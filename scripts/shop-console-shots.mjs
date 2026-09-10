// CDP verification harness for the shop storefront: the featured stage
// (BUY href, rail swap), the Pro terms, the plate cards (checkout chip,
// SPEC → drawer → ?plate= contract), the sticky catalog index scroll-spy,
// then light / mobile / reduced-motion / loading-skeleton captures.
// Spawns headless Brave (falls back to Google Chrome) on port 9232 and
// prints every assertion as it passes.
//
//   node scripts/shop-console-shots.mjs [base-url]

import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:3000'
const PORT = 9232
const OUT = new URL('./shots-shop/', import.meta.url).pathname
const BROWSERS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]

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
  const executable = BROWSERS.find((path) => fs.existsSync(path))
  if (!executable) throw new Error(`no browser found; tried ${BROWSERS.join(', ')}`)
  console.log('browser', executable)

  const profileDir = `/tmp/brave-cdp-${PORT}`
  fs.rmSync(profileDir, { recursive: true, force: true })

  browser = spawn(
    executable,
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

  const waitFor = async (expression, label, timeout = 20000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      if (await evalJs(expression)) return
      await sleep(150)
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
  // `settle` outlasts the GSAP entrance (masthead → rules → index → first
  // section ≈ 1s after hydration) so captures never catch a mid-fade.
  const gotoShop = async ({ theme, readySelector = '.shpp-root', settle = 1400, query = '' }) => {
    if (!themeStorageReady) {
      // The first hit also warms the dev server's compile of the route.
      await cdp.send('Page.navigate', { url: `${BASE}/shop?__bootstrap=1` })
      await waitFor(
        `location.origin === ${JSON.stringify(BASE)} && document.readyState === 'complete'`,
        'same-origin theme bootstrap',
        120000
      )
      themeStorageReady = true
    }
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)}); 'ok'`)
    const id = ++navigationId
    await cdp.send('Page.navigate', { url: `${BASE}/shop?__shot=${id}${query}` })
    await waitFor(
      `location.search.includes('__shot=${id}') && document.readyState === 'complete'`,
      `shop navigation ${id}`,
      60000
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

  const viewportCenter = async (selector) => {
    const rect = await evalJs(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()`
    )
    if (!rect) throw new Error(`missing ${selector}`)
    return rect
  }

  const hover = async (selector) => {
    const point = await viewportCenter(selector)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await sleep(450)
  }

  const unhover = async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
    await sleep(250)
  }

  // A real pointer click (move → press → release) so React sees the same
  // event sequence a user produces; the target is scrolled into view first.
  const click = async (selector) => {
    await scrollTo(selector)
    const point = await viewportCenter(selector)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1
    })
  }

  const pressKey = async (key, code, keyCode) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode
    })
  }

  const assert = (condition, message) => {
    if (!condition) throw new Error(`assertion failed: ${message}`)
  }

  const pass = (label, detail) =>
    console.log(`PASS ${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)

  const DRAWER_OPEN = `!!document.querySelector('body > .shop-floor > .shpd-root .shpd-panel[role="dialog"]')`
  const DRAWER_GONE = `!document.querySelector('.shpd-panel[role="dialog"]')`

  /** SPEC on the first plate card → drawer open with `?plate=` set. */
  const openFirstPlateDrawer = async () => {
    await click('article.shpk-card .shpc-btn')
    await waitFor(DRAWER_OPEN, 'spec drawer panel')
    await waitFor(`location.search.includes('plate=')`, 'drawer to write ?plate=', 5000)
    await sleep(500)
    return evalJs(`(() => {
      const panel = document.querySelector('.shpd-panel[role="dialog"]');
      const buy = panel?.querySelector('a[href^="/api/checkout?type=plate"]');
      const close = panel?.querySelector('.shpd-close');
      const box = panel?.getBoundingClientRect();
      return {
        search: location.search,
        activeIsClose: document.activeElement === close,
        buyHref: buy?.getAttribute('href') ?? null,
        panelBottom: box ? Math.round(box.bottom) : null,
        panelRight: box ? Math.round(box.right) : null,
        innerHeight,
        innerWidth
      };
    })()`)
  }

  const closeDrawerWithEscape = async () => {
    await pressKey('Escape', 'Escape', 27)
    await waitFor(DRAWER_GONE, 'spec drawer to close')
    await waitFor(`location.search === ''`, 'drawer close to scrub ?plate=')
  }

  // ================= desktop dark =================
  await setViewport(1440, 900)
  await gotoShop({ theme: 'dark' })
  const desktopShell = await evalJs(`(() => ({
    masthead: !!document.querySelector('.shpm-masthead'),
    ticker: !!document.querySelector('.shop-ticker-track'),
    index: !!document.querySelector('.shpi-index'),
    activeIndex: document.querySelector('.shpi-item[data-active]')?.dataset.section ?? null,
    sections: [...document.querySelectorAll('[data-shop-section]')].map((el) => el.id)
  }))()`)
  assert(desktopShell.masthead && desktopShell.ticker && desktopShell.index, `shell: ${JSON.stringify(desktopShell)}`)
  assert(desktopShell.activeIndex === 'featured', `initial index item: ${desktopShell.activeIndex}`)
  assert(
    desktopShell.sections.join(',') === 'shop-featured,shop-pro,shop-mythic,shop-plates,shop-vault',
    `section order: ${desktopShell.sections}`
  )
  pass('shell + section order', desktopShell)

  // The Team door is a priced link out to /teams, not a selected state:
  // signed out (401) means the TEAM label with its $50/MO, no data-active
  // anywhere on it, and the row still fits on one line at desktop.
  const teamDoor = await evalJs(`(() => {
    const door = document.querySelector('.shpi-doors a[href="/teams"]');
    if (!door) return null;
    const row = document.querySelector('.shpi-row');
    const chip = door.querySelector('.shpi-chip');
    return {
      text: door.textContent.replace(/\\s+/g, ' ').trim(),
      ariaLabel: door.getAttribute('aria-label'),
      active: door.hasAttribute('data-active') || !!door.querySelector('[data-active]'),
      chipHeight: Math.round(chip.getBoundingClientRect().height),
      rowOverflow: row.scrollWidth - row.clientWidth
    };
  })()`)
  assert(teamDoor, 'TEAM door a[href="/teams"] present in the catalog index')
  assert(teamDoor.text.includes('$50'), `TEAM door prints the price: ${teamDoor.text}`)
  assert(!teamDoor.active, `TEAM door carries no data-active: ${JSON.stringify(teamDoor)}`)
  assert(teamDoor.rowOverflow <= 0, `index row fits on one line: ${JSON.stringify(teamDoor)}`)
  pass('TEAM door is a priced link, not a selected state', teamDoor)
  await shot('storefront-top-dark')

  // ---- 01 featured stage ----
  await scrollTo('.shpf-stage')
  const stage = await evalJs(`(() => {
    const buy = document.querySelector('.shpf-stage a[href^="/api/checkout?type=plate"]');
    const spec = document.querySelector('.shpf-stage .shps-outline');
    const radios = [...document.querySelectorAll('.shpf-rail[role="radiogroup"] button[role="radio"]')];
    return {
      buyHref: buy?.getAttribute('href') ?? null,
      buyLabel: buy?.getAttribute('aria-label') ?? null,
      specButton: !!spec,
      radios: radios.length,
      checked: radios.map((r) => r.getAttribute('aria-checked')),
      specId: document.querySelector('.shpf-spec [data-plate-spec]')?.dataset.plateSpec ?? null
    };
  })()`)
  assert(
    /^\/api\/checkout\?type=plate&plateId=.+/.test(stage.buyHref ?? ''),
    `stage BUY href: ${stage.buyHref}`
  )
  assert(stage.buyLabel?.startsWith('Buy '), `stage BUY label: ${stage.buyLabel}`)
  assert(stage.specButton, 'stage SPEC door present')
  assert(stage.radios === 5 && stage.checked[0] === 'true', `rail radios: ${JSON.stringify(stage)}`)
  pass('stage BUY href + rail', stage)
  await clipShot('hero-full-dark', '.shpf-stage', 8)

  await click('.shpf-rail button[role="radio"]:nth-child(2)')
  await sleep(900)
  const swapped = await evalJs(`(() => {
    const radios = [...document.querySelectorAll('.shpf-rail button[role="radio"]')];
    return {
      checked: radios.map((r) => r.getAttribute('aria-checked')),
      specId: document.querySelector('.shpf-spec [data-plate-spec]')?.dataset.plateSpec ?? null,
      buyHref: document.querySelector('.shpf-stage a[href^="/api/checkout?type=plate"]')?.getAttribute('href') ?? null
    };
  })()`)
  assert(swapped.checked[0] === 'false' && swapped.checked[1] === 'true', `rail aria-checked: ${swapped.checked}`)
  assert(swapped.specId && swapped.specId !== stage.specId, `stage spec swapped: ${stage.specId} → ${swapped.specId}`)
  assert(swapped.buyHref?.includes(`plateId=${swapped.specId}`), `stage BUY follows the swap: ${swapped.buyHref}`)
  pass('rail swap', swapped)
  await clipShot('hero-swapped-dark', '.shpf-stage', 8)
  await click('.shpf-rail button[role="radio"]:nth-child(1)')
  await sleep(700)

  // ---- 02 pro ----
  await scrollTo('.shpp-root')
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
  pass('CTA yearly', yearly)
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
  pass('CTA monthly', monthly)

  await hover('a[href="/api/checkout?type=pro_yearly"]')
  await shot('console-cta-hover-dark')
  await unhover()

  // ---- 03 mythic + 04 plates ----
  await scrollTo('#shop-mythic', 'start')
  await sleep(600)
  await clipShot('mythic-grid-dark', '#shop-mythic', 8)

  // Price chip is the checkout link: signed-out means every rack plate is unowned.
  await scrollTo('#shop-plates', 'start')
  await sleep(700)
  const plateLink = await evalJs(`(() => {
    const link = document.querySelector('article.shpk-card a.shpc-chip');
    const article = link?.closest('article');
    return {
      href: link?.getAttribute('href'),
      label: link?.getAttribute('aria-label'),
      cards: document.querySelectorAll('article.shpk-card').length,
      text: article?.textContent.replace(/\\s+/g, ' ').trim()
    };
  })()`)
  assert(
    /^\/api\/checkout\?type=plate&plateId=.+/.test(plateLink.href ?? ''),
    `plate checkout href: ${plateLink.href}`
  )
  assert(plateLink.label?.startsWith('Buy '), `plate accessible label: ${plateLink.label}`)
  pass('plate card chip', plateLink)
  await clipShot('plates-grid-dark', '#shop-plates', 8)

  await scrollTo('article.shpk-card')
  await hover('article.shpk-card')
  await clipShot('plate-card-hover-dark', 'article.shpk-card', 20)
  await unhover()
  // Keyboard path: focus the SPEC button, then a real Tab lands on the
  // chip with keyboard modality, so :focus-visible (the dashed ink ring)
  // applies — a scripted .focus() after mouse input would not show it.
  await evalJs(`document.querySelector('article.shpk-card .shpc-btn').focus(); 'focused'`)
  await pressKey('Tab', 'Tab', 9)
  await sleep(300)
  const plateFocus = await evalJs(`(() => {
    const link = document.querySelector('article.shpk-card a.shpc-chip');
    const style = getComputedStyle(link);
    return {
      active: document.activeElement === link,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  })()`)
  assert(plateFocus.active, 'plate chip receives keyboard focus')
  assert(plateFocus.outlineStyle !== 'none', `plate focus outline: ${JSON.stringify(plateFocus)}`)
  pass('plate chip focus', plateFocus)
  await clipShot('plate-card-focus-dark', 'article.shpk-card', 20)
  await evalJs(`document.activeElement?.blur(); 'blurred'`)

  // ---- SPEC → drawer → ?plate= ----
  const drawer = await openFirstPlateDrawer()
  assert(drawer.search.includes('plate='), `drawer sets ?plate=: ${drawer.search}`)
  assert(drawer.activeIsClose, 'drawer focuses CLOSE on open')
  assert(
    /^\/api\/checkout\?type=plate&plateId=.+/.test(drawer.buyHref ?? ''),
    `drawer BUY href: ${drawer.buyHref}`
  )
  assert(drawer.panelRight <= drawer.innerWidth, `drawer panel within viewport: ${JSON.stringify(drawer)}`)
  pass('spec drawer open', drawer)
  await shot('drawer-dark')
  await closeDrawerWithEscape()
  pass('spec drawer Escape → closed, URL scrubbed', await evalJs('location.search'))

  // ---- 05 vault ----
  await scrollTo('#shop-vault', 'start')
  await sleep(700)
  const vault = await evalJs(`(() => {
    const founder = document.querySelector('#shop-vault a[href^="/api/checkout?type=plate&plateId=founder"]');
    return { founderHref: founder?.getAttribute('href') ?? null };
  })()`)
  assert(vault.founderHref, 'founder gold chip is the checkout link')
  pass('vault founder chip', vault)
  await clipShot('vault-dark', '#shop-vault', 8)

  // ---- catalog index scroll-spy ----
  await evalJs(`window.scrollTo({ top: 0, behavior: 'auto' }); 'top'`)
  await sleep(500)
  const indexTop = await evalJs(
    `document.querySelector('.shpi-item[data-active]')?.dataset.section ?? null`
  )
  assert(indexTop === 'featured', `index at top: ${indexTop}`)
  await scrollTo('#shop-plates', 'start')
  await waitFor(
    `document.querySelector('.shpi-item[data-active]')?.dataset.section === 'plates'`,
    'index spy → PLATES',
    1500
  )
  pass('catalog index scroll-spy', { top: indexTop, afterScroll: 'plates' })
  await clipShot('index-active-plates-dark', '.shpi-index', 8)

  // ---- footer ----
  await evalJs(`window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' }); 'bottom'`)
  await sleep(500)
  await shot('footer-dark')

  // ================= desktop light =================
  await gotoShop({ theme: 'light' })
  const lightState = await evalJs(`(() => {
    const price = document.querySelector('.shpp-card-featured .shpp-price');
    return {
      htmlClass: document.documentElement.className,
      price: price?.textContent.trim(),
      stageExists: Boolean(document.querySelector('.shpf-stage')),
      onGold: getComputedStyle(document.querySelector('a[href="/api/checkout?type=pro_yearly"]')).color,
      goldBg: getComputedStyle(document.querySelector('a[href="/api/checkout?type=pro_yearly"]')).backgroundColor
    };
  })()`)
  assert(lightState.price === '$49.99', `light yearly price: ${lightState.price}`)
  assert(lightState.stageExists, 'light stage is present')
  pass('light theme', lightState)
  await shot('storefront-top-light')
  await scrollTo('.shpf-stage')
  await clipShot('hero-full-light', '.shpf-stage', 8)
  await scrollTo('.shpp-root')
  await shot('console-yearly-light')
  await scrollTo('#shop-plates', 'start')
  await sleep(700)
  await clipShot('plates-grid-light', '#shop-plates', 8)
  const lightDrawer = await openFirstPlateDrawer()
  assert(lightDrawer.search.includes('plate='), `light drawer ?plate=: ${lightDrawer.search}`)
  await shot('drawer-light')
  await closeDrawerWithEscape()

  // ================= mobile dark =================
  await setViewport(390, 844, true)
  await gotoShop({ theme: 'dark' })
  const mobile = await evalJs(`(() => {
    const stage = document.querySelector('.shpf-stage').getBoundingClientRect();
    const panel = document.querySelector('.shpp-root').getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      index: !!document.querySelector('.shpi-index'),
      stageLeft: Math.round(stage.left),
      stageRight: Math.round(stage.right),
      panelLeft: Math.round(panel.left),
      panelRight: Math.round(panel.right)
    };
  })()`)
  assert(mobile.scrollWidth <= mobile.viewportWidth, `mobile overflow: ${JSON.stringify(mobile)}`)
  assert(mobile.index, 'mobile catalog index strip present')
  assert(mobile.panelLeft >= 0 && mobile.panelRight <= mobile.viewportWidth, `mobile panel bounds: ${JSON.stringify(mobile)}`)
  pass('mobile layout', mobile)
  await shot('mobile-390')
  await scrollTo('.shpf-stage', 'start')
  await sleep(400)
  await shot('mobile-390-stage')
  await scrollTo('.shpp-root')
  await shot('mobile-390-pro')
  const mobileDrawer = await openFirstPlateDrawer()
  assert(mobileDrawer.search.includes('plate='), `mobile drawer ?plate=: ${mobileDrawer.search}`)
  assert(
    mobileDrawer.panelBottom <= mobileDrawer.innerHeight,
    `mobile sheet bottom within viewport: ${JSON.stringify(mobileDrawer)}`
  )
  pass('mobile sheet', mobileDrawer)
  await shot('mobile-390-sheet')
  await closeDrawerWithEscape()

  // ================= reduced motion =================
  await setViewport(1440, 900)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await gotoShop({ theme: 'dark', settle: 600 })
  const reducedMotion = await evalJs(`(() => {
    const stage = document.querySelector('.shpf-stage');
    const keyline = document.querySelector('.shop-pro-keyline');
    return {
      tickerAnimation: getComputedStyle(document.querySelector('.shop-ticker-track')).animationName,
      stageTransform: getComputedStyle(stage).transform,
      stageWrapperTransform: getComputedStyle(stage.parentElement).transform,
      mastheadTransform: getComputedStyle(document.querySelector('.shpm-lockup')).transform,
      sheenAnimation: keyline ? getComputedStyle(keyline, '::after').animationName : 'none'
    };
  })()`)
  assert(reducedMotion.tickerAnimation === 'none', `ticker animation: ${reducedMotion.tickerAnimation}`)
  assert(reducedMotion.stageTransform === 'none', `stage transform: ${reducedMotion.stageTransform}`)
  assert(reducedMotion.stageWrapperTransform === 'none', `stage wrapper transform: ${reducedMotion.stageWrapperTransform}`)
  assert(reducedMotion.mastheadTransform === 'none', `masthead transform: ${reducedMotion.mastheadTransform}`)
  assert(reducedMotion.sheenAnimation === 'none', `sheen animation: ${reducedMotion.sheenAnimation}`)
  pass('reduced motion', reducedMotion)
  await scrollTo('.shpp-root')
  await clipShot('reduced-motion', '.shpp-root', 24)
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })

  // ================= loading skeleton (deterministic hold) ===
  cosmeticsMode = 'hold'
  await gotoShop({ theme: 'dark', readySelector: '.shpp-root .animate-pulse', settle: 250 })
  const skeleton = await evalJs(`(() => ({
    proSkeleton: document.querySelectorAll('.shpp-root .animate-pulse').length,
    tier: document.querySelector('.shpm-tier')?.textContent.trim() ?? null
  }))()`)
  assert(skeleton.proSkeleton > 0, 'pro skeleton while cosmetics are held')
  assert(skeleton.tier === 'TIER · SYNCING', `masthead tier while syncing: ${skeleton.tier}`)
  pass('skeleton', skeleton)
  await scrollTo('.shpp-root')
  await clipShot('skeleton-state', '.shpp-root', 8)
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
