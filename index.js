/**
 * Petdex pets for DeepSeek Harness — Host half.
 *
 * Owns a pet library under `$DSH_HOME/pets`, downloads pets from petdex.dev in
 * the same format Codex and Petdex use (pet.json + an 8-column sprite atlas),
 * and runs the bundled desktop companion (desktop/PetdexPet.app on macOS,
 * desktop/windows/PetPal.exe on Windows). The companion is its own process, not
 * page content, so the pet stays on screen when the Harness window is closed;
 * it watches `PETDEX_PARENT_PID` and exits within 2s of Harness going away, so a
 * quit never leaves an orphan behind.
 *
 * Everything the companion needs is a file under `<pets>/.petdex`:
 *   ui.json        active pet + appearance settings (also written by the app
 *                  when the pet is dragged, so reads always merge first)
 *   activity.json  last session event projected for the sprite and bubble
 *   app.pid        the companion's process id
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PREFIX = '/petdex'
const SITE = 'https://petdex.dev'
const ASSET_HOST = 'assets.petdex.dev'
const MAX_SPRITE_BYTES = 24 * 1024 * 1024
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/
const MAX_BODY_BYTES = 64 * 1024
const MAX_CLIENT_LOG_BYTES = 256 * 1024
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
// The Client half is normally injected by the web boot graph. That graph can be
// computed before this bundle's row activates (the window then loads a page
// without the settings section), so the Host also appends the module itself.
const CLIENT_BUILD = Date.now().toString(36)
const CLIENT_SCRIPT = join(PACKAGE_DIR, 'client.js')

const DESKTOP_APPS = {
  darwin: join(PACKAGE_DIR, 'desktop', 'PetdexPet.app', 'Contents', 'MacOS', 'PetdexPet'),
  win32: join(PACKAGE_DIR, 'desktop', 'windows', 'PetPal.exe'),
}

const DEFAULT_UI = {
  active: null,
  enabled: true,
  visible: true,
  scale: 1,
  bubbles: true,
  bubbleFontSize: 13,
  bubbleMaxWidth: 320,
  bubbleLifetime: 8,
  bubbleColor: '#0f0f0f',
  bubbleOpacity: 100,
  bubbleTextColor: '#ffffff',
  clickThrough: false,
  enableNotifications: false,
  webhookUrl: '',
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function petsDir() {
  return join(dshHome(), 'pets')
}

function configDir() {
  return join(petsDir(), '.petdex')
}

function uiPath() {
  return join(configDir(), 'ui.json')
}

function activityPath() {
  return join(configDir(), 'activity.json')
}

function pidPath() {
  return join(configDir(), 'app.pid')
}

function clientErrorPath() {
  return join(configDir(), 'client-error.log')
}

function clampNumber(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max))
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function timeoutSignal(ms) {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}

async function fetchUpstream(url) {
  let response
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { referer: `${SITE}/`, 'user-agent': 'dsh-petpal/1.1 (+https://petdex.dev)' },
      signal: timeoutSignal(30000),
    })
  } catch (error) {
    throw new HttpError(502, `Petdex 请求失败 / Petdex request failed: ${String(error?.message ?? error)}`)
  }
  if (!response.ok) {
    throw new HttpError(404, `Petdex 上没有找到这只宠物 / Pet was not found on Petdex (${response.status})`)
  }
  return response
}

// ---------------------------------------------------------------------------
// Library state

function sanitizeUI(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    active: typeof source.active === 'string' && SLUG_PATTERN.test(source.active) ? source.active : null,
    enabled: source.enabled !== false,
    visible: source.visible !== false,
    scale: clampNumber(source.scale, DEFAULT_UI.scale, 0.4, 2.4),
    bubbles: source.bubbles !== false,
    bubbleFontSize: clampInteger(source.bubbleFontSize, DEFAULT_UI.bubbleFontSize, 9, 28),
    bubbleMaxWidth: clampInteger(source.bubbleMaxWidth, DEFAULT_UI.bubbleMaxWidth, 140, 640),
    bubbleLifetime: clampNumber(source.bubbleLifetime, DEFAULT_UI.bubbleLifetime, 0, 60),
    bubbleColor: /^#[0-9a-f]{6}$/i.test(source.bubbleColor) ? source.bubbleColor.toLowerCase() : DEFAULT_UI.bubbleColor,
    bubbleOpacity: clampInteger(source.bubbleOpacity, DEFAULT_UI.bubbleOpacity, 0, 100),
    bubbleTextColor: /^#[0-9a-f]{6}$/i.test(source.bubbleTextColor) ? source.bubbleTextColor.toLowerCase() : DEFAULT_UI.bubbleTextColor,
    clickThrough: source.clickThrough === true,
    enableNotifications: source.enableNotifications === true,
    webhookUrl: typeof source.webhookUrl === 'string' ? source.webhookUrl.trim() : '',
  }
}

async function readUIRaw() {
  try {
    const parsed = JSON.parse(await readFile(uiPath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function readUI() {
  return sanitizeUI(await readUIRaw())
}

async function writeUI(patch) {
  const raw = await readUIRaw()
  const merged = { ...raw, ...(patch ?? {}) }
  // Unknown keys (the drag coordinates the companion writes) survive.
  const normalized = { ...merged, ...sanitizeUI(merged) }
  await mkdir(configDir(), { recursive: true })
  await writeFile(uiPath(), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return sanitizeUI(normalized)
}

async function spriteFileFor(directory, pet) {
  const declared = typeof pet.spritesheetPath === 'string' ? pet.spritesheetPath.replace(/^.*[/\\]/, '') : ''
  const candidates = [declared, 'spritesheet.webp', 'spritesheet.png'].filter(
    name => /^[a-z0-9._-]+$/i.test(name) && /\.(webp|png)$/i.test(name),
  )
  for (const name of new Set(candidates)) {
    try {
      const info = await stat(join(directory, name))
      if (info.isFile()) return { file: name, info }
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

async function listPets() {
  let entries
  try {
    entries = await readdir(petsDir(), { withFileTypes: true })
  } catch {
    return []
  }
  const pets = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG_PATTERN.test(entry.name)) continue
    const directory = join(petsDir(), entry.name)
    let pet
    try {
      pet = JSON.parse(await readFile(join(directory, 'pet.json'), 'utf8'))
    } catch {
      continue
    }
    const sprite = await spriteFileFor(directory, pet)
    if (sprite === undefined) continue
    pets.push({
      slug: entry.name,
      name: typeof pet.displayName === 'string' && pet.displayName.trim() ? pet.displayName : entry.name,
      description: typeof pet.description === 'string' ? pet.description : '',
      file: sprite.file,
      bytes: sprite.info.size,
      updatedAt: Math.round(sprite.info.mtimeMs),
    })
  }
  pets.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return pets
}

// ---------------------------------------------------------------------------
// Desktop companion

async function appPid() {
  try {
    const pid = Number.parseInt((await readFile(pidPath(), 'utf8')).trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function appRunning() {
  const pid = await appPid()
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Access denied still means the process exists (for example when it was
    // started by a sibling process with a different token).
    if (error?.code === 'EPERM') return true
    await rm(pidPath(), { force: true })
    return false
  }
}

/** The companion binary bundled for this platform, or null when unsupported. */
function desktopAppPath() {
  return DESKTOP_APPS[process.platform] ?? null
}

function appAvailable() {
  const path = desktopAppPath()
  return path !== null && existsSync(path)
}

async function startApp() {
  const path = desktopAppPath()
  if (path === null || !existsSync(path)) {
    throw new HttpError(
      500,
      '桌面宠物组件不可用：安装包里缺少当前系统的桌面组件。 / Desktop companion is not available: the install is missing the binary for this platform.',
    )
  }
  if (await appRunning()) return false
  await mkdir(configDir(), { recursive: true })

  const child = spawn(path, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, PETDEX_HOME: petsDir(), PETDEX_PARENT_PID: String(process.pid) },
  })

  // Windows WinExe apps report a missing/broken install asynchronously; wait
  // for Node's spawn result so the settings page can show the real error
  // instead of an optimistic "running" state.
  let spawnError = null
  child.on('error', error => {
    spawnError = error
  })
  const spawned = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 5000)
    child.once('spawn', () => {
      clearTimeout(timer)
      resolve(true)
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  if (!spawned) {
    child.unref()
    throw new HttpError(
      500,
      `无法启动桌面宠物 / Failed to start the desktop companion: ${spawnError?.message ?? 'unknown error'}`,
    )
  }

  child.unref()
  return true
}

async function stopApp() {
  const pid = await appPid()
  if (pid === null) return false
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    // On Windows a process started outside our token may refuse SIGTERM;
    // taskkill is the portable fallback there.
    if (process.platform === 'win32' && error?.code === 'EPERM') {
      try {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        killer.on('error', () => {})
        killer.unref()
      } catch {
        // already gone
      }
    }
  }
  await rm(pidPath(), { force: true })
  return true
}

async function snapshot() {
  const [ui, pets, running] = await Promise.all([readUI(), listPets(), appRunning()])
  return {
    active: pets.some(pet => pet.slug === ui.active) ? ui.active : (pets[0]?.slug ?? null),
    pets,
    ui,
    desktop: running,
    appAvailable: appAvailable(),
    home: petsDir(),
  }
}

/**
 * Petdex's installer is a tiny shell script that downloads `pet.json` and a
 * spritesheet from assets.petdex.dev. Read those URLs so the same download can
 * be written straight into the DSH library, with no Codex install required.
 */
function parseInstallScript(script) {
  const re = /-o\s+"\$PET_DIR\/([^"]+)"\s+'([^']+)'/g
  const files = new Map()
  let match
  while ((match = re.exec(script)) !== null) {
    const [, name, raw] = match
    if (!/^[a-z0-9._-]+$/i.test(name)) continue
    let url
    try {
      url = new URL(raw)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || url.hostname !== ASSET_HOST) continue
    files.set(name, url.href)
  }
  const petJson = files.get('pet.json')
  const spriteEntry = [...files.entries()].find(([name]) => /^spritesheet\.(webp|png)$/.test(name))
  return { petJson, sprite: spriteEntry?.[1], spriteName: spriteEntry?.[0] }
}

function looksLikeSprite(bytes) {
  if (bytes.length < 1024) return false
  const riff = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  const png = bytes.subarray(1, 4).toString('ascii') === 'PNG'
  return riff || png
}

async function lookupPetdex(url, response) {
  const slug = (url.searchParams.get('slug') ?? '').trim()
  if (!SLUG_PATTERN.test(slug)) {
    throw new HttpError(400, '无效的宠物标识 / Invalid pet slug')
  }

  // Resolve through the installer, which works for every published pet:
  // its script names the metadata URL, and pet.json carries the display fields.
  let script
  try {
    script = await (await fetchUpstream(`${SITE}/install/${encodeURIComponent(slug)}`)).text()
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError(404, `Petdex 上没有找到「${slug}」。请检查宠物标识或宠物页面链接。`)
    }
    throw error
  }
  const files = parseInstallScript(script)
  if (!files.petJson) {
    throw new HttpError(404, `Petdex 上没有找到 ${slug} / ${slug} was not found on Petdex`)
  }

  let pet
  try {
    pet = JSON.parse(await (await fetchUpstream(files.petJson)).text())
  } catch {
    throw new HttpError(502, '宠物元数据不是合法 JSON / Pet metadata is not valid JSON')
  }

  sendJson(response, 200, {
    pet: {
      slug,
      name: typeof pet.displayName === 'string' && pet.displayName.trim() ? pet.displayName : slug,
      description: typeof pet.description === 'string' ? pet.description : '',
      kind: typeof pet.kind === 'string' ? pet.kind : undefined,
    },
  })
}

async function thumbPetdex(url, response) {
  const slug = url.searchParams.get('slug') ?? ''
  if (!SLUG_PATTERN.test(slug)) {
    sendJson(response, 400, { error: '无效的宠物标识 / Invalid pet slug' })
    return
  }
  const upstream = await fetchUpstream(`${SITE}/api/pets/${encodeURIComponent(slug)}/thumb`)
  const bytes = Buffer.from(await upstream.arrayBuffer())
  if (bytes.length > 4 * 1024 * 1024) {
    sendJson(response, 502, { error: '缩略图过大 / Thumbnail too large' })
    return
  }
  response.writeHead(200, {
    'cache-control': 'public, max-age=86400, immutable',
    'content-type': upstream.headers.get('content-type') ?? 'image/webp',
    'content-length': String(bytes.length),
  })
  response.end(bytes)
}

async function installPet(slug, activate) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new HttpError(400, '无效的宠物标识 / Invalid pet slug')
  }

  const script = await (await fetchUpstream(`${SITE}/install/${encodeURIComponent(slug)}`)).text()
  const files = parseInstallScript(script)
  if (!files.petJson || !files.sprite || !files.spriteName) {
    throw new HttpError(404, `Petdex 上没有找到 ${slug} / ${slug} is not installable from Petdex`)
  }

  let pet
  try {
    pet = JSON.parse(await (await fetchUpstream(files.petJson)).text())
  } catch {
    throw new HttpError(502, '宠物元数据不是合法 JSON / Pet metadata is not valid JSON')
  }

  const spriteBytes = Buffer.from(await (await fetchUpstream(files.sprite)).arrayBuffer())
  if (spriteBytes.length > MAX_SPRITE_BYTES) {
    throw new HttpError(502, '雪碧图超过大小上限 / Sprite exceeds the size limit')
  }
  if (!looksLikeSprite(spriteBytes)) {
    throw new HttpError(502, '下载到的不是图片 / The download is not an image')
  }

  const directory = join(petsDir(), slug)
  await mkdir(directory, { recursive: true })
  pet.spritesheetPath = files.spriteName
  pet.id = typeof pet.id === 'string' && pet.id ? pet.id : slug

  // Sprite first, manifest last: pet.json marks a complete install.
  await writeFile(join(directory, files.spriteName), spriteBytes)
  await writeFile(join(directory, 'pet.json'), `${JSON.stringify(pet, null, 2)}\n`, 'utf8')
  for (const name of ['spritesheet.webp', 'spritesheet.png']) {
    if (name !== files.spriteName) await rm(join(directory, name), { force: true })
  }

  if (activate !== false) await writeUI({ active: slug })
  return { slug, name: typeof pet.displayName === 'string' ? pet.displayName : slug }
}

async function removePet(slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new HttpError(400, '无效的宠物标识 / Invalid pet slug')
  }
  const directory = join(petsDir(), slug)
  try {
    await stat(directory)
  } catch {
    throw new HttpError(404, `宠物 ${slug} 没有安装 / ${slug} is not installed`)
  }
  await rm(directory, { recursive: true, force: true })
  const ui = await readUI()
  if (ui.active === slug) {
    const remaining = await listPets()
    await writeUI({ active: remaining[0]?.slug ?? null })
  }
  return snapshot()
}

// ---------------------------------------------------------------------------
// 企业微信机器人通知 / WeChat Work Bot Notification

/**
 * 发送企业微信机器人消息
 * Send message via WeChat Work bot webhook
 */
async function sendWeChatNotification(webhookUrl, message) {
  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('https://')) {
    return
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'text',
        text: {
          content: message,
        },
      }),
      signal: timeoutSignal(5000),
    })

    if (!response.ok) {
      console.warn('[petdex] WeChat notification failed:', response.status)
    }
  } catch (error) {
    console.warn('[petdex] WeChat notification error:', error?.message ?? error)
  }
}

/**
 * 格式化会话状态通知消息
 * Format session status notification message
 */
function formatNotificationMessage(session, event, data) {
  const title = sessionTitle(session)
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

  if (event === 'approval/asked') {
    const question = typeof data.title === 'string' ? data.title : '需要您的确认'
    return `🔔 DeepSeek Harness 通知

会话：${title}
状态：等待操作
问题：${question}

时间：${timestamp}`
  }

  if (event === 'turn/end') {
    const reason = data.reason?.kind
    let statusText = '已完成'
    let emoji = '✅'

    if (reason === 'blocked' || reason === 'max-tokens') {
      statusText = '等待操作'
      emoji = '⏸️'
    } else if (reason !== 'completed') {
      statusText = '出错了'
      emoji = '❌'
      if (data.reason?.error?.message) {
        statusText += `：${truncate(data.reason.error.message, 60)}`
      }
    }

    const tokensText = session.activity.tokens > 0 ? `\n输出token：${session.activity.tokens}` : ''

    return `${emoji} DeepSeek Harness 通知

会话：${title}
状态：${statusText}${tokensText}

时间：${timestamp}`
  }

  return null
}

// ---------------------------------------------------------------------------
// Session activity → sprite state + bubble

const SESSION_IDLE_MS = 10 * 60 * 1000
const MAX_SESSIONS = 5
const WRITE_INTERVAL_MS = 160

let sequence = 0
let writeTimer = null
let sessionTitleService = null

/**
 * Per-session activity state. The desktop companion renders one bubble per
 * session, so every session keeps its own label, stream buffers and revision.
 */
const sessions = new Map()

function sessionState(id) {
  let session = sessions.get(id)
  if (session === undefined) {
    session = {
      id,
      title: '',
      firstPrompt: '',
      updatedAt: Date.now(),
      rev: 0,
      hydrated: false,
      finished: false,
      lastMessage: '',
      activity: {
        state: 'idle',
        status: null,
        label: null,
        detail: null,
        tokens: 0,
        hold: false,
      },
      streaming: {
        reasoning: '',
        text: '',
        toolName: '',
        toolArgs: '',
      },
    }
    sessions.set(id, session)
  }
  return session
}

function truncate(text, maxLength) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength - 1)}…`
}

function trimDetail(text, maxLength = 240) {
  if (!text) return null
  if (text.length <= maxLength) return text
  return `…${text.slice(-maxLength).replace(/^\S*\s+/, '')}`
}

/** DSH's one-line detail rules: whitespace collapsed, 160 chars, ellipsis. */
const LIVE_TOOL_DETAIL_MAX_CHARS = 160
const LIVE_TOOL_DETAIL_KEYS = [
  'title',
  'description',
  'objective',
  'task',
  'task_name',
  'name',
  'question',
  'questions',
  'prompt',
  'message',
  'command',
  'cmd',
  'queries',
  'query',
  'pattern',
  'url',
  'uri',
  'file_path',
  'path',
  'target',
  'action',
  'status',
]

function normalizeLiveText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  const chars = Array.from(text)
  if (chars.length <= LIVE_TOOL_DETAIL_MAX_CHARS) return text
  return `${chars.slice(0, LIVE_TOOL_DETAIL_MAX_CHARS - 1).join('').trimEnd()}…`
}

function liveDetailValue(key, value) {
  if (key === 'questions' && Array.isArray(value)) {
    for (const item of value) {
      if (item === null || typeof item !== 'object') continue
      const detail = normalizeLiveText(item.question)
      if (detail !== '') return detail
    }
    return ''
  }
  if (typeof value === 'string') return normalizeLiveText(value)
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return normalizeLiveText(value.join(', '))
  }
  return ''
}

/** Last non-empty reasoning paragraph, with DSH's markdown cleanup. */
function liveReasoningDetail(text) {
  const paragraphs = String(text ?? '').split(/\r?\n[\t ]*\r?\n/)
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const detail = normalizeLiveText((paragraphs[index] ?? '').replaceAll('**', ''))
    if (detail !== '') return detail
  }
  return ''
}

function decodeJsonString(raw) {
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw
  }
}

function formatToolArgs(argsJson) {
  if (typeof argsJson !== 'string' || argsJson === '') return null

  let args
  try {
    args = JSON.parse(argsJson)
  } catch {
    args = null
  }

  if (args !== null && typeof args === 'object') {
    for (const key of LIVE_TOOL_DETAIL_KEYS) {
      if (!Object.hasOwn(args, key)) continue
      const detail = liveDetailValue(key, args[key])
      if (detail !== '') return detail
    }
    return null
  }

  // Arguments still streaming: read the first known key that has a string value.
  for (const key of LIVE_TOOL_DETAIL_KEYS) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(argsJson)
    if (match === null) continue
    const detail = normalizeLiveText(decodeJsonString(match[1]))
    if (detail !== '') return detail
  }
  return normalizeLiveText(argsJson) || null
}

const TOOL_COPY = {
  bash: { ready: '准备运行命令', running: '正在运行命令', done: '执行了命令' },
  read: { ready: '准备读取文件', running: '正在读取文件', done: '已读取文件' },
  read_image: { ready: '准备读取图片', running: '正在读取图片', done: '已读取图片' },
  write: { ready: '准备写入文件', running: '正在写入文件', done: '已写入文件' },
  edit: { ready: '准备编辑文件', running: '正在编辑文件', done: '修改了文件' },
  grep: { ready: '准备搜索代码', running: '正在搜索代码', done: '已搜索代码' },
  glob: { ready: '准备搜索代码', running: '正在搜索代码', done: '已搜索代码' },
  web_search: { ready: '准备搜索网页', running: '正在搜索网页', done: '已搜索网页' },
  web_fetch: { ready: '准备访问网页', running: '正在访问网页', done: '已访问网页' },
  subagent: { ready: '准备协调子智能体', running: '正在协调子智能体', done: '已协调子智能体' },
  subagent_fork: { ready: '准备协调子智能体', running: '正在协调子智能体', done: '已协调子智能体' },
  workflow: { ready: '准备运行工作流', running: '正在运行工作流', done: '工作流已完成' },
  todo_write: { ready: '准备更新计划', running: '正在更新计划', done: '更新了计划' },
  schedule_create: { ready: '准备创建提醒', running: '正在创建提醒', done: '已创建提醒' },
  schedule_update: { ready: '准备更新提醒', running: '正在更新提醒', done: '已更新提醒' },
}

function toolCopy(name, phase) {
  const entry = TOOL_COPY[name] ?? { ready: '准备调用工具', running: '正在调用工具', done: '已调用工具' }
  return entry[phase]
}

function sessionTitle(session) {
  if (session.title) return truncate(session.title, 40)
  if (session.firstPrompt) return truncate(session.firstPrompt, 36)
  return '新会话'
}

function updateSession(session, patch) {
  Object.assign(session.activity, patch)
  session.rev += 1
  session.updatedAt = Date.now()
  scheduleActivityWrite()
}

function scheduleActivityWrite() {
  if (writeTimer !== null) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    void flushActivity().catch(() => {})
  }, WRITE_INTERVAL_MS)
}

/**
 * 从消息数据中提取文本内容
 * Extract text content from message data
 */
function textFromMessage(message) {
  if (!message || typeof message !== 'object') return ''
  
  // 处理字符串消息
  if (typeof message === 'string') return message.trim()
  
  // 处理对象消息
  if (typeof message.text === 'string') return message.text.trim()
  if (typeof message.content === 'string') return message.content.trim()
  
  // 处理数组内容
  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
        return item.text.trim()
      }
    }
  }
  
  return ''
}

async function flushActivity() {
  const now = Date.now()
  for (const [id, session] of sessions.entries()) {
    if (now - session.updatedAt > SESSION_IDLE_MS) sessions.delete(id)
  }

  // Fill titles for sessions whose first events predate the title service
  // becoming available (or whose log scan happened before the title existed).
  if (sessionTitleService !== null && typeof sessionTitleService.get === 'function') {
    for (const session of sessions.values()) {
      if (session.title !== '' || session.session === undefined) continue
      try {
        const snapshot = sessionTitleService.get(session.session)
        if (snapshot !== undefined && typeof snapshot.title === 'string' && snapshot.title.trim() !== '') {
          session.title = snapshot.title.trim()
          session.rev += 1
        }
      } catch {
        // Best-effort; the live session/title event still updates it.
      }
    }
  }

  const list = [...sessions.values()]
    .filter(session => session.activity.label !== null || session.activity.status !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map(session => ({
      id: session.id,
      title: sessionTitle(session),
      state: session.activity.state,
      status: session.activity.status,
      label: session.activity.label,
      detail: session.activity.detail,
      tokens: session.activity.tokens,
      hold: session.activity.hold,
      rev: session.rev,
      updatedAt: session.updatedAt,
      open: 'dsh://open',
    }))

  sequence += 1
  const payload = { seq: sequence, at: now, sessions: list }
  await mkdir(configDir(), { recursive: true })
  await writeFile(activityPath(), `${JSON.stringify(payload)}\n`, 'utf8')
}

/** Live assistant stream: `{ agent: { id }, frame: start|chunk|end }`. */
function handleStreamPayload(payload) {
  const sessionId = payload?.agent?.id
  const frame = payload?.frame
  if (!sessionId || !frame) return
  const session = sessionState(sessionId)
  const { activity, streaming } = session

  // A late chunk after the turn settled must not resurrect the running state.
  if (session.finished) return

  if (frame.type === 'start') {
    streaming.reasoning = ''
    streaming.text = ''
    streaming.toolName = ''
    streaming.toolArgs = ''
    updateSession(session, {
      state: 'running',
      status: 'thinking',
      label: '正在分析请求',
      detail: null,
      hold: true,
    })
    return
  }

  if (frame.type === 'chunk') {
    const chunk = frame.chunk
    if (!chunk || typeof chunk !== 'object') return

    if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
      streaming.reasoning += chunk.text
      updateSession(session, {
        status: 'thinking',
        label: '正在分析请求',
        detail: liveReasoningDetail(streaming.reasoning),
        hold: true,
      })
      return
    }

    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      streaming.text += chunk.text
      updateSession(session, {
        status: 'generating',
        label: '正在生成回复',
        detail: trimDetail(streaming.text),
        hold: true,
      })
      return
    }

    if (chunk.type === 'tool-call-delta') {
      if (typeof chunk.name === 'string' && chunk.name) streaming.toolName = chunk.name
      if (typeof chunk.argumentsDelta === 'string') streaming.toolArgs += chunk.argumentsDelta
      updateSession(session, {
        status: 'tool',
        label: toolCopy(streaming.toolName, 'ready'),
        detail: formatToolArgs(streaming.toolArgs),
        hold: true,
      })
      return
    }

    if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage.outputTokens === 'number') {
      activity.tokens = chunk.usage.outputTokens
      session.rev += 1
      session.updatedAt = Date.now()
      scheduleActivityWrite()
      return
    }

    if (chunk.type === 'finish' && chunk.reason) {
      const kind = chunk.reason.kind
      if (kind === 'tool-calls') {
        updateSession(session, { status: 'tool', label: toolCopy(streaming.toolName, 'ready'), hold: true })
      } else if (kind === 'stop') {
        updateSession(session, { status: 'generating', label: '正在生成回复', hold: true })
      }
    }
    return
  }

  if (frame.type === 'end') {
    const outcome = frame.outcome
    if (outcome?.kind === 'abandoned') {
      updateSession(session, { state: 'idle', status: null, label: null, detail: null, hold: false })
    }
  }
}

/** Committed session events. The first argument is the Session itself. */
function handleSessionEvent(session, event) {
  if (!session || !event || typeof event !== 'object') return
  const sessionId = session.id ?? event.sessionId
  if (!sessionId) return
  const state = sessionState(sessionId)
  state.session = session
  const type = event.type
  const data = event.data ?? {}

  // Recover a title (and first prompt) when the plugin starts after the session
  // was created: the title lives in the logged `session/title` event.
  if (!state.hydrated) {
    state.hydrated = true
    let changed = false
    try {
      let title = ''
      // The supported reader for the session title projection.
      if (sessionTitleService !== null && typeof sessionTitleService.get === 'function') {
        try {
          const snapshot = sessionTitleService.get(session)
          if (snapshot !== undefined && typeof snapshot.title === 'string') title = snapshot.title.trim()
        } catch {
          // Fall back to the log scan below.
        }
      }
      const history = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
      let historyTitle = ''
      let firstPrompt = ''
      for (const item of history) {
        if (item?.type === 'session/title' && typeof item.data?.title === 'string' && item.data.title.trim()) {
          historyTitle = item.data.title.trim()
        }
        if (firstPrompt === '' && item?.type === 'user/message') {
          const text = textFromMessage(item.data)
          if (text) firstPrompt = text
        }
      }
      if (title === '') title = historyTitle
      if (title !== '') {
        state.title = title
        changed = true
      }
      if (state.firstPrompt === '' && firstPrompt !== '') {
        state.firstPrompt = firstPrompt
        changed = true
      }
    } catch {
      // History is best-effort; live events still update the title.
    }
    if (changed) scheduleActivityWrite()
  }

  if (type === 'session/title') {
    if (typeof data.title === 'string' && data.title.trim()) {
      state.title = data.title.trim()
      scheduleActivityWrite()
    }
    return
  }

  if (type === 'user/message') {
    const text = textFromMessage(data)
    if (text && !state.firstPrompt) {
      state.firstPrompt = text
      scheduleActivityWrite()
    }
    return
  }

  if (type === 'turn/start') {
    state.streaming.reasoning = ''
    state.streaming.text = ''
    state.streaming.toolName = ''
    state.streaming.toolArgs = ''
    state.lastMessage = ''
    state.finished = false
    state.activity.tokens = 0
    updateSession(state, {
      state: 'running',
      status: 'thinking',
      label: '正在分析请求',
      detail: null,
      tokens: 0,
      hold: true,
    })
    return
  }

  if (type === 'step/start') {
    state.streaming.reasoning = ''
    state.streaming.text = ''
    updateSession(state, {
      state: 'running',
      status: 'thinking',
      label: '正在分析请求',
      detail: null,
      hold: true,
    })
    return
  }

  if (type === 'tool/call') {
    const name = typeof data.name === 'string' ? data.name : ''
    state.streaming.toolName = name
    state.streaming.toolArgs = typeof data.arguments === 'string' ? data.arguments : ''
    updateSession(state, {
      state: 'running',
      status: 'tool',
      label: toolCopy(name, 'running'),
      detail: formatToolArgs(state.streaming.toolArgs),
      hold: true,
    })
    return
  }

  if (type === 'tool/result') {
    updateSession(state, {
      state: 'running',
      status: 'working',
      label: toolCopy(state.streaming.toolName, 'done'),
      detail: null,
      hold: true,
    })
    return
  }

  if (type === 'approval/asked' || type === 'approval/request') {
    updateSession(state, {
      state: 'waiting',
      status: 'waiting',
      label: '等待你的操作',
      detail: typeof data.title === 'string' ? data.title : null,
      hold: true,
    })
    // 发送企业微信通知
    void (async () => {
      try {
        const ui = await readUI()
        if (ui.enableNotifications && ui.webhookUrl) {
          const message = formatNotificationMessage(state, 'approval/asked', data)
          if (message) await sendWeChatNotification(ui.webhookUrl, message)
        }
      } catch (error) {
        console.warn('[petdex] Failed to send WeChat notification:', error)
      }
    })()
    return
  }

  if (type === 'approval/decided') {
    updateSession(state, {
      state: 'running',
      status: 'working',
      label: '正在分析请求',
      detail: null,
      hold: true,
    })
    return
  }

  if (type === 'assistant/message') {
    const text = textFromMessage(data.message)
    if (text) state.lastMessage = text
    if (data.usage && typeof data.usage.outputTokens === 'number') {
      state.activity.tokens = data.usage.outputTokens
    }
    state.rev += 1
    state.updatedAt = Date.now()
    scheduleActivityWrite()
    return
  }

  if (type === 'turn/end') {
    state.finished = true
    const reason = data.reason?.kind
    if (reason === 'completed') {
      updateSession(state, {
        state: 'waving',
        status: 'done',
        label: '已完成',
        detail: null,
        hold: false,
      })
    } else if (reason === 'blocked' || reason === 'max-tokens') {
      updateSession(state, {
        state: 'waiting',
        status: 'waiting',
        label: '等待你的操作',
        detail: null,
        hold: true,
      })
    } else {
      updateSession(state, {
        state: 'failed',
        status: 'failed',
        label: '出错了',
        detail: typeof data.reason?.error?.message === 'string' ? truncate(data.reason.error.message, 120) : null,
        hold: false,
      })
    }
    // 发送企业微信通知
    void (async () => {
      try {
        const ui = await readUI()
        if (ui.enableNotifications && ui.webhookUrl) {
          const message = formatNotificationMessage(state, 'turn/end', data)
          if (message) await sendWeChatNotification(ui.webhookUrl, message)
        }
      } catch (error) {
        console.warn('[petdex] Failed to send WeChat notification:', error)
      }
    })()
    return
  }

  if (type === 'compaction/start') {
    updateSession(state, { state: 'running', status: 'working', label: '正在整理上下文', detail: null, hold: true })
    return
  }

  if (type === 'workflow/run-start') {
    updateSession(state, { state: 'running', status: 'working', label: '正在运行工作流', detail: null, hold: true })
    return
  }
}

/**
 * Agent-level idle signal. `turn/end` is the primary terminal event, but a
 * crash, a missed event or an externally stopped turn can leave a session stuck
 * on a running state; idle is authoritative and clears it.
 */
function handleAgentStatus(payload) {
  const sessionId = payload?.agent?.id
  if (!sessionId) return
  const status = payload?.status
  if (status !== 'running' && status !== 'idle') return

  const session = sessionState(sessionId)
  if (status === 'running') {
    session.finished = false
    if (session.activity.label === null) {
      updateSession(session, {
        state: 'running',
        status: 'thinking',
        label: '正在分析请求',
        detail: null,
        hold: true,
      })
    }
    return
  }

  // Never clear a pending confirmation: the agent is idle precisely because it
  // is waiting for the user.
  if (session.activity.status === 'waiting') return
  if (session.activity.hold) {
    updateSession(session, {
      state: 'idle',
      status: null,
      label: null,
      detail: null,
      hold: false,
    })
  }
}

/** Clear stale running states even when no terminal event ever arrives. */
function startActivityWatchdog(ctx) {
  const timer = setInterval(() => {
    const now = Date.now()
    let changed = false
    for (const session of sessions.values()) {
      if (!session.activity.hold) continue
      const status = session.activity.status
      if (status === 'waiting') continue
      // Streaming states refresh constantly; tool calls can legitimately run long.
      const idleAfter = status === 'tool' ? 10 * 60 * 1000 : 45 * 1000
      if (now - session.updatedAt <= idleAfter) continue
      Object.assign(session.activity, {
        state: 'idle',
        status: null,
        label: null,
        detail: null,
        hold: false,
      })
      session.rev += 1
      session.updatedAt = now
      changed = true
    }
    if (changed) scheduleActivityWrite()
  }, 5000)
  ctx.effect(() => () => clearInterval(timer))
}

// ---------------------------------------------------------------------------
// HTTP plumbing

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, '请求体过大 / Request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON / Request body is not valid JSON'))
      }
    })
    request.on('error', reject)
  })
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const url = new URL(origin)
    // The desktop shell loads the same client from its custom dsh-app scheme.
    if (url.protocol === 'dsh-app:' && url.hostname === 'app') return true
    return url.host === request.headers.host
  } catch {
    return false
  }
}

async function sendClient(response) {
  let bytes
  try {
    bytes = await readFile(CLIENT_SCRIPT)
  } catch {
    sendJson(response, 404, { error: 'not found' })
    return
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'text/javascript; charset=utf-8',
    'content-length': String(bytes.length),
  })
  response.end(bytes)
}

async function sendSprite(path, response) {
  const match = /^\/petdex\/asset\/([a-z0-9][a-z0-9-]{0,80})\/(spritesheet\.(?:webp|png))$/.exec(path)
  if (match === null) {
    sendJson(response, 404, { error: 'not found' })
    return
  }
  const [, slug, file] = match
  let bytes
  try {
    bytes = await readFile(join(petsDir(), slug, file))
  } catch {
    sendJson(response, 404, { error: 'not found' })
    return
  }
  response.writeHead(200, {
    'cache-control': 'public, max-age=3600',
    'content-type': file.endsWith('.png') ? 'image/png' : 'image/webp',
    'content-length': String(bytes.length),
  })
  response.end(bytes)
}

async function handle(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const path = url.pathname

  try {
    if (request.method === 'GET' && path === `${PREFIX}/api/state`) {
      sendJson(response, 200, await snapshot())
      return
    }
    if (request.method === 'GET' && path === `${PREFIX}/api/lookup`) {
      await lookupPetdex(url, response)
      return
    }
    if (request.method === 'GET' && path === `${PREFIX}/api/thumb`) {
      await thumbPetdex(url, response)
      return
    }
    if (request.method === 'GET' && path === `${PREFIX}/client.js`) {
      await sendClient(response)
      return
    }
    if (request.method === 'GET' && path.startsWith(`${PREFIX}/asset/`)) {
      await sendSprite(path, response)
      return
    }
    // Client-side diagnostics use sendBeacon (text/plain, possibly cross-origin),
    // so this route intentionally runs before the same-origin guard.
    if (request.method === 'POST' && path === `${PREFIX}/api/client-log`) {
      const body = await readJsonBody(request).catch(() => ({}))
      const message = typeof body.message === 'string' ? body.message : 'unknown'
      const phase = typeof body.phase === 'string' ? body.phase : 'client'
      const stack = typeof body.stack === 'string' ? body.stack : ''
      try {
        mkdirSync(configDir(), { recursive: true })
        const file = clientErrorPath()
        // The Client half reports one milestone per page load; keep the file from
        // growing without bound across restarts.
        try {
          if (statSync(file).size > MAX_CLIENT_LOG_BYTES) rmSync(file, { force: true })
        } catch {
          // no log yet
        }
        appendFileSync(file, `[${new Date().toISOString()}] ${phase}: ${message}\n${stack}\n`, 'utf8')
      } catch {
        // best-effort diagnostics
      }
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method === 'POST' && path.startsWith(`${PREFIX}/api/`)) {
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: '拒绝跨站请求 / Cross-origin request refused' })
        return
      }
      const body = await readJsonBody(request)

      if (path === `${PREFIX}/api/install`) {
        const installed = await installPet(body.slug, body.activate !== false)
        sendJson(response, 200, { ...(await snapshot()), installed })
        return
      }
      if (path === `${PREFIX}/api/remove`) {
        sendJson(response, 200, await removePet(body.slug))
        return
      }
      if (path === `${PREFIX}/api/active`) {
        const slug = body.slug
        if (slug !== null && (typeof slug !== 'string' || !SLUG_PATTERN.test(slug))) {
          throw new HttpError(400, '无效的宠物标识 / Invalid pet slug')
        }
        if (slug !== null) {
          const pets = await listPets()
          if (!pets.some(pet => pet.slug === slug)) throw new HttpError(404, `宠物 ${slug} 没有安装 / ${slug} is not installed`)
        }
        await writeUI({ active: slug })
        sendJson(response, 200, await snapshot())
        return
      }
      if (path === `${PREFIX}/api/config`) {
        const patch = body.patch !== null && typeof body.patch === 'object' ? body.patch : body
        await writeUI(patch)
        sendJson(response, 200, await snapshot())
        return
      }
      if (path === `${PREFIX}/api/desktop`) {
        if (body.enabled === false) {
          // Let the companion see the flag before terminating it, so a clean
          // exit can remove its own pid file and stop timers.
          await writeUI({ enabled: false })
          await stopApp()
        } else {
          await writeUI({ enabled: true })
          try {
            await startApp()
          } catch (error) {
            await writeUI({ enabled: false })
            throw error
          }
        }
        sendJson(response, 200, await snapshot())
        return
      }
      sendJson(response, 404, { error: 'not found' })
      return
    }
    sendJson(response, 404, { error: 'not found' })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : String(error)
    if (status >= 500) console.error('[petdex]', error)
    if (!response.headersSent) sendJson(response, status, { error: message })
    else response.end()
  }
}

/** Persist activation failures: the loader only reports a failed entry. */
function logBootError(error) {
  try {
    mkdirSync(configDir(), { recursive: true })
    const line = `[${new Date().toISOString()}] ${error?.stack ?? String(error)}\n`
    appendFileSync(join(configDir(), 'boot-error.log'), line, 'utf8')
  } catch {
    // logging must never take the plugin down
  }
}

/** Register one listener without letting an optional event break activation. */
function safeOn(ctx, name, listener) {
  try {
    ctx.on(name, listener, { global: true })
  } catch (error) {
    logBootError(error)
  }
}

/**
 * Host entry point. Activation failures are logged, never rethrown: one pet
 * plugin must not abort the whole web boot and take Harness down.
 */
export function apply(ctx) {
  try {
    applyPlugin(ctx)
  } catch (error) {
    logBootError(error)
  }
}

function applyPlugin(ctx) {
  try {
    ctx.inject(['webServer'], injected => {
      try {
        injected.effect(() => {
          try {
            return injected.webServer.register({ kind: 'prefix', path: PREFIX, handler: handle })
          } catch (error) {
            // The market can mount a hot entry next to the composed bundle, so a
            // second fiber of this same module may try to own /petdex as well.
            // Both load this file, so the routes already registered serve the
            // same handlers; failing the fiber here would take the pets page
            // down until the plugin is toggled by hand.
            if (/duplicate[^"]*route|already (registered|exists)/i.test(String(error?.message ?? error))) {
              console.warn('[petdex] /petdex is already served by another instance of this plugin')
              return () => {}
            }
            throw error
          }
        }, 'petdex: http routes')
      } catch (error) {
        logBootError(error)
      }
    })
  } catch (error) {
    logBootError(error)
  }

  try {
    ctx.inject(['sessionTitle'], injected => {
      sessionTitleService = injected.sessionTitle ?? null
    })
  } catch (error) {
    logBootError(error)
  }

  // Committed session events (session is the first listener argument).
  safeOn(ctx, 'session/event', (session, event) => {
    handleSessionEvent(session, event)
  })

  // Live assistant stream: `{ agent, frame }` drives reasoning / reply text,
  // tool-call details and output-token counts while the model is still talking.
  safeOn(ctx, 'agent/assistant-stream', payload => {
    handleStreamPayload(payload)
  })

  // Authoritative idle signal, so a stopped turn never leaves the pet running.
  safeOn(ctx, 'agent/status', payload => {
    handleAgentStatus(payload)
  })

  // A failed step or turn should surface on the pet even without a turn/end.
  safeOn(ctx, 'agent/error', payload => {
    const id = payload?.agent?.id
    if (!id) return
    updateSession(sessionState(id), {
      state: 'failed',
      status: 'failed',
      label: '出错了',
      detail: null,
      hold: false,
    })
  })

  try {
    startActivityWatchdog(ctx)
  } catch (error) {
    logBootError(error)
  }

  // Disabling or reloading the plugin must not leave the companion running.
  try {
    ctx.effect(() => () => {
      void stopApp().catch(() => {})
    })
  } catch (error) {
    logBootError(error)
  }

  void (async () => {
    try {
      const ui = await readUI()
      await mkdir(configDir(), { recursive: true })

      const pets = await listPets()
      const installed = pets.some(pet => pet.slug === ui.active)
      const active = installed ? ui.active : (pets[0]?.slug ?? null)
      if (active !== ui.active) await writeUI({ active })

      try {
        const previous = JSON.parse(await readFile(activityPath(), 'utf8'))
        if (Number.isSafeInteger(previous?.seq) && previous.seq > sequence) sequence = previous.seq
      } catch {
        await writeFile(
          activityPath(),
          `${JSON.stringify({ seq: 0, at: Date.now(), sessions: [] })}\n`,
          'utf8',
        )
      }

      // Replace any stale activity left by a previous process: a fresh Host has
      // no running sessions, so the pet must start idle instead of inheriting
      // a "running" state from the last run.
      await flushActivity()

      const current = await readUI()
      if (current.enabled && !(await appRunning())) {
        try {
          await startApp()
        } catch (error) {
          await writeUI({ enabled: false }).catch(() => {})
          throw error
        }
      }
    } catch (error) {
      logBootError(error)
    }
  })()
}
