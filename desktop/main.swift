// Petdex for DeepSeek Harness — desktop companion.
//
// A transparent, always-on-top, borderless window that draws the active pet
// from $PETDEX_HOME (the DSH pet library) with a WKWebView, so the pet keeps
// living after Harness closes. All state is file-driven:
//
//   <pets>/.petdex/ui.json        active pet, visible, scale, bubble settings
//   <pets>/.petdex/activity.json  last session event { seq, state, text, hold }
//   <pets>/.petdex/app.pid        this process, so the plugin never double-starts
//
// The page reports its natural size back, and the window resizes around it.

import AppKit
import WebKit
import Darwin

let petsRoot: URL = {
    if let raw = ProcessInfo.processInfo.environment["PETDEX_HOME"], !raw.isEmpty {
        return URL(fileURLWithPath: raw, isDirectory: true)
    }
    return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".dsh/pets", isDirectory: true)
}()

let configDir = petsRoot.appendingPathComponent(".petdex", isDirectory: true)
let uiURL = configDir.appendingPathComponent("ui.json")
let activityURL = configDir.appendingPathComponent("activity.json")
let pidURL = configDir.appendingPathComponent("app.pid")

func readJSON(_ url: URL) -> [String: Any] {
    guard let data = try? Data(contentsOf: url),
          let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return [:] }
    return object
}

func writeJSON(_ object: [String: Any], to url: URL) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    else { return }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? data.write(to: url, options: .atomic)
}

struct Settings {
    var active: String?
    var enabled: Bool
    var visible: Bool
    var scale: Double
    var bubbles: Bool
    var bubbleFontSize: Double
    var bubbleMaxWidth: Double
    var bubbleLifetime: Double
    var bubbleColor: String
    var bubbleOpacity: Double
    var bubbleTextColor: String
    var clickThrough: Bool

    static func load() -> Settings {
        let raw = readJSON(uiURL)
        func flag(_ key: String, _ fallback: Bool) -> Bool {
            (raw[key] as? Bool) ?? fallback
        }
        func number(_ key: String, _ fallback: Double) -> Double {
            (raw[key] as? NSNumber)?.doubleValue ?? fallback
        }
        let active = (raw["active"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return Settings(
            active: active,
            enabled: flag("enabled", true),
            visible: flag("visible", true),
            scale: min(max(number("scale", 1), 0.4), 2.4),
            bubbles: flag("bubbles", true),
            bubbleFontSize: min(max(number("bubbleFontSize", 13), 9), 28),
            bubbleMaxWidth: min(max(number("bubbleMaxWidth", 320), 120), 640),
            bubbleLifetime: min(max(number("bubbleLifetime", 8), 0), 60),
            bubbleColor: (raw["bubbleColor"] as? String) ?? "#0f0f0f",
            bubbleOpacity: min(max(number("bubbleOpacity", 100), 0), 100),
            bubbleTextColor: (raw["bubbleTextColor"] as? String) ?? "#ffffff",
            clickThrough: flag("clickThrough", false)
        )
    }
}

func spriteFile(for slug: String) -> (name: String, version: Int)? {
    let directory = petsRoot.appendingPathComponent(slug, isDirectory: true)
    for name in ["spritesheet.webp", "spritesheet.png"] {
        let file = directory.appendingPathComponent(name)
        if let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
           let modified = attributes[.modificationDate] as? Date {
            return (name, Int(modified.timeIntervalSince1970))
        }
    }
    return nil
}

func mimeType(for pathExtension: String) -> String {
    switch pathExtension.lowercased() {
    case "html": return "text/html"
    case "js": return "text/javascript"
    case "css": return "text/css"
    case "json": return "application/json"
    case "webp": return "image/webp"
    case "png": return "image/png"
    case "svg": return "image/svg+xml"
    default: return "application/octet-stream"
    }
}

private let errorNotFound = NSError(
    domain: "dev.dsh.petdex", code: 404,
    userInfo: [NSLocalizedDescriptionKey: "not found"])

/// Serves the bundled page at petdex://app/ and pet files at petdex://pet/<slug>/<file>.
final class PetSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(errorNotFound)
            return
        }
        let host = url.host ?? ""
        let path = url.path
        var target: URL?
        if host == "app" {
            let name = String(path.dropFirst(path.hasPrefix("/") ? 1 : 0))
            if !name.contains(".."), let web = Bundle.main.resourceURL?.appendingPathComponent("web") {
                target = web.appendingPathComponent(name)
            }
        } else if host == "pet" {
            let name = String(path.dropFirst(path.hasPrefix("/") ? 1 : 0))
            let parts = name.split(separator: "/")
            if parts.count == 2, !name.contains("..") {
                target = petsRoot
                    .appendingPathComponent(String(parts[0]), isDirectory: true)
                    .appendingPathComponent(String(parts[1]))
            }
        }
        guard let file = target, let data = try? Data(contentsOf: file) else {
            task.didFailWithError(errorNotFound)
            return
        }
        let response = URLResponse(
            url: url, mimeType: mimeType(for: file.pathExtension),
            expectedContentLength: data.count, textEncodingName: nil)
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var schemeHandler: PetSchemeHandler!
    private var timer: Timer?
    private var clickMonitor: Any?
    private var dragTimer: Timer?
    private var dragging = false
    private var dragMoved = false
    private var dragStartMouse = NSPoint.zero
    private var dragStartFrame = NSPoint.zero
    private var dragStartTime = Date()
    private var lastDragDirection: String?
    /// Harness process that spawned this pet; exit with it so closing or
    /// crashing Harness never leaves an orphan pet behind.
    private var parentPID: Int32?
    private var parentTimer: Timer?
    /// Bubble hit regions reported by the page, in web-view coordinates.
    private var bubbleRegions: [CGRect] = []
    private var settings = Settings.load()
    private var lastUIData = Data()
    private var ready = false
    private let debug = ProcessInfo.processInfo.environment["PETDEX_DEBUG"] == "1"

    private func debugLog(_ message: String) {
        guard debug else { return }
        let line = "\(Date().timeIntervalSince1970) \(message)\n"
        let file = configDir.appendingPathComponent("app.log")
        if let handle = FileHandle(forWritingAtPath: file.path) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? line.write(to: file, atomically: true, encoding: .utf8)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        try? "\(ProcessInfo.processInfo.processIdentifier)"
            .write(to: pidURL, atomically: true, encoding: .utf8)

        if let raw = ProcessInfo.processInfo.environment["PETDEX_PARENT_PID"], let pid = Int32(raw), pid > 1 {
            parentPID = pid
            parentTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                guard let self, let parent = self.parentPID else { return }
                // ESRCH means the Harness process is gone; EPERM still means it exists.
                if kill(parent, 0) != 0 && errno == ESRCH {
                    NSApp.terminate(nil)
                }
            }
            if let timer = parentTimer { RunLoop.main.add(timer, forMode: .common) }
        }

        let screen = NSScreen.main ?? NSScreen.screens.first
        let visibleFrame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let raw = readJSON(uiURL)
        // Start wide enough for the widest configured bubble: the page sizes
        // itself, but a too-narrow initial viewport would clamp the bubble and
        // then keep shrinking it on every resize.
        let width = CGFloat(settings.bubbleMaxWidth + 16)
        let height: CGFloat = 360
        let startX = (raw["x"] as? NSNumber)?.doubleValue ?? (visibleFrame.maxX - width - 48)
        let startY = (raw["y"] as? NSNumber)?.doubleValue ?? (visibleFrame.minY + 72)

        window = NSWindow(
            contentRect: NSRect(x: startX, y: startY, width: width, height: height),
            styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        window.ignoresMouseEvents = false
        window.alphaValue = 0

        let configuration = WKWebViewConfiguration()
        schemeHandler = PetSchemeHandler()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "petdex")
        configuration.userContentController.add(self, name: "petdex")

        webView = WKWebView(
            frame: NSRect(origin: .zero, size: NSSize(width: width, height: height)),
            configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        
        // WKWebView paints a white background by default. Even with the window and
        // CSS set to transparent, the whole pet shows up as a white rectangle without this.
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = .clear }

        webView.navigationDelegate = self
        window.contentView = webView
        window.orderFrontRegardless()
        webView.load(URLRequest(url: URL(string: "petdex://app/index.html")!))

        applySettings()
        timer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] _ in
            self?.poll()
        }
        if let timer { RunLoop.main.add(timer, forMode: .common) }

        clickMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] event in
            guard let self, let window = self.window, event.window === window,
                  !window.ignoresMouseEvents else { return event }

            // A click on a bubble belongs to the page: let WebKit deliver it so
            // the page can expand the stack or open the session.
            let point = self.webView.convert(event.locationInWindow, from: nil)
            if self.bubbleRegions.contains(where: { $0.contains(point) }) {
                return event
            }

            self.dragging = true
            self.dragMoved = false
            self.dragStartMouse = NSEvent.mouseLocation
            self.dragStartFrame = window.frame.origin
            self.dragStartTime = Date()
            self.lastDragDirection = nil

            // Drive the drag from a timer instead of mouseDragged events: the
            // window must stay draggable while WebKit is busy rendering a
            // streaming reply, and the timer also works when the pointer leaves
            // the small pet window.
            self.dragTimer?.invalidate()
            let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
                self?.dragTick()
            }
            self.dragTimer = timer
            RunLoop.main.add(timer, forMode: .common)
            return nil
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        parentTimer?.invalidate()
        stopDragTimer()
        if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }
        try? FileManager.default.removeItem(at: pidURL)
    }

    private func stopDragTimer() {
        dragTimer?.invalidate()
        dragTimer = nil
    }

    private func dragTick() {
        guard dragging, let window = self.window else {
            stopDragTimer()
            return
        }
        // A short grace period avoids treating the mouseDown frame itself as a
        // release if the hardware state has not settled yet.
        if Date().timeIntervalSince(dragStartTime) > 0.05 && NSEvent.pressedMouseButtons & 1 == 0 {
            dragging = false
            stopDragTimer()
            if dragMoved {
                persistPosition()
                sendDragEnd()
            } else {
                sendClick()
            }
            return
        }

        let current = NSEvent.mouseLocation
        let dx = current.x - dragStartMouse.x
        let dy = current.y - dragStartMouse.y
        if abs(dx) > 2 || abs(dy) > 2 { dragMoved = true }
        window.setFrameOrigin(NSPoint(x: dragStartFrame.x + dx, y: dragStartFrame.y + dy))

        if abs(dx) > 2 {
            let direction = dx > 0 ? "right" : "left"
            if direction != lastDragDirection {
                lastDragDirection = direction
                sendDrag(direction)
            }
        }
    }

    private func poll() {
        let data = (try? Data(contentsOf: uiURL)) ?? Data()
        if data != lastUIData {
            lastUIData = data
            settings = Settings.load()
            applySettings()
        }
        pushState()
    }

    private func applySettings() {
        guard window != nil else { return }
        if !settings.enabled {
            NSApp.terminate(nil)
            return
        }
        if ready {
            window.alphaValue = settings.visible ? 1 : 0
        }
        window.ignoresMouseEvents = !settings.visible || settings.clickThrough
    }

    private func payload() -> [String: Any] {
        var result: [String: Any] = [
            "scale": settings.scale,
            "bubbles": settings.bubbles,
            "fontSize": settings.bubbleFontSize,
            "maxWidth": settings.bubbleMaxWidth,
            "lifetime": settings.bubbleLifetime,
            "bubbleColor": settings.bubbleColor,
            "bubbleOpacity": settings.bubbleOpacity,
            "bubbleTextColor": settings.bubbleTextColor,
            "visible": settings.visible,
        ]
        if let active = settings.active, let sprite = spriteFile(for: active) {
            result["active"] = active
            result["sprite"] = "petdex://pet/\(active)/\(sprite.name)?v=\(sprite.version)"
        }
        result["activity"] = readJSON(activityURL)
        return result
    }

    private func pushState() {
        guard webView != nil else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload()),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__petdex && window.__petdex(\(json));", completionHandler: nil)
    }

    private func sendClick() {
        webView.evaluateJavaScript("window.__petdexClick && window.__petdexClick();", completionHandler: nil)
    }

    private func sendDrag(_ direction: String) {
        webView.evaluateJavaScript("window.__petdexDrag && window.__petdexDrag('\(direction)');", completionHandler: nil)
    }

    private func sendDragEnd() {
        webView.evaluateJavaScript("window.__petdexDragEnd && window.__petdexDragEnd();", completionHandler: nil)
    }

    private func persistPosition() {
        var raw = readJSON(uiURL)
        raw["x"] = Int(window.frame.origin.x.rounded())
        raw["y"] = Int(window.frame.origin.y.rounded())
        writeJSON(raw, to: uiURL)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        debugLog("page loaded")
        ready = true
        applySettings()
        if settings.visible { window.alphaValue = 1 }
        pushState()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        debugLog("navigation failed: \(error)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        debugLog("provisional navigation failed: \(error)")
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        debugLog("message \(type) \(body)")
        switch type {
        case "size":
            let width = (body["width"] as? NSNumber)?.doubleValue ?? 0
            let height = (body["height"] as? NSNumber)?.doubleValue ?? 0
            resize(width: width, height: height)
        case "regions":
            // The page reports bubble rectangles in top-left origin CSS pixels.
            // Convert them to the web view's bottom-left coordinate space.
            let height = webView.bounds.height
            var rects: [CGRect] = []
            if let list = body["regions"] as? [[String: Any]] {
                for item in list {
                    let x = (item["x"] as? NSNumber)?.doubleValue ?? 0
                    let y = (item["y"] as? NSNumber)?.doubleValue ?? 0
                    let w = (item["w"] as? NSNumber)?.doubleValue ?? 0
                    let h = (item["h"] as? NSNumber)?.doubleValue ?? 0
                    if w <= 0 || h <= 0 { continue }
                    rects.append(CGRect(x: x, y: height - y - h, width: w, height: h))
                }
            }
            bubbleRegions = rects
        case "open":
            if let raw = body["url"] as? String, let url = URL(string: raw),
               ["dsh", "http", "https"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            } else if let sessionId = body["sessionId"] as? String {
                debugLog("open session \(sessionId) without a URL")
            }
        case "ready":
            ready = true
            applySettings()
            if settings.visible { window.alphaValue = 1 }
            pushState()
        default:
            break
        }
    }

    private func resize(width: Double, height: Double) {
        guard window != nil else { return }
        let targetWidth = max(80, min(width.rounded(.up), 1200))
        let targetHeight = max(60, min(height.rounded(.up), 1200))
        var frame = window.frame
        guard abs(frame.width - targetWidth) > 0.5 || abs(frame.height - targetHeight) > 0.5 else { return }
        frame.size = NSSize(width: targetWidth, height: targetHeight)
        window.setFrame(frame, display: true)
        // Region coordinates were reported for the previous viewport; the page
        // reports fresh ones after this resize.
        bubbleRegions = []
        debugLog("resize \(Int(targetWidth))x\(Int(targetHeight)) at \(Int(window.frame.origin.x)),\(Int(window.frame.origin.y))")
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
