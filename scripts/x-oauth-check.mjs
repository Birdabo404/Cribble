// One-off diagnostic: load the local X OAuth entry point in a headless
// browser (CDP on :9231) and screenshot whatever X renders.
import WebSocket from 'ws'
import { writeFileSync } from 'fs'

const CDP_PORT = 9231
const TARGET = 'http://localhost:3000/api/auth/twitter'

const version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json())
const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })

let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
})
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Page.navigate', { url: TARGET }, sessionId)
await new Promise((r) => setTimeout(r, 6000))

const { result } = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({ url: location.href, text: document.body.innerText.slice(0, 800) })',
  returnByValue: true
}, sessionId)
console.log(result.value)

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
writeFileSync('/tmp/x-oauth-local.png', Buffer.from(shot.data, 'base64'))
console.log('screenshot: /tmp/x-oauth-local.png')
ws.close()
