/**
 * Render smoke test for the PetPal settings page.
 *
 * Loads client.js with a fake module loader and a minimal React stub, then
 * executes the settings component against fake host snapshots. A plain syntax
 * check cannot see a ReferenceError raised while building the tree (an
 * undefined variable inside the preview once blanked the whole page), so this
 * walks the produced tree, expands the child components, and fails loudly.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js')

let loaded = null
globalThis.window = {
  // The page uses window timers for its "已保存" hint; the DOM-less stub needs them.
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle),
  __ModuleLoader__: {
    load(config) {
      loaded = config
    },
  },
}

await import(`file://${CLIENT}`)
if (loaded === null) throw new Error('client.js did not register a module')

let captured = null
let hookIndex = 0
let fakeStore = null

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(initial) {
    const index = hookIndex++
    // First hook call is useStore's useState(snapshot): feed it a snapshot so
    // the page renders its real content instead of the loading placeholder.
    if (index === 0) return [fakeStore, () => {}]
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useReducer(_reducer, initial) {
    return [initial, () => {}]
  },
  useRef(current) {
    return { current }
  },
}

const mod = loaded.factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

const ctx = {
  get: () => ({
    register() {},
    bind: () => key => key,
    subscribe: () => () => {},
  }),
  effect() {},
  slots: {
    inject(_name, run) {
      run()
    },
    register(_config, component) {
      captured = component
      return () => {}
    },
  },
}

mod.apply(ctx)
if (typeof captured !== 'function') throw new Error('settings section was not registered')

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  // Expand function components so their own render paths run here too.
  if (typeof node.type === 'function') {
    walk(node.type(node.props), visit)
    return
  }
  for (const child of node.children ?? []) walk(child, visit)
}

const baseUI = {
  enabled: true,
  bubbles: true,
  bubbleOpacity: 40,
  bubbleColor: '#0f0f0f',
  bubbleTextColor: '#ffffff',
  bubbleMaxWidth: 320,
  bubbleFontSize: 13,
  scale: 1,
}

const cases = [
  {
    name: 'notifications off',
    ui: { ...baseUI, enableNotifications: false, webhookUrl: '' },
    expectChecked: false,
  },
  {
    name: 'notifications on with a webhook',
    ui: { ...baseUI, enableNotifications: true, webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc' },
    expectChecked: true,
  },
  {
    name: 'light bubble on a translucent bubble',
    ui: { ...baseUI, bubbleOpacity: 20, bubbleColor: '#ffffff', bubbleTextColor: '#101010', enableNotifications: false },
    expectChecked: false,
  },
  {
    name: 'no pets installed',
    ui: { ...baseUI, enableNotifications: false },
    pets: [],
    active: null,
    expectChecked: false,
  },
  {
    name: 'non-https webhook blocks saving',
    ui: { ...baseUI, enableNotifications: true, webhookUrl: 'http://example.com/hook' },
    expectChecked: true,
    expectSaveDisabled: true,
  },
]

const requested = []
globalThis.fetch = async (url, init) => {
  requested.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
  return { ok: true, status: 200, json: async () => ({}) }
}

let failures = 0
for (const testCase of cases) {
  hookIndex = 0
  requested.length = 0
  fakeStore = {
    active: testCase.active === undefined ? 'cat-in-the-box-shaco' : testCase.active,
    pets:
      testCase.pets ??
      [{ slug: 'cat-in-the-box-shaco', name: 'Cat', description: 'A cat', file: 'spritesheet.webp', updatedAt: 1 }],
    ui: testCase.ui,
    desktop: true,
    appAvailable: true,
    home: '/tmp/pets',
  }

  try {
    const nodes = []
    walk(captured(), node => nodes.push(node))

    const notificationSwitch = nodes.find(node => node.props?.['aria-label'] === 'enableNotifications')
    if (notificationSwitch === undefined) throw new Error('notification switch is missing from the page')
    if (notificationSwitch.props['aria-checked'] !== testCase.expectChecked) {
      throw new Error(`switch shows aria-checked=${notificationSwitch.props['aria-checked']}, expected ${testCase.expectChecked}`)
    }
    if (notificationSwitch.props.disabled === true) {
      throw new Error('notification switch is disabled and cannot be clicked')
    }
    if (typeof notificationSwitch.props.onClick !== 'function') {
      throw new Error('notification switch has no onClick handler')
    }

    // The switch must actually reach the host: clicking it posts the opposite value.
    notificationSwitch.props.onClick()
    await new Promise(resolve => setTimeout(resolve, 30))
    const configCall = requested.find(call => call.url.endsWith('/api/config'))
    if (configCall === undefined) throw new Error('clicking the switch did not post a config change')
    if (configCall.body?.patch?.enableNotifications !== !testCase.expectChecked) {
      throw new Error(
        `click posted enableNotifications=${configCall.body?.patch?.enableNotifications}, expected ${!testCase.expectChecked}`,
      )
    }

    // With notifications on, the webhook field must be editable.
    const webhookInput = nodes.find(node => node.type === 'input' && node.props?.['aria-label'] === 'webhookUrl')
    if (webhookInput === undefined) throw new Error('webhook input is missing from the page')
    if (testCase.expectChecked === true && webhookInput.props.disabled === true) {
      throw new Error('webhook input stays disabled while notifications are on')
    }

    // The save button must exist, respect URL validation, and actually persist.
    const saveButton = nodes.find(node => node.type === 'button' && node.props?.['aria-label'] === 'saveWebhook')
    if (saveButton === undefined) throw new Error('webhook save button is missing from the page')
    const saveDisabled = saveButton.props.disabled === true
    if (saveDisabled !== (testCase.expectSaveDisabled === true)) {
      throw new Error(`save button disabled=${saveDisabled}, expected ${testCase.expectSaveDisabled === true}`)
    }
    if (!saveDisabled) {
      requested.length = 0
      saveButton.props.onClick()
      await new Promise(resolve => setTimeout(resolve, 30))
      const saveCall = requested.find(call => call.url.endsWith('/api/config'))
      if (saveCall === undefined) throw new Error('pressing save did not post a config change')
      if (typeof saveCall.body?.patch?.webhookUrl !== 'string') {
        throw new Error('save did not send a webhookUrl')
      }
    }

    const switches = nodes.filter(node => node.props?.role === 'switch')
    console.log(`✓ ${testCase.name}: ${nodes.length} nodes, ${switches.length} switches, switch click posts config`)
  } catch (error) {
    failures += 1
    console.error(`✗ ${testCase.name}: ${error?.stack ?? error}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} render case(s) failed`)
  process.exit(1)
}
console.log('\nclient render test passed')
