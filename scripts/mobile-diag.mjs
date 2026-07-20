// One-off mobile diagnostics: finds elements wider than the viewport and
// reports hero fold positions at 390×844.
//
//   node scripts/mobile-diag.mjs [cdp-port] [url]

import http from 'node:http'

const PORT = process.argv[2] || '9229'
const URL_TO_OPEN = process.argv[3] || 'http://localhost:3000/'

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

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  })
  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(4500)

  const report = await evalJs(`(() => {
    const cw = document.documentElement.clientWidth
    const offenders = []
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.right > cw + 1 || r.left < -1) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed') return
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 90),
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width)
        })
      }
    })
    // de-dup by keeping widest few
    offenders.sort((a, b) => (b.right - b.left) - (a.right - a.left))
    const hero = {}
    const h1 = document.querySelector('h1')
    if (h1) hero.h1Top = Math.round(h1.getBoundingClientRect().top + scrollY)
    const badge = document.querySelector('.hero-item')
    if (badge) hero.badgeTop = Math.round(badge.getBoundingClientRect().top + scrollY)
    const p = document.querySelector('main p')
    if (p) hero.bodyTop = Math.round(p.getBoundingClientRect().top + scrollY)
    const cta = document.querySelector('main a[href="/login"]')
    if (cta) {
      const cr = cta.getBoundingClientRect()
      hero.ctaTop = Math.round(cr.top + scrollY)
      hero.ctaH = Math.round(cr.height)
    }
    return {
      clientWidth: cw,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 25),
      hero
    }
  })()`)

  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
