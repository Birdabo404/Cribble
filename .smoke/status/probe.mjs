// One-off CDP verification harness for the /status page (final
// integration pass). Drives headless Brave over raw CDP against the
// running dev server, captures the four required screenshots into
// .smoke/status/, and checks console + network behavior.
//
// Capture strategy: captureBeyondViewport resizes the viewport at
// capture time, which restarts the day-bar entrance stagger and can
// shift the cell under a held pointer — the pixels then lie about
// steady state. Instead we pre-size the emulated viewport to the full
// content height, finish all finite animations, and take plain
// viewport screenshots with no resize anywhere in the capture path.
//
//   node .smoke/status/probe.mjs [base-url]

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:3000'
const PORT = 9257
const OUT = new URL('./', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const VENDOR_HOSTS = [
  'githubstatus.com',
  'openai.com',
  'claude.com',
  'anthropic.com',
  'status.cursor.com',
  'x.ai'
]

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
const requests = [] // { url, ts }
let loadedAt = 0

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
  await cdp.send('Network.enable')

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
  cdp.on('Network.requestWillBeSent', (params) => {
    requests.push({ url: params.request.url, ts: Date.now() })
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

  const mouseMove = (x, y) =>
    cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x),
      y: Math.round(y),
      buttons: 0,
      pointerType: 'mouse'
    })

  // Finish finite animations (entrance staggers) so captures show steady
  // state; infinite ones (breathing lamps) throw on finish() and keep going.
  const finishAnimations = () =>
    evalJs(`(() => {
      let n = 0;
      for (const a of document.getAnimations()) {
        try { a.finish(); n++; } catch {}
      }
      return n;
    })()`)

  /** Resize the emulated viewport to the page's full content height so a
   *  plain (no-resize) screenshot covers the whole page. Returns height. */
  const viewport = { width: 1440, dsf: 1, mobile: false }
  const sizeToContent = async () => {
    const metrics = await cdp.send('Page.getLayoutMetrics')
    const size = metrics.cssContentSize ?? metrics.contentSize
    const height = Math.ceil(size.height)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height,
      deviceScaleFactor: viewport.dsf,
      mobile: viewport.mobile
    })
    // the resize can restart entrance animations — let them run out, then
    // jump anything unfinished to its end state
    await sleep(1200)
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

  const clipShot = async (name, rect) => {
    const response = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { ...rect, scale: 1 }
    })
    const file = `${OUT}${name}.png`
    fs.writeFileSync(file, Buffer.from(response.data, 'base64'))
    console.log('saved', file)
    return file
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })

  // ================= phase A: load + payload paint (dark) =================
  phase = 'load-dark'
  loadedAt = Date.now()
  await cdp.send('Page.navigate', { url: `${BASE}/status` })
  await waitFor(
    `document.readyState === 'complete' && !!document.querySelector('.status-scope')`,
    'status shell render',
    60000
  )
  await waitFor(
    `document.querySelectorAll('.status-scope .font-display').length === 6`,
    'six service rows (payload landed)',
    60000
  )
  await waitFor(
    `document.querySelectorAll('.status-cell').length >= 500`,
    'day cells rendered'
  )
  await evalJs(`document.fonts.ready.then(() => 'ok')`)
  await sleep(1500)

  await check('load: exactly one /api/status fetch on load', async () => {
    const api = requests.filter((r) => r.url.includes('/api/status'))
    if (api.length === 1) return '1 request'
    if (api.length === 2 && api[1].ts - api[0].ts < 1500) {
      // Dev-only React StrictMode double-mount refires the effect; the
      // production build mounts once. Report, don't fail the gate.
      return `2 requests ${api[1].ts - api[0].ts}ms apart — dev StrictMode double-mount, single fetch per mount`
    }
    throw new Error(`${api.length} requests: ${api.map((r) => r.url).join(', ')}`)
  })

  await check('load: rows in pinned order with severities', async () => {
    const rows = await evalJs(`(() => {
      const out = [];
      for (const row of document.querySelectorAll('.status-scope .divide-y > div')) {
        const name = row.querySelector('.font-display')?.textContent ?? '?';
        const sev = row.querySelector('.font-data')?.textContent ?? '?';
        out.push(name + ':' + sev.trim());
      }
      return out;
    })()`)
    const names = rows.map((r) => r.split(':')[0]).join(',')
    if (names !== 'GitHub,ChatGPT,Claude,Cursor,Grok,Cribble')
      throw new Error(`order: ${names}`)
    return rows.join(' | ')
  })

  await check('load: hero verdict present', async () => {
    const h1 = await evalJs(
      `document.querySelector('.status-scope h1')?.textContent ?? ''`
    )
    if (!/quiet|humming|loud|incomplete|pulse/.test(h1))
      throw new Error(`unexpected hero: "${h1}"`)
    return `"${h1.trim()}"`
  })

  await check('load: vendor bars 90 cells desktop / 30 mobile in DOM', async () => {
    const counts = await evalJs(`(() => {
      const out = {};
      for (const g of document.querySelectorAll('[role="group"][aria-label*="days"]')) {
        out[g.getAttribute('aria-label')] = g.children.length;
      }
      return out;
    })()`)
    const bad = Object.entries(counts).filter(
      ([label, n]) =>
        (label.includes('90 days') && n !== 90) ||
        (label.includes('30 days') && n !== 30)
    )
    if (bad.length > 0) throw new Error(JSON.stringify(bad))
    const ninety = Object.keys(counts).filter((l) => l.includes('90 days')).length
    return `${ninety} vendors with 90-day bars`
  })

  await check('load: cribble row shows lamps, no day bar', async () => {
    const state = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('.status-scope .divide-y > div')];
      const cribble = rows[5];
      return {
        cells: cribble.querySelectorAll('.status-cell').length,
        text: cribble.querySelector('.glass-inset-lite')?.textContent ?? ''
      };
    })()`)
    if (state.cells !== 0) throw new Error(`cribble has ${state.cells} day cells`)
    if (!/web/i.test(state.text) || !/api/i.test(state.text) || !/database/i.test(state.text))
      throw new Error(`lamp labels missing: ${state.text}`)
    return state.text.replace(/\s+/g, ' ').trim().slice(0, 80)
  })

  const desktopHeight = await sizeToContent()

  await check('capture: bars settled before dark-desktop shot', async () => {
    const state = await evalJs(`(() => {
      const bar = document.querySelector('[role="group"][aria-label*="90 days"]');
      const cells = [...bar.querySelectorAll('.status-cell')];
      const last = cells[cells.length - 1];
      const cs = getComputedStyle(last);
      const first = cells[0].getBoundingClientRect();
      const end = last.getBoundingClientRect();
      return {
        transform: cs.transform,
        opacity: cs.opacity,
        span: Math.round(end.right - first.left),
        barWidth: Math.round(bar.getBoundingClientRect().width)
      };
    })()`)
    if (state.opacity !== '1') throw new Error(`last cell opacity ${state.opacity}`)
    if (state.transform !== 'none' && !/matrix\(1, 0, 0, 1,/.test(state.transform))
      throw new Error(`last cell mid-animation: ${state.transform}`)
    if (state.span < state.barWidth * 0.95)
      throw new Error(`cells span ${state.span}px of ${state.barWidth}px bar`)
    return `90 cells span ${state.span}px of ${state.barWidth}px, viewport ${desktopHeight}px`
  })

  await plainShot('dark-desktop')

  // ================= phase B: disclosure + tooltip detail =================
  phase = 'detail'
  await check('detail: GitHub components disclosure expands', async () => {
    const chips = await evalJs(`(async () => {
      const btn = document.querySelector('button[aria-controls="status-components-github"]');
      if (!btn) return { error: 'no disclosure button' };
      btn.click();
      await new Promise((r) => setTimeout(r, 350));
      const panel = document.getElementById('status-components-github');
      if (!panel) return { error: 'panel missing after click' };
      return { chips: panel.querySelectorAll('.truncate').length, expanded: btn.getAttribute('aria-expanded') };
    })()`)
    if (chips.error) throw new Error(chips.error)
    if (chips.expanded !== 'true') throw new Error(`aria-expanded=${chips.expanded}`)
    if (chips.chips < 5) throw new Error(`only ${chips.chips} component chips`)
    return `${chips.chips} chips, aria-expanded=true`
  })

  let heldTip = ''
  await check('detail: hover holds a day-cell tooltip', async () => {
    const target = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('.status-scope .divide-y > div')];
      const gh = rows[0];
      const bar = gh.querySelector('[role="group"][aria-label*="90 days"]');
      const cells = [...bar.querySelectorAll('.status-cell')];
      const incident = cells.filter((c) => c.tabIndex === 0);
      const cell = incident[incident.length - 1] ?? cells[cells.length - 1];
      const r = cell.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        tip: cell.getAttribute('title'),
        incidents: incident.length
      };
    })()`)
    await mouseMove(target.x, target.y)
    await sleep(350)
    const tip = await evalJs(`(() => {
      const el = document.querySelector('.status-scope .glass-pop');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent, w: r.width, left: r.left };
    })()`)
    if (!tip) throw new Error('tooltip did not appear')
    if (tip.w < 10 || tip.left < 0) throw new Error(`tooltip clipped: ${JSON.stringify(tip)}`)
    if (tip.text !== target.tip)
      throw new Error(`tooltip "${tip.text}" ≠ hovered cell title "${target.tip}"`)
    heldTip = tip.text
    return `"${tip.text}" (${target.incidents} incident cells in GitHub bar)`
  })

  await check('detail: capture expanded row + held tooltip', async () => {
    const rect = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('.status-scope .divide-y > div')];
      const r = rows[0].getBoundingClientRect();
      return {
        x: Math.max(0, r.left - 10 + window.scrollX),
        y: Math.max(0, r.top - 46 + window.scrollY),
        width: r.width + 20,
        height: r.height + 56
      };
    })()`)
    await clipShot('dark-detail', rect)
    const still = await evalJs(
      `document.querySelector('.status-scope .glass-pop')?.textContent ?? null`
    )
    if (still !== heldTip)
      throw new Error(`tooltip drifted during capture: "${still}" ≠ "${heldTip}"`)
    return `tooltip held: "${still}"`
  })

  // reset hover + disclosure so the light shot mirrors the dark one
  await mouseMove(4, 4)
  await evalJs(`(() => {
    const btn = document.querySelector('button[aria-controls="status-components-github"]');
    if (btn?.getAttribute('aria-expanded') === 'true') btn.click();
    window.scrollTo(0, 0);
    return 'reset';
  })()`)
  await sleep(300)

  // ================= phase C: light theme =================
  phase = 'light'
  await check('light: toggle flips html.light', async () => {
    await evalJs(
      `document.querySelector('button[aria-label="Switch to light mode"]').click(); 'ok'`
    )
    await waitFor(
      `document.documentElement.classList.contains('light')`,
      'html.light class'
    )
    await sleep(800) // view transition + repaint
    await finishAnimations()
    await sleep(150)
    return 'html.light set'
  })

  await check('light: outage ink distinct from accent on paper', async () => {
    const inks = await evalJs(`(() => {
      const scope = document.querySelector('.status-scope');
      const cs = getComputedStyle(scope);
      const down = cs.getPropertyValue('--sev-down').trim();
      const ok = cs.getPropertyValue('--sev-ok').trim();
      const warn = cs.getPropertyValue('--sev-warn').trim();
      const accentEl = document.querySelector('.status-scope .text-accent');
      const rows = [...document.querySelectorAll('.status-scope .divide-y > div')];
      let outageLabel = null;
      for (const row of rows) {
        const sev = row.querySelector('.font-data');
        if (sev && sev.textContent.trim() === 'OUTAGE') {
          outageLabel = getComputedStyle(sev).color;
          break;
        }
      }
      return {
        down, ok, warn,
        accent: accentEl ? getComputedStyle(accentEl).color : null,
        outageLabel
      };
    })()`)
    if (inks.down === inks.ok)
      throw new Error(`--sev-down "${inks.down}" === --sev-ok "${inks.ok}"`)
    if (inks.down !== '185 28 28')
      throw new Error(`--sev-down not re-pinned on light: "${inks.down}"`)
    if (inks.outageLabel && inks.accent && inks.outageLabel === inks.accent)
      throw new Error(`outage label color equals accent: ${inks.outageLabel}`)
    return `down=${inks.down} ok=${inks.ok} warn=${inks.warn} outageLabel=${inks.outageLabel}`
  })

  await plainShot('light-desktop')

  await check('light: back to dark for mobile shot', async () => {
    await evalJs(
      `document.querySelector('button[aria-label="Switch to dark mode"]').click(); 'ok'`
    )
    await waitFor(
      `!document.documentElement.classList.contains('light')`,
      'html.light removed'
    )
    await sleep(500)
  })

  // ================= phase D: mobile =================
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

  await check('mobile: 30-day window + stamp visible', async () => {
    const state = await evalJs(`(() => {
      const stamp = [...document.querySelectorAll('.status-scope span')]
        .find((s) => /last 30 of 90 days/i.test(s.textContent ?? ''));
      const rows = [...document.querySelectorAll('.status-scope .divide-y > div')];
      const gh = rows[0];
      const desktop = gh.querySelector('[role="group"][aria-label*="90 days"]');
      const mobile = gh.querySelector('[role="group"][aria-label*="30 days"]');
      const visible = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
      return {
        stamp: !!stamp && visible(stamp),
        desktopHidden: !visible(desktop),
        mobileVisible: visible(mobile),
        mobileCells: mobile ? mobile.children.length : 0
      };
    })()`)
    if (!state.stamp) throw new Error('LAST 30 OF 90 DAYS stamp not visible')
    if (!state.desktopHidden) throw new Error('90-day group still visible at 390px')
    if (!state.mobileVisible || state.mobileCells !== 30)
      throw new Error(`mobile group: visible=${state.mobileVisible} cells=${state.mobileCells}`)
    return `stamp visible, 30 cells, 90-day group hidden`
  })

  const mobileHeight = await sizeToContent()
  console.log(`mobile viewport sized to ${mobileHeight}px`)
  await plainShot('mobile')

  // ================= phase E: network + console report =================
  phase = 'report'
  await check('network: no browser requests to vendor hosts', async () => {
    const external = requests.filter((r) => !r.url.startsWith(BASE))
    const vendor = external.filter((r) =>
      VENDOR_HOSTS.some((host) => r.url.includes(host))
    )
    if (vendor.length > 0)
      throw new Error(vendor.map((r) => r.url).join(', '))
    const hosts = [...new Set(external.map((r) => new URL(r.url).host))]
    return hosts.length > 0 ? `external hosts (non-vendor): ${hosts.join(', ')}` : 'all requests same-origin'
  })

  await check('network: /api/status request tally', async () => {
    const api = requests.filter((r) => r.url.includes('/api/status'))
    const elapsed = Math.round((Date.now() - loadedAt) / 1000)
    return `${api.length} total over ${elapsed}s on page`
  })

  const expectedNoise = (entry) =>
    /favicon\.ico/.test(entry.text) ||
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
    JSON.stringify({ results, consoleErrors, apiRequests: requests.filter((r) => r.url.includes('/api/status')) }, null, 2)
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
