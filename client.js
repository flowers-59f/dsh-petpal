/**
 * PetPal (Petdex library) for DeepSeek Harness — Client half.
 *
 * A dedicated settings page (plus nothing else): the pet itself is drawn by the
 * bundled desktop companion, not by the Harness window, so it survives closing
 * Harness. This page manages the library under `~/.dsh/pets`, downloads from
 * petdex.dev, and edits the appearance settings the companion reads live.
 */
window.__ModuleLoader__.load({
  id: 'dsh-petpal',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-petpal'

    const ATLAS = { columns: 8, frameWidth: 192, frameHeight: 208 }
    const STATES = [
      { id: 'idle', row: 0, frames: 6, durationMs: 1100 },
      { id: 'running-right', row: 1, frames: 8, durationMs: 1060 },
      { id: 'running-left', row: 2, frames: 8, durationMs: 1060 },
      { id: 'waving', row: 3, frames: 4, durationMs: 700 },
      { id: 'jumping', row: 4, frames: 5, durationMs: 840 },
      { id: 'failed', row: 5, frames: 8, durationMs: 1220 },
      { id: 'waiting', row: 6, frames: 6, durationMs: 1010 },
      { id: 'running', row: 7, frames: 6, durationMs: 820 },
      { id: 'review', row: 8, frames: 6, durationMs: 1030 },
    ]
    const STATE_BY_ID = Object.fromEntries(STATES.map(state => [state.id, state]))

    const zh = {
      nav: '宠物',
      title: '宠物',
      intro: '挑一只宠物，它会待在桌面上陪着你 —— 关掉 Harness 窗口也在。宠物文件放在 DSH 自己的 ~/.dsh/pets 目录里，和 Codex 安装目录互不影响。',
      desktop: '桌面宠物',
      running: '运行中',
      stopped: '未运行',
      start: '启动',
      stop: '停止',
      restartHint: '切换后桌面宠物会立刻更新，不需要重启 Harness。',
      preview: '预览',
      previewText: '主人，我在这儿呢～',
      previewTitle: '回复一句话',
      previewStatus: '正在思考',
      installed: '已安装',
      installedEmpty: '还没有宠物。从 petdex.dev 下载并放到下面的宠物目录里就能用了。',
      use: '使用',
      inUse: '使用中',
      remove: '删除',
      removing: '删除中…',
      appearance: '外观',
      size: '宠物大小',
      bubbles: '显示气泡',
      bubbleFont: '气泡字号',
      bubbleWidth: '气泡宽度',
      bubbleLife: '气泡停留',
      bubbleColor: '气泡背景色',
      bubbleOpacity: '气泡不透明度',
      bubbleTextColor: '气泡文字颜色',
      seconds: '{value} 秒',
      forever: '一直显示',
      clickThrough: '点击穿透',
      clickThroughHint: '开启后鼠标可以穿过宠物，但也不能再拖动它。',
      showOnDesktop: '在桌面显示',
      missingApp: '桌面宠物组件不可用：当前系统没有对应的桌面组件，或安装包里缺少 desktop/ 下的程序。',
      failed: '出错了：{message}',
      confirmRemove: '删除「{name}」？桌面上正在显示的话会切到别的宠物。',
      downloadTitle: '下载宠物',
      identifierPlaceholder: '粘贴宠物链接或宠物标识，例如 cat-in-the-box-shaco',
      lookup: '查找',
      lookingUp: '查找中…',
      slugWhat: '宠物标识（slug）就是宠物页面链接的最后一段：',
      slugExamplePage: '宠物页面：',
      slugExampleId: '宠物标识：',
      officialHintBefore: '还没有目标？打开',
      officialHintAfter: '，进入宠物页面，复制地址栏链接粘贴到上面的输入框，点「查找」。',
      download: '下载并使用',
      downloading: '下载中…',
      downloadInvalid: '无法识别。请粘贴 petdex.dev 的宠物页面链接，或链接最后一段的宠物标识。',
      libraryPath: '宠物目录',
      loading: '加载中…',
      hint: '拖动桌宠可以换位置；点一下它会挥挥手；气泡跟着 Harness 里的活动自动出现。从 petdex.dev 下载更多宠物。',
      kindCreature: '生物',
      appBadge: '桌面组件',
      appReady: '就绪',
      appMissing: '缺失',
    }

    const en = {
      nav: 'Pets',
      title: 'Pets',
      intro: 'Pick a pet and it lives on your desktop — it stays there after you close Harness. Pet files live in DSH’s own ~/.dsh/pets folder, independent of the Codex install.',
      desktop: 'Desktop pet',
      running: 'Running',
      stopped: 'Stopped',
      start: 'Start',
      stop: 'Stop',
      restartHint: 'Changes apply to the desktop pet immediately; no Harness restart needed.',
      preview: 'Preview',
      previewText: 'Hey, I am right here!',
      previewTitle: 'Reply to a message',
      previewStatus: 'Thinking',
      installed: 'Installed',
      installedEmpty: 'No pets yet. Download from petdex.dev and place them in the pet folder below.',
      use: 'Use',
      inUse: 'In use',
      remove: 'Remove',
      removing: 'Removing…',
      appearance: 'Appearance',
      size: 'Pet size',
      bubbles: 'Show bubbles',
      bubbleFont: 'Bubble text size',
      bubbleWidth: 'Bubble width',
      bubbleLife: 'Bubble lifetime',
      bubbleColor: 'Bubble background',
      bubbleOpacity: 'Bubble opacity',
      bubbleTextColor: 'Bubble text color',
      seconds: '{value}s',
      forever: 'Until replaced',
      clickThrough: 'Click-through',
      clickThroughHint: 'The mouse passes through the pet — which also means it can no longer be dragged.',
      showOnDesktop: 'Show on the desktop',
      missingApp: 'The desktop companion is unavailable: there is no companion for this platform, or the install is missing the program under desktop/.',
      failed: 'Something went wrong: {message}',
      confirmRemove: 'Remove "{name}"? If it is on the desktop, another pet takes over.',
      downloadTitle: 'Download a pet',
      identifierPlaceholder: 'Paste a pet URL or identifier, e.g. cat-in-the-box-shaco',
      lookup: 'Look up',
      lookingUp: 'Looking up…',
      slugWhat: 'The pet identifier (slug) is the last segment of its page URL:',
      slugExamplePage: 'Pet page:',
      slugExampleId: 'Identifier:',
      officialHintBefore: 'No pet in mind? Open',
      officialHintAfter: ', open a pet page, copy its URL into the field above, and press Look up.',
      download: 'Download and use',
      downloading: 'Downloading…',
      downloadInvalid: 'Not recognized. Paste a petdex.dev pet page URL, or the identifier at the end of that URL.',
      libraryPath: 'Pet folder',
      loading: 'Loading…',
      hint: 'Drag the pet to move it, click it to say hello, and bubbles follow activity in Harness. Download more from petdex.dev.',
      kindCreature: 'creature',
      appBadge: 'Desktop companion',
      appReady: 'ready',
      appMissing: 'missing',
    }

    function reportClientError(phase, error) {
      try {
        const payload = {
          phase,
          message: String(error?.message ?? error),
          stack: typeof error?.stack === 'string' ? error.stack : '',
        }
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(api('petdex/api/client-log'), JSON.stringify(payload))
        } else if (typeof fetch === 'function') {
          void fetch(api('petdex/api/client-log'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => {})
        }
      } catch {
        // diagnostics must never break the page
      }
    }

    function interpolate(template, vars) {
      if (!vars) return template
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        vars[key] === undefined ? whole : String(vars[key]),
      )
    }

    let translate = (key, vars) => interpolate(en[key] ?? key, vars)
    let localeService = null

    const token = name => `var(--dsw-alias-${name})`
    const COLORS = {
      text: token('label-primary'),
      muted: token('label-secondary'),
      border: token('border-l1'),
      borderStrong: token('border-l2'),
      layer1: token('bg-layer-1'),
      layer2: token('bg-layer-2'),
      brand: token('brand-primary'),
      danger: token('state-error-primary'),
      success: token('state-success-primary'),
      warn: token('state-warn-primary'),
    }

    function colorRgb(hex) {
      const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
      return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [34, 37, 42]
    }

    function lightColor(hex) {
      const rgb = colorRgb(hex)
      return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 155
    }

    const KEYFRAMES = STATES.map(state => {
      const shift = (state.frames / ATLAS.columns) * 100
      return `@keyframes petdex-${state.id} { from { transform: translateX(0); } to { transform: translateX(-${shift}%); } }`
    }).join('\n')

    // -----------------------------------------------------------------------
    // Host API

    function api(path) {
      const relative = String(path).replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      return new URL(relative, document.baseURI).pathname
    }

    const listeners = new Set()
    let snapshot = null
    let pending = null

    function publish(next) {
      snapshot = next
      for (const listener of [...listeners]) {
        try {
          listener(next)
        } catch {
          // a broken consumer must not take the store down
        }
      }
    }

    function loadState(force) {
      if (!force && snapshot !== null) return Promise.resolve(snapshot)
      if (pending !== null) return pending
      pending = fetch(api('petdex/api/state'), { cache: 'no-store', headers: { accept: 'application/json' } })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        })
        .then(data => {
          publish(data)
          return data
        })
        .finally(() => {
          pending = null
        })
      return pending
    }

    async function mutate(path, body) {
      const response = await fetch(api(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      publish(data)
      return data
    }

    function useStore() {
      const [value, setValue] = React.useState(snapshot)
      React.useEffect(() => {
        listeners.add(setValue)
        if (snapshot === null) void loadState().catch(() => {})
        else setValue(snapshot)
        return () => {
          listeners.delete(setValue)
        }
      }, [])
      return value
    }

    function useLocaleTick() {
      const [, bump] = React.useReducer(value => value + 1, 0)
      React.useEffect(() => {
        if (localeService === null || typeof localeService.subscribe !== 'function') return undefined
        return localeService.subscribe(() => bump())
      }, [])
    }

    function detectRows(width, height) {
      if (!(width > 0) || !(height > 0)) return 9
      // Petdex cells are 192x208; the ratio heuristic assumes square cells and
      // misreads the 11-row (1536x2288) export, so estimate from the frame
      // aspect first and only fall back to the old ratio check.
      const estimate = height / ((width / ATLAS.columns) * (ATLAS.frameHeight / ATLAS.frameWidth))
      if (Math.abs(estimate - 9) < 0.35) return 9
      if (Math.abs(estimate - 11) < 0.35) return 11
      const ratio = height / width
      const candidates = [
        { rows: 9, ratio: 9 / 8 },
        { rows: 11, ratio: 11 / 8 },
      ]
      let best = candidates[0]
      for (const candidate of candidates) {
        if (Math.abs(candidate.ratio - ratio) < Math.abs(best.ratio - ratio)) best = candidate
      }
      return Math.abs(best.ratio - ratio) < 0.05 ? best.rows : 9
    }

    function Sprite(props) {
      const { src, state = 'idle', playing = true, scale = 1, alt = '' } = props
      const definition = STATE_BY_ID[state] ?? STATE_BY_ID.idle
      const [natural, setNatural] = React.useState(null)
      const rows = natural === null ? 9 : detectRows(natural.width, natural.height)
      const sheetWidth = natural === null ? ATLAS.columns * ATLAS.frameWidth : natural.width
      const sheetHeight = natural === null ? rows * ATLAS.frameHeight : natural.height
      const rowHeight = sheetHeight / rows
      return h(
        'div',
        {
          style: {
            width: `${Math.round(ATLAS.frameWidth * scale)}px`,
            height: `${Math.round(ATLAS.frameHeight * scale)}px`,
            position: 'relative',
            overflow: 'hidden',
            flex: 'none',
          },
          role: alt ? 'img' : undefined,
          'aria-label': alt || undefined,
          'aria-hidden': alt ? undefined : true,
        },
        h('img', {
          src,
          alt: '',
          draggable: false,
          decoding: 'async',
          onLoad: event => {
            const image = event.currentTarget
            if (image.naturalWidth > 0) setNatural({ width: image.naturalWidth, height: image.naturalHeight })
          },
          style: {
            position: 'absolute',
            left: 0,
            top: `${-definition.row * rowHeight * scale}px`,
            width: `${sheetWidth * scale}px`,
            height: `${sheetHeight * scale}px`,
            maxWidth: 'none',
            transform: 'translateX(0)',
            animation: playing
              ? `petdex-${definition.id} ${definition.durationMs}ms steps(${definition.frames}) infinite`
              : undefined,
            pointerEvents: 'none',
            userSelect: 'none',
          },
        }),
      )
    }

    /**
     * Resolve the pet identifier (slug) from a petdex.dev pet URL or from the
     * identifier itself. Names are NOT accepted: Petdex slugs are the key.
     */
    function parsePetdexSlug(value) {
      const text = String(value ?? '').trim()
      if (text === '') return ''
      if (/^[a-z0-9][a-z0-9-]{0,80}$/.test(text)) return text
      try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
        if (/(^|\.)petdex\.dev$/i.test(url.hostname)) {
          const parts = url.pathname.split('/').filter(Boolean)
          const index = parts.findIndex(part => part === 'pets' || part === 'install')
          const candidate = index >= 0 ? parts[index + 1] : parts[parts.length - 1]
          return typeof candidate === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(candidate) ? candidate : ''
        }
      } catch {
        return ''
      }
      return ''
    }

    function spriteUrl(pet) {
      return `${api('petdex/asset')}/${encodeURIComponent(pet.slug)}/${encodeURIComponent(pet.file)}?v=${pet.updatedAt}`
    }

    // -----------------------------------------------------------------------
    // Controls

    function Switch(props) {
      const { checked, onChange, label, disabled } = props
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          disabled,
          onClick: () => onChange(!checked),
          style: {
            appearance: 'none',
            border: 'none',
            borderRadius: '999px',
            width: '38px',
            height: '22px',
            padding: '2px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            background: checked ? COLORS.brand : COLORS.borderStrong,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: checked ? 'flex-end' : 'flex-start',
            transition: 'background 120ms ease',
            flex: 'none',
          },
        },
        h('span', {
          style: {
            display: 'block',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
          },
        }),
      )
    }

    /** Color picker that commits once the user pauses. */
    function ColorInput(props) {
      const { value, onCommit, label } = props
      const [local, setLocal] = React.useState(value)
      const timer = React.useRef(0)

      React.useEffect(() => {
        setLocal(value)
      }, [value])

      React.useEffect(
        () => () => {
          window.clearTimeout(timer.current)
        },
        [],
      )

      return h('input', {
        type: 'color',
        value: local,
        'aria-label': label,
        onChange: event => {
          const next = event.target.value
          setLocal(next)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => onCommit(next), 220)
        },
        style: {
          width: '42px',
          height: '26px',
          padding: 0,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '6px',
          background: 'transparent',
          cursor: 'pointer',
          flex: 'none',
        },
      })
    }

    /** Slider that commits once the user pauses, so dragging is not chatty. */
    function Slider(props) {
      const { value, min, max, step, onCommit, label, format } = props
      const [local, setLocal] = React.useState(value)
      const timer = React.useRef(0)

      React.useEffect(() => {
        setLocal(value)
      }, [value])

      React.useEffect(
        () => () => {
          window.clearTimeout(timer.current)
        },
        [],
      )

      const change = next => {
        setLocal(next)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => onCommit(next), 260)
      }

      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 } },
        h('input', {
          type: 'range',
          min,
          max,
          step,
          value: local,
          'aria-label': label,
          onChange: event => change(Number.parseFloat(event.target.value)),
          style: { flex: 1, minWidth: 0, accentColor: COLORS.brand },
        }),
        h('span', { style: { fontSize: '11px', color: COLORS.muted, width: '52px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, format(local)),
      )
    }

    // -----------------------------------------------------------------------
    // Page

    const styles = {
      section: { display: 'flex', flexDirection: 'column', gap: '26px', maxWidth: '780px', color: COLORS.text },
      heading: { margin: 0, fontSize: '18px', fontWeight: 600, lineHeight: 1.4 },
      intro: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: COLORS.muted },
      groupTitle: { margin: '0 0 10px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: '8px' },
      count: { fontSize: '12px', fontWeight: 400, color: COLORS.muted },
      panel: { border: `1px solid ${COLORS.border}`, borderRadius: '12px', background: COLORS.layer1, padding: '14px' },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '12px',
        background: COLORS.layer1,
      },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '12px',
        background: COLORS.layer1,
        minWidth: 0,
      },
      cardName: { fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      cardText: {
        fontSize: '11px',
        lineHeight: 1.5,
        color: COLORS.muted,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        minHeight: '33px',
      },
      thumb: {
        height: '88px',
        borderRadius: '8px',
        background: COLORS.layer2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      },
      thumbImage: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
      primaryButton: {
        appearance: 'none',
        border: '1px solid transparent',
        borderRadius: '8px',
        padding: '6px 12px',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
        background: COLORS.brand,
        color: '#fff',
        whiteSpace: 'nowrap',
      },
      quietButton: {
        appearance: 'none',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        padding: '6px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        background: 'transparent',
        color: COLORS.text,
        whiteSpace: 'nowrap',
      },
      dangerButton: {
        appearance: 'none',
        border: '1px solid transparent',
        borderRadius: '8px',
        padding: '6px 10px',
        fontSize: '12px',
        cursor: 'pointer',
        background: 'transparent',
        color: COLORS.muted,
        whiteSpace: 'nowrap',
      },
      input: {
        flex: 1,
        minWidth: 0,
        appearance: 'none',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        padding: '8px 10px',
        fontSize: '13px',
        background: COLORS.layer1,
        color: COLORS.text,
        outline: 'none',
      },
      settingRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderTop: `1px solid ${COLORS.border}` },
      settingLabel: { fontSize: '13px', flex: 'none', width: '104px' },
      error: { fontSize: '12px', color: COLORS.danger, margin: 0, lineHeight: 1.6 },
      empty: { fontSize: '12px', color: COLORS.muted, margin: 0, lineHeight: 1.6 },
      footer: { fontSize: '11px', color: COLORS.muted, margin: 0, lineHeight: 1.7 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      badge: { fontSize: '10px', padding: '1px 6px', borderRadius: '999px', border: `1px solid ${COLORS.border}`, color: COLORS.muted },
    }

    function PetdexSection() {
      useLocaleTick()
      const store = useStore()
      const [busy, setBusy] = React.useState(null)

      // Refresh on mount: the desktop app or another window can change ui.json.
      React.useEffect(() => {
        void loadState(true).catch(() => {})
      }, [])

      const [actionError, setActionError] = React.useState(null)
      const [identifier, setIdentifier] = React.useState('')
      const [preview, setPreview] = React.useState(null)
      const [lookingUp, setLookingUp] = React.useState(false)
      const [lookupError, setLookupError] = React.useState(null)

      const activePet = (store?.pets ?? []).find(pet => pet.slug === store.active)

      const act = async (path, body, token) => {
        setBusy(token ?? 'global')
        setActionError(null)
        try {
          const data = await mutate(path, body)
          return data
        } catch (error) {
          setActionError(String(error?.message ?? error))
          return null
        } finally {
          setBusy(null)
        }
      }

      const setConfig = patch => act('petdex/api/config', { patch }, 'config')

      const toggleDesktop = async enabled => {
        await act('petdex/api/desktop', { enabled }, 'desktop')
        window.setTimeout(() => void loadState(true).catch(() => {}), 700)
      }

      const lookup = async event => {
        event?.preventDefault?.()
        const slug = parsePetdexSlug(identifier)
        if (slug === '') {
          setPreview(null)
          setLookupError(translate('downloadInvalid'))
          return
        }
        setLookingUp(true)
        setLookupError(null)
        setPreview(null)
        try {
          const response = await fetch(
            `${api('petdex/api/lookup')}?slug=${encodeURIComponent(slug)}`,
            { cache: 'no-store', headers: { accept: 'application/json' } },
          )
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
          setPreview(data.pet ?? null)
          if (data.pet === undefined) setLookupError(translate('downloadInvalid'))
        } catch (error) {
          setLookupError(String(error?.message ?? error))
        } finally {
          setLookingUp(false)
        }
      }

      const choosePet = pet => {
        const installed = (store?.pets ?? []).some(item => item.slug === pet.slug)
        return installed
          ? act('petdex/api/active', { slug: pet.slug }, pet.slug)
          : act('petdex/api/install', { slug: pet.slug }, `install:${pet.slug}`)
      }

      const requestRemove = pet => {
        const message = translate('confirmRemove', { name: pet.name })
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(message)) return
        void act('petdex/api/remove', { slug: pet.slug }, pet.slug)
      }

      if (store === null) {
        return h('div', { style: styles.section }, h('p', { style: styles.empty }, translate('loading')))
      }

      const ui = store.ui

      return h(
        'div',
        { style: styles.section },
        h('style', { key: 'petdex-keyframes' }, KEYFRAMES),

        h(
          'header',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('h2', { style: styles.heading }, translate('title')),
          h('p', { style: styles.intro }, translate('intro')),
        ),

        actionError === null ? null : h('p', { style: styles.error }, translate('failed', { message: actionError })),

        // Desktop companion status -------------------------------------------------
        h(
          'section',
          { style: styles.panel },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
              h('span', { style: { fontSize: '13px', fontWeight: 600 } }, translate('desktop')),
              h(
                'span',
                {
                  style: {
                    fontSize: '10px',
                    padding: '2px 7px',
                    borderRadius: '999px',
                    color: store.desktop ? COLORS.success : COLORS.muted,
                    border: `1px solid ${store.desktop ? COLORS.success : COLORS.border}`,
                  },
                },
                store.desktop ? translate('running') : translate('stopped'),
              ),
              h('span', { style: styles.badge }, `${translate('appBadge')} · ${store.appAvailable ? translate('appReady') : translate('appMissing')}`),
            ),
            h(Switch, {
              checked: ui.enabled,
              disabled: !store.appAvailable || busy !== null,
              label: translate('showOnDesktop'),
              onChange: value => void toggleDesktop(value),
            }),
          ),
          h('p', { style: { ...styles.empty, marginTop: '8px' } }, translate('restartHint')),
          store.appAvailable ? null : h('p', { style: { ...styles.error, marginTop: '8px' } }, translate('missingApp')),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '14px', marginTop: '12px' } },
            h('div', { style: { ...styles.thumb, width: '86px', height: '96px', flex: 'none' } },
              activePet === undefined
                ? null
                : h(Sprite, { src: spriteUrl(activePet), scale: 0.4, playing: true }),
            ),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '12px', color: COLORS.muted } }, translate('preview')),
              h('div', { style: { ...styles.cardName, fontSize: '14px' } }, activePet?.name ?? '—'),
              (() => {
                const alpha = Math.min(100, Math.max(0, Number(ui.bubbleOpacity) || 0)) / 100
                const bg = /^#[0-9a-f]{6}$/i.test(ui.bubbleColor) ? ui.bubbleColor : '#0f0f0f'
                const fg = /^#[0-9a-f]{6}$/i.test(ui.bubbleTextColor) ? ui.bubbleTextColor : '#ffffff'
                return h(
                  'div',
                  {
                    style: {
                      marginTop: '8px',
                      padding: '16px',
                      borderRadius: '12px',
                      background: '#ffffff',
                      border: `1px solid ${COLORS.border}`,
                      display: 'flex',
                      justifyContent: 'flex-end',
                    },
                  },
                  h(
                    'div',
                    {
                      style: {
                        width: `${ui.bubbleMaxWidth}px`,
                        maxWidth: '100%',
                        fontSize: `${ui.bubbleFontSize}px`,
                        lineHeight: 1.45,
                        padding: '4px 8px 5px',
                        borderRadius: '12px',
                        background: bg,
                        color: fg,
                        textShadow: alpha < 0.5 ? (fgLight ? '0 1px 3px rgba(0,0,0,0.8)' : '0 1px 3px rgba(255,255,255,0.65)') : 'none',
                        display: ui.bubbles ? 'block' : 'none',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                      h('span', {
                        style: {
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          border: '1.5px solid transparent',
                          borderTopColor: fg,
                          borderRightColor: fg,
                          display: 'inline-block',
                        },
                      }),
                      h(
                        'span',
                        {
                          style: {
                            flex: 1,
                            minWidth: 0,
                            fontSize: '1em',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          },
                        },
                        translate('previewTitle'),
                      ),
                    ),
                    h(
                      'div',
                      {
                        style: {
                          marginTop: '1px',
                          paddingLeft: '16px',
                          fontSize: '0.94em',
                          opacity: 0.72,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                      },
                      translate('previewText'),
                    ),
                  ),
                )
              })(),
            ),
          ),
        ),

        // Installed ----------------------------------------------------------------
        h(
          'section',
          null,
          h(
            'h3',
            { style: styles.groupTitle },
            translate('installed'),
            store.pets.length > 0 ? h('span', { style: styles.count }, String(store.pets.length)) : null,
          ),
          store.pets.length === 0
            ? h('p', { style: styles.empty }, translate('installedEmpty'))
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                store.pets.map(pet =>
                  h(
                    'div',
                    { key: pet.slug, style: styles.row },
                    h('div', { style: { flex: 'none' } }, h(Sprite, { src: spriteUrl(pet), scale: 0.4 })),
                    h(
                      'div',
                      { style: { flex: 1, minWidth: 0 } },
                      h('div', { style: { ...styles.cardName, fontSize: '14px' } }, pet.name),
                      h('div', { style: { ...styles.cardText, minHeight: 0, WebkitLineClamp: 1 } }, pet.description || pet.slug),
                      h('div', { style: { ...styles.count, ...styles.mono, fontSize: '10px', marginTop: '2px' } }, pet.slug),
                    ),
                    store.active === pet.slug
                      ? h('span', { style: { ...styles.quietButton, cursor: 'default', color: COLORS.muted } }, translate('inUse'))
                      : h(
                          'button',
                          {
                            type: 'button',
                            style: styles.primaryButton,
                            disabled: busy !== null,
                            onClick: () => void act('petdex/api/active', { slug: pet.slug }, pet.slug),
                          },
                          translate('use'),
                        ),
                    h(
                      'button',
                      {
                        type: 'button',
                        style: styles.dangerButton,
                        disabled: busy !== null,
                        onClick: () => requestRemove(pet),
                      },
                      busy === pet.slug ? translate('removing') : translate('remove'),
                    ),
                  ),
                ),
              ),
        ),

        // Download -----------------------------------------------------------------
        h(
          'section',
          null,
          h('h3', { style: styles.groupTitle }, translate('downloadTitle')),
          h(
            'form',
            { onSubmit: event => void lookup(event), style: { display: 'flex', gap: '8px' } },
            h('input', {
              type: 'text',
              value: identifier,
              placeholder: translate('identifierPlaceholder'),
              'aria-label': translate('identifierPlaceholder'),
              onChange: event => {
                setIdentifier(event.target.value)
                setPreview(null)
                setLookupError(null)
              },
              style: styles.input,
            }),
            h(
              'button',
              {
                type: 'submit',
                style: styles.primaryButton,
                disabled: lookingUp || identifier.trim() === '',
              },
              lookingUp ? translate('lookingUp') : translate('lookup'),
            ),
          ),

          h(
            'div',
            { style: { ...styles.empty, marginTop: '8px', lineHeight: 1.8 } },
            h('div', null, translate('slugWhat')),
            h(
              'div',
              null,
              translate('slugExamplePage'),
              h('span', { style: styles.mono }, 'https://petdex.dev/pets/cat-in-the-box-shaco'),
            ),
            h(
              'div',
              null,
              translate('slugExampleId'),
              h('span', { style: styles.mono }, 'cat-in-the-box-shaco'),
            ),
            h(
              'div',
              null,
              translate('officialHintBefore'),
              h(
                'a',
                {
                  href: 'https://petdex.dev',
                  target: '_blank',
                  rel: 'noreferrer',
                  style: { color: COLORS.brand, textDecoration: 'none', margin: '0 3px' },
                },
                'petdex.dev',
              ),
              translate('officialHintAfter'),
            ),
          ),

          lookupError === null
            ? null
            : h('p', { style: { ...styles.error, marginTop: '8px' } }, translate('failed', { message: lookupError })),

          preview === null
            ? null
            : (() => {
                const installed = (store?.pets ?? []).some(item => item.slug === preview.slug)
                const active = store.active === preview.slug
                const token = `install:${preview.slug}`
                return h(
                  'div',
                  { style: { ...styles.row, gap: '12px', marginTop: '10px', alignItems: 'flex-start' } },
                  h(
                    'div',
                    {
                      style: {
                        width: '96px',
                        height: '96px',
                        flex: 'none',
                        borderRadius: '12px',
                        background: COLORS.layer2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      },
                    },
                    h('img', {
                      src: `${api('petdex/api/thumb')}?slug=${encodeURIComponent(preview.slug)}`,
                      alt: preview.name,
                      draggable: false,
                      style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
                    }),
                  ),
                  h(
                    'div',
                    { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { ...styles.cardName, fontSize: '14px' } }, preview.name),
                    h('div', { style: { ...styles.cardText, minHeight: 0, WebkitLineClamp: 3 } }, preview.description || preview.slug),
                    h('div', { style: { ...styles.count, ...styles.mono, fontSize: '10px', marginTop: '4px' } }, preview.slug),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: installed ? styles.quietButton : styles.primaryButton,
                      disabled: busy !== null || active,
                      onClick: () => void choosePet(preview),
                    },
                    active
                      ? translate('inUse')
                      : busy === token
                        ? translate('downloading')
                        : installed
                          ? translate('use')
                          : translate('download'),
                  ),
                )
              })(),
        ),

        // Appearance ---------------------------------------------------------------
        h(
          'section',
          null,
          h('h3', { style: styles.groupTitle }, translate('appearance')),
          h(
            'div',
            { style: { ...styles.panel, paddingTop: '4px', paddingBottom: '4px' } },
            h(
              'div',
              { style: { ...styles.settingRow, borderTop: 'none' } },
              h('span', { style: styles.settingLabel }, translate('size')),
              h(Slider, {
                value: ui.scale,
                min: 0.5,
                max: 2,
                step: 0.05,
                label: translate('size'),
                format: value => `${Math.round(value * 100)}%`,
                onCommit: value => void setConfig({ scale: value }),
              }),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('span', { style: styles.settingLabel }, translate('bubbles')),
              h('div', { style: { flex: 1, display: 'flex', justifyContent: 'flex-end' } },
                h(Switch, {
                  checked: ui.bubbles,
                  label: translate('bubbles'),
                  onChange: value => void setConfig({ bubbles: value }),
                }),
              ),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('span', { style: styles.settingLabel }, translate('bubbleFont')),
              h(Slider, {
                value: ui.bubbleFontSize,
                min: 9,
                max: 28,
                step: 1,
                label: translate('bubbleFont'),
                format: value => `${Math.round(value)}px`,
                onCommit: value => void setConfig({ bubbleFontSize: value }),
              }),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('span', { style: styles.settingLabel }, translate('bubbleWidth')),
              h(Slider, {
                value: ui.bubbleMaxWidth,
                min: 160,
                max: 560,
                step: 10,
                label: translate('bubbleWidth'),
                format: value => `${Math.round(value)}px`,
                onCommit: value => void setConfig({ bubbleMaxWidth: value }),
              }),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('span', { style: styles.settingLabel }, translate('bubbleLife')),
              h(Slider, {
                value: ui.bubbleLifetime,
                min: 0,
                max: 30,
                step: 1,
                label: translate('bubbleLife'),
                format: value => (value === 0 ? translate('forever') : translate('seconds', { value: Math.round(value) })),
                onCommit: value => void setConfig({ bubbleLifetime: value }),
              }),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('span', { style: styles.settingLabel }, translate('bubbleColor')),
              h('div', { style: { flex: 1, display: 'flex', justifyContent: 'flex-end' } },
                h(ColorInput, {
                  value: ui.bubbleColor,
                  label: translate('bubbleColor'),
                  onCommit: value => void setConfig({ bubbleColor: value }),
                }),
              ),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('span', { style: styles.settingLabel }, translate('bubbleTextColor')),
              h('div', { style: { flex: 1, display: 'flex', justifyContent: 'flex-end' } },
                h(ColorInput, {
                  value: ui.bubbleTextColor ?? '#ffffff',
                  label: translate('bubbleTextColor'),
                  onCommit: value => void setConfig({ bubbleTextColor: value }),
                }),
              ),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('span', { style: styles.settingLabel }, translate('bubbleOpacity')),
              h(Slider, {
                value: ui.bubbleOpacity,
                min: 0,
                max: 100,
                step: 1,
                label: translate('bubbleOpacity'),
                format: value => `${Math.round(value)}%`,
                onCommit: value => void setConfig({ bubbleOpacity: value }),
              }),
            ),
            h(
              'div',
              { style: styles.settingRow },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: '13px' } }, translate('clickThrough')),
                h('div', { style: { ...styles.empty, marginTop: '2px' } }, translate('clickThroughHint')),
              ),
              h(Switch, {
                checked: ui.clickThrough,
                label: translate('clickThrough'),
                onChange: value => void setConfig({ clickThrough: value }),
              }),
            ),
          ),
        ),

        // Gallery removed - users add pets manually to ~/.dsh/pets

        h(
          'p',
          { style: styles.footer },
          `${translate('libraryPath')}: `,
          h('span', { style: styles.mono }, store.home),
          h('br'),
          translate('hint'),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // A settings-page plugin must never abort the whole client boot: log and
        // degrade instead of letting one bad registration blank the UI.
        try {
          const locale = ctx.get('locale') ?? ctx.locale
          if (locale !== undefined && locale !== null && typeof locale.register === 'function') {
            localeService = locale
            try {
              ctx.effect(() => locale.register(NS, { zh, en }), 'petdex: dictionaries')
            } catch (error) {
              console.warn('[petdex] locale registration failed', error)
              reportClientError('locale', error)
            }
            if (typeof locale.bind === 'function') translate = locale.bind(NS)
          }

          ctx.slots.inject('settings.section', () => {
            try {
              return ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'petpal',
                  order: 45,
                  label: () => translate('nav'),
                  locale: NS,
                },
                PetdexSection,
              )
            } catch (error) {
              console.warn('[petdex] settings section registration failed', error)
              reportClientError('section', error)
              return () => {}
            }
          })
        } catch (error) {
          console.warn('[petdex] client activation failed', error)
          reportClientError('activation', error)
        }
      },
    }
  },
})
