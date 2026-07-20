// Light-mode + mobile passes for the landing descent. Same CDP harness as
// landing-shots.mjs; writes to /tmp/landing/.
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
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', name)
  }
  const goTo = async (id, extra = 0) => {
    await evalJs(
      `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' }); 'ok'`
    )
    if (extra) await evalJs(`window.scrollBy(0, ${extra}); 'ok'`)
    await sleep(2400)
  }

  // ---- light mode at desktop ----
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
  })
  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(3500)
  await evalJs(
    `localStorage.setItem('theme','light'); document.documentElement.classList.add('light'); document.documentElement.style.colorScheme='light'; 'ok'`
  )
  await sleep(600)

  await goTo('descent-arena')
  await shot('L1-arena-light')
  await goTo('descent-identity')
  await shot('L3-identity-light')
  await goTo('descent-honors', 700)
  await shot('L4-honors-light')
  await goTo('descent-roadmap', 600)
  await sleep(3200)
  await shot('L5-roadmap-light')

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
  await sleep(3500)

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
