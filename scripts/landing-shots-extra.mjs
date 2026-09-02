// Light-mode + mobile passes for the landing descent. Same CDP harness as
// landing-shots.mjs; writes to /tmp/landing/. Scrolls are window.scrollTo
// against gBCR + scrollY (never scrollIntoView — see landing-shots.mjs).
//
//   node scripts/landing-shots-extra.mjs [cdp-port] [url]

import fs from 'node:fs'
import http from 'node:http'

const PORT = process.argv[2] || '9227'
const URL_TO_OPEN = process.argv[3] || 'http://localhost:3000/'
const OUT = '/tmp/landing'
fs.mkdirSync(OUT, { recursive: true })

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
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await getJson('/json/list')
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

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
  const shot = async (name) => {
    await evalJs(`document.querySelector('nextjs-portal')?.remove(); 'ok'`)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', name)
  }
  // poll a page-side predicate — fixed sleeps race a slow dev compile
  const waitFor = async (expr, timeout = 30000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`)) return true
      await sleep(150)
    }
    throw new Error('timeout waiting for ' + expr)
  }
  // hero mounted and hydrated: the theme toggle only renders its icon
  // once next-themes has resolved client-side
  const HYDRATED =
    `document.querySelector('.lx-hero') && document.querySelector('button[aria-label^="Switch to"] svg')`
  // smoother settled = #smooth-content translateY equals -scrollY
  const settle = async (timeout = 4000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const gap = await evalJs(
        `(() => { const c = document.getElementById('smooth-content'); if (!c) return 0; const m = new DOMMatrixReadOnly(getComputedStyle(c).transform); return Math.abs(m.f + window.scrollY) })()`
      )
      if (gap < 0.5) return
      await sleep(100)
    }
  }
  // the hero pin builds late and refreshes every trigger when it lands —
  // measuring across that reflow lands frames a spacer's height off
  const waitForPin = async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 6000) {
      if (await evalJs(`!!document.querySelector('.lx-hero')?.parentElement?.classList.contains('pin-spacer')`)) return true
      await sleep(200)
    }
    return false
  }
  const goTo = async (id, extra = 0) => {
    await settle()
    await evalJs(
      `(() => { const el = document.getElementById(${JSON.stringify(id)}); const y = el.getBoundingClientRect().top + window.scrollY; window.scrollTo(0, Math.max(0, y + ${extra})); return 'ok' })()`
    )
    await settle()
    await sleep(2400)
    console.log(
      id,
      await evalJs(
        `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return 'scrollY=' + Math.round(window.scrollY) + ' top=' + Math.round(r.top) })()`
      )
    )
  }

  // ---- light mode at desktop ----
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
  })
  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await waitFor(HYDRATED)
  // next-themes (attribute="class", default storage key) reads
  // localStorage.theme on load; flipping the class live covers this page.
  await evalJs(
    `localStorage.setItem('theme','light'); document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); document.documentElement.style.colorScheme='light'; 'ok'`
  )
  await waitFor(`document.documentElement.classList.contains('light')`)
  await sleep(2500) // hero entrance
  await shot('L0-hero-light')
  console.log('light:', await evalJs(`document.documentElement.className`), '| hero pinned:', await waitForPin())

  await goTo('descent-arena', -40)
  await shot('L1-arena-light')
  await goTo('descent-cockpit', -40)
  await shot('L2-cockpit-light')
  await goTo('descent-identity', -40)
  await shot('L3-identity-light')
  await goTo('descent-honors', 700)
  await shot('L4-honors-light')
  await goTo('descent-roadmap', 600)
  await sleep(3200)
  await shot('L5-roadmap-light')
  await evalJs(
    `window.scrollTo(0, document.documentElement.scrollHeight); 'ok'`
  )
  await settle()
  await sleep(2600)
  await shot('L6-touchdown-light')

  // ---- mobile dark ----
  await evalJs(
    `localStorage.setItem('theme','dark'); document.documentElement.classList.remove('light'); 'ok'`
  )
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  })
  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await waitFor(HYDRATED)
  await sleep(2500) // hero entrance
  // lite tier below lg: no smoother, and the pin only builds on fine
  // pointers — waitForPin simply times out here if so
  console.log('mobile theme:', await evalJs(`document.documentElement.className`), '| pinned:', await waitForPin())

  await goTo('descent-arena', 100)
  await shot('M1-arena-mobile')
  await goTo('descent-cockpit', 120)
  await shot('M2-cockpit-mobile')
  await goTo('descent-identity', 400)
  await shot('M3-identity-mobile')
  await goTo('descent-honors', 300)
  await shot('M4-honors-mobile')
  await goTo('descent-roadmap', 500)
  await sleep(3000)
  await shot('M5-roadmap-mobile')

  console.log('done')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
