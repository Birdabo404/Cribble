import { NextRequest } from 'next/server'

/** App origin for redirects — in dev, follow the incoming Host header (port-safe). */
export function resolveAppUrl(request: NextRequest): string {
  if (process.env.NODE_ENV !== 'production') {
    const host = request.headers.get('host')
    if (host) {
      const protocol = request.headers.get('x-forwarded-proto') || 'http'
      return `${protocol}://${host}`
    }
  }

  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_DOMAIN ||
    'http://localhost:3000'
  )
}

/** GitHub OAuth callback URL registered with the GitHub OAuth app. */
export function resolveGithubRedirectUri(request: NextRequest, appUrl: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return `${appUrl}/api/auth/github/callback`
  }

  return process.env.GITHUB_REDIRECT_URI || `${appUrl}/api/auth/github/callback`
}
