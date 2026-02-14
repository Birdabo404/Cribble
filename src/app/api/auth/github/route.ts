import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function GET(request: NextRequest) {
  try {
    const state = crypto.randomUUID()
    const clientId = process.env.GITHUB_CLIENT_ID!
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const redirectUri = process.env.GITHUB_REDIRECT_URI || `${appUrl}/api/auth/github/callback`

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
    return response
  } catch (error) {
    console.error('GitHub OAuth init error:', error)
    return NextResponse.json({ error: 'Failed to start GitHub login' }, { status: 500 })
  }
}

