// Throwaway: catches the first seconds after navigation in a burst of hero
// close-ups, to prove the mark never shows the flat PNG before the shader.
//   node scripts/brand-flash-check.mjs [cdp-port] [url]

import fs from 'node:fs'
import http from 'node:http'

const PORT = process.argv[2] || '9229'
const URL_TO_OPEN = process.argv[3] || 'http://localhost:3000/'
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

async function connect() {
  const targets = await getJson('/json/list')
  const page = targets.find((t) => t.type === 'page')
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
  return { cdp, ws }
}

async function main() {
  // warmup so the dev server compile doesn't eat the interesting window;
  // reconnect afterwards — the renderer may swap processes on navigation,
  // which kills the old CDP session
  let { cdp, ws } = await connect()
  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(9000)
  ws.close()
  ;({ cdp, ws } = await connect())

  // hero mark box is stable across loads: h1 sits ~y170-230, mark at left
  const clip = { x: 140, y: 150, width: 420, height: 120 }

  await cdp.send('Page.navigate', { url: URL_TO_OPEN }).catch(() => {})
  const marks = [400, 800, 1200, 1800, 2600, 4000, 6000]
  let prev = 0
  for (const at of marks) {
    await sleep(at - prev)
    prev = at
    try {
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...clip, scale: 2 }
      })
      fs.writeFileSync(`${OUT}/flash-${String(at).padStart(4, '0')}ms.png`, Buffer.from(data, 'base64'))
      console.log(`saved flash-${at}ms`)
    } catch (e) {
      // the session dies if the renderer swaps processes mid-commit —
      // reattach and keep sampling
      console.log(`flash-${at}ms: ${e.message}; reconnecting`)
      try {
        ws.close()
      } catch {}
      ;({ cdp, ws } = await connect())
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
