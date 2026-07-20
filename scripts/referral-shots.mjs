// Throwaway CDP harness for the profile ReferralPlate: authenticates with a
// pre-minted cribble_session cookie, mocks GET /api/user/referral at the
// network layer (the backend may not exist yet), and captures the plate +
// modal across themes/viewports plus animation frames to scripts/shots-referral.
//
//   node scripts/referral-shots.mjs [label] [base-url]
//
//   label     prefix for output files (default "shot") — use before/after
//   base-url  default http://localhost:3000
//
// Env:
//   SESSION_TOKEN  cribble_session value (default: the QA token minted for
//                  this visual pass — see user_sessions row for user 13)
//   PROFILE_PATH   profile page to visit (default /u/Birdabo404)
//   MOCK=0         disable the referral API mock (use the real endpoint)
//
// Spawns its own headless browser on port 9231 and kills it when done.

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const LABEL = process.argv[2] || 'shot'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9231
const OUT = new URL('./shots-referral/', import.meta.url).pathname
const SESSION = process.env.SESSION_TOKEN || 'a3f6d2e8-referral-qa-7c1b-visual-pass'
const PROFILE = process.env.PROFILE_PATH || '/u/Birdabo404'
const MOCK = process.env.MOCK !== '0'

const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const MOCK_BODY = JSON.stringify({
  code: 'CRIB-K4M2-X9P3',
  link: `${BASE}/join/CRIB-K4M2-X9P3`,
  stats: { joined: 7, rewarded: 4, pointsEarned: 2000, capRemaining: 6 }
})

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

async function main() {
  // ---- browser ----
  const profileDir = `/tmp/brave-cdp-${PORT}`
  fs.rmSync(profileDir, { recursive: true, force: true })
  const browser = spawn(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--disable-features=Translate',
      '--window-size=1440,900',
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
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const cdp = new Cdp(ws)

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')

  // ---- auth cookie (session minted directly in user_sessions) ----
  await cdp.send('Network.setCookie', {
    name: 'cribble_session',
    value: SESSION,
    url: BASE
  })

  // ---- referral API mock ----
  // mockMode: 'ok' fulfills with MOCK_BODY, 'error' 500s, 'hold' parks the
  // request (loading skeleton) until releaseHeld() is called.
  let mockMode = 'ok'
  let held = []
  const releaseHeld = async () => {
    for (const requestId of held.splice(0)) {
      await cdp
        .send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(MOCK_BODY).toString('base64')
        })
        .catch(() => {})
    }
  }
  if (MOCK) {
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*/api/user/referral*' }]
    })
    cdp.on('Fetch.requestPaused', (p) => {
      if (mockMode === 'hold') {
        held.push(p.requestId)
        return
      }
      if (mockMode === 'error') {
        cdp
          .send('Fetch.fulfillRequest', {
            requestId: p.requestId,
            responseCode: 500,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from('{"error":"boom"}').toString('base64')
          })
          .catch(() => {})
        return
      }
      cdp
        .send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(MOCK_BODY).toString('base64')
        })
        .catch(() => {})
    })
  }

  // ---- helpers ----
  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception))
    return r.result.value
  }

  const setViewport = (width, height, mobile = false) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile
    })

  const shot = async (name, clip) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      ...(clip ? { clip: { ...clip, scale: 1 } } : {})
    })
    const file = `${OUT}${LABEL}-${name}.png`
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    console.log('saved', file)
    return file
  }

  const waitFor = async (selector, timeout = 15000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJs(`!!document.querySelector(${JSON.stringify(selector)})`)) return
      await sleep(250)
    }
    throw new Error(`timeout waiting for ${selector}`)
  }

  // Screenshot clips are in document coordinates; getBoundingClientRect is
  // viewport-relative, so fold the scroll offset in.
  const plateRect = async (margin = 32) => {
    const r = await evalJs(
      `(() => { const el = document.querySelector('.referral-plate'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }; })()`
    )
    if (!r) throw new Error('plate not found')
    return {
      x: Math.max(0, r.x - margin),
      y: Math.max(0, r.y - margin),
      width: r.width + margin * 2,
      height: r.height + margin * 2
    }
  }

  const goto = async (path = PROFILE, settle = 2500) => {
    await cdp.send('Page.navigate', { url: `${BASE}${path}` })
    await waitFor('.referral-plate')
    await evalJs(
      `document.querySelector('.referral-plate').scrollIntoView({ block: 'center' }); 'ok'`
    )
    await sleep(settle) // pf-reveal + fonts
  }

  const openModal = async (settle = 900) => {
    await evalJs(`document.querySelector('.referral-plate').click(); 'ok'`)
    await sleep(settle) // modal-in animation + fetch
  }

  const closeModal = async () => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    })
    await sleep(300)
  }

  const hoverPlate = async () => {
    // Mouse events take viewport coordinates, unlike screenshot clips.
    const r = await evalJs(
      `(() => { const b = document.querySelector('.referral-plate').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`
    )
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: r.x + r.width / 2,
      y: r.y + r.height / 2
    })
    await sleep(500) // hover transition is 300ms
  }

  const unhover = async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
    await sleep(400)
  }

  const setTheme = async (theme) => {
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)
  }

  // ================= sequence =================

  // ---- notification bell only (BELL=1): needs a seeded referral
  // notification row for the session user ----
  if (process.env.BELL === '1') {
    await setViewport(1440, 900)
    await goto()
    await evalJs(
      `document.querySelector('button[aria-label^="Notifications"]').click(); 'ok'`
    )
    await sleep(1200)
    await shot('bell-panel')
    kill()
    process.exit(0)
  }

  // ---- canonical-link proof (PROOF=1): real API, open modal, capture the
  // rendered link and the X intent URL (run with MOCK=0) ----
  if (process.env.PROOF === '1') {
    await setViewport(1440, 900)
    await goto()
    await openModal(1200)
    await shot('proof-modal-canonical-link')
    const intentUrl = await evalJs(
      `(() => {
        let captured = null;
        const orig = window.open;
        window.open = (url) => { captured = url; return null };
        const buttons = [...document.querySelectorAll('div[role="dialog"] button')];
        const postBtn = buttons.find((b) => b.textContent.includes('POST ON X'));
        postBtn.click();
        window.open = orig;
        return captured;
      })()`
    )
    console.log('X intent URL:', intentUrl)
    console.log('intent link decoded:', decodeURIComponent(String(intentUrl)))
    kill()
    process.exit(0)
  }

  // ---- dark desktop ----
  await setViewport(1440, 900)
  await goto()
  await setTheme('dark')
  await goto() // reload with theme applied

  await shot('01-plate-dark', await plateRect())

  // animation frames across ~3s (ring 7s, pulse 3s, sheen 5.5s+1.2s delay)
  const clip = await plateRect()
  for (let i = 0; i < 7; i++) {
    await shot(`anim-dark-f${i}`, clip)
    await sleep(500)
  }

  // sheen crossing lives late in its 7s loop — rewind its phase so the
  // sweep is on-plate right now, then sample it
  await evalJs(
    `document.querySelector('.referral-sheen').style.animationDelay = '-6.1s'; 'ok'`
  )
  for (let i = 0; i < 4; i++) {
    await shot(`sheen-dark-f${i}`, clip)
    await sleep(280)
  }
  await evalJs(`document.querySelector('.referral-sheen').style.animationDelay = ''; 'ok'`)

  await hoverPlate()
  await shot('02-plate-dark-hover', await plateRect())
  await unhover()

  await openModal(450) // mid cap-bar fill (200ms delay + 700ms draw)
  await shot('03b-modal-dark-cap-filling')
  await sleep(700)
  await shot('03-modal-dark')
  await closeModal()

  // ---- loading + error states (fresh page each so data isn't cached) ----
  mockMode = 'hold'
  await goto(PROFILE, 1500)
  await openModal(600)
  await shot('04-modal-loading')
  await releaseHeld()
  await closeModal()

  mockMode = 'error'
  await goto(PROFILE, 1500)
  await openModal(700)
  await shot('05-modal-error')
  await closeModal()
  mockMode = 'ok'

  // ---- light theme ----
  await setTheme('light')
  await goto()
  await shot('06-plate-light', await plateRect())
  const lclip = await plateRect()
  for (let i = 0; i < 4; i++) {
    await shot(`anim-light-f${i}`, lclip)
    await sleep(700)
  }
  await hoverPlate()
  await shot('07-plate-light-hover', await plateRect())
  await unhover()
  await openModal()
  await shot('08-modal-light')
  await closeModal()

  // ---- mobile 375 (dark) ----
  await setTheme('dark')
  await setViewport(375, 812, true)
  await goto()
  await shot('09-mobile-plate', await plateRect(12))
  await openModal()
  await shot('10-mobile-modal')
  await closeModal()

  // ---- 360px narrow wrap check ----
  await setViewport(360, 780, true)
  await goto()
  await shot('11-plate-360', await plateRect(8))

  // ---- reduced-motion freeze check ----
  await setViewport(1440, 900)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await goto()
  const rmClip = await plateRect()
  const a = await shot('12-reduced-motion-f0', rmClip)
  await sleep(1500)
  const b = await shot('12-reduced-motion-f1', rmClip)
  const frozen = fs.readFileSync(a).equals(fs.readFileSync(b))
  console.log(frozen ? 'reduced-motion: FROZEN (ok)' : 'reduced-motion: STILL MOVING (bad)')
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })

  console.log('done')
  kill()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
