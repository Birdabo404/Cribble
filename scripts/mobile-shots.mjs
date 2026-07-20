// Mobile pass for the landing page. Same CDP harness as landing-shots.mjs;
// emulates a 390×844 phone and walks hero → every descent stage → finale.
//
//   node scripts/mobile-shots.mjs [cdp-port] [url] [out-dir]

import fs from 'node:fs'
import http from 'node:http'

const PORT = process.argv[2] || '9229'
const URL_TO_OPEN = process.argv[3] || 'http://localhost:3000/'
const OUT = process.argv[4] || '/tmp/landing-mobile'
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

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5
  })
  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(4500)

  await shot('01-hero-top')
  await evalJs(`window.scrollBy(0, 700); 'ok'`)
  await sleep(1500)
  await shot('02-hero-copy')

  // horizontal overflow check
  const overflow = await evalJs(
    `(document.documentElement.scrollWidth - document.documentElement.clientWidth) + 'px overflow, clientWidth=' + document.documentElement.clientWidth`
  )
  console.log('h-overflow:', overflow)

  await goTo('descent-arena', 100)
  await shot('03-arena')
  await goTo('descent-cockpit', 120)
  await shot('04-cockpit')
  await goTo('descent-identity', 300)
  await shot('05-identity')
  await goTo('descent-honors', 300)
  await shot('06-honors')
  await goTo('descent-roadmap', 400)
  await sleep(2600)
  await shot('07-roadmap')
  await evalJs(
    `window.scrollTo(0, document.body.scrollHeight - window.innerHeight); 'ok'`
  )
  await sleep(2400)
  await shot('08-finale')

  console.log('done')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
