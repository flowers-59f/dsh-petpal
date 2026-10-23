/**
 * End-to-end test for the notification setting and the WeChat bot sender.
 *
 * Boots index.js against a throwaway DSH_HOME, drives the HTTP config route the
 * way the settings page does, and checks that:
 *   1. enableNotifications survives a config write and comes back in /api/state
 *   2. approval/asked and turn/end post to the webhook only while enabled and
 *      configured
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HOST_MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js')
const HOME = join(tmpdir(), `petpal-host-test-${process.pid}`)

process.env.DSH_HOME = HOME
await mkdir(join(HOME, 'pets', '.petdex'), { recursive: true })
// Keep the desktop companion out of the test: disabled means no spawn.
await writeFile(join(HOME, 'pets', '.petdex', 'ui.json'), JSON.stringify({ enabled: false }))

const sent = []
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
  return { ok: true, status: 200, json: async () => ({ errcode: 0 }), text: async () => '{"errcode":0}' }
}

const plugin = await import(`file://${HOST_MODULE}`)
if (typeof plugin.apply !== 'function') throw new Error('index.js does not export apply')

let handler = null
const listeners = new Map()
const disposers = []

const ctx = {
  inject(names, run) {
    const injected = {
      effect(fn) {
        disposers.push(fn())
      },
    }
    for (const name of names) {
      if (name === 'webServer') {
        injected.webServer = {
          register(route) {
            handler = route.handler
            return () => {}
          },
        }
      }
      if (name === 'sessionTitle') injected.sessionTitle = { get: () => undefined }
    }
    run(injected)
  },
  on(name, listener) {
    listeners.set(name, listener)
  },
  effect(fn) {
    disposers.push(fn())
  },
}

plugin.apply(ctx)
if (typeof handler !== 'function') throw new Error('http handler was not registered')

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.url = path
    request.headers = { host: 'localhost:1', 'content-type': 'application/json' }
    const response = {
      headersSent: false,
      status: 0,
      payload: '',
      writeHead(status) {
        this.status = status
        this.headersSent = true
      },
      end(chunk) {
        if (chunk !== undefined) this.payload += chunk.toString()
        try {
          resolve({ status: this.status, json: JSON.parse(this.payload || '{}') })
        } catch {
          resolve({ status: this.status, json: {} })
        }
      },
    }
    handler(request, response).catch(reject)
  })
}

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`)
}

const settle = () => new Promise(resolve => setTimeout(resolve, 100))
const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key'
const session = { id: 'test-session', snapshotEvents: () => [] }
const emit = (type, data) => listeners.get('session/event')(session, { type, data })

// 1. Turning the switch on must persist and come back in the snapshot.
const switchedOn = await call('POST', '/petdex/api/config', {
  patch: { enableNotifications: true, webhookUrl: WEBHOOK },
})
check('config write returns enableNotifications=true', switchedOn.json.ui?.enableNotifications, true)

const state = await call('GET', '/petdex/api/state')
check('state exposes enableNotifications=true', state.json.ui?.enableNotifications, true)
check('state exposes webhookUrl', state.json.ui?.webhookUrl, WEBHOOK)

// 2. A question from the agent while enabled must reach the webhook.
emit('session/title', { title: '测试会话' })
emit('approval/asked', { title: '确认删除文件？' })
await settle()
check('approval/asked sent one notification', sent.length, 1)
check('notification went to the configured webhook', sent[0]?.url, WEBHOOK)
check(
  'notification is a WeChat text message',
  sent[0]?.body?.msgtype === 'text' && typeof sent[0]?.body?.text?.content === 'string',
  true,
)
console.log(`  message: ${JSON.stringify(sent[0]?.body?.text?.content)}`)

// 3. Finishing a turn also notifies.
emit('turn/end', { reason: { kind: 'completed' } })
await settle()
check('turn/end sent a second notification', sent.length, 2)

// 4. Turning it off must silence everything, even with a valid URL.
await call('POST', '/petdex/api/config', { patch: { enableNotifications: false } })
sent.length = 0
emit('approval/asked', { title: '确认删除文件？' })
emit('turn/end', { reason: { kind: 'completed' } })
await settle()
check('disabled notifications send nothing', sent.length, 0)

// 5. Enabled but blank URL must not attempt a request.
await call('POST', '/petdex/api/config', { patch: { enableNotifications: true, webhookUrl: '' } })
const blank = await call('GET', '/petdex/api/state')
check('blank webhook is exposed as empty', blank.json.ui?.webhookUrl, '')
emit('turn/end', { reason: { kind: 'completed' } })
await settle()
check('enabled without webhook sends nothing', sent.length, 0)

// 6. A non-https URL is refused rather than fetched.
await call('POST', '/petdex/api/config', { patch: { webhookUrl: 'http://example.com/hook' } })
emit('turn/end', { reason: { kind: 'completed' } })
await settle()
check('plain http webhook is not called', sent.length, 0)

for (const dispose of disposers) {
  try {
    await dispose()
  } catch {
    // a disposer failing must not hide the results
  }
}
await rm(HOME, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nhost notification test passed')
