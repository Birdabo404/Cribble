// One-off CDP harness for the /sponsorship buyer page (sweep pass).
// Screenshots desktop dark, desktop light, and mobile against a running
// local server. Adapted from .smoke/status/probe.mjs — same Brave/CDP
// path, no resize-during-capture.
//
//   node .smoke/sponsorship/probe.mjs [base-url]

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:3000'
const PORT = 9261
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

  const viewport = { width: 1440, dsf: 1, mobile: false }
  const sizeToContent = async () => {
    const metrics = await cdp.send('Page.getLayoutMetrics')
    const size = metrics.cssContentSize ?? metrics.contentSize
    const height = Math.min(8000, Math.ceil(size.height))
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height,
      deviceScaleFactor: viewport.dsf,
      mobile: viewport.mobile
    })
    await sleep(800)
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

  const pageFacts = () =>
    evalJs(`(() => {
      const scope = document.querySelector('.settings-scope');
      const h1 = document.querySelector('.settings-scope h1');
      const headings = [...document.querySelectorAll('.settings-scope h2')].map((el) =>
        el.textContent.trim()
      );
      const live = [...document.querySelectorAll('.settings-scope span, .settings-scope p')]
        .some((el) => el.textContent.trim() === 'Live preview');
      const pitch = document.getElementById('pitch');
      const openLabels = [...document.querySelectorAll('.settings-scope *')].filter(
        (el) => el.childNodes.length === 1 && el.textContent.trim() === 'Open'
      );
      const openGold = openLabels.filter((el) => {
        const c = getComputedStyle(el).color;
        return /rgb\\(212|201|180|var\\(--lb-gold/.test(c);
      }).length;
      const studio = pitch ? getComputedStyle(pitch).display : null;
      const studioCols = pitch ? getComputedStyle(pitch).gridTemplateColumns : null;
      const well = document.querySelector('.settings-scope [class*="bg-[#09090b]"], .settings-scope .bg-\\\\[\\\\#09090b\\\\]');
      const wells = [...document.querySelectorAll('.settings-scope div')].filter((el) =>
        (el.className || '').includes('bg-[#09090b]')
      );
      const howCells = [...document.querySelectorAll('.settings-scope h2')]
        .find((el) => el.textContent.trim() === 'How it works')
        ?.nextElementSibling?.nextElementSibling?.querySelectorAll(':scope > div > div').length;
      const cs = scope ? getComputedStyle(scope) : null;
      return {
        hasScope: !!scope,
        title: h1?.textContent.trim() ?? null,
        headings,
        livePreview: live,
        hasPitch: !!pitch,
        pitchScrollMt: pitch ? getComputedStyle(pitch).scrollMarginTop : null,
        studioDisplay: studio,
        studioCols,
        wellCount: wells.length,
        howCells: howCells ?? 0,
        openCount: openLabels.length,
        openGold,
        text: cs?.getPropertyValue('--st-text').trim() || cs?.color || null,
        panel: cs?.getPropertyValue('--st-panel').trim() || null,
        light: document.documentElement.classList.contains('light'),
        width: window.innerWidth,
        bodyH: document.documentElement.scrollHeight
      };
    })()`)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })

  phase = 'load-dark'
  await cdp.send('Page.navigate', { url: `${BASE}/sponsorship` })
  await waitFor(
    `document.readyState === 'complete' && !!document.querySelector('.settings-scope')`,
    'sponsorship shell',
    60000
  )
  await waitFor(
    `!!document.getElementById('pitch')`,
    'buy-view studio #pitch',
    30000
  )
  await evalJs(`document.fonts.ready.then(() => 'ok')`)
  await sleep(800)

  const darkFacts = await pageFacts()
  await check('dark: settings-scope + title + buy bands', async () => {
    if (!darkFacts.hasScope) throw new Error('no .settings-scope')
    if (darkFacts.title !== 'Sponsorship') throw new Error(`h1="${darkFacts.title}"`)
    if (!darkFacts.headings.includes('Become a sponsor')) throw new Error(`headings=${darkFacts.headings}`)
    if (!darkFacts.headings.includes('Create your ad')) throw new Error('missing Create your ad')
    if (!darkFacts.headings.includes('How it works')) throw new Error('missing How it works')
    if (!darkFacts.hasPitch) throw new Error('no #pitch')
    return `headings=${darkFacts.headings.join(' | ')}`
  })

  await check('dark: live preview stage present', async () => {
    if (!darkFacts.livePreview) throw new Error('no Live preview label')
    if (darkFacts.wellCount < 1) throw new Error(`wells=${darkFacts.wellCount}`)
    return `wells=${darkFacts.wellCount} studio=${darkFacts.studioDisplay} cols=${darkFacts.studioCols}`
  })

  await check('dark: Open labels are not gold', async () => {
    if (darkFacts.openGold > 0) throw new Error(`${darkFacts.openGold} Open labels look gold`)
    return `${darkFacts.openCount} Open labels, 0 gold`
  })

  const desktopHeight = await sizeToContent()
  await plainShot('dark-desktop')

  phase = 'light'
  await check('light: toggle flips html.light', async () => {
    await evalJs(
      `document.querySelector('button[aria-label="Switch to light mode"]').click(); 'ok'`
    )
    await waitFor(`document.documentElement.classList.contains('light')`, 'html.light class')
    await sleep(800)
    await finishAnimations()
    await sleep(150)
    return 'html.light set'
  })

  const lightFacts = await pageFacts()
  await check('light: page tokens remapped (not white-on-black chrome)', async () => {
    if (!lightFacts.light) throw new Error('html.light missing')
    const text = lightFacts.text || ''
    // Light --st-text is a dark ink, not near-white.
    if (/255|250|244/.test(text) && !/9 |17 |24 |28 |39 /.test(text))
      throw new Error(`--st-text still light-looking: "${text}"`)
    return `text=${lightFacts.text} panel=${lightFacts.panel}`
  })

  await sizeToContent()
  await plainShot('light-desktop')

  await check('light: back to dark for mobile', async () => {
    await evalJs(
      `document.querySelector('button[aria-label="Switch to dark mode"]').click(); 'ok'`
    )
    await waitFor(
      `!document.documentElement.classList.contains('light')`,
      'html.light removed'
    )
    await sleep(400)
  })

  phase = 'mobile'
  viewport.width = 390
  viewport.dsf = 2
  viewport.mobile = true
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  })
  await sleep(800)
  await waitFor(`!!document.getElementById('pitch')`, 'pitch still mounted')

  const mobileFacts = await pageFacts()
  await check('mobile: studio stacks, preview still present', async () => {
    if (!mobileFacts.livePreview) throw new Error('no Live preview')
    if (mobileFacts.studioDisplay === 'grid')
      throw new Error(`studio still grid at 390: ${mobileFacts.studioCols}`)
    return `display=${mobileFacts.studioDisplay} wells=${mobileFacts.wellCount}`
  })

  const mobileHeight = await sizeToContent()
  console.log(`viewport heights desktop=${desktopHeight} mobile=${mobileHeight}`)
  await plainShot('mobile')

  phase = 'report'
  const expectedNoise = (entry) =>
    /favicon\.ico/.test(entry.text) ||
    (entry.kind === 'console.warning' && /Download the React DevTools/.test(entry.text))
  await check('console: no unexpected errors', async () => {
    const unexpected = consoleErrors.filter((entry) => !expectedNoise(entry))
    if (unexpected.length > 0)
      throw new Error(
        unexpected
          .map((entry) => `[${entry.phase}] ${entry.kind}: ${entry.text.slice(0, 200)}`)
          .join(' | ')
      )
    return consoleErrors.length === 0 ? 'zero console entries' : `${consoleErrors.length} known-noise`
  })

  fs.writeFileSync(
    `${OUT}report.json`,
    JSON.stringify({ results, consoleErrors, darkFacts, lightFacts, mobileFacts }, null, 2)
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
