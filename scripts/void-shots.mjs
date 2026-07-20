// Throwaway CDP harness: captures the 404 and maintenance void screens in
// both themes to /tmp/void/. Drives a headless Chromium-family browser
// started with --remote-debugging-port (no Playwright dependency).
//
//   node scripts/void-shots.mjs [cdp-port] [base-url]

import fs from 'node:fs'
import http from 'node:http'

const PORT = process.argv[2] || '9230'
const BASE = process.argv[3] || 'http://localhost:3000'
const OUT = '/tmp/void'
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

const httpPut = (path) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'PUT' },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
      }
    )
    req.on('error', reject)
    req.end()
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

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  return new Cdp(ws)
}

async function main() {
  let targets = await getJson('/json/list')
  let page = targets.find((t) => t.type === 'page')
  if (!page) {
    await httpPut('/json/new?about:blank')
    await sleep(300)
    targets = await getJson('/json/list')
    page = targets.find((t) => t.type === 'page')
  }
  if (!page) throw new Error('no page target')

  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
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

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', name)
  }

  const capture = async (path, theme, name, settle) => {
    await cdp.send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(3500) // dev compile + shader boot
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)
    await cdp.send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(settle)
    await shot(name)
  }

  // long settle on the first pass — dev-server compiles the route
  await capture('/this-route-does-not-exist', 'dark', '404-dark', 5000)
  await capture('/this-route-does-not-exist', 'light', '404-light', 4000)
  await capture('/maintenance', 'dark', 'maintenance-dark', 5000)
  await capture('/maintenance', 'light', 'maintenance-light', 4000)

  // mobile pass for the 404, dark
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true
  })
  await evalJs(`localStorage.setItem('theme', 'dark'); 'ok'`)
  await cdp.send('Page.navigate', { url: `${BASE}/this-route-does-not-exist` })
  await sleep(4000)
  await shot('404-mobile-dark')

  console.log('done')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
