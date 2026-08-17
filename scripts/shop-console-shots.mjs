// CDP verification harness for the shop's Pro terms and clickable plate
// cards. Spawns headless Brave on port 9232, captures dark/light/mobile/
// reduced-motion/loading states, and prints checkout href assertions.
//
//   node scripts/shop-console-shots.mjs [base-url]

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:3000'
const PORT = 9232
const OUT = new URL('./shots-shop/', import.meta.url).pathname
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
      '--window-size=1440,900',
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

  // Make signed-out state deterministic. "hold" leaves the client request
  // pending so the matching console skeleton can be captured.
  let cosmeticsMode = 'neutral'
  const heldCosmetics = []
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/user/cosmetics*' }]
  })
  cdp.on('Fetch.requestPaused', (params) => {
    if (cosmeticsMode === 'hold') {
      heldCosmetics.push(params.requestId)
      return
    }
    cdp
      .send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 401,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from('{"error":"signed out"}').toString('base64')
      })
      .catch(() => {})
  })

  const releaseHeldCosmetics = async () => {
    for (const requestId of heldCosmetics.splice(0)) {
      await cdp
        .send('Fetch.failRequest', {
          requestId,
          errorReason: 'Aborted'
        })
        .catch(() => {})
    }
  }

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

  const waitFor = async (expression, label, timeout = 15000) => {
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
  const gotoShop = async ({ theme, readySelector = '.shpp-root', settle = 900 }) => {
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
    await waitFor(
      `!!document.querySelector(${JSON.stringify(readySelector)})`,
      readySelector
    )
    await waitFor(
      `document.documentElement.classList.contains(${JSON.stringify(theme)})`,
      `${theme} theme`
    )
    await evalJs(`document.fonts.ready.then(() => 'ready')`)
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
    await sleep(250)
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
    const file = `${OUT}${name}.png`
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
    await sleep(450)
  }

  const unhover = async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
    await sleep(250)
  }

  const assert = (condition, message) => {
    if (!condition) throw new Error(`assertion failed: ${message}`)
  }

  // ================= desktop dark =================
  await setViewport(1440, 900)
  await gotoShop({ theme: 'dark' })
  await scrollTo('.shpm-fan')

  const yearly = await evalJs(`(() => {
    const cta = document.querySelector('a[href="/api/checkout?type=pro_yearly"]');
    const price = document.querySelector('.shpp-card-featured .shpp-price');
    return {
      href: cta?.getAttribute('href'),
      price: price?.textContent.trim()
    };
  })()`)
  assert(yearly.href === '/api/checkout?type=pro_yearly', `yearly CTA href: ${yearly.href}`)
  assert(yearly.price === '$49.99', `yearly price: ${yearly.price}`)
  console.log('CTA yearly assertion:', JSON.stringify(yearly))
  await shot('console-yearly-dark')
  await clipShot('console-yearly-href', '.shpp-root', 24)

  const monthly = await evalJs(`(() => {
    const cta = document.querySelector('a[href="/api/checkout?type=pro_monthly"]');
    const card = cta?.closest('.shpp-card');
    const price = card?.querySelector('.shpp-price');
    return {
      href: cta?.getAttribute('href'),
      price: price?.textContent.trim()
    };
  })()`)
  assert(monthly.href === '/api/checkout?type=pro_monthly', `monthly CTA href: ${monthly.href}`)
  assert(monthly.price === '$6.99', `monthly price: ${monthly.price}`)
  console.log('CTA monthly assertion:', JSON.stringify(monthly))
  await shot('console-monthly-dark')

  await hover('a[href="/api/checkout?type=pro_yearly"]')
  await shot('console-cta-hover-dark')
  await unhover()
  await clipShot('hero-full-dark', '.shpm-fan', 8)

  // Full-card checkout link: signed-out means every rack plate is unowned.
  const plateLink = await evalJs(`(() => {
    const link = document.querySelector('article.shpk-card a.shpk-link');
    const article = link?.closest('article');
    return {
      href: link?.getAttribute('href'),
      label: link?.getAttribute('aria-label'),
      text: article?.textContent.replace(/\\s+/g, ' ').trim()
    };
  })()`)
  assert(
    /^\/api\/checkout\?type=plate&plateId=.+/.test(plateLink.href ?? ''),
    `plate checkout href: ${plateLink.href}`
  )
  assert(plateLink.label?.startsWith('Buy '), `plate accessible label: ${plateLink.label}`)
  console.log('Plate card assertion:', JSON.stringify(plateLink))

  await scrollTo('article.shpk-card')
  await hover('article.shpk-card')
  await clipShot('plate-card-hover-dark', 'article.shpk-card', 20)
  await unhover()
  await evalJs(`document.querySelector('article.shpk-card a.shpk-link').focus(); 'focused'`)
  await sleep(300)
  const plateFocus = await evalJs(`(() => {
    const link = document.querySelector('article.shpk-card a.shpk-link');
    const style = getComputedStyle(link);
    return {
      active: document.activeElement === link,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  })()`)
  assert(plateFocus.active, 'plate link receives keyboard focus')
  assert(plateFocus.outlineStyle !== 'none', `plate focus outline: ${JSON.stringify(plateFocus)}`)
  console.log('Plate focus assertion:', JSON.stringify(plateFocus))
  await clipShot('plate-card-focus-dark', 'article.shpk-card', 20)

  // ================= desktop light =================
  await gotoShop({ theme: 'light' })
  await scrollTo('.shpm-fan')
  const lightState = await evalJs(`(() => {
    const price = document.querySelector('.shpp-card-featured .shpp-price');
    return {
      htmlClass: document.documentElement.className,
      price: price?.textContent.trim(),
      fanExists: Boolean(document.querySelector('.shpm-fan'))
    };
  })()`)
  assert(lightState.price === '$49.99', `light yearly price: ${lightState.price}`)
  assert(lightState.fanExists, 'light fan is present')
  console.log('Light theme assertion:', JSON.stringify(lightState))
  await shot('console-yearly-light')

  // ================= mobile dark =================
  await setViewport(390, 844, true)
  await gotoShop({ theme: 'dark' })
  await scrollTo('.shpp-root')
  const mobile = await evalJs(`(() => {
    const fan = document.querySelector('.shpm-fan').getBoundingClientRect();
    const panel = document.querySelector('.shpp-root').getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      fanLeft: fan.left,
      fanRight: fan.right,
      panelLeft: panel.left,
      panelRight: panel.right
    };
  })()`)
  assert(mobile.scrollWidth <= mobile.viewportWidth, `mobile overflow: ${JSON.stringify(mobile)}`)
  assert(mobile.panelLeft >= 0 && mobile.panelRight <= mobile.viewportWidth, `mobile panel bounds: ${JSON.stringify(mobile)}`)
  console.log('Mobile layout assertion:', JSON.stringify(mobile))
  await shot('mobile-390')

  // ================= reduced motion =================
  await setViewport(1440, 900)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await gotoShop({ theme: 'dark', settle: 300 })
  await scrollTo('.shpp-root')
  await hover('a[href="/api/checkout?type=pro_yearly"]')
  const reducedMotion = await evalJs(`(() => {
    const cta = document.querySelector('a[href="/api/checkout?type=pro_yearly"]');
    const clip = cta?.querySelector('.shpp-go-clip');
    return {
      sheenAnimation: clip ? getComputedStyle(clip, '::after').animationName : 'none',
      dealAnimation: getComputedStyle(document.querySelector('.shpm-card')).animationName
    };
  })()`)
  assert(reducedMotion.sheenAnimation === 'none', `sheen animation: ${reducedMotion.sheenAnimation}`)
  assert(reducedMotion.dealAnimation === 'none', `fan deal animation: ${reducedMotion.dealAnimation}`)
  console.log('Reduced motion assertion:', JSON.stringify(reducedMotion))
  const reducedClip = await elementRect('.shpp-root', 24)
  const reducedFirst = await capture(reducedClip)
  const reducedFile = `${OUT}reduced-motion.png`
  fs.writeFileSync(reducedFile, reducedFirst)
  console.log('saved', reducedFile)
  await unhover()
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })

  // ================= loading skeleton (best effort, deterministic hold) ===
  cosmeticsMode = 'hold'
  await gotoShop({ theme: 'dark', readySelector: '.shpp-root .animate-pulse', settle: 250 })
  await scrollTo('.shpp-root')
  await clipShot('skeleton-state', '.shpp-root', 8)
  console.log('Skeleton assertion: held /api/user/cosmetics request')
  await releaseHeldCosmetics()
  cosmeticsMode = 'neutral'

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
