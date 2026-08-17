// CDP verification harness for the Koi Pond plate rebuild. Spawns headless
// Brave on port 9236, forces the signed-out cosmetics state, finds the Koi
// Pond row on the Reserve shelf and captures: the full preview (dark/light),
// a 1000×68 leaderboard-row simulation (full strength + the 55% rest dim),
// deterministic animation-clock freezes at the choreographed moments
// (surface kiss, pad nibble, petal drift, dragonfly visit), the hover
// bloom, and frozen reduced-motion frames with a pixel-stability check.
//
//   node scripts/koi-plate-shots.mjs [label] [base-url]

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const LABEL = process.argv[2] || 'pass1'
const BASE = process.argv[3] || 'http://localhost:3000'
const PORT = 9236
const OUT = new URL('./shots-koi/', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

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

  // Deterministic signed-out state: nothing owned, all tiles buyable.
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

  const hideChrome = () =>
    evalJs(
      `document.querySelectorAll('nav, header').forEach((el) => { el.style.visibility = 'hidden'; }); 'ok'`
    )

  // Tag the Koi Pond row + preview so every helper can address them with
  // plain selectors (the shelf has no per-plate ids). Also add `group` to
  // the article so hover reproduces the leaderboard row's bloom context.
  const tagKoi = async () => {
    const found = await evalJs(
      `(() => {
        const link = document.querySelector('a.shpv-link[href*="plateId=koi-pond"]');
        if (!link) return false;
        const article = link.closest('article');
        article.setAttribute('data-koi', '1');
        article.classList.add('group');
        const preview = article.querySelector('[class*="aspect-"]');
        preview.setAttribute('data-koi-preview', '1');
        return true;
      })()`
    )
    if (!found) throw new Error('koi-pond row not found on the Reserve shelf')
  }

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
    await waitFor(`!!document.querySelector('a.shpv-link[href*="plateId=koi-pond"]')`, 'koi tile')
    await waitFor(
      `document.documentElement.classList.contains(${JSON.stringify(theme)})`,
      `${theme} theme`
    )
    await evalJs(`document.fonts.ready.then(() => 'ready')`)
    await tagKoi()
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

  const clipShot = async (name, selector, margin = 10) =>
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
   * pause — deterministic captures of the choreographed moments. All the
   * scene's clocks share document time, so one `ms` pins the full frame
   * (delays are baked into each keyframe phase computation below). */
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

  const TILE = 'article[data-koi]'
  const PREVIEW = '[data-koi-preview]'

  // Choreography clock positions (document ms → keyframe phase):
  //   kiss   26s clock, delay -6s, rings open 46% → (0.46·26000) − 6000 = 5960
  //   nibble 11s clock, delay -4s, rings 58%   → (0.58·11000) − 4000 = 2380
  //   petal  18s clock, delay -9s, mid  30%    → (0.30·18000) − 9000 + 18000 = 14400... (mod)
  //   dfly   28s clock, delay -12s, hover 74%  → (0.74·28000) − 12000 = 8720
  const KISS_MS = 5960
  const NIBBLE_MS = 2380
  const PETAL_MS = 14400
  const DFLY_MS = 8720

  // ================= desktop dark =================
  await setViewport(1440, 1000)
  await gotoShop({ theme: 'dark' })

  await scrollTo(TILE)
  await clipShot('01-tile-dark', TILE)
  await clipShot('02-preview-dark', PREVIEW, 6)

  // ---- deterministic choreography freezes ----
  await freezeAnimationsAt(TILE, KISS_MS)
  await clipShot('03-kiss-freeze', PREVIEW, 6)
  await freezeAnimationsAt(TILE, NIBBLE_MS)
  await clipShot('04-nibble-freeze', PREVIEW, 6)
  await freezeAnimationsAt(TILE, PETAL_MS)
  await clipShot('05-petal-freeze', PREVIEW, 6)
  await freezeAnimationsAt(TILE, DFLY_MS)
  await clipShot('06-dfly-freeze', PREVIEW, 6)
  await thawAnimations(TILE)

  // ---- hover bloom (group added by tagKoi) ----
  await hover(PREVIEW)
  await sleep(700)
  await clipShot('07-hover-bloom', PREVIEW, 6)
  await unhover()

  // ---- leaderboard-row simulation: 1000×68, full + 55% rest dim ----
  await evalJs(
    `(() => {
      const preview = document.querySelector('${PREVIEW}');
      preview.style.aspectRatio = 'auto';
      preview.style.width = '1000px';
      preview.style.height = '68px';
      preview.style.maxWidth = 'none';
      return 'ok';
    })()`
  )
  await sleep(400)
  await scrollTo(TILE)
  await clipShot('08-row68-dark', PREVIEW, 6)
  await freezeAnimationsAt(TILE, KISS_MS)
  await clipShot('09-row68-kiss', PREVIEW, 6)
  await thawAnimations(TILE)
  await evalJs(
    `document.querySelector('${PREVIEW}').firstElementChild.style.opacity = '0.55'; 'ok'`
  )
  await sleep(200)
  await clipShot('10-row68-dim55', PREVIEW, 6)
  await evalJs(
    `document.querySelector('${PREVIEW}').firstElementChild.style.opacity = ''; 'ok'`
  )

  // ================= desktop light =================
  await gotoShop({ theme: 'light' })
  await scrollTo(TILE)
  await clipShot('11-preview-light', PREVIEW, 6)

  // ================= reduced motion =================
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await gotoShop({ theme: 'dark', settle: 500 })
  await scrollTo(TILE)
  const reducedState = await evalJs(
    `(() => {
      const tile = document.querySelector('${TILE}');
      return {
        liveAnimations: tile.getAnimations({ subtree: true })
          .filter((a) => a.playState === 'running').length
      };
    })()`
  )
  assert(
    reducedState.liveAnimations === 0,
    `reduced-motion still animating: ${reducedState.liveAnimations}`
  )
  console.log('Reduced motion assertion:', JSON.stringify(reducedState))
  const reducedClip = await elementRect(PREVIEW, 6)
  const reducedFirst = await capture(reducedClip)
  const f0 = `${OUT}${LABEL}-12-reduced-motion-f0.png`
  fs.writeFileSync(f0, reducedFirst)
  console.log('saved', f0)
  await sleep(1000)
  const reducedSecond = await capture(reducedClip)
  const f1 = `${OUT}${LABEL}-12-reduced-motion-f1.png`
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
        let count = 0;
        for (let i = 0; i < da.length; i += 4) {
          if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) count++;
        }
        return { count, total: a.width * a.height };
      })()`
    )
    assert(
      bbox.count / bbox.total < 0.0005,
      `reduced-motion frame is not pixel-stable: ${JSON.stringify(bbox)}`
    )
    console.log(
      `Reduced motion pixel comparison: FROZEN (${bbox.count}/${bbox.total} px capture noise, ${(
        (bbox.count / bbox.total) * 100
      ).toFixed(4)}%)`
    )
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })

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
