#!/bin/sh
# Builds PetdexPet.app next to this script. Requires the macOS command line
# tools (swiftc); no third-party dependency, no network access.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HERE/PetdexPet.app"
BIN="$APP/Contents/MacOS/PetdexPet"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$HERE/web/index.html" "$APP/Contents/Resources/web/index.html"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleExecutable</key><string>PetdexPet</string>
  <key>CFBundleIdentifier</key><string>dev.dsh.petdex.pet</string>
  <key>CFBundleName</key><string>PetdexPet</string>
  <key>CFBundleDisplayName</key><string>Petdex</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

mkdir -p "$HERE/.build-cache"
export CLANG_MODULE_CACHE_PATH="$HERE/.build-cache"
swiftc -O -swift-version 5 -module-cache-path "$HERE/.build-cache" -o "$BIN" "$HERE/main.swift" \
  -framework AppKit -framework WebKit

codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "built $APP"
