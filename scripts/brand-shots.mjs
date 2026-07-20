// Throwaway CDP harness: captures the pages that carry the new liquid-metal
// brand mark (landing hero, login, leaderboard nav rail) to /tmp/brand-shots.
//
//   node scripts/brand-shots.mjs [cdp-port] [base-url]

import fs from 'node:fs'
import http from 'node:http'

const PORT = process.argv[2] || '9228'
const BASE = process.argv[3] || 'http://localhost:3000'
const OUT = '/tmp/brand-shots'
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

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const cdp = new Cdp(ws)

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

  const visit = async (path, wait, name) => {
    await cdp.send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(wait)
    await shot(name)
  }

  await visit('/', 6500, '01-landing-hero')
  await visit('/login', 5000, '02-login')
  await visit('/leaderboard', 6500, '03-leaderboard-topbar')

  // rail chrome (nav position/expansion live in localStorage)
  await evalJs(
    `localStorage.setItem('cribble.nav.pos', 'left'); localStorage.setItem('cribble.nav.exp', '1'); 'ok'`
  )
  await visit('/leaderboard', 5000, '04-leaderboard-rail-expanded')

  await evalJs(`localStorage.setItem('cribble.nav.exp', '0'); 'ok'`)
  await visit('/leaderboard', 5000, '05-leaderboard-rail-collapsed')

  console.log('done')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
