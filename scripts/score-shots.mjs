// Throwaway CDP harness for the lime score-numeral pass: authenticates with
// a cribble_session QA cookie supplied via SESSION_TOKEN and captures the leaderboard
// (dark + light, podium + rows + stat bar) and the landing arena preview
// into scripts/shots-score.
//
//   node scripts/score-shots.mjs [label] [base-url]
//
// Env:
//   SESSION_TOKEN  required cribble_session value

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const LABEL = process.argv[2] || 'shot'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9233
const OUT = new URL('./shots-score/', import.meta.url).pathname
const SESSION = process.env.SESSION_TOKEN
if (!SESSION) {
  console.error('SESSION_TOKEN is required. Supply it explicitly to run score-shots.mjs.')
  process.exit(1)
}

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
  await cdp.send('Network.setCookie', {
    name: 'cribble_session',
    value: SESSION,
    url: BASE
  })

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception))
    return r.result.value
  }

  const setViewport = (width, height) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false
    })

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const file = `${OUT}${LABEL}-${name}.png`
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    console.log('saved', file)
    return file
  }

  const waitFor = async (selector, timeout = 20000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJs(`!!document.querySelector(${JSON.stringify(selector)})`)) return
      await sleep(250)
    }
    throw new Error(`timeout waiting for ${selector}`)
  }

  const setTheme = (theme) =>
    evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)

  const gotoBoard = async () => {
    await cdp.send('Page.navigate', { url: `${BASE}/leaderboard` })
    await waitFor('.lb4-arena')
    await sleep(4500) // reveals + animated counters settling
  }

  // ---- leaderboard dark: podium + stat bar + rows ----
  await setViewport(1440, 1700)
  await cdp.send('Page.navigate', { url: `${BASE}/leaderboard` })
  await sleep(2000)
  await setTheme('dark')
  await gotoBoard()
  await shot('01-leaderboard-dark')

  // scrolled: rows fully in frame
  await evalJs(`window.scrollTo(0, 700); 'ok'`)
  await sleep(800)
  await shot('02-leaderboard-dark-rows')
  await evalJs(`window.scrollTo(0, 0); 'ok'`)

  // ---- leaderboard light ----
  await setTheme('light')
  await gotoBoard()
  await shot('03-leaderboard-light')
  await evalJs(`window.scrollTo(0, 700); 'ok'`)
  await sleep(800)
  await shot('04-leaderboard-light-rows')

  // ---- landing arena preview (dark, then light: .lx-hw pins dark palette) ----
  await setTheme('dark')
  await setViewport(1440, 1100)
  await cdp.send('Page.navigate', { url: `${BASE}/` })
  await waitFor('.ar-panel')
  await evalJs(`document.querySelector('.ar-panel').scrollIntoView({ block: 'center' }); 'ok'`)
  await sleep(3000)
  await shot('05-landing-arena-dark')

  await setTheme('light')
  await cdp.send('Page.navigate', { url: `${BASE}/` })
  await waitFor('.ar-panel')
  await evalJs(`document.querySelector('.ar-panel').scrollIntoView({ block: 'center' }); 'ok'`)
  await sleep(3000)
  await shot('06-landing-arena-light')

  console.log('done')
  kill()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
