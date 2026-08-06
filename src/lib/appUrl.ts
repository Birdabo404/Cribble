import { NextRequest } from 'next/server'

/** Canonical public origin — mirrors the NEXT_PUBLIC_DOMAIN fallback in
 *  middleware.ts. */
const PRODUCTION_ORIGIN = 'https://cribble.dev'

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    )
  } catch {
    return true
  }
}

/**
 * Origin for links that leave the app (referral invites, X intent posts).
 * These get shared publicly, so they must always carry the canonical
 * public domain — even when minted from a dev server, where the app-url
 * envs legitimately point at localhost for OAuth. Local/unparsable env
 * values are skipped rather than trusted.
 */
export function resolveShareOrigin(): string {
  for (const candidate of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_DOMAIN]) {
    if (candidate && !isLocalOrigin(candidate)) return candidate.replace(/\/+$/, '')
  }
  return PRODUCTION_ORIGIN
}

/** App origin for redirects and OAuth callbacks — unlike share links, these
 *  must stay on the host the visitor actually hit. Dev follows the incoming
 *  Host header (port-safe). Production prefers the canonical app-url env,
 *  then falls back to the request origin — never to localhost, which must
 *  not leak into redirects minted in prod. */
export function resolveAppUrl(request: NextRequest): string {
  if (process.env.NODE_ENV !== 'production') {
    const host = request.headers.get('host')
    if (host) {
      const protocol = request.headers.get('x-forwarded-proto') || 'http'
      return `${protocol}://${host}`
    }
    return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  }

  const canonical = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_DOMAIN
  if (canonical) return canonical

  const host = request.headers.get('host')
  if (host) {
    const protocol = request.headers.get('x-forwarded-proto') || 'https'
    return `${protocol}://${host}`
  }

  // Unreachable in practice (HTTP requests always carry Host); kept so the
  // signature stays total.
  return 'http://localhost:3000'
}

/** GitHub OAuth callback URL registered with the GitHub OAuth app. */
export function resolveGithubRedirectUri(request: NextRequest, appUrl: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return `${appUrl}/api/auth/github/callback`
  }

  return process.env.GITHUB_REDIRECT_URI || `${appUrl}/api/auth/github/callback`
}

/** X (Twitter) OAuth callback URL registered with the X developer app. */
export function resolveTwitterRedirectUri(request: NextRequest, appUrl: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return `${appUrl}/api/auth/twitter/callback`
  }

  return process.env.TWITTER_REDIRECT_URI || `${appUrl}/api/auth/twitter/callback`
}
