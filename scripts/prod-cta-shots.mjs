// One-off CDP check: what does PRODUCTION render for the landing CTAs?
// Photographs the hero CTA row and the descent-finale CTA on cribble.dev
// and prints the button text/classes actually served.
//
//   node scripts/prod-cta-shots.mjs [base-url] [label]

import fs from 'node:fs'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'

const BASE = process.argv[2] || 'https://cribble.dev'
const LABEL = process.argv[3] || 'prod'
const PORT = 9235
const OUT = new URL('./shots-prod/', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

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

async function main() {
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
      '--window-size=1440,1000',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )
  process.on('exit', () => {
    try {
      browser.kill('SIGKILL')
    } catch {}
  })

  let page
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    try {
      const targets = await getJson('/json/list')
      page = targets.find((t) => t.type === 'page')
      if (page) break
    } catch {}
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
    height: 1000,
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

  const shot = async (name, clip) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {})
    })
    fs.writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', `${OUT}${name}.png`)
  }

  await cdp.send('Page.navigate', { url: BASE })
  await sleep(6000)

  // What CTAs does the served page actually contain?
  const ctas = await evalJs(`
    Array.from(document.querySelectorAll('a[href="/login"]')).map((a) => ({
      text: a.textContent.trim(),
      cls: a.className.slice(0, 90)
    }))
  `)
  console.log('LOGIN CTAs on page:', JSON.stringify(ctas, null, 2))

  // Hero: first viewport.
  await shot(`${LABEL}-hero`, { x: 0, y: 0, width: 1440, height: 1000 })

  // Finale: scroll the last /login anchor into view, let the stage entrance
  // play, force animations to their end state, then clip its section.
  const rect = await evalJs(`(async () => {
    const links = Array.from(document.querySelectorAll('a[href="/login"]'))
    const el = links[links.length - 1]
    el.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 2500))
    document.getAnimations().forEach((a) => { try { a.finish() } catch {} })
    const sec = el.closest('section') || el.parentElement
    const b = sec.getBoundingClientRect()
    return { x: b.x + window.scrollX, y: b.y + window.scrollY,
             width: b.width, height: Math.min(b.height, 900) }
  })()`)
  await shot(`${LABEL}-finale`, rect)

  browser.kill('SIGKILL')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
