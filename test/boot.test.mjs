/**
 * Host activation test.
 *
 * The market can mount a hot entry next to the composed bundle, so apply() may
 * run twice in one process. The second run must not take the pets page down when
 * /petdex is already served — that failure used to be written to boot-error.log
 * and left the settings page stuck until the plugin was toggled by hand.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HOST_MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js')
const HOME = join(tmpdir(), `petpal-boot-test-${process.pid}`)
const BOOT_LOG = join(HOME, 'pets', '.petdex', 'boot-error.log')

process.env.DSH_HOME = HOME
await mkdir(join(HOME, 'pets', '.petdex'), { recursive: true })
await writeFile(join(HOME, 'pets', '.petdex', 'ui.json'), JSON.stringify({ enabled: false }))
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })

const plugin = await import(`file://${HOST_MODULE}`)

function makeCtx(register) {
  const disposers = []
  const injections = []
  const listeners = {}
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
            register,
          }
        }
        if (name === 'sessionTitle') injected.sessionTitle = { get: () => undefined }
      }
      run(injected)
    },
    on(event, handler, opts) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    },
    effect(fn) {
      disposers.push(fn())
    },
  }
  return {
    disposers,
    injections,
    ctx,
    // Trigger event for testing
    emit(event, ...args) {
      if (listeners[event]) {
        for (const handler of listeners[event]) handler(...args)
      }
    },
  }
}

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`)
}

// 1. A normal activation registers the prefix route.
let registered = 0
const first = makeCtx(() => {
  registered += 1
  return () => {}
})
plugin.apply(first.ctx)
check('first activation registers /petdex', registered, 1)

// The Client half travels through DSH's own web boot graph (package.json
// `dsh.client`), so the Host must not add a second injection of its own.
first.emit('webserver/index-inject', first.injections)
check('host adds no index injection of its own', first.injections.length, 0)

// 2. A second activation (hot entry next to the bundle) must swallow the
//    duplicate-route error instead of failing its fiber.
const second = makeCtx(() => {
  throw new Error('webserver: duplicate prefix route "/petdex"')
})
let threw = false
try {
  plugin.apply(second.ctx)
} catch {
  threw = true
}
check('duplicate route does not throw', threw, false)

let bootLog = ''
try {
  bootLog = await readFile(BOOT_LOG, 'utf8')
} catch {
  bootLog = ''
}
check('duplicate route is not recorded as a boot error', bootLog.includes('duplicate prefix route'), false)

// 3. Unrelated registration failures are still surfaced in boot-error.log.
const third = makeCtx(() => {
  throw new Error('webserver exploded')
})
plugin.apply(third.ctx)
bootLog = await readFile(BOOT_LOG, 'utf8').catch(() => '')
check('a real registration failure is still logged', bootLog.includes('webserver exploded'), true)

for (const holder of [first, second, third]) {
  for (const dispose of holder.disposers) {
    try {
      await dispose()
    } catch {
      // cleanup must not mask the results
    }
  }
}
// The boot pass still writes activity.json in the background; retry the rm.
await new Promise(resolve => setTimeout(resolve, 150))
await rm(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nhost activation test passed')
