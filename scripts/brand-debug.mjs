// Throwaway: navigate the landing page, dump console messages + LiquidMark
// wrapper DOM state so shader failures are visible from the CLI.
//   node scripts/brand-debug.mjs [cdp-port] [url]

import http from 'node:http'

const PORT = process.argv[2] || '9228'
const URL_TO_OPEN = process.argv[3] || 'http://localhost:3000/'

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
    this.events = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
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

async function main() {
  const targets = await getJson('/json/list')
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  await cdp.send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(7000)

  for (const e of cdp.events) {
    if (e.method === 'Runtime.consoleAPICalled') {
      const args = e.params.args
        .map((a) => a.value ?? a.description ?? '')
        .join(' ')
      console.log(`[console.${e.params.type}]`, args.slice(0, 500))
    }
    if (e.method === 'Runtime.exceptionThrown') {
      console.log(
        '[exception]',
        JSON.stringify(e.params.exceptionDetails).slice(0, 800)
      )
    }
    if (e.method === 'Log.entryAdded') {
      console.log(`[log.${e.params.entry.level}]`, e.params.entry.text.slice(0, 300))
    }
  }

  const r = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const h1 = document.querySelector('h1')
        const spans = [...document.querySelectorAll('h1 span')]
        const imgs = [...document.querySelectorAll('img[src*="cribble-mark"]')]
        const canvases = [...document.querySelectorAll('canvas')]
        return JSON.stringify({
          h1: h1 ? h1.outerHTML.slice(0, 600) : null,
          markImgs: imgs.length,
          canvases: canvases.map((c) => ({ w: c.width, h: c.height, cls: c.className })),
          webgl2: (() => { try { return !!document.createElement('canvas').getContext('webgl2') } catch (e) { return String(e) } })()
        }, null, 2)
      })()
    `,
    returnByValue: true
  })
  console.log(r.result.value)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
