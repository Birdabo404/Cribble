import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

describe('middleware security headers', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_LOCKED', 'false')
    vi.stubEnv('NEXT_PUBLIC_SITE_LOCKED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('adds browser security headers to application responses', () => {
    const response = middleware(new NextRequest('https://cribble.dev/login'))

    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('x-xss-protection')).toBe('1; mode=block')
    expect(response.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()'
    )
    // Outside production (dev/test) the CSP keeps 'unsafe-eval' for Next.js
    // dev tooling; production drops it (covered below).
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://gc.zgo.at; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https: blob:; " +
        "connect-src 'self' https://*.supabase.co https://vitals.vercel-insights.com https://*.goatcounter.com; " +
        "frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
        "frame-ancestors 'none'"
    )
  })

  it("omits 'unsafe-eval' from the production CSP", () => {
    vi.stubEnv('NODE_ENV', 'production')

    const response = middleware(new NextRequest('https://cribble.dev/login'))
    const csp = response.headers.get('content-security-policy')

    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://gc.zgo.at"
    )
    expect(csp).toContain('https://*.goatcounter.com')
    expect(csp).not.toContain('https://datafa.st')
    expect(csp).not.toContain('unsafe-eval')
  })

  it('returns production CORS headers for API preflight requests', () => {
    vi.stubEnv('NODE_ENV', 'production')

    const response = middleware(
      new NextRequest('https://cribble.dev/api/device/verify', { method: 'OPTIONS' })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://cribble.dev')
    expect(response.headers.get('access-control-allow-methods')).toContain('OPTIONS')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('preserves security headers when the site lock rejects a route', () => {
    vi.stubEnv('SITE_LOCKED', 'true')

    const response = middleware(new NextRequest('https://cribble.dev/api/shop/checkout'))

    expect(response.status).toBe(404)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
})

describe('middleware site lock', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const request = (path: string, cookie?: string) =>
    new NextRequest(`https://cribble.dev${path}`, cookie ? { headers: { cookie } } : undefined)

  const rewriteTarget = (path: string, cookie?: string) => {
    const rewrite = middleware(request(path, cookie)).headers.get('x-middleware-rewrite')
    return rewrite ? new URL(rewrite).pathname : null
  }

  it('rewrites locked sectors to the maintenance screen', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Any page outside the allowlist rewrites in place. /shop is its own
    // case now — sealed or open depending on the session cookie (below).
    expect(rewriteTarget('/roadmap')).toBe('/maintenance')
  })

  it('keeps dashboard and settings APIs reachable while the app shell is session-gated', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Pages are session-gated (below); the data lanes still need to answer
    // once a pilot is in — they enforce real auth themselves.
    expect(middleware(request('/api/user/settings')).status).toBe(200)
    expect(middleware(request('/api/user/agent-keys')).status).toBe(200)
    expect(middleware(request('/api/user/agent-sharing')).status).toBe(200)
    expect(middleware(request('/api/user/token-usage')).status).toBe(200)
    expect(middleware(request('/api/user/token-usage/')).status).toBe(200)
    expect(middleware(request('/api/user/delete')).status).toBe(200)
    expect(middleware(request('/api/user/agent-sharing-extra')).status).toBe(404)
    expect(middleware(request('/api/user/token-usage-extra')).status).toBe(404)
  })

  it('opens only the exact agent usage API while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(middleware(request('/api/agent/usage')).status).toBe(200)
    expect(middleware(request('/api/agent/usage/')).status).toBe(200)
    expect(middleware(request('/api/agent/other')).status).toBe(404)
  })

  it('keeps the void screens themselves reachable while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(rewriteTarget('/maintenance')).toBeNull()
    expect(middleware(request('/maintenance')).status).toBe(200)
    expect(rewriteTarget('/restricted')).toBeNull()
    expect(middleware(request('/restricted')).status).toBe(200)
  })

  it('still 404s locked API routes', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(middleware(request('/api/shop/checkout')).status).toBe(404)
  })

  it('keeps operational cron routes reachable while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(middleware(request('/api/cron/season')).status).toBe(200)
    expect(middleware(request('/api/cron/insights-rollup')).status).toBe(200)
    expect(middleware(request('/api/cron/leaderboard-integrity')).status).toBe(200)
    expect(middleware(request('/api/cron/unknown')).status).toBe(404)
  })

  it('leaves allowlisted pages alone while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(rewriteTarget('/leaderboard')).toBeNull()
    // Payments must survive the lock: the API lanes stay reachable so
    // Polar webhooks and checkout bounces keep landing.
    // The Team and sponsorship pitch pages are publicly shareable while
    // the beta is locked — otherwise cribble.dev/sponsorship rewrites
    // to /maintenance for every visitor, signed-in or not.
    expect(rewriteTarget('/teams')).toBeNull()
    expect(rewriteTarget('/sponsorship')).toBeNull()
    expect(rewriteTarget('/sponsorship?slot=L2')).toBeNull()
    // The team console is Polar's checkout success URL and its API lanes
    // back it — a mid-lock Team purchase must not land on /maintenance.
    expect(rewriteTarget('/team')).toBeNull()
    expect(rewriteTarget('/team/invites')).toBeNull()
    expect(middleware(request('/api/team/roster')).status).toBe(200)
    expect(middleware(request('/api/webhooks/polar')).status).toBe(200)
    expect(middleware(request('/api/user/subscription/sync')).status).toBe(200)
    // Billboard APIs back the ticker/rails on allowlisted shell pages.
    expect(middleware(request('/api/billboard')).status).toBe(200)
    expect(middleware(request('/api/billboard/slots')).status).toBe(200)
    expect(middleware(request('/api/analytics/visitors')).status).toBe(200)
    expect(middleware(request('/api/analytics/hit')).status).toBe(200)
  })

  it('keeps the status observatory public while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // The status page must answer precisely when things look broken —
    // rewriting it to /maintenance would defeat it. Its data lane is an
    // exact-match allowlist entry; /api/device/status keeps riding the
    // /api/device/ rule instead.
    expect(rewriteTarget('/status')).toBeNull()
    expect(middleware(request('/status')).status).toBe(200)
    expect(middleware(request('/api/status')).status).toBe(200)
    expect(middleware(request('/api/analytics/visitors')).status).toBe(200)
  })

  it('serves the landing globe assets while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // The stylized globe on / builds from runtime fetches — if these rewrite
    // to /maintenance, production renders a bare ocean ball.
    expect(rewriteTarget('/geo/countries-110m.geojson')).toBeNull()
    expect(rewriteTarget('/models/clouds-puffy.glb')).toBeNull()
    expect(middleware(request('/geo/countries-110m.geojson')).status).toBe(200)
  })

  it('walls /shop /bag /settings behind sign-in while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Not the maintenance screen: a session would open these sectors, so
    // the visitor gets the sign-in wall instead of "under construction".
    expect(rewriteTarget('/shop')).toBe('/restricted')
    expect(rewriteTarget('/bag')).toBe('/restricted')
    expect(rewriteTarget('/settings')).toBe('/restricted')
    expect(rewriteTarget('/settings/account')).toBe('/restricted')
  })

  it('keeps /shop /bag /settings open for signed-in pilots while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Presence-only gate: the middleware never validates the token, so any
    // cribble_session cookie opens the shell — the data lanes behind it
    // still enforce real auth.
    const cookie = 'cribble_session=beta-tester'
    expect(rewriteTarget('/shop', cookie)).toBeNull()
    expect(rewriteTarget('/bag', cookie)).toBeNull()
    expect(rewriteTarget('/settings', cookie)).toBeNull()
    expect(rewriteTarget('/settings/privacy', cookie)).toBeNull()
  })

  it('does not rewrite anything when unlocked', () => {
    vi.stubEnv('SITE_LOCKED', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_LOCKED', 'false')
    expect(rewriteTarget('/shop')).toBeNull()
  })

  it('keeps lowercase /join/ invite links reachable while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(rewriteTarget('/join/CRIB-THDM-AVQZ')).toBeNull()
    expect(middleware(request('/join/CRIB-THDM-AVQZ')).status).toBe(200)
  })

  it('canonicalizes uppercase /JOIN/ invite links instead of the maintenance screen', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    const response = middleware(request('/JOIN/CRIB-THDM-AVQZ'))
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('https://cribble.dev/join/CRIB-THDM-AVQZ')
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('public profile HTTP semantics', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_LOCKED', 'false')
    vi.stubEnv('NEXT_PUBLIC_SITE_LOCKED', 'false')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rewrites a missing public profile with HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    const response = await middleware(new NextRequest('https://cribble.dev/u/does-not-exist'))

    expect(response.status).toBe(404)
    expect(new URL(response.headers.get('x-middleware-rewrite')!).pathname).toBe('/_profile-not-found')
  })

  it('leaves valid profiles and backend outages on the profile route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const valid = await middleware(new NextRequest('https://cribble.dev/u/ada'))
    const outage = await middleware(new NextRequest('https://cribble.dev/u/outage'))
    expect(valid.status).toBe(200)
    expect(outage.status).toBe(200)
    expect(valid.headers.get('x-middleware-rewrite')).toBeNull()
    expect(outage.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
