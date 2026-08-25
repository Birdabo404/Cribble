import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { resolveAppUrl, resolveTwitterRedirectUri } from '@/lib/appUrl'
import { normalizeInviteCode } from '@/lib/inviteCodes'
import { checkRateLimit, rateLimitConfigs } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

// X (Twitter) OAuth 2.0 with PKCE. Sign-in is open: the callback creates
// an account with or without an invite. When ?invite= is present we stash
// it so staff keys and friend referrals still redeem (and still pay
// referral points) on first signup.
export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request)

  // OAuth flows are browser navigations, so a rate-limited attempt lands
  // back on /login with a visible error rather than a raw 429 body.
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
  if (!rateLimitResult.success) {
    return NextResponse.redirect(`${appUrl}/login?error=twitter_rate_limited`)
  }

  try {
    const clientId = process.env.TWITTER_CLIENT_ID
    if (!clientId) {
      return NextResponse.redirect(`${appUrl}/login?error=twitter_not_configured`)
    }

    const state = crypto.randomUUID()
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const redirectUri = resolveTwitterRedirectUri(request, appUrl)
    const inviteCode = request.nextUrl.searchParams.get('invite')

    const authUrl = `https://x.com/i/oauth2/authorize?` + new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'users.read tweet.read',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    }).toString()

    const response = NextResponse.redirect(authUrl)
    response.cookies.set('twitter_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600
    })
    response.cookies.set('twitter_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600
    })
    // Carry the invite code across the OAuth round-trip. It is only
    // validated (and consumed) in the callback for first-time signups.
    if (inviteCode) {
      response.cookies.set('cribble_invite', normalizeInviteCode(inviteCode), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600
      })
    } else {
      response.cookies.delete('cribble_invite')
    }
    return response
  } catch (error) {
    console.error('X OAuth init error:', error)
    return NextResponse.json({ error: 'Failed to start X login' }, { status: 500 })
  }
}
