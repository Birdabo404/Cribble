import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { resolveAppUrl, resolveGithubRedirectUri } from '@/lib/appUrl'
import { normalizeInviteCode } from '@/lib/inviteCodes'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const state = crypto.randomUUID()
    const clientId = process.env.GITHUB_CLIENT_ID!
    const appUrl = resolveAppUrl(request)
    const redirectUri = resolveGithubRedirectUri(request, appUrl)
    const inviteCode = request.nextUrl.searchParams.get('invite')

    const authUrl = `https://github.com/login/oauth/authorize?` + new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state
    }).toString()

    const response = NextResponse.redirect(authUrl)
    response.cookies.set('github_oauth_state', state, {
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
    console.error('GitHub OAuth init error:', error)
    return NextResponse.json({ error: 'Failed to start GitHub login' }, { status: 500 })
  }
}
