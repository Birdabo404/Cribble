// CDP verification harness for the Reserve shelf and the three mythic
// plates (Koi Pond / Event Horizon / Prime Anomaly). Spawns headless
// Brave on port 9234, forces the signed-out cosmetics state, and captures:
// the Reserve band (dark/light/mobile), each plate as a full-width preview,
// 68px row-height crops, hover states (koi light bloom, anomaly tear-hold),
// deterministic mid-cycle moments (animation clock jumps), and frozen
// reduced-motion frames with a pixel-stability assertion.
//
//   node scripts/premium-plate-shots.mjs [label] [base-url]

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const LABEL = process.argv[2] || 'pass1'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9234
const OUT = new URL('./shots-premium/', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const RESERVE_IDS = ['koi-pond', 'event-horizon', 'prime-anomaly']

fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getJson = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
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
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method && this.handlers.has(message.method)) {
        this.handlers.get(message.method)(message.params)
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

let browser

const killBrowser = () => {
  try {
    browser?.kill('SIGKILL')
  } catch {}
}

async function main() {
  const profileDir = `/tmp/brave-cdp-${PORT}`
  fs.rmSync(profileDir, { recursive: true, force: true })

  browser = spawn(
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
      `${BASE}/shop`
    ],
    { stdio: 'ignore' }
  )
  process.on('exit', killBrowser)

  let page
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250)
    try {
      const targets = await getJson('/json/list')
      page = targets.find((target) => target.type === 'page')
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

  // Deterministic signed-out state: nothing owned, no Pro, all rows buyable.
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/user/cosmetics*' }]
  })
  cdp.on('Fetch.requestPaused', (params) => {
    cdp
      .send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 401,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from('{"error":"signed out"}').toString('base64')
      })
      .catch(() => {})
  })

  const evalJs = async (expression) => {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (response.exceptionDetails) {
      throw new Error(JSON.stringify(response.exceptionDetails.exception))
    }
    return response.result.value
  }

  const waitFor = async (expression, label, timeout = 20000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      if (await evalJs(expression)) return
      await sleep(200)
    }
    throw new Error(`timeout waiting for ${label}`)
  }

  const setViewport = (width, height, mobile = false) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile
    })

  let navigationId = 0
  let themeStorageReady = false
  const gotoShop = async ({ theme, settle = 1100 }) => {
    if (!themeStorageReady) {
      await cdp.send('Page.navigate', { url: `${BASE}/shop?__bootstrap=1` })
      await waitFor(
        `location.origin === ${JSON.stringify(BASE)} && document.readyState === 'complete'`,
        'same-origin theme bootstrap'
      )
      themeStorageReady = true
    }
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)
    const id = ++navigationId
    await cdp.send('Page.navigate', { url: `${BASE}/shop?__shot=${id}` })
    await waitFor(
      `location.search.includes('__shot=${id}') && document.readyState === 'complete'`,
      `shop navigation ${id}`
    )
    await waitFor(`!!document.querySelector('.shp-mythic')`, '.shp-mythic')
    await waitFor(
      `document.documentElement.classList.contains(${JSON.stringify(theme)})`,
      `${theme} theme`
    )
    await evalJs(`document.fonts.ready.then(() => 'ready')`)
    await hideChrome()
    await sleep(settle)
  }

  const scrollTo = async (selector, block = 'center') => {
    await evalJs(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('missing ${selector}');
        element.scrollIntoView({ block: ${JSON.stringify(block)}, inline: 'nearest' });
        return 'ok';
      })()`
    )
    await sleep(300)
  }

  // The app's fixed nav paints at the top of full-page surfaces and lands
  // inside tall clips (and its live bits can wiggle between frames) — hide
  // page chrome for the captures; the shop content is the subject here.
  const hideChrome = () =>
    evalJs(
      `document.querySelectorAll('nav, header').forEach((el) => { el.style.visibility = 'hidden'; }); 'ok'`
    )

  const elementRect = async (selector, margin = 0) => {
    const rect = await evalJs(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          x: box.x + window.scrollX,
          y: box.y + window.scrollY,
          width: box.width,
          height: box.height
        };
      })()`
    )
    if (!rect) throw new Error(`missing ${selector}`)
    return {
      x: Math.max(0, rect.x - margin),
      y: Math.max(0, rect.y - margin),
      width: rect.width + margin * 2,
      height: rect.height + margin * 2
    }
  }

  const capture = async (clip) => {
    const response = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: Boolean(clip),
      ...(clip ? { clip: { ...clip, scale: 1 } } : {})
    })
    return Buffer.from(response.data, 'base64')
  }

  const shot = async (name, clip) => {
    const file = `${OUT}${LABEL}-${name}.png`
    fs.writeFileSync(file, await capture(clip))
    console.log('saved', file)
    return file
  }

  const clipShot = async (name, selector, margin = 16) =>
    shot(name, await elementRect(selector, margin))

  const hover = async (selector) => {
    const rect = await evalJs(
      `(() => {
        const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      })()`
    )
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2
    })
  }

  const unhover = async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
    await sleep(300)
  }

  /** Jump every animation inside `selector` to `ms` on its own clock and
   * pause — deterministic mid-cycle captures for the long (30–45s) loops. */
  const freezeAnimationsAt = async (selector, ms) => {
    await evalJs(
      `(() => {
        const root = document.querySelector(${JSON.stringify(selector)});
        for (const anim of root.getAnimations({ subtree: true })) {
          anim.currentTime = ${ms};
          anim.pause();
        }
        return 'ok';
      })()`
    )
    await sleep(150)
  }

  const thawAnimations = async (selector) => {
    await evalJs(
      `(() => {
        const root = document.querySelector(${JSON.stringify(selector)});
        for (const anim of root.getAnimations({ subtree: true })) anim.play();
        return 'ok';
      })()`
    )
  }

  const assert = (condition, message) => {
    if (!condition) throw new Error(`assertion failed: ${message}`)
  }

  const rowSelector = (index) => `.shp-mythic article.shpv-card:nth-of-type(${index + 1})`

  // --strips-only: skip the full suite and only run the hover filmstrips
  const STRIPS_ONLY = process.argv.includes('--strips-only')

  if (!STRIPS_ONLY) {
  // ================= desktop dark =================
  await setViewport(1440, 1000)
  await gotoShop({ theme: 'dark' })

  // Structure assertions: shelf order, checkout hrefs, grid exclusion.
  const structure = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.shp-mythic article.shpv-card')];
    const gridHrefs = [...document.querySelectorAll('article.shpk-card a.shpk-link')]
      .map((a) => a.getAttribute('href'));
    return {
      reserveHrefs: rows.map((row) =>
        row.querySelector('a.shpv-link')?.getAttribute('href') ?? null),
      chipText: rows[0]?.textContent.includes('Mythic') ? 'Mythic' : '',
      gridHrefs
    };
  })()`)
  for (let i = 0; i < RESERVE_IDS.length; i++) {
    assert(
      structure.reserveHrefs[i] === `/api/checkout?type=plate&plateId=${RESERVE_IDS[i]}`,
      `reserve row ${i} href: ${structure.reserveHrefs[i]}`
    )
  }
  assert(structure.chipText === 'Mythic', `mythic label: ${structure.chipText}`)
  for (const id of RESERVE_IDS) {
    assert(
      !structure.gridHrefs.some((href) => href?.includes(`plateId=${id}`)),
      `${id} leaked into the plate grid`
    )
  }
  console.log('Structure assertions:', JSON.stringify(structure.reserveHrefs))

  await scrollTo('.shp-mythic')
  await clipShot('01-reserve-dark', '.shp-mythic', 10)

  await scrollTo(rowSelector(0))
  await clipShot('02-koi-row-dark', rowSelector(0), 10)
  await scrollTo(rowSelector(1))
  await clipShot('03-horizon-row-dark', rowSelector(1), 10)
  await scrollTo(rowSelector(2))
  await clipShot('04-anomaly-row-dark', rowSelector(2), 10)

  // ---- hover states ----
  await scrollTo(rowSelector(0))
  await hover(rowSelector(0))
  await sleep(700) // koi light bloom is a 480ms opacity transition — let it settle
  await clipShot('05-koi-hover-dark', rowSelector(0), 10)
  await unhover()

  await scrollTo(rowSelector(1))
  await hover(rowSelector(1))
  await sleep(1100) // feed-the-disk choreography (last transition ends ~740ms)
  await clipShot('05b-horizon-hover-dark', rowSelector(1), 10)
  await unhover()

  await scrollTo(rowSelector(2))
  await hover(rowSelector(2))
  await sleep(1100) // tear-hold animation (850ms) settled fully open
  await clipShot('06-anomaly-hover-dark', rowSelector(2), 10)
  await unhover()

  // ---- deterministic mid-cycle moments (jump the animation clocks) ----
  await scrollTo(rowSelector(1))
  await freezeAnimationsAt(rowSelector(1), 35820) // 79.6% of 45s — the doomed star drifting in
  await clipShot('07a-horizon-tde-star-dark', rowSelector(1), 10)
  await freezeAnimationsAt(rowSelector(1), 38160) // 84.8% of 45s — disruption flare peak, star whipped into a filament
  await clipShot('07-horizon-flare-dark', rowSelector(1), 10)
  await thawAnimations(rowSelector(1))

  await scrollTo(rowSelector(2))
  await freezeAnimationsAt(rowSelector(2), 36100) // 80.2% of 45s — tear pop, burst flash-on
  await clipShot('08a-anomaly-ray-pop-dark', rowSelector(2), 10)
  await freezeAnimationsAt(rowSelector(2), 37800) // 84% of 45s — open dwell, rays raking
  await clipShot('08b-anomaly-rays-dwell-dark', rowSelector(2), 10)
  await thawAnimations(rowSelector(2))

  // ---- 68px row-height renders (leaderboard row geometry) ----
  await evalJs(
    `(() => {
      document.querySelectorAll('.shp-mythic article.shpv-card .aspect-\\\\[4\\\\/1\\\\]').forEach((el) => {
        el.style.aspectRatio = 'auto';
        el.style.height = '68px';
      });
      return 'ok';
    })()`
  )
  await sleep(400)
  await scrollTo(rowSelector(0))
  await clipShot('09-row68-koi-dark', rowSelector(0), 10)
  await scrollTo(rowSelector(1))
  await clipShot('10-row68-horizon-dark', rowSelector(1), 10)
  await scrollTo(rowSelector(2))
  await clipShot('11-row68-anomaly-dark', rowSelector(2), 10)

  // ================= desktop light =================
  await gotoShop({ theme: 'light' })
  await scrollTo('.shp-mythic')
  const lightBand = await evalJs(`(() => {
    const band = document.querySelector('.shp-mythic');
    return {
      htmlClass: document.documentElement.className,
      background: getComputedStyle(band).backgroundColor
    };
  })()`)
  console.log('Light band assertion:', JSON.stringify(lightBand))
  await clipShot('12-reserve-light', '.shp-mythic', 10)

  // ================= mobile 390 =================
  await setViewport(390, 844, true)
  await gotoShop({ theme: 'dark' })
  await scrollTo('.shp-mythic', 'start')
  const mobile = await evalJs(`(() => {
    const band = document.querySelector('.shp-mythic').getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bandLeft: band.left,
      bandRight: band.right
    };
  })()`)
  assert(mobile.scrollWidth <= mobile.viewportWidth, `mobile overflow: ${JSON.stringify(mobile)}`)
  console.log('Mobile layout assertion:', JSON.stringify(mobile))
  await shot('13-mobile-390')
  await clipShot('14-mobile-anomaly-row', rowSelector(2), 8)

  // ================= reduced motion =================
  await setViewport(1440, 1000)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await gotoShop({ theme: 'dark', settle: 400 })
  await scrollTo('.shp-mythic')
  const reducedState = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.shp-mythic article.shpv-card')];
    return {
      liveAnimations: rows.reduce(
        (n, row) => n + row.getAnimations({ subtree: true })
          .filter((a) => a.playState === 'running').length,
        0
      )
    };
  })()`)
  assert(
    reducedState.liveAnimations === 0,
    `reduced-motion still animating: ${reducedState.liveAnimations}`
  )
  console.log('Reduced motion assertion:', JSON.stringify(reducedState))
  const reducedClip = await elementRect('.shp-mythic', 10)
  const reducedFirst = await capture(reducedClip)
  const f0 = `${OUT}${LABEL}-15-reduced-motion-f0.png`
  fs.writeFileSync(f0, reducedFirst)
  console.log('saved', f0)
  await sleep(1000)
  const reducedSecond = await capture(reducedClip)
  const f1 = `${OUT}${LABEL}-15-reduced-motion-f1.png`
  fs.writeFileSync(f1, reducedSecond)
  console.log('saved', f1)
  if (reducedFirst.equals(reducedSecond)) {
    console.log('Reduced motion pixel comparison: FROZEN (bit-exact)')
  } else {
    // Headless software rendering dithers a few hundred pixels per capture;
    // an actually-running scene diffs thousands, concentrated. Measure it.
    const bbox = await evalJs(
      `(async () => {
        const load = (src) => new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
        const a = await load('data:image/png;base64,${reducedFirst.toString('base64')}');
        const b = await load('data:image/png;base64,${reducedSecond.toString('base64')}');
        const canvas = new OffscreenCanvas(a.width, a.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(a, 0, 0);
        const da = ctx.getImageData(0, 0, a.width, a.height).data;
        ctx.clearRect(0, 0, a.width, a.height);
        ctx.drawImage(b, 0, 0);
        const db = ctx.getImageData(0, 0, a.width, a.height).data;
        let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
        for (let y = 0; y < a.height; y++) {
          for (let x = 0; x < a.width; x++) {
            const i = (y * a.width + x) * 4;
            if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) {
              count++;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        return { count, minX, minY, maxX, maxY, width: a.width, height: a.height };
      })()`
    )
    const total = bbox.width * bbox.height
    assert(
      bbox.count / total < 0.0005,
      `reduced-motion band is not pixel-stable: ${JSON.stringify(bbox)}`
    )
    console.log(
      `Reduced motion pixel comparison: FROZEN (${bbox.count}/${total} px capture noise, ${(
        (bbox.count / total) * 100
      ).toFixed(4)}%)`
    )
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  }

  // ================= hover filmstrips (anomaly + horizon) =================
  // The hover choreography is transition-driven; CSSTransitions are Web
  // Animations too, so pause + scrub them to exact offsets for
  // deterministic frames (ambient keyframe loops keep running — they are
  // slow enough that capture latency doesn't matter).
  await setViewport(1440, 1000)
  await gotoShop({ theme: 'dark', settle: 700 })
  await scrollTo(rowSelector(2))
  const fxRoot = `${rowSelector(2)} [data-plate-fx]`
  const ehFxRoot = `${rowSelector(1)} [data-plate-fx]`

  // ---- ambient filmstrip: the resting plate, 6 frames 2s apart on the
  // shared clock (freezeAnimationsAt seeks EVERY animation to the same
  // wall-clock offset). Over 0–10s the 45s cycle stays in its rest phase,
  // so what the strip shows is pure ambient life: the 12s crack surge
  // (pop at 0.48s, arm jumps 1.26–1.86s, etched hold to 6s, reseal by
  // 7.4s), the moonlet advancing along its 18s orbit, star strata drift,
  // twinkle states, nebula creep. Plus one frame right on the second arm
  // jump (13% of 12s = 1.56s).
  for (const [i, ms] of [0, 2000, 4000, 6000, 8000, 10000].entries()) {
    await freezeAnimationsAt(rowSelector(2), ms)
    await clipShot(`20-ambient-f${i}-${ms / 1000}s`, rowSelector(2), 10)
  }
  await freezeAnimationsAt(rowSelector(2), 1560)
  await clipShot('21-crack-jump-1560ms', rowSelector(2), 10)
  await freezeAnimationsAt(rowSelector(2), 800) // light front mid-race along the arms
  await clipShot('22-crack-front-800ms', rowSelector(2), 10)
  await thawAnimations(rowSelector(2))

  // Headless renderers coalesce input + style updates into BeginFrames and
  // stop producing frames when idle — a hover event may sit unprocessed
  // until something forces a frame, and CDP round-trip latency would let
  // short transitions finish (and vanish from getAnimations) before we
  // could seek them. So freeze transitions AT SPAWN: a transitionrun
  // listener pauses every new CSSTransition at currentTime 0 in the same
  // task that creates it. scrubTransitions then seeks the frozen set to
  // exact choreography offsets. Helpers take the FX root of the row under
  // test (default: the anomaly) — the horizon strip reuses the machinery.
  const forceFrame = () =>
    evalJs(`new Promise((resolve) => requestAnimationFrame(() => resolve('f')))`)
  const armTransitionFreeze = (root = fxRoot) =>
    evalJs(
      `(() => {
        const root = document.querySelector(${JSON.stringify(root)});
        root.addEventListener('transitionrun', () => {
          for (const anim of root.getAnimations({ subtree: true })) {
            if (
              'transitionProperty' in anim &&
              anim.playState !== 'paused' &&
              anim.playState !== 'finished'
            ) {
              anim.pause();
              anim.currentTime = 0;
            }
          }
        });
        return 'armed';
      })()`
    )
  await armTransitionFreeze(fxRoot)
  const scrubTransitions = (ms, root = fxRoot) =>
    evalJs(
      `(() => {
        const root = document.querySelector(${JSON.stringify(root)});
        let count = 0;
        for (const anim of root.getAnimations({ subtree: true })) {
          if ('transitionProperty' in anim) {
            anim.pause();
            anim.currentTime = ${ms};
            count++;
          }
        }
        return count;
      })()`
    )
  // Wait for the frozen transition set to be complete and stable. Expected
  // = the full choreography (anomaly: 5 hover layers × opacity+transform
  // pairs + the cycle gate's opacity single + the rift-interior depth
  // transform + two rim-light opacities = 14; horizon: 3 opacity layers +
  // the lens-pull transform = 4). Redirect flips can legitimately
  // spawn fewer (properties already at target don't transition), so a
  // stable nonzero count is accepted after a few frames.
  // Chromium exposes delayed transitions in getAnimations only around the
  // time their delay elapses (real time), so poll the full window for the
  // complete choreography set before trusting a partial one.
  const captureTransitions = async (label, expected = 14, root = fxRoot) => {
    let last = 0
    for (let attempt = 0; attempt < 45; attempt++) {
      await forceFrame()
      last = await scrubTransitions(0, root)
      if (last >= expected) return last
      await sleep(30)
    }
    if (last > 0) {
      console.log(`${label}: settled for ${last} transitions (< ${expected})`)
      return last
    }
    throw new Error(`no transitions spawned for ${label}`)
  }
  const settleTransitions = (root = fxRoot) =>
    evalJs(
      `(() => {
        const root = document.querySelector(${JSON.stringify(root)});
        for (const anim of root.getAnimations({ subtree: true })) {
          if ('transitionProperty' in anim) anim.finish();
        }
        return 'ok';
      })()`
    )
  // Late-spawning delayed transitions (out-direction delays reach 500ms)
  // get frozen at 0 by the listener — finish them in rounds until the
  // spawn window is exhausted, so every sequence starts from a true rest.
  const flushTransitions = async (root = fxRoot) => {
    for (let round = 0; round < 6; round++) {
      await sleep(150)
      await settleTransitions(root)
    }
  }

  // hover-in strip: crack widens → seam blooms → rift → rays → flare
  await hover(rowSelector(2))
  const inCount = await captureTransitions('hover-in')
  console.log('hover-in transitions:', inCount)
  for (const [i, ms] of [0, 120, 280, 450, 700].entries()) {
    await scrubTransitions(ms)
    await sleep(120)
    await clipShot(`16-hoverin-f${i}-${ms}ms`, rowSelector(2), 10)
  }
  await settleTransitions()

  // hover-out strip: rays retract → flare dies → rift narrows → cracks dim
  await unhover()
  const outCount = await captureTransitions('hover-out')
  console.log('hover-out transitions:', outCount)
  for (const [i, ms] of [0, 150, 350, 600, 900].entries()) {
    await scrubTransitions(ms)
    await sleep(120)
    await clipShot(`17-hoverout-f${i}-${ms}ms`, rowSelector(2), 10)
  }
  await flushTransitions()

  // rapid in→out→in interruption: transitions must redirect smoothly from
  // wherever they are. Headless capture latency makes real-time sleeps
  // dishonest (~300ms/frame), so scrub here too: pause mid-flight, flip
  // the hover state (new transitions start FROM the paused computed
  // values — the redirect under test), pause the new set, capture.
  await hover(rowSelector(2))
  await captureTransitions('interrupt-in')
  await scrubTransitions(170)
  await sleep(120)
  await clipShot('18-interrupt-a-in170', rowSelector(2), 10)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
  await captureTransitions('interrupt-out')
  await scrubTransitions(160)
  await sleep(120)
  await clipShot('18-interrupt-b-out160', rowSelector(2), 10)
  await hover(rowSelector(2))
  await captureTransitions('interrupt-reIn')
  await scrubTransitions(90)
  await sleep(120)
  await clipShot('18-interrupt-c-in90', rowSelector(2), 10)
  await scrubTransitions(2000)
  await sleep(120)
  await clipShot('18-interrupt-d-settled', rowSelector(2), 10)
  await settleTransitions()
  await unhover()
  await sleep(1200)

  // hover arriving mid-burst: the cycle gate crossfades the keyframed
  // burst away, so combined brightness stays bounded — the shot must show
  // ONE rift + ray set, not a double exposure
  await freezeAnimationsAt(rowSelector(2), 37000)
  await hover(rowSelector(2))
  await captureTransitions('mid-burst hover')
  await scrubTransitions(2000)
  await sleep(120)
  await clipShot('19-hover-mid-burst', rowSelector(2), 10)
  await settleTransitions()
  await unhover()
  await thawAnimations(rowSelector(2))

  // ================= horizon hover filmstrip =================
  // Feed-the-disk choreography (4 transitions): disk luminance blooms
  // (0ms) → spin-up band crossfades in (80ms) → ring + arches bloom
  // (160ms) → lens pull to scale(1.03) (280ms; last leg ends ~740ms).
  // Out reverses: well settles → ring dies → spin-up fades → disk dims.
  await scrollTo(rowSelector(1))
  await armTransitionFreeze(ehFxRoot)

  await hover(rowSelector(1))
  const ehInCount = await captureTransitions('eh-hover-in', 4, ehFxRoot)
  console.log('eh-hover-in transitions:', ehInCount)
  for (const [i, ms] of [0, 120, 280, 450, 740].entries()) {
    await scrubTransitions(ms, ehFxRoot)
    await sleep(120)
    await clipShot(`23-eh-hoverin-f${i}-${ms}ms`, rowSelector(1), 10)
  }
  await settleTransitions(ehFxRoot)

  await unhover()
  const ehOutCount = await captureTransitions('eh-hover-out', 4, ehFxRoot)
  console.log('eh-hover-out transitions:', ehOutCount)
  for (const [i, ms] of [0, 150, 350, 600, 900].entries()) {
    await scrubTransitions(ms, ehFxRoot)
    await sleep(120)
    await clipShot(`24-eh-hoverout-f${i}-${ms}ms`, rowSelector(1), 10)
  }
  await flushTransitions(ehFxRoot)

  console.log('done')
  ws.close()
  killBrowser()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  killBrowser()
  process.exit(1)
})
