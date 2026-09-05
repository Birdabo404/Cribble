// Throwaway CDP harness for the profile header badge cleanup: mocks
// GET /api/profile/[username] at the network layer and captures the hero
// card across the states that used to be cluttered (medal + FREE + role +
// FOLLOWS YOU all in the name rows).
//
//   node scripts/profile-badge-shots.mjs [label] [base-url]
//
// States:
//   01  PRO founder, rank 2, follows you, you follow them  (dark)
//       -> name + check, handle + FOUNDER, FOLLOWS YOU pill + FOLLOWING
//   02  FREE student, follows you, you don't follow back   (dark)
//       -> no check, no pill (button reads FOLLOW BACK)
//   03  state 01 in light theme
//   04  state 01 at 390px mobile
//   05  signed-out viewer (no CTA cluster at all)
//
// Spawns its own headless browser on port 9235 and kills it when done.

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const LABEL = process.argv[2] || 'shot'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9235
const OUT = new URL('./shots-profile-badges/', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const baseProfile = {
  userId: 4040,
  username: 'sui',
  display_name: 'sui',
  profile_image: null,
  banner_image: null,
  plate: null,
  bio: 'Orbiting the leaderboard. Shipping daily.',
  location: 'Singapore',
  website: null,
  socials: { x: 'sui', github: null, youtube: null, linkedin: null },
  role: 'founder',
  tier: 'PRO',
  memberSince: '2025-07-02T00:00:00.000Z',
  lastSeen: new Date().toISOString(),
  isActive: true,
  rank: 2,
  rankDelta: 0,
  score: 128400,
  todayScore: 1220,
  weekScore: 8400,
  activeDays: 61,
  longestStreak: 19,
  totalActiveMs: 302_400_000,
  topTools: [
    { name: 'Cursor', visits: 411, active_ms: 190_000_000, percent: 63 },
    { name: 'ChatGPT', visits: 168, active_ms: 71_000_000, percent: 24 }
  ],
  badges: [],
  isPrivate: false,
  restricted: false,
  followers: 214,
  following: 87,
  followedBy: null,
  viewer: { isYou: false, isFollowing: true, followsYou: true }
}

const STATES = {
  proFollowing: baseProfile,
  freeFollowBack: {
    ...baseProfile,
    role: 'student',
    tier: 'FREE',
    rank: 44,
    viewer: { isYou: false, isFollowing: false, followsYou: true }
  },
  signedOut: { ...baseProfile, viewer: null, followedBy: null }
}

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
  const profileDir = `/tmp/brave-cdp-${PORT}`
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
      '--window-size=1440,1000',
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

  // ---- profile API mock ----
  let state = 'proFollowing'
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/profile/*' }] })
  cdp.on('Fetch.requestPaused', (p) => {
    const body = JSON.stringify({ success: true, profile: STATES[state] })
    cdp
      .send('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(body).toString('base64')
      })
      .catch(() => {})
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

  const setViewport = (width, height, mobile = false) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile
    })

  const shot = async (name, clip) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
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

  const heroRect = async (margin = 16) => {
    const r = await evalJs(
      `(() => { const el = document.querySelector('section.pf-dossier'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }; })()`
    )
    if (!r) throw new Error('hero card not found')
    return {
      x: Math.max(0, r.x - margin),
      y: Math.max(0, r.y - margin),
      width: r.width + margin * 2,
      height: Math.min(r.height, 460) + margin * 2
    }
  }

  const goto = async (settle = 2600) => {
    await cdp.send('Page.navigate', { url: `${BASE}/u/sui` })
    await waitFor('section.pf-dossier h1')
    await sleep(settle) // pf-reveal + fonts
  }

  const setTheme = async (theme) => {
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)
  }

  // header text audit: what chips/buttons actually rendered
  const audit = () =>
    evalJs(
      `(() => {
        const hero = document.querySelector('section.pf-dossier')
        const text = hero.innerText.replace(/\\s+/g, ' ')
        return {
          hasRunnerUp: text.includes('RUNNER-UP'),
          hasFreeChip: / FREE /.test(' ' + text + ' '),
          hasProChip: / PRO /.test(' ' + text + ' '),
          hasFollowsYou: text.includes('FOLLOWS YOU'),
          hasRole: text.includes('FOUNDER') || text.includes('STUDENT'),
          hasCheck: !!hero.querySelector('svg[aria-label^="Verified"]'),
          button: (hero.querySelector('button[aria-pressed]') || {}).innerText || null
        }
      })()`
    )

  // ---- 01: PRO founder, mutual follow, dark ----
  await setViewport(1440, 1000)
  await goto()
  await setTheme('dark')
  await goto()
  console.log('01 audit', JSON.stringify(await audit()))
  await shot('01-pro-founder-following-dark', await heroRect())

  // ---- 02: FREE student, follow-back state, dark ----
  state = 'freeFollowBack'
  await goto()
  console.log('02 audit', JSON.stringify(await audit()))
  await shot('02-free-student-followback-dark', await heroRect())

  // ---- 03: light theme, state 01 ----
  state = 'proFollowing'
  await setTheme('light')
  await goto()
  console.log('03 audit', JSON.stringify(await audit()))
  await shot('03-pro-founder-light', await heroRect())

  // ---- 04: mobile 390, dark, state 01 ----
  await setTheme('dark')
  await setViewport(390, 844, true)
  await goto()
  await shot('04-mobile-390-dark', await heroRect(8))

  // ---- 05: signed-out viewer ----
  state = 'signedOut'
  await setViewport(1440, 1000)
  await goto()
  console.log('05 audit', JSON.stringify(await audit()))
  await shot('05-signed-out-dark', await heroRect())

  console.log('done')
  kill()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
