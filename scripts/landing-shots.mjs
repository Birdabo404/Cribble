// Throwaway CDP harness: scrolls the landing page section by section and
// captures screenshots to /tmp/landing/. Drives a headless Chromium-family
// browser started with --remote-debugging-port (no Playwright dependency).
//
//   node scripts/landing-shots.mjs [cdp-port] [url]

import fs from 'node:fs'
import http from 'node:http'

const PORT = process.argv[2] || '9226'
const URL_TO_OPEN = process.argv[3] || 'http://localhost:3000/'
const OUT = '/tmp/landing'
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
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png'
    })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
    console.log('saved', name)
  }

  // 0 — hero untouched check
  await shot('00-hero')

  const sections = [
    'descent-arena',
    'descent-cockpit',
    'descent-identity',
    'descent-honors',
    'descent-roadmap'
  ]

  for (let i = 0; i < sections.length; i++) {
    const id = sections[i]
    await evalJs(
      `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' }); 'ok'`
    )
    // small extra nudge so the seam sits near the top and entrances trigger
    await evalJs(`window.scrollBy(0, -40); 'ok'`)
    await sleep(2600) // let entrance choreography + sims settle
    await shot(`0${i + 1}-${id.replace('descent-', '')}`)
  }

  // APEX centerpiece sits below the honors wall
  await evalJs(
    `document.getElementById('descent-honors').scrollIntoView({ block: 'start' }); 'ok'`
  )
  await evalJs(`window.scrollBy(0, window.innerHeight * 0.85); 'ok'`)
  await sleep(2400)
  await shot('05b-apex')

  // roadmap terminal needs longer (typing animation) — second capture
  await evalJs(
    `document.getElementById('descent-roadmap').scrollIntoView({ block: 'start' }); 'ok'`
  )
  await evalJs(`window.scrollBy(0, window.innerHeight * 0.8); 'ok'`)
  await sleep(6500)
  await shot('06-roadmap-terminal')

  // finale
  await evalJs(`window.scrollTo(0, document.body.scrollHeight); 'ok'`)
  await sleep(2200)
  await shot('07-finale')

  // mid-scroll scrub poses (board pitching in)
  await evalJs(
    `const el = document.getElementById('descent-arena'); const r = el.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - window.innerHeight * 0.72); 'ok'`
  )
  await sleep(700)
  await shot('08-arena-scrub-pose')

  console.log('done')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
