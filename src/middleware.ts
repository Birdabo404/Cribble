import { NextRequest, NextResponse } from 'next/server'
import { canonicalizeJoinPathname } from '@/lib/joinPath'
import { isAllowedDuringLock, isSiteLocked } from '@/lib/siteLock'

export function middleware(request: NextRequest) {
  // Create response
  const response = NextResponse.next()
  const pathname = request.nextUrl.pathname
  const isApiRoute = pathname.startsWith('/api/')

  // Security Headers
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  // CSP Header (Content Security Policy)
  // 'unsafe-eval' is only needed by Next.js dev tooling (fast refresh /
  // eval source maps). No production dependency evals code, so drop it there.
  const scriptSrc =
    process.env.NODE_ENV !== 'production'
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://gc.zgo.at"
      : "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://gc.zgo.at"
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://*.supabase.co https://vitals.vercel-insights.com https://*.goatcounter.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')

  response.headers.set('Content-Security-Policy', csp)

  // /JOIN/CODE (any casing) → /join/CODE so the invite page matches and
  // the site-lock allowlist sees the canonical path. Do this before the
  // lock rewrite or uppercase links land on /maintenance.
  const canonicalJoin = canonicalizeJoinPathname(pathname)
  if (canonicalJoin) {
    const url = request.nextUrl.clone()
    url.pathname = canonicalJoin
    return NextResponse.redirect(url, { status: 308, headers: response.headers })
  }

  // CORS for API routes
  if (isApiRoute) {
    const allowedOrigin = process.env.NODE_ENV === 'production'
      ? (process.env.NEXT_PUBLIC_DOMAIN || 'https://cribble.dev')
      : 'http://localhost:3000'
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret')
    response.headers.set('Access-Control-Max-Age', '86400')
  }

  const locked = isSiteLocked()
  // Presence-only check — sessionAuth validates the token on every data
  // route; here it just decides whether lock-time /shop is yours to see.
  const hasSession = request.cookies.has('cribble_session')

  // Signed-in visitors skip the marketing hero — land on their profile.
  if (pathname === '/' && hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = '/profile'
    return NextResponse.redirect(url, { status: 307, headers: response.headers })
  }

  const allowedDuringLock = isAllowedDuringLock(pathname, hasSession)

  if (locked && !allowedDuringLock) {
    if (isApiRoute) {
      return new NextResponse('Not found', { status: 404, headers: response.headers })
    }

    // Locked sectors render a void screen in place — the URL is preserved
    // so the visitor knows where they are, and refreshing after launch
    // (or after signing in) lands on the real page. Sectors that a session
    // would open get the sign-in wall; everything else is under works.
    const url = request.nextUrl.clone()
    url.pathname = isAllowedDuringLock(pathname, true) ? '/restricted' : '/maintenance'
    return NextResponse.rewrite(url, { headers: response.headers })
  }

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: response.headers })
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon assets / manifest / robots / sitemap
     */
    '/((?!_next/static|_next/image|favicon.ico|favicon.png|site.webmanifest|robots.txt|sitemap.xml).*)',
  ],
} 