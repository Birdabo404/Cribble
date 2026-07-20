// Throwaway: clipped close-ups of the liquid-metal mark (hero + header) so
// the material can be judged at real pixel density.
//   node scripts/brand-zoom.mjs [cdp-port] [url]
//   THEME=light node scripts/brand-zoom.mjs   → force the light theme first

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

async function main() {
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
  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(6500)

  if (process.env.THEME) {
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('theme', ${JSON.stringify(process.env.THEME)})`
    })
    await cdp.send('Page.navigate', { url: URL_TO_OPEN })
    await sleep(6500)
  }

  const rectOf = async (selector, pad = 20) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`,
      returnByValue: true
    })
    const b = JSON.parse(r.result.value)
    return {
      x: Math.max(0, b.x - pad),
      y: Math.max(0, b.y - pad),
      width: b.width + pad * 2,
      height: b.height + pad * 2
    }
  }

  const clipShot = async (name, clip, scale) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...clip, scale }
    })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', name)
  }

  const suffix = process.env.THEME ? `-${process.env.THEME}` : ''

  const full = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`${OUT}/zoom-full${suffix}.png`, Buffer.from(full.data, 'base64'))
  console.log('saved zoom-full' + suffix)

  const heroRect = await rectOf('h1', 24)
  await clipShot(`zoom-hero-a${suffix}`, heroRect, 2.5)
  await sleep(900)
  await clipShot(`zoom-hero-b${suffix}`, heroRect, 2.5)

  const headerRect = await rectOf('header div.flex.items-center', 14)
  await clipShot(`zoom-header${suffix}`, headerRect, 5)

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
