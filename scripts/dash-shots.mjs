// Throwaway CDP harness for the /dashboard duotone instrument redesign:
// authenticates with a pre-minted cribble_session cookie, mocks every
// dashboard API at the network layer with rich fixtures, and captures the
// console across themes, viewports, hover and reduced-motion states to
// scripts/shots-dash.
//
//   node scripts/dash-shots.mjs [label] [base-url]
//
//   label     prefix for output files (default "shot") — use pass1, pass2, …
//   base-url  default http://localhost:3000
//
// Env:
//   SESSION_TOKEN  cribble_session value (default: the QA token minted for
//                  visual passes — see user_sessions row for user 13)
//
// Spawns its own headless browser on port 9233 and kills it when done.

import fs from 'node:fs'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'

const LABEL = process.argv[2] || 'shot'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9233
const OUT = new URL('./shots-dash/', import.meta.url).pathname
const SESSION = process.env.SESSION_TOKEN || 'a3f6d2e8-referral-qa-7c1b-visual-pass'
const PAGE = '/dashboard'

const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const now = Date.now()
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const iso = (agoMs) => new Date(now - agoMs).toISOString()

// ---- fixtures --------------------------------------------------------------

const ME = {
  user: {
    id: 13,
    twitter_username: 'Birdabo404',
    twitter_name: 'Birdabo',
    twitter_profile_image: '/favicon.png',
    subscription_tier: 'PRO',
    last_extension_sync: iso(2 * MIN),
    active_device_uuid: 'qa-device-01',
    created_at: iso(210 * DAY),
    last_login: iso(1 * HOUR)
  },
  scores: {
    total_score: 1_847_203,
    today_score: 8_420,
    week_score: 96_210,
    month_score: 402_118
  },
  stats: {
    total_visits: 48_213,
    today_visits: 128,
    total_time: 512 * HOUR,
    today_time: 5 * HOUR + 12 * MIN,
    active_time: 396 * HOUR,
    today_active_time: 3 * HOUR + 41 * MIN,
    efficiency: 72
  },
  activeDevice: {
    device_uuid: 'qa-device-01',
    device_name: 'MacBook Pro 14',
    last_sync_at: iso(2 * MIN)
  }
}

const TOOLS = {
  success: true,
  tools: [
    { name: 'Cursor', visits: 18_320, active_ms: 152 * HOUR, score: 701_937, percent: 38 },
    { name: 'ChatGPT', visits: 12_904, active_ms: 104 * HOUR, score: 498_745, percent: 27 },
    { name: 'Claude', visits: 8_188, active_ms: 76 * HOUR, score: 350_969, percent: 19 },
    { name: 'Perplexity', visits: 4_370, active_ms: 38 * HOUR, score: 184_720, percent: 10 },
    { name: 'GitHub Copilot', visits: 2_431, active_ms: 26 * HOUR, score: 110_832, percent: 6 }
  ]
}

// 84 days of varied scores keyed by UTC date (the activity API buckets by
// UTC date key): a current 9-day streak, scattered zero days, one big
// ~52k spike inside the sparkline's 28-day window. Seeded LCG so repeat
// passes photograph the same data.
const mkActivity = () => {
  const t = new Date()
  const utcToday = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
  let seed = 42
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const days = []
  for (let i = 83; i >= 0; i--) {
    const key = new Date(utcToday - i * DAY).toISOString().split('T')[0]
    let score
    if (i === 0) score = 8_420
    else if (i < 9) score = 2_600 + Math.round(rnd() * 9_000)
    else if (i === 9) score = 0 // streak boundary
    else if (i === 23) score = 52_000 // the spike
    else {
      const r = rnd()
      score = r < 0.22 ? 0 : Math.round(500 + r * 12_000)
    }
    days.push({ date: key, score })
  }
  return { success: true, activity: days }
}
const ACTIVITY = mkActivity()

// 120 players, our user parked at rank 7.
const mkLeaderboard = () => {
  const data = []
  for (let i = 0; i < 120; i++) {
    const rank = i + 1
    if (rank === 7) {
      data.push({
        userId: 13,
        username: 'Birdabo404',
        display_name: 'Birdabo',
        profile_image: null,
        score: ME.scores.total_score,
        rank,
        tier: 'PRO',
        isActive: true
      })
      continue
    }
    const score =
      rank < 7
        ? 2_600_000 - i * 120_000
        : Math.round(1_800_000 * 0.97 ** (i - 7))
    data.push({
      userId: 1000 + i,
      username: `pilot_${String(rank).padStart(3, '0')}`,
      display_name: `Pilot ${rank}`,
      profile_image: null,
      score,
      rank,
      tier: 'FREE',
      isActive: rank % 3 !== 0
    })
  }
  return { success: true, data }
}
const LEADERBOARD = mkLeaderboard()

const ONBOARDING = { success: true, role: 'engineer', metadata: { goal: 'top100' } }

// SEASON 01, ~62% through (56 of 90 days elapsed).
const SEASON = {
  success: true,
  phase: 'active',
  current: {
    id: 1,
    number: 1,
    name: 'SEASON 01',
    startsAt: iso(56 * DAY),
    endsAt: new Date(now + 34 * DAY).toISOString(),
    status: 'active'
  },
  next: null
}

const NOTIFS = { success: true, notifications: [], unreadCount: 0 }

const ROUTES = new Map([
  ['/api/user/me', ME],
  ['/api/user/tools', TOOLS],
  ['/api/user/activity', ACTIVITY],
  ['/api/leaderboard', LEADERBOARD],
  ['/api/user/onboarding', ONBOARDING],
  ['/api/season', SEASON],
  ['/api/user/notifications', NOTIFS]
])

// ---- harness ---------------------------------------------------------------

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
    this.handlers = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method && this.handlers.has(msg.method)) {
        this.handlers.get(msg.method)(msg.params)
      }
    })
    // A dying browser must fail the run loudly, not park it on a promise.
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'))
      }
      this.pending.clear()
    })
  }
  on(method, handler) {
    this.handlers.set(method, handler)
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
  // Hard ceiling — a wedged browser must not park the run forever.
  const watchdog = setTimeout(() => {
    console.error('watchdog: run exceeded 6 minutes, aborting')
    process.exit(2)
  }, 6 * 60_000)
  watchdog.unref?.()

  // ---- browser ----
  const profileDir = `/tmp/brave-cdp-${PORT}`
  // A leftover browser from an aborted pass keeps the port and serves a
  // stale ws URL that never connects — clear it before launching.
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
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 15_000)
    ws.addEventListener('open', () => {
      clearTimeout(t)
      resolve()
    })
    ws.addEventListener('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
  const cdp = new Cdp(ws)

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')

  // ---- auth cookie ----
  await cdp.send('Network.setCookie', {
    name: 'cribble_session',
    value: SESSION,
    url: BASE
  })

  // ---- dashboard API mocks (everything else continues to the server) ----
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/*' }]
  })
  cdp.on('Fetch.requestPaused', (p) => {
    const pathname = new URL(p.request.url).pathname
    const fixture = ROUTES.get(pathname)
    if (!fixture) {
      cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
      return
    }
    const body =
      p.request.method === 'GET' ? JSON.stringify(fixture) : '{"success":true}'
    cdp
      .send('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(body).toString('base64')
      })
      .catch(() => {})
  })

  // ---- helpers ----
  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception))
    return r.result.value
  }

  const setViewport = (width, height, mobile = false) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile
    })

  const shot = async (name, clip, beyond = false) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      ...(beyond ? { captureBeyondViewport: true } : {}),
      ...(clip ? { clip: { ...clip, scale: 1 } } : {})
    })
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

  // Reveal cascade (~1.6s) + odometer roll (~2.8s from the hero landing)
  // must both finish before a clean frame.
  const goto = async (path = PAGE, settle = 3600) => {
    await cdp.send('Page.navigate', { url: `${BASE}${path}` })
    await waitFor('.dash-reveal-root main')
    await sleep(settle)
  }

  // Element clip in document coordinates (fold in scroll offset).
  const rectOf = async (selector, margin = 20) => {
    const r = await evalJs(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }; })()`
    )
    if (!r) throw new Error(`element not found: ${selector}`)
    return {
      x: Math.max(0, r.x - margin),
      y: Math.max(0, r.y - margin),
      width: r.width + margin * 2,
      height: r.height + margin * 2
    }
  }

  const unionRect = (a, b) => {
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    return {
      x,
      y,
      width: Math.max(a.x + a.width, b.x + b.width) - x,
      height: Math.max(a.y + a.height, b.y + b.height) - y
    }
  }

  const setTheme = (theme) =>
    evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)
  const setNavPos = (pos) =>
    evalJs(`localStorage.setItem('cribble.nav.pos', ${JSON.stringify(pos)}); 'ok'`)

  // With the extension "linked" in the fixtures the nudge never renders,
  // so the hero is the first section in the main grid.
  const HERO = '.dash-reveal-root main > section:first-of-type'
  const KPI = '.dash-reveal-root main > div:nth-of-type(2)'
  const ACT = '.dash-reveal-root main > section:nth-of-type(2)'
  const TOOLSQ = '.dash-reveal-root main > section:nth-of-type(3)'

  // Computed-style sweep of the page content (banner excluded — it owns
  // the one legit green): flags any green-dominant color in paint-relevant
  // properties, so "zero green" is verified rather than eyeballed.
  const greenAudit = async () => {
    const offenders = await evalJs(`(() => {
      const isGreen = (str) => {
        let m
        const re = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/g
        while ((m = re.exec(str))) {
          const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
          if (g > 120 && g > r * 1.6 && g > b * 1.6) return true
        }
        return false
      }
      const root = document.querySelector('.dash-reveal-root')
      const banner = root?.querySelector('pre[aria-label="DASHBOARD"]')?.closest('section')
      const out = []
      const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'textShadow', 'fill', 'stroke', 'outlineColor']
      for (const el of root?.querySelectorAll('*') ?? []) {
        if (banner && banner.contains(el)) continue
        const cs = getComputedStyle(el)
        const hits = PROPS.filter((p) => isGreen(cs[p]))
        if (hits.length) {
          out.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 60) + ' → ' + hits.join(','))
        }
      }
      for (const el of document.querySelectorAll('.dash-asteroid, .dash-grazer')) {
        const v = getComputedStyle(el).getPropertyValue('--ast-rgb').trim()
        if (v && isGreen('rgb(' + v.replace(/ /g, ',') + ')')) out.push('asteroid --ast-rgb ' + v)
      }
      return out.slice(0, 20)
    })()`)
    console.log(
      offenders.length === 0
        ? 'green audit: CLEAN (banner excluded)'
        : `green audit: ${offenders.length} OFFENDERS\n  ` + offenders.join('\n  ')
    )
  }

  // ================= sequence =================

  // ---- dark desktop ----
  await setViewport(1440, 900)
  await goto(PAGE, 1200) // first visit just seeds localStorage
  await setTheme('dark')
  await setNavPos('top')
  await goto()
  await shot('01-full-dark')
  await greenAudit()

  await evalJs(`window.scrollTo(0, document.body.scrollHeight); 'ok'`)
  await sleep(700)
  await shot('02-full-dark-bottom')
  await evalJs(`window.scrollTo(0, 0); 'ok'`)
  await sleep(400)

  await shot('03-hero-dark', await rectOf(HERO))
  await shot('04-kpi-dark', await rectOf(KPI))

  // scroll the lower panels into the viewport before clipping them
  const actTools = unionRect(await rectOf(ACT), await rectOf(TOOLSQ))
  await evalJs(`window.scrollTo(0, ${Math.max(0, Math.round(actTools.y - 40))}); 'ok'`)
  await sleep(400)
  await shot('05-activity-tools-dark', actTools)
  await evalJs(`window.scrollTo(0, 0); 'ok'`)
  await sleep(400)

  // ---- hover state (ember glow + tilt on the hero) ----
  const heroBox = await evalJs(
    `(() => { const b = document.querySelector(${JSON.stringify(HERO)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`
  )
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(heroBox.x),
    y: Math.round(heroBox.y)
  })
  await sleep(550)
  await shot('06-hero-hover-dark', await rectOf(HERO, 48))
  // park the cursor away so later shots are hover-free
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await sleep(500)

  // ---- light theme ----
  await setTheme('light')
  await goto()
  await shot('07-full-light')
  await greenAudit()
  await evalJs(`window.scrollTo(0, document.body.scrollHeight); 'ok'`)
  await sleep(700)
  await shot('08-full-light-bottom')
  await setTheme('dark')

  // ---- mobile 390x844, whole page ----
  await setViewport(390, 844, true)
  await goto()
  await shot('09-mobile-full', undefined, true)

  // ---- reduced-motion freeze check ----
  // Full settle: the odometer's one-off glow ease (700ms text-shadow
  // transition) must finish before frame 0 or the diff reports motion.
  await setViewport(1440, 900)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await goto()
  const rmClip = await rectOf('.dash-reveal-root', 0)
  const a = await shot('10-reduced-motion-f0', rmClip)
  await sleep(1200)
  const b = await shot('10-reduced-motion-f1', rmClip)
  const frozen = fs.readFileSync(a).equals(fs.readFileSync(b))
  console.log(frozen ? 'reduced-motion: FROZEN (ok)' : 'reduced-motion: STILL MOVING (bad)')

  if (!frozen) {
    // Decode both frames in the page and report where pixels changed, so
    // the mover can be identified instead of guessed at.
    const b64a = fs.readFileSync(a).toString('base64')
    const b64b = fs.readFileSync(b).toString('base64')
    const report = await evalJs(`(async () => {
      const load = (b64) =>
        new Promise((res, rej) => {
          const i = new Image()
          i.onload = () => res(i)
          i.onerror = rej
          i.src = 'data:image/png;base64,' + b64
        })
      const [ia, ib] = await Promise.all([load(${JSON.stringify(b64a)}), load(${JSON.stringify(b64b)})])
      const w = Math.min(ia.width, ib.width)
      const h = Math.min(ia.height, ib.height)
      const cv = (img) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const x = c.getContext('2d')
        x.drawImage(img, 0, 0)
        return x.getImageData(0, 0, w, h).data
      }
      const da = cv(ia)
      const db = cv(ib)
      let minX = w, minY = h, maxX = -1, maxY = -1, count = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          if (
            Math.abs(da[i] - db[i]) > 6 ||
            Math.abs(da[i + 1] - db[i + 1]) > 6 ||
            Math.abs(da[i + 2] - db[i + 2]) > 6
          ) {
            count++
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      return count === 0
        ? 'sub-threshold noise only'
        : 'changed px=' + count + ' bbox=[' + minX + ',' + minY + ' → ' + maxX + ',' + maxY + '] of ' + w + 'x' + h
    })()`)
    console.log('reduced-motion diff:', report)
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })

  console.log('done')
  kill()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
