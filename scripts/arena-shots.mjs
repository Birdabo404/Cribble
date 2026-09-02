// Throwaway CDP harness for the landing arena takeover: drives the public
// landing page, scrolls the arena stage live, and photographs the takeover
// timeline (old guard → warp-ins → deranks → final cast) plus light theme,
// mobile and reduced-motion states into scripts/shots-arena.
//
//   node scripts/arena-shots.mjs [label] [base-url]
//
// Spawns its own headless browser on port 9234 and kills it when done.
// Asserts (printed as ASSERT lines): opening roster is the old guard,
// closing roster is the final cast, all four insurgent avatars resolve,
// and reduced motion renders the final cast with no takeover.

import fs from 'node:fs'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'

const LABEL = process.argv[2] || 'shot'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9234
const OUT = new URL('./shots-arena/', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const PANEL = '#descent-arena .ar-panel'

const OLD_GUARD = '@birdabo,@sama,@elonmusk,@karpathy,@mntruell,@naval'
const FINAL_CAST =
  '@birdabo,@levelsio,@marc_louvion,@karpathy,@jackfriks,@robj3d3'

// ---- harness ---------------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const getJson = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(e)
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
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method && this.handlers.has(msg.method)) {
        this.handlers.get(msg.method)(msg.params)
      }
    })
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'))
      }
      this.pending.clear()
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

let pass = 0
let fail = 0
const assert = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`ASSERT PASS  ${name}`)
  } else {
    fail++
    console.log(`ASSERT FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error('watchdog: run exceeded 5 minutes, aborting')
    process.exit(2)
  }, 5 * 60_000)
  watchdog.unref?.()

  const profileDir = `/tmp/brave-cdp-${PORT}`
  spawnSync('pkill', ['-f', `brave-cdp-${PORT}`])
  await sleep(600)
  fs.rmSync(profileDir, { recursive: true, force: true })
  const browser = spawn(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--disable-features=Translate',
      '--window-size=1440,1000',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )
  const kill = () => {
    try {
      browser.kill('SIGKILL')
    } catch {}
  }
  process.on('exit', kill)

  let page
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    try {
      const targets = await getJson('/json/list')
      page = targets.find((t) => t.type === 'page')
      if (page) break
    } catch {}
  }
  if (!page) throw new Error('browser did not expose a page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 15_000)
    ws.addEventListener('open', () => {
      clearTimeout(t)
      resolve()
    })
    ws.addEventListener('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
  const cdp = new Cdp(ws)

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  // Console/exception capture — hydration mismatches must not slip by.
  const consoleErrors = []
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'warning') return
    const text = (p.args || [])
      .map((a) => a.value ?? a.description ?? '')
      .join(' ')
    consoleErrors.push(`[console.${p.type}] ${text}`)
  })
  cdp.on('Runtime.exceptionThrown', (p) => {
    consoleErrors.push(
      `[exception] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`
    )
  })

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails)
      throw new Error(JSON.stringify(r.exceptionDetails.exception))
    return r.result.value
  }

  const setViewport = (width, height, mobile = false) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile
    })

  const setReducedMotion = (on) =>
    cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : '' }]
    })

  const shot = async (name, clip, beyond = false) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      ...(beyond ? { captureBeyondViewport: true } : {}),
      ...(clip ? { clip: { ...clip, scale: 1 } } : {})
    })
    const file = `${OUT}${LABEL}-${name}.png`
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    console.log('saved', file)
  }

  const waitFor = async (selector, timeout = 30000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJs(`!!document.querySelector(${JSON.stringify(selector)})`))
        return
      await sleep(250)
    }
    throw new Error(`timeout waiting for ${selector}`)
  }

  // Element clip in document coordinates (fold in the scroll offset).
  const rectOf = async (selector, margin = 20) => {
    const r = await evalJs(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }; })()`
    )
    if (!r) throw new Error(`element not found: ${selector}`)
    return {
      x: Math.max(0, r.x - margin),
      y: Math.max(0, r.y - margin),
      width: r.width + margin * 2,
      height: r.height + margin * 2
    }
  }

  const goto = async () => {
    await cdp.send('Page.navigate', { url: `${BASE}/` })
    await waitFor('#descent-arena')
    await sleep(400)
  }

  // Scroll so the arena stage crosses the IO threshold and goes live.
  // (offsetTop resolves against the positioned .lx-descent wrapper, so
  // document position must come from gBCR + scrollY.)
  const scrollToArena = () =>
    evalJs(
      `(() => { const el = document.getElementById('descent-arena'); const y = el.getBoundingClientRect().top + window.scrollY; window.scrollTo(0, y - 60); return 'ok' })()`
    )

  // The CALLSIGN cell is the third column of the Tower-style table
  // (P · PLATE · CALLSIGN · …) — row textContent would run every column
  // together.
  const roster = () =>
    evalJs(
      `[...document.querySelectorAll('#descent-arena .ar-row')].map((r) => r.querySelector('td:nth-child(3)')?.textContent.trim() || '?').join(',')`
    )

  const setTheme = (theme) =>
    evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)

  // Poll until the roster satisfies a predicate — the stage's IO adds a
  // few hundred ms of slack, so beats are event-driven, not clock-driven.
  const waitRoster = async (name, test, timeout = 20000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const r = await roster()
      if (test(r)) return r
      await sleep(110)
    }
    const last = await roster()
    assert(name, false, `timeout — last roster: ${last}`)
    return last
  }

  /* ---- pass 1 · dark desktop — the full takeover timeline --------------- */

  await setViewport(1440, 1000)
  await goto()
  await scrollToArena()

  await sleep(1500) // entrance stagger settled
  const opening = await roster()
  assert('opening roster = old guard', opening === OLD_GUARD, opening)
  await shot('01-oldguard-dark', await rectOf(PANEL))

  await waitRoster('rob arrives', (r) => r.includes('@robj3d3'))
  const rows = await evalJs(
    `document.querySelectorAll('#descent-arena .ar-row').length`
  )
  assert('board holds 7 rows mid-arrival', rows === 7, `rows=${rows}`)
  await shot('02-rob-warpin', await rectOf(PANEL))

  await sleep(1000) // naval mid-fall (exit starts 820ms after arrival)
  await shot('03-naval-falling', await rectOf(PANEL))

  await waitRoster('jack arrives', (r) => r.includes('@jackfriks'))
  await shot('04-jack-warpin', await rectOf(PANEL))

  await waitRoster('marc arrives', (r) => r.includes('@marc_louvion'))
  await shot('05-marc-warpin', await rectOf(PANEL))

  await waitRoster('levelsio arrives', (r) => r.includes('@levelsio'))
  await shot('06-levelsio-warpin', await rectOf(PANEL))

  const closing = await waitRoster(
    'closing roster = final cast',
    (r) => r === FINAL_CAST
  )
  assert('closing roster = final cast', closing === FINAL_CAST, closing)
  await sleep(500)
  await shot('07-final-cast-dark', await rectOf(PANEL))

  // Every ranked row carries a plate swatch cell (the second column); a
  // pilot without a plate shows an empty hairline box, never nothing.
  const swatches = await evalJs(
    `[...document.querySelectorAll('#descent-arena .ar-row')].map((r) => r.querySelector('td:nth-child(2) > span') ? 'ok' : 'MISSING').join(' | ')`
  )
  assert('all rows carry a plate swatch', !swatches.includes('MISSING'), swatches)

  await sleep(3400) // act two — duel ticks running again
  await shot('08-duel-resumed', await rectOf(PANEL))

  /* ---- pass 2 · light theme — end state on the white sheet -------------- */

  await setTheme('light')
  await goto()
  await scrollToArena()
  await waitRoster('light: marc arrives', (r) => r.includes('@marc_louvion'))
  await shot('09-marc-warpin-light', await rectOf(PANEL))
  const closingLight = await waitRoster(
    'light: closing roster = final cast',
    (r) => r === FINAL_CAST
  )
  assert(
    'light: closing roster = final cast',
    closingLight === FINAL_CAST,
    closingLight
  )
  await sleep(500)
  await shot('10-final-cast-light', await rectOf(PANEL))

  /* ---- pass 3 · mobile — end state ------------------------------------- */

  // Phone width drives the layout; the extra height just fits the whole
  // panel in-viewport (captureBeyondViewport perturbs the scroll scrub).
  await setTheme('dark')
  await setViewport(390, 1180, true)
  await goto()
  // Park just above the arena, then swipe the last stretch as a real
  // compositor gesture so the stage's ScrollTrigger sees a scroll like a
  // phone would deliver it.
  await evalJs(
    `(() => { const el = document.getElementById('descent-arena'); const y = el.getBoundingClientRect().top + window.scrollY; window.scrollTo(0, y - 300); return 'ok' })()`
  )
  await cdp.send('Input.synthesizeScrollGesture', {
    x: 195,
    y: 700,
    yDistance: -240,
    speed: 4000
  })
  const closingMobile = await waitRoster(
    'mobile: closing roster = final cast',
    (r) => r === FINAL_CAST
  )
  assert(
    'mobile: closing roster = final cast',
    closingMobile === FINAL_CAST,
    closingMobile
  )
  await sleep(1500) // entrance choreography settled
  await shot('11-final-cast-mobile', await rectOf(PANEL, 8))

  /* ---- pass 4 · reduced motion — static final cast, no theater ---------- */

  await setViewport(1440, 1000)
  await setReducedMotion(true)
  await goto()
  await scrollToArena()
  await sleep(400)
  const rmEarly = await roster()
  assert('reduced motion: final cast immediately', rmEarly === FINAL_CAST, rmEarly)
  await sleep(3200) // past TK_T0 — nothing may have started arriving
  const rmLate = await roster()
  assert('reduced motion: no takeover plays', rmLate === FINAL_CAST, rmLate)
  await shot('12-reduced-motion', await rectOf(PANEL))
  await setReducedMotion(false)

  /* ---- wrap up ----------------------------------------------------------- */

  const hydration = consoleErrors.filter(
    (e) => /hydrat/i.test(e) || /did not match/i.test(e)
  )
  assert('no hydration warnings', hydration.length === 0, hydration.join(' // '))
  if (consoleErrors.length) {
    console.log('\nconsole noise (first 12):')
    consoleErrors.slice(0, 12).forEach((e) => console.log('  ' + e.slice(0, 240)))
  }

  console.log(`\nDONE — ${pass} passed, ${fail} failed`)
  kill()
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
