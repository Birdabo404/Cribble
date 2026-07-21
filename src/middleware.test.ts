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

    const response = middleware(new NextRequest('https://cribble.dev/api/user/delete'))

    expect(response.status).toBe(404)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
})

describe('middleware site lock', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const request = (path: string) => new NextRequest(`https://cribble.dev${path}`)

  const rewriteTarget = (path: string) => {
    const rewrite = middleware(request(path)).headers.get('x-middleware-rewrite')
    return rewrite ? new URL(rewrite).pathname : null
  }

  it('rewrites locked sectors to the maintenance screen', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    // Any page outside the allowlist rewrites in place. /shop used to be
    // the example here but is now allowlisted so payments survive a lock
    // (covered below).
    expect(rewriteTarget('/settings')).toBe('/maintenance')
  })

  it('keeps the maintenance screen itself reachable while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(rewriteTarget('/maintenance')).toBeNull()
    expect(middleware(request('/maintenance')).status).toBe(200)
  })

  it('still 404s locked API routes', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(middleware(request('/api/shop/checkout')).status).toBe(404)
  })

  it('leaves allowlisted pages alone while locked', () => {
    vi.stubEnv('SITE_LOCKED', '1')
    expect(rewriteTarget('/leaderboard')).toBeNull()
    // Payments must survive the lock: the shop page and its API routes
    // stay reachable so Polar webhooks and checkout bounces keep landing.
    expect(rewriteTarget('/shop')).toBeNull()
    expect(middleware(request('/api/webhooks/polar')).status).toBe(200)
    expect(middleware(request('/api/user/subscription/sync')).status).toBe(200)
  })

  it('does not rewrite anything when unlocked', () => {
    vi.stubEnv('SITE_LOCKED', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_LOCKED', 'false')
    expect(rewriteTarget('/shop')).toBeNull()
  })
})
