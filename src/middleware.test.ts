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
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https: blob:; " +
        "connect-src 'self' https://*.supabase.co https://vitals.vercel-insights.com; " +
        "frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
        "frame-ancestors 'none'"
    )
  })

  it("omits 'unsafe-eval' from the production CSP", () => {
    vi.stubEnv('NODE_ENV', 'production')

    const response = middleware(new NextRequest('https://cribble.dev/login'))
    const csp = response.headers.get('content-security-policy')

    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com")
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

  it('keeps the settings hub open while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Settings left the modal stack for real /settings/* routes — same
    // allowlist class as /dashboard so the account menu deep-links land.
    expect(rewriteTarget('/settings')).toBeNull()
    expect(rewriteTarget('/settings/account')).toBeNull()
    expect(rewriteTarget('/settings/privacy')).toBeNull()
    expect(middleware(request('/api/user/settings')).status).toBe(200)
    expect(middleware(request('/api/user/delete')).status).toBe(200)
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

  it('leaves allowlisted pages alone while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(rewriteTarget('/leaderboard')).toBeNull()
    // Payments must survive the lock: the API lanes stay reachable so
    // Polar webhooks and checkout bounces keep landing.
    // The Team pitch page is publicly shareable while the beta is locked.
    expect(rewriteTarget('/teams')).toBeNull()
    // The team console is Polar's checkout success URL and its API lanes
    // back it — a mid-lock Team purchase must not land on /maintenance.
    expect(rewriteTarget('/team')).toBeNull()
    expect(rewriteTarget('/team/invites')).toBeNull()
    expect(middleware(request('/api/team/roster')).status).toBe(200)
    expect(middleware(request('/api/webhooks/polar')).status).toBe(200)
    expect(middleware(request('/api/user/subscription/sync')).status).toBe(200)
    // Bag + billboard shipped after the lock allowlist froze — keep them
    // reachable so new surfaces don't land on the void screen in beta.
    expect(rewriteTarget('/bag')).toBeNull()
    expect(rewriteTarget('/billboard')).toBeNull()
    expect(middleware(request('/api/billboard')).status).toBe(200)
    expect(middleware(request('/api/billboard/slots')).status).toBe(200)
  })

  it('walls /shop behind sign-in for signed-out visitors while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Not the maintenance screen: a session would open this sector, so
    // the visitor gets the sign-in wall instead of "under construction".
    expect(rewriteTarget('/shop')).toBe('/restricted')
  })

  it('keeps /shop open for signed-in pilots while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Presence-only gate: the middleware never validates the token, so any
    // cribble_session cookie opens the storefront shell — the data lanes
    // behind it still enforce real auth.
    expect(rewriteTarget('/shop', 'cribble_session=beta-tester')).toBeNull()
  })

  it('does not rewrite anything when unlocked', () => {
    vi.stubEnv('SITE_LOCKED', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_LOCKED', 'false')
    expect(rewriteTarget('/shop')).toBeNull()
  })
})
