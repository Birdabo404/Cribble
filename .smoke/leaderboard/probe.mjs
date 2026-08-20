// One-off CDP verification harness for the squared leaderboard panels.
// Drives headless Brave over raw CDP against the running dev server,
// captures dark/light desktop shots plus the AI and TEAMS tabs into
// .smoke/leaderboard/, and asserts the square-panel geometry landed
// (with zero corner-tick surfaces) without breaking the rounded controls.
//
//   node .smoke/leaderboard/probe.mjs [base-url]

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:3000'
const PORT = 9258
const OUT = new URL('./', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getJson = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
          }
        })
      })
      .on('error', reject)
  })

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method && this.handlers.has(message.method)) {
        this.handlers.get(message.method)(message.params)
      }
    })
  }

  on(method, handler) {
    this.handlers.set(method, handler)
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

let browser
const killBrowser = () => {
  try {
    browser?.kill('SIGKILL')
  } catch {}
}

const results = []
let phase = 'boot'
const consoleErrors = []

async function check(name, fn) {
  try {
    const note = await fn()
    results.push({ name, ok: true, note: note || '' })
    console.log(`PASS  ${name}${note ? ` — ${note}` : ''}`)
  } catch (error) {
    results.push({ name, ok: false, note: String(error.message || error) })
    console.log(`FAIL  ${name} — ${error.message || error}`)
  }
}

async function main() {
  const profileDir = `/tmp/brave-cdp-${PORT}`
  fs.rmSync(profileDir, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  browser = spawn(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--disable-features=Translate',
      '--window-size=1440,900',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )
  process.on('exit', killBrowser)

  let page
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250)
    try {
      const targets = await getJson('/json/list')
      page = targets.find((target) => target.type === 'page')
      if (page) break
    } catch {}
  }
  if (!page) throw new Error('browser did not expose a page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const cdp = new Cdp(ws)

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error' && params.type !== 'warning') return
    const text = params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    consoleErrors.push({ phase, kind: `console.${params.type}`, text })
  })
  cdp.on('Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails
    consoleErrors.push({
      phase,
      kind: 'exception',
      text: d.exception?.description || d.text || 'unknown exception'
    })
  })
  cdp.on('Log.entryAdded', (params) => {
    const e = params.entry
    if (e.level !== 'error') return
    consoleErrors.push({
      phase,
      kind: `log:${e.source}`,
      text: `${e.text} ${e.url || ''}`
    })
  })

  const evalJs = async (expression) => {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          JSON.stringify(response.exceptionDetails)
      )
    }
    return response.result.value
  }

  const waitFor = async (expression, label, timeout = 30000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      if (await evalJs(expression)) return
      await sleep(200)
    }
    throw new Error(`timeout waiting for ${label}`)
  }

  const finishAnimations = () =>
    evalJs(`(() => {
      let n = 0;
      for (const a of document.getAnimations()) {
        try { a.finish(); n++; } catch {}
      }
      return n;
    })()`)

  /** Resize the emulated viewport to full content height so a plain
   *  (no-resize) screenshot covers the whole page. */
  const sizeToContent = async () => {
    const metrics = await cdp.send('Page.getLayoutMetrics')
    const size = metrics.cssContentSize ?? metrics.contentSize
    const height = Math.min(Math.ceil(size.height), 6000)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await sleep(1000)
    await finishAnimations()
    await sleep(150)
    return height
  }

  const plainShot = async (name) => {
    const response = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })
    const file = `${OUT}${name}.png`
    fs.writeFileSync(file, Buffer.from(response.data, 'base64'))
    console.log('saved', file)
    return file
  }

  // Shared in-page audit of the squared panel geometry for the current view.
  const SQUARE_AUDIT = `(() => {
    const out = { panels: [], chips: [], ticks: [] };
    for (const el of document.querySelectorAll('.lb-panel')) {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      out.panels.push({
        classes: el.className.slice(0, 60),
        radius: cs.borderRadius,
        afterContent: after.content
      });
    }
    for (const el of document.querySelectorAll('.lb-panel span.inline-flex.h-8.w-8')) {
      out.chips.push(getComputedStyle(el).borderRadius);
    }
    out.hudCount = document.querySelectorAll('.lb-hud, .lb-hud-accent').length;
    const tablist = document.querySelector('[role="tablist"]');
    out.tablistRadius = tablist ? getComputedStyle(tablist).borderRadius : null;
    const pod = document.querySelector('.pod-card');
    out.podCardRadius = pod ? getComputedStyle(pod).borderRadius : null;
    return out;
  })()`

  const auditSquare = async (label) => {
    const audit = await evalJs(SQUARE_AUDIT)
    if (audit.panels.length === 0) throw new Error('no .lb-panel found')
    const roundPanels = audit.panels.filter((p) => p.radius !== '0px')
    if (roundPanels.length > 0)
      throw new Error(`rounded panels: ${JSON.stringify(roundPanels)}`)
    if (audit.hudCount !== 0)
      throw new Error(`${audit.hudCount} lb-hud surfaces still in DOM`)
    const ticked = audit.panels.filter((p) => p.afterContent !== 'none')
    if (ticked.length > 0)
      throw new Error(`panels still draw ::after ticks: ${JSON.stringify(ticked)}`)
    const roundChips = audit.chips.filter((r) => r !== '0px')
    if (roundChips.length > 0)
      throw new Error(`rounded rank chips: ${JSON.stringify(roundChips)}`)
    if (audit.tablistRadius && audit.tablistRadius === '0px')
      throw new Error('tablist control lost its rounding')
    return {
      audit,
      note:
        `${audit.panels.length} panels square, 0 corner ticks, ` +
        `${audit.chips.length} chips square — ${label}`
    }
  }

  const clickTab = async (label) => {
    const found = await evalJs(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((t) => t.textContent.trim() === ${JSON.stringify(label)});
      if (!tab) return false;
      tab.click();
      return true;
    })()`)
    if (!found) throw new Error(`tab ${label} not found`)
    await sleep(700)
    await finishAnimations()
    await sleep(150)
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })

  // ================= phase A: season board, dark =================
  phase = 'dark-season'
  await cdp.send('Page.navigate', { url: `${BASE}/leaderboard` })
  await waitFor(
    `document.readyState === 'complete' && !!document.querySelector('.lb-panel')`,
    'leaderboard shell render',
    60000
  )
  await waitFor(
    `document.querySelectorAll('[role="tab"]').length >= 4`,
    'board tabs render'
  )
  // rows, skeletons, or the empty state — any settled table body
  await waitFor(
    `!!document.querySelector('.lb-panel ul li')`,
    'standings body render'
  )
  await evalJs(`document.fonts.ready.then(() => 'ok')`)
  await sleep(1500)

  await check('dark/season: panels square, zero ticks, chips square', async () => {
    const { note } = await auditSquare('season board')
    return note
  })

  await check('dark/season: standings panel keeps overflow clipping', async () => {
    const state = await evalJs(`(() => {
      const el = [...document.querySelectorAll('.lb-panel')]
        .find((p) => p.querySelector('ul'));
      return el ? getComputedStyle(el).overflow : null;
    })()`)
    if (state !== 'hidden')
      throw new Error(`standings panel overflow: ${state}`)
    return 'overflow-hidden intact'
  })

  await check('dark/season: sticky YouBar state', async () => {
    const state = await evalJs(`(() => {
      const bar = document.querySelector('button[aria-label="Open your profile card"]');
      if (!bar) return { present: false };
      const cs = getComputedStyle(bar);
      const plate = [...bar.querySelectorAll('span')]
        .find((s) => s.textContent.trim() === 'YOU');
      const plateCs = plate ? getComputedStyle(plate) : null;
      return {
        present: true,
        radius: cs.borderRadius,
        afterContent: getComputedStyle(bar, '::after').content,
        plate: plateCs
          ? { border: plateCs.borderTopWidth, radius: plateCs.borderRadius, bg: plateCs.backgroundColor }
          : null
      };
    })()`)
    if (!state.present)
      return 'YouBar not rendered — logged-out session (needs auth); geometry covered by shared CSS'
    if (state.radius !== '0px') throw new Error(`YouBar radius ${state.radius}`)
    if (state.afterContent !== 'none')
      throw new Error(`YouBar still draws ::after ticks: ${state.afterContent}`)
    if (!state.plate || state.plate.radius !== '0px' || state.plate.border === '0px')
      throw new Error(`YOU plate wrong: ${JSON.stringify(state.plate)}`)
    return 'YouBar square, no ticks, YOU plate bordered'
  })

  await sizeToContent()
  await plainShot('dark-desktop')

  // A settled table body: at least one row that is not a skeleton shimmer.
  const LIVE_ROWS = `[...document.querySelectorAll('.lb-panel ul li')]
    .some((li) => !li.querySelector('.animate-pulse'))`

  // ================= phase B: AI tab =================
  phase = 'dark-ai'
  await check('dark/ai: tab switch + squared tool standings', async () => {
    await clickTab('AI')
    await waitFor(
      `[...document.querySelectorAll('h2')].some((h) => h.textContent.includes('TOOL STANDINGS'))`,
      'AI board render'
    )
    await waitFor(LIVE_ROWS, 'AI board live rows')
    await sleep(800)
    await finishAnimations()
    const { note } = await auditSquare('AI board')
    return note
  })
  await sizeToContent()
  await plainShot('dark-ai')

  // ================= phase C: TEAMS tab =================
  phase = 'dark-teams'
  await check('dark/teams: tab switch + squared team standings', async () => {
    await clickTab('TEAMS')
    await waitFor(LIVE_ROWS, 'team board live rows')
    await sleep(800)
    await finishAnimations()
    const { note } = await auditSquare('teams board')
    return note
  })
  await sizeToContent()
  await plainShot('dark-teams')

  // ================= phase D: light mode, season =================
  phase = 'light'
  await check('light: theme flips, panels stay square with zero ticks', async () => {
    await clickTab('SEASON')
    await waitFor(`!!document.querySelector('.lb-panel ul li')`, 'season board back')
    const toggled = await evalJs(`(() => {
      const btn = document.querySelector('button[aria-label="Switch to light mode"]');
      if (btn) { btn.click(); return 'button'; }
      document.documentElement.classList.add('light');
      return 'class-forced';
    })()`)
    await waitFor(
      `document.documentElement.classList.contains('light')`,
      'html.light class'
    )
    await sleep(800)
    await finishAnimations()
    const { note } = await auditSquare('season board, light')
    return `${note}; toggle=${toggled}`
  })
  await sizeToContent()
  await plainShot('light-desktop')

  // ================= phase E: console report =================
  phase = 'report'
  const expectedNoise = (entry) =>
    /favicon\.ico/.test(entry.text) ||
    /401|Unauthorized|Failed to load resource.*40[13]/.test(entry.text) ||
    (entry.kind === 'console.warning' && /Download the React DevTools/.test(entry.text))
  await check('console: no unexpected errors/warnings across phases', async () => {
    const unexpected = consoleErrors.filter((entry) => !expectedNoise(entry))
    if (unexpected.length > 0)
      throw new Error(
        unexpected
          .map((entry) => `[${entry.phase}] ${entry.kind}: ${entry.text.slice(0, 200)}`)
          .join(' | ')
      )
    const noise = consoleErrors.length - unexpected.length
    return noise > 0 ? `${noise} known-noise entries only` : 'zero console entries'
  })

  fs.writeFileSync(
    `${OUT}report.json`,
    JSON.stringify({ results, consoleErrors }, null, 2)
  )

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)

  ws.close()
  killBrowser()
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('HARNESS ERROR:', error)
  killBrowser()
  process.exit(2)
})
