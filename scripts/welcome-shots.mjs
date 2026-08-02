// One-off CDP pass for the welcome wizard's TEAM branch. The wizard needs
// a session, so this script mints a clearly-marked THROWAWAY user
// (shotbot_tmp, metadata.is_private so it never surfaces on boards) plus a
// session row via the service-role creds in .env.local, photographs the
// mode stage with TEAM selected and the team stage in both billing terms,
// then deletes the user again (deletion is verified; sessions cascade).
//
//   node scripts/welcome-shots.mjs [base-url]
//
// PNGs land in scripts/shots-welcome/ (gitignored via scripts/shots-*/).
// The user row is removed in a finally block, so a mid-run crash still
// cleans up.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const BASE = process.argv[2] || 'http://localhost:4123'
const PORT = 9243
const OUT = new URL('./shots-welcome/', import.meta.url).pathname
const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- env + throwaway account ---------------- */

function loadEnvLocal() {
  const file = path.resolve(new URL('.', import.meta.url).pathname, '../.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

loadEnvLocal()
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

/** Insert the throwaway user + session. onboarded_at stays NULL so the
 *  wizard actually runs; is_private keeps it off every board while alive. */
async function createThrowaway() {
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      twitter_id: `shotbot_tmp_${Date.now()}`,
      twitter_access_token: '',
      twitter_username: 'shotbot_tmp',
      twitter_name: 'SHOTBOT (temp, delete me)',
      twitter_profile_image: '',
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString(),
      metadata: { is_private: true, shotbot: true }
    })
    .select('id')
    .single()
  if (userError) throw new Error(`throwaway user insert failed: ${userError.message}`)

  const sessionToken = randomUUID()
  const { error: sessionError } = await supabase.from('user_sessions').insert({
    user_id: user.id,
    session_token: sessionToken,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString()
  })
  if (sessionError) {
    await supabase.from('users').delete().eq('id', user.id)
    throw new Error(`throwaway session insert failed: ${sessionError.message}`)
  }
  console.log(`throwaway user id=${user.id} created (username shotbot_tmp)`)
  return { userId: user.id, sessionToken }
}

/** Delete the throwaway user and prove both the row and its sessions are
 *  gone. Sessions should cascade with the user; any survivor is removed
 *  explicitly and reported. */
async function destroyThrowaway(userId) {
  const { error: deleteError } = await supabase.from('users').delete().eq('id', userId)
  if (deleteError) throw new Error(`throwaway delete failed: ${deleteError.message}`)

  const { data: userLeft } = await supabase.from('users').select('id').eq('id', userId)
  const { data: sessionsLeft } = await supabase
    .from('user_sessions')
    .select('id')
    .eq('user_id', userId)
  if (sessionsLeft?.length) {
    await supabase.from('user_sessions').delete().eq('user_id', userId)
    console.log(`note: ${sessionsLeft.length} session row(s) did not cascade — deleted explicitly`)
  }
  const clean = (userLeft?.length ?? 0) === 0
  console.log(
    clean
      ? `throwaway user id=${userId} deleted — verified gone (0 user rows, ${sessionsLeft?.length ?? 0} session rows needed manual cleanup)`
      : `WARNING: throwaway user id=${userId} still present after delete!`
  )
  if (!clean) process.exitCode = 1
}

/* ---------------- CDP plumbing (same shape as teams-shots) ---------------- */

const getJson = (p) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
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

async function main() {
  const throwaway = await createThrowaway()
  let browser
  try {
    const profileDir = `/tmp/brave-cdp-${PORT}`
    spawnSync('pkill', ['-f', `brave-cdp-${PORT}`])
    await sleep(600)
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
        '--mute-audio',
        '--window-size=1440,1000',
        'about:blank'
      ],
      { stdio: 'ignore' }
    )
    process.on('exit', () => {
      try {
        browser.kill('SIGKILL')
      } catch {}
    })

    let page
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      try {
        const targets = await getJson('/json/list')
        page = targets.find((t) => t.type === 'page')
        if (page) break
      } catch {}
    }
    if (!page) throw new Error('no page target')

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', reject)
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')

    // The wizard's session — httpOnly like the real login sets it.
    await cdp.send('Network.setCookie', {
      name: 'cribble_session',
      value: throwaway.sessionToken,
      url: BASE,
      httpOnly: true
    })

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

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 2,
      mobile: false
    })

    const shot = async (name) => {
      const height = await evalJs('document.documentElement.scrollHeight')
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1440, height: Math.max(1000, Math.min(height, 4000)), scale: 1 }
      })
      fs.writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'))
      console.log('saved', `${OUT}${name}.png`)
    }

    const waitFor = async (marker, tries = 50) => {
      for (let i = 0; i < tries; i++) {
        const ready = await evalJs(
          `document.body && document.body.innerText.includes(${JSON.stringify(marker)})`
        ).catch(() => false)
        if (ready) return
        await sleep(300)
      }
      throw new Error(`marker never appeared: ${marker}`)
    }

    const freeze = async () => {
      await evalJs('document.fonts.ready.then(() => true)')
      await sleep(700)
      await evalJs(
        `document.getAnimations().forEach((a) => { try { a.finish() } catch {} }); true`
      )
      await sleep(200)
    }

    const clickByText = async (text) => {
      const hit = await evalJs(`(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find((b) => b.textContent.includes(${JSON.stringify(text)}))
        if (!btn) return false
        btn.click()
        return true
      })()`)
      if (!hit) throw new Error(`no button containing: ${text}`)
    }

    // ---- boot: intro plays ~1.8s, then the mode stage hydrates in ----
    await cdp.send('Page.navigate', { url: `${BASE}/welcome` })
    await waitFor('how will you')
    await freeze()

    // A signed-out session would have bounced to /login by now — assert.
    const loc = await evalJs('location.pathname')
    if (loc !== '/welcome') throw new Error(`wizard bounced to ${loc} — session rejected?`)

    // ---- 1. mode stage with TEAM selected ----
    await clickByText('Play as your company')
    await sleep(400)
    await freeze()
    await shot('welcome-mode-team')

    // ---- 2. team stage, yearly (the preselected default) ----
    await clickByText('Continue')
    await waitFor('WHAT THE PLAN UNLOCKS')
    await freeze()
    await shot('welcome-team-yearly')

    // ---- 3. team stage, monthly ----
    await evalJs(`(() => {
      const card = Array.from(document.querySelectorAll('button'))
        .find((b) => /monthly/i.test(b.textContent) && b.textContent.includes('$') && !/yearly/i.test(b.textContent))
      if (!card) throw new Error('no monthly term card')
      card.click()
      return true
    })()`)
    await sleep(400)
    await freeze()
    await shot('welcome-team-monthly')

    // ---- 4. the escape hatch: continue solo lands on privacy, 02/0N ----
    await clickByText('Continue solo instead')
    await waitFor('WHAT WE COLLECT')
    await freeze()
    const counter = await evalJs(
      `(document.body.innerText.match(/\\d\\d\\s*\\/\\s*\\d\\d/) || [''])[0]`
    )
    console.log('solo-escape step counter:', counter)
    await shot('welcome-solo-escape')

    browser.kill('SIGKILL')
    browser = null
  } finally {
    if (browser) {
      try {
        browser.kill('SIGKILL')
      } catch {}
    }
    await destroyThrowaway(throwaway.userId)
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
