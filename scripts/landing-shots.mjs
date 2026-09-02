// Throwaway CDP harness: walks the landing page — hero, the pinned fall,
// the Contents rail, every sheet (start + centre frame), the touchdown —
// and captures screenshots to /tmp/landing/ (or [out-dir]). Drives a
// headless Chromium-family browser started with --remote-debugging-port
// (no Playwright dependency).
//
//   node scripts/landing-shots.mjs [cdp-port] [url] [out-dir]
//
// Scrolling is always window.scrollTo against gBCR + scrollY: at this
// viewport the page runs the full tier (ScrollSmoother), whose content is
// a transformed child of a fixed wrapper — scrollIntoView would scroll the
// wrapper's own overflow and desync the smoother. Wait for it to settle
// (~1.2s) before measuring anything.

import fs from 'node:fs'
import http from 'node:http'

const PORT = process.argv[2] || '9226'
const URL_TO_OPEN = process.argv[3] || 'http://localhost:3000/'
const OUT = process.argv[4] || '/tmp/landing'
fs.mkdirSync(OUT, { recursive: true })

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

const httpPut = (path) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'PUT' },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
      }
    )
    req.on('error', reject)
    req.end()
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  return new Cdp(ws)
}

async function main() {
  // find or create a page target
  let targets = await getJson('/json/list')
  let page = targets.find((t) => t.type === 'page')
  if (!page) {
    await httpPut('/json/new?about:blank')
    await sleep(300)
    targets = await getJson('/json/list')
    page = targets.find((t) => t.type === 'page')
  }
  if (!page) throw new Error('no page target')

  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
  })

  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(4500) // dev-server compile + hero entrance

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

  const shot = async (name) => {
    // the Next dev overlay badge is environment noise (headless has no
    // WebGL, so the globe logs context errors) — keep it out of the frame
    await evalJs(`document.querySelector('nextjs-portal')?.remove(); 'ok'`)
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png'
    })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', name)
  }

  // The smoother is settled once #smooth-content's translateY equals
  // -scrollY (no smoother: immediately). Polls up to `timeout` ms.
  const settle = async (timeout = 4000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const gap = await evalJs(
        `(() => {
          const c = document.getElementById('smooth-content');
          if (!c) return 0;
          const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
          return Math.abs(m.f + window.scrollY);
        })()`
      )
      if (gap < 0.5) return
      await sleep(100)
    }
  }

  // Where an element sits in the viewport right now — logged with every
  // frame so the run documents where it was actually taken.
  const landed = async (selector) =>
    evalJs(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const r = el && el.getBoundingClientRect();
        return 'scrollY=' + Math.round(window.scrollY) + ' ' + ${JSON.stringify(selector)} + '.top=' + (r ? Math.round(r.top) : 'n/a');
      })()`
    )

  // Document-space scroll to an element: its top lands `offset` px below
  // the viewport top ('start'), or its centre on the viewport centre.
  // Measured after the smoother has settled (a moving content transform
  // would fold the lag into the target).
  const scrollToEl = async (selector, mode = 'start', offset = 40) => {
    await settle()
    await evalJs(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        const y = ${JSON.stringify(mode)} === 'centre'
          ? top + r.height / 2 - window.innerHeight / 2
          : top - ${offset};
        window.scrollTo(0, Math.max(0, y));
        return 'ok';
      })()`
    )
    await settle()
  }

  // Rope diagnostics: is the spine live, where is the marker, what does
  // the KM readout say, which ticks are lit / yielding to the readout.
  const ropeState = () =>
    evalJs(
      `(() => {
        const host = document.querySelector('.lx-spine');
        if (!host) return 'no .lx-spine mounted';
        const alt = host.querySelector('.lx-spine-alt')?.textContent;
        const ticks = [...host.querySelectorAll('.lx-spine-tick')].map((t) =>
          t.className.baseVal.replace('lx-spine-tick', '').trim() || '-'
        );
        return 'live=' + host.classList.contains('is-live') + ' alt=' + alt + ' ticks=[' + ticks.join(',') + ']';
      })()`
    )

  // 0 — hero untouched check. The hero pin builds late (fonts + entrance
  // settle) and refreshes every trigger when it lands; wait it out so no
  // later frame is measured across that reflow.
  await shot('00-hero')
  const t0 = Date.now()
  while (Date.now() - t0 < 6000) {
    if (await evalJs(`!!document.querySelector('.lx-hero')?.parentElement?.classList.contains('pin-spacer')`)) break
    await sleep(200)
  }
  console.log('hero pinned:', await evalJs(`document.querySelector('.lx-hero')?.parentElement?.className`))

  // the pinned fall, mid-way: the rope should be fading in on the left
  await evalJs(`window.scrollTo(0, window.innerHeight * 1.5); 'ok'`)
  await settle()
  await sleep(600)
  console.log('mid-pin:', await landed('.lx-hero'), '|', await ropeState())
  await shot('00b-midpin')

  // the Contents rail — first thing below the fold after the pin releases;
  // parked a third of the way down so the hero's tail shows above it
  await scrollToEl('.lx-descent', 'start', 300)
  await sleep(2400)
  console.log('contents:', await landed('.lx-descent'))
  await shot('00c-contents')

  const sections = ['arena', 'cockpit', 'identity', 'honors', 'roadmap']

  for (let i = 0; i < sections.length; i++) {
    const id = `descent-${sections[i]}`
    // start frame: the sheet's top rule near the viewport top, entrances
    // and sims settled
    await scrollToEl(`#${id}`, 'start', 40)
    await sleep(2600)
    console.log(`${sections[i]}:`, await landed(`#${id}`))
    await shot(`0${i + 1}-${sections[i]}`)
    // centre frame: the sheet centre on the viewport centre — the rope's
    // marker should sit on this sheet's tick
    await scrollToEl(`#${id}`, 'centre')
    await sleep(1600)
    console.log(`${sections[i]} centre:`, await landed(`#${id}`), '|', await ropeState())
    await shot(`0${i + 1}-${sections[i]}-centre`)
  }

  // the medal case sits under the honors grid
  await scrollToEl('#descent-honors', 'start', -Math.round(900 * 0.85))
  await sleep(2400)
  await shot('05b-apex')

  // roadmap terminal needs longer (typing animation) — second capture
  await scrollToEl('#descent-roadmap', 'start', -Math.round(900 * 0.8))
  await sleep(6500)
  await shot('06-roadmap-terminal')

  // touchdown
  await evalJs(
    `window.scrollTo(0, document.documentElement.scrollHeight); 'ok'`
  )
  await settle()
  await sleep(2600)
  console.log('touchdown:', await landed('.lx-descent'), '|', await ropeState())
  await shot('07-touchdown')

  console.log('done')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
