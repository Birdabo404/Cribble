import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  // Create response
  const response = NextResponse.next()

  // ----- temporary site lock (hide unfinished routes) -----
  const locked = process.env.NEXT_PUBLIC_SITE_LOCKED === 'true'
  const p = request.nextUrl.pathname
  if (
    locked &&
    (p.startsWith('/dashboard') || p.startsWith('/leaderboard'))
  ) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  
  // Security Headers
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  
  // CSP Header (Content Security Policy)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://*.supabase.co https://vitals.vercel-insights.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
  
  response.headers.set('Content-Security-Policy', csp)

  // CORS for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const allowedOrigin = process.env.NODE_ENV === 'production'
      ? (process.env.NEXT_PUBLIC_DOMAIN || 'https://cribble.dev')
      : 'http://localhost:3000'
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret')
    response.headers.set('Access-Control-Max-Age', '86400')
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
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
} 