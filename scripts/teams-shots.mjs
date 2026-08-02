// One-off CDP pass for the /teams landing + the shop's Team pointer band.
// Photographs, logged out, against a local production server:
//   - /teams full page, desktop dark + light and mobile dark
//   - /shop desktop from the top through the gold Team pointer band
//
//   node scripts/teams-shots.mjs [base-url]
//
// PNGs land in scripts/shots-teams/ (gitignored via scripts/shots-*/).

import fs from 'node:fs'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:4123'
const PORT = 9241
const OUT = new URL('./shots-teams/', import.meta.url).pathname
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

  const setViewport = (width, height, mobile) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile
    })

  const shot = async (name, clip) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {})
    })
    fs.writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', `${OUT}${name}.png`)
  }

  // Navigate, wait for a marker string to hydrate in, let the entrance
  // cascade play, then freeze every finishable animation (the infinite
  // cursor blink throws on finish(); ignored).
  const settle = async (url, marker) => {
    await cdp.send('Page.navigate', { url })
    for (let i = 0; i < 40; i++) {
      await sleep(300)
      const ready = await evalJs(
        `document.body && document.body.innerText.includes(${JSON.stringify(marker)})`
      ).catch(() => false)
      if (ready) break
    }
    await evalJs('document.fonts.ready.then(() => true)')
    await sleep(1600)
    await evalJs(
      `document.getAnimations().forEach((a) => { try { a.finish() } catch {} }); true`
    )
    await sleep(200)
  }

  const fullPageClip = async (width) => {
    const height = await evalJs('document.documentElement.scrollHeight')
    return { x: 0, y: 0, width, height: Math.min(height, 8000) }
  }

  // ---- 1. /teams desktop, dark (default theme) ----
  await setViewport(1440, 1000, false)
  await settle(`${BASE}/teams`, 'FIELD A TEAM')
  await shot('teams-desktop-dark', await fullPageClip(1440))

  // ---- 2. /teams mobile, dark ----
  await setViewport(390, 844, true)
  await settle(`${BASE}/teams`, 'FIELD A TEAM')
  await shot('teams-mobile-dark', await fullPageClip(390))

  // Close-up of a selector'd section, page coordinates.
  const sectionClip = async (selector, pad = 16) =>
    evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: 0, y: Math.max(0, Math.floor(b.top + window.scrollY - ${pad})),
               width: ${1440}, height: Math.ceil(b.height + ${pad} * 2) }
    })()`)

  // chooser close-up, dark
  await setViewport(1440, 1000, false)
  await settle(`${BASE}/teams`, 'FIELD A TEAM')
  await shot('teams-chooser-dark', await sectionClip('#choose'))

  // ---- 3. /teams desktop, light (seed next-themes before boot) ----
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('theme', 'light') } catch {}`
  })
  await setViewport(1440, 1000, false)
  await settle(`${BASE}/teams`, 'FIELD A TEAM')
  const lightOk = await evalJs(`document.documentElement.classList.contains('light')`)
  console.log('light mode applied:', lightOk)
  await shot('teams-desktop-light', await fullPageClip(1440))
  await shot('teams-proofstrip-light', await sectionClip('.tm-reveal:has(.lb-inset)'))
  await shot('teams-chooser-light', await sectionClip('#choose'))

  // SOLO lane in light — the amber console must hold on the re-pinned ink
  await evalJs(`(() => {
    const solo = Array.from(document.querySelectorAll('[role="radio"]'))
      .find((b) => b.textContent.includes('SOLO'))
    if (solo) solo.click()
    return true
  })()`)
  await sleep(900)
  await evalJs(
    `document.getAnimations().forEach((a) => { try { a.finish() } catch {} }); true`
  )
  await shot('teams-chooser-solo-light', await sectionClip('#choose'))

  // ---- 4. /shop desktop, dark: top through the Team pointer band ----
  // The light seed script persists on this tab, so flip it back first.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('theme', 'dark') } catch {}`
  })
  await settle(`${BASE}/shop`, 'GO PRO')
  const bandBottom = await evalJs(`(() => {
    const el = document.querySelector('.shp-teamband')
    if (!el) return null
    const b = el.getBoundingClientRect()
    return Math.ceil(b.bottom + window.scrollY + 32)
  })()`)
  console.log('teamband bottom:', bandBottom)
  await shot('shop-desktop-dark', {
    x: 0,
    y: 0,
    width: 1440,
    height: bandBottom || 1800
  })

  browser.kill('SIGKILL')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
