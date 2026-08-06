// Throwaway CDP harness for the NotificationBell comms console: authenticates
// with a cribble_session cookie supplied via SESSION_TOKEN, mocks GET /api/user/notifications
// at the network layer, and captures the panel across nav placements, themes,
// viewports and states to scripts/shots-notif.
//
//   node scripts/notif-shots.mjs [label] [base-url]
//
//   label     prefix for output files (default "shot") — use before/after
//   base-url  default http://localhost:3000
//
// Env:
//   SESSION_TOKEN  required cribble_session value
//   PAGE_PATH      page to visit (default /u/Birdabo404)
//
// Spawns its own headless browser on port 9232 and kills it when done.

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const LABEL = process.argv[2] || 'shot'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9232
const OUT = new URL('./shots-notif/', import.meta.url).pathname
const SESSION = process.env.SESSION_TOKEN
if (!SESSION) {
  console.error('SESSION_TOKEN is required. Supply it explicitly to run notif-shots.mjs.')
  process.exit(1)
}
const PAGE = process.env.PAGE_PATH || '/u/Birdabo404'

const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const now = Date.now()
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const iso = (agoMs) => new Date(now - agoMs).toISOString()

// Deterministic offline avatars — the harness must not depend on live
// pbs.twimg.com fetches. Data URIs pass through Avatar's twimg upgrade
// untouched and never 404 into the monogram fallback.
const avi = (bg, letter) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${bg}"/><text x="40" y="53" font-family="Menlo,monospace" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`
  )}`

const follow = (id, username, color, letter, createdAgo, readAgo) => ({
  id,
  type: 'social',
  title: 'NEW WINGMAN',
  body: `@${username} started following you.`,
  data: { followerId: 100 + id, username, avatarUrl: avi(color, letter) },
  read_at: readAgo == null ? null : iso(readAgo),
  created_at: iso(createdAgo)
})

// Read rows carry a read_at stamp; the newest few stay unread so the
// snapshot-on-open "fresh" styling and the header counter are exercised.
// TODAY holds a 5-follow burst (interleaved with other events) so the
// X-style follow stack collapses them into one row; EARLIER keeps a solo
// follow to prove lone follows stay ordinary avatar rows.
const FEED = [
  {
    id: 1,
    type: 'social',
    title: '+500 PTS — RECRUIT ACTIVATED',
    body: '@karpathy joined through your invite and synced their first activity.',
    data: { kind: 'referral' },
    read_at: null,
    created_at: iso(4 * MIN)
  },
  follow(2, 'sama', '#1d9bf0', 'S', 9 * MIN, null),
  {
    id: 3,
    type: 'rank',
    title: 'RANK CLIMB — TOP 10',
    body: 'You broke into the season top 10. Hold the line.',
    data: { kind: 'promotion' },
    read_at: null,
    created_at: iso(38 * MIN)
  },
  follow(4, 'patio11', '#e0245e', 'P', 52 * MIN, null),
  follow(5, 'levelsio', '#f28c18', 'L', 2 * HOUR, 30 * MIN),
  {
    id: 6,
    type: 'premium',
    title: 'YOUR BLUE CHECK IS HERE',
    body: 'It now shows next to your name on your profile, your player card and the leaderboard.',
    data: {},
    read_at: null,
    created_at: iso(3 * HOUR)
  },
  follow(7, 'swyx', '#7856ff', 'W', 5 * HOUR, 2 * HOUR),
  follow(8, 'dhh', '#17bf63', 'D', 7 * HOUR, 2 * HOUR),
  {
    id: 9,
    type: 'achievement',
    title: 'WARMING UP',
    body: 'Achievement unlocked — Log activity three days in a row.',
    data: { achievementId: 'streak_3' },
    read_at: iso(20 * HOUR),
    created_at: iso(26 * HOUR)
  },
  {
    id: 10,
    type: 'achievement',
    title: 'SUPERNOVA',
    body: 'Achievement unlocked — Score 1,000+ points in a single day.',
    data: { achievementId: 'day_1k' },
    read_at: iso(20 * HOUR),
    created_at: iso(30 * HOUR)
  },
  {
    id: 11,
    type: 'milestone',
    title: 'MILESTONE — 10,000 PTS',
    body: 'Lifetime score crossed 10,000 points.',
    data: {},
    read_at: iso(2 * DAY),
    created_at: iso(3 * DAY)
  },
  {
    id: 12,
    type: 'season',
    title: 'SEASON 1 — FINAL WEEK',
    body: 'Seven days until the board locks and honors are stamped.',
    data: {},
    read_at: iso(4 * DAY),
    created_at: iso(5 * DAY)
  },
  {
    id: 13,
    type: 'rank',
    title: 'RANK SLIP — #14',
    body: 'You dropped out of the top 10. @naval is 240 points ahead.',
    data: { kind: 'demotion' },
    read_at: iso(5 * DAY),
    created_at: iso(6 * DAY)
  },
  follow(14, 'pmarca', '#657786', 'M', 9 * DAY, 8 * DAY),
  {
    id: 15,
    type: 'system',
    title: 'SYNC PROTOCOL UPDATED',
    body: 'Extension v0.4 ships smarter session detection. Update for cleaner scores.',
    data: {},
    read_at: iso(11 * DAY),
    created_at: iso(12 * DAY)
  },
  {
    id: 16,
    type: 'milestone',
    title: 'MILESTONE — 5,000 PTS',
    body: 'Lifetime score crossed 5,000 points.',
    data: {},
    read_at: iso(13 * DAY),
    created_at: iso(14 * DAY)
  },
  {
    id: 17,
    type: 'achievement',
    title: 'FIRST CONTACT',
    body: 'Achievement unlocked — Complete your first sync.',
    data: { achievementId: 'first_sync' },
    read_at: iso(19 * DAY),
    created_at: iso(20 * DAY)
  }
]

const UNREAD = FEED.filter((n) => !n.read_at).length

const feedBody = (items, unread) =>
  JSON.stringify({ success: true, notifications: items, unreadCount: unread })

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
  // ---- browser ----
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

  // ---- auth cookie ----
  await cdp.send('Network.setCookie', {
    name: 'cribble_session',
    value: SESSION,
    url: BASE
  })

  // ---- notifications API mock ----
  // feedMode: 'full' | 'empty' | 'hold' (parks GETs for the skeleton state)
  let feedMode = 'full'
  let held = []
  const releaseHeld = async () => {
    for (const { requestId } of held.splice(0)) {
      await cdp
        .send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(feedBody(FEED, UNREAD)).toString('base64')
        })
        .catch(() => {})
    }
  }
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/user/notifications*' }]
  })
  cdp.on('Fetch.requestPaused', (p) => {
    const method = p.request.method
    if (method === 'PATCH') {
      cdp
        .send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from('{"success":true}').toString('base64')
        })
        .catch(() => {})
      return
    }
    if (feedMode === 'hold') {
      held.push({ requestId: p.requestId })
      return
    }
    const body = feedMode === 'empty' ? feedBody([], 0) : feedBody(FEED, UNREAD)
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

  const BELL = 'button[aria-label^="Notifications"]'
  const PANEL = 'div[role="dialog"][aria-label="Notifications"]'

  // Headless Brave occasionally hangs a navigation deep into the sequence
  // (renderer swap after many gotos); one retry recovers instead of
  // flaking the whole pass.
  const goto = async (path = PAGE, settle = 2200) => {
    for (let attempt = 0; ; attempt++) {
      await cdp.send('Page.navigate', { url: `${BASE}${path}` })
      try {
        await waitFor(BELL)
        break
      } catch (e) {
        if (attempt >= 1) throw e
        console.log('goto: retrying after timeout')
      }
    }
    await sleep(settle)
  }

  const openPanel = async (settle = 900) => {
    await evalJs(`document.querySelector('${BELL}').click(); 'ok'`)
    await waitFor(PANEL)
    await sleep(settle)
  }

  const closePanel = async () => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    })
    await sleep(250)
  }

  // Panel clip in document coordinates (fold in scroll offset).
  const panelRect = async (margin = 28) => {
    const r = await evalJs(
      `(() => { const el = document.querySelector('${PANEL}'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }; })()`
    )
    if (!r) throw new Error('panel not found')
    return {
      x: Math.max(0, r.x - margin),
      y: Math.max(0, r.y - margin),
      width: r.width + margin * 2,
      height: r.height + margin * 2
    }
  }

  const setTheme = (theme) =>
    evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)
  const setNavPos = (pos) =>
    evalJs(`localStorage.setItem('cribble.nav.pos', ${JSON.stringify(pos)}); 'ok'`)

  // ================= sequence =================

  // ---- dark, top-bar dropdown (desktop) ----
  await setViewport(1440, 900)
  await goto()
  await setTheme('dark')
  await setNavPos('top')
  await goto()
  await openPanel()
  await shot('01-panel-dark', await panelRect())
  await shot('02-context-dark') // full viewport: panel over page content

  // follow stack — expand the burst into inline member rows, then collapse
  const STACK = `${PANEL} button[aria-expanded]`
  await evalJs(`document.querySelector('${STACK}').click(); 'ok'`)
  await sleep(500)
  await shot('01b-stack-expanded', await panelRect())
  await evalJs(`document.querySelector('${PANEL} button[aria-expanded="true"]').click(); 'ok'`)
  await sleep(300)

  // scrolled feed — sticky day markers over rows
  await evalJs(
    `document.querySelector('${PANEL} .comms-scroll').scrollTop = 260; 'ok'`
  )
  await sleep(400)
  await shot('03-panel-dark-scrolled', await panelRect())
  await closePanel()

  // ---- dark, rail flyout ----
  await setNavPos('left')
  await goto()
  await openPanel()
  await shot('04-rail-flyout-dark', await panelRect())
  await closePanel()
  await setNavPos('top')

  // ---- light theme ----
  await setTheme('light')
  await goto()
  await openPanel()
  await shot('05-panel-light', await panelRect())
  await shot('06-context-light')
  await closePanel()
  await setTheme('dark')

  // ---- mobile sheet (375) ----
  await setViewport(375, 812, true)
  await goto()
  await openPanel()
  await shot('07-mobile-sheet')
  await closePanel()

  // ---- empty state ----
  feedMode = 'empty'
  await setViewport(1440, 900)
  await goto()
  await openPanel(1100)
  await shot('08-empty', await panelRect())
  await closePanel()

  // ---- loading skeleton (park the GET) ----
  feedMode = 'hold'
  await goto(PAGE, 1200)
  await openPanel(500)
  await shot('09-loading', await panelRect())
  await releaseHeld()
  feedMode = 'full'
  await closePanel()

  // ---- reduced-motion freeze check (radar sweep must park) ----
  feedMode = 'empty'
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await goto()
  await openPanel(1100)
  const rmClip = await panelRect()
  const a = await shot('10-reduced-motion-f0', rmClip)
  await sleep(1200)
  const b = await shot('10-reduced-motion-f1', rmClip)
  const frozen = fs.readFileSync(a).equals(fs.readFileSync(b))
  console.log(frozen ? 'reduced-motion: FROZEN (ok)' : 'reduced-motion: STILL MOVING (bad)')
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })

  console.log('done')
  kill()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
