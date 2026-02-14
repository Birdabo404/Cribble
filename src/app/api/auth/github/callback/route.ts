import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      console.error('GitHub OAuth error:', error)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_oauth_denied`)
    }
    if (!code) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_missing_code`)
    }

    const storedState = request.cookies.get('github_oauth_state')?.value
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_invalid_state`)
    }

    // Exchange code for token
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const redirectUri = process.env.GITHUB_REDIRECT_URI || `${appUrl}/api/auth/github/callback`

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID!,
        client_secret: process.env.GITHUB_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri
      })
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.error('GitHub token exchange failed:', text)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_token_failed`)
    }

    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token
    if (!accessToken) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_no_token`)
    }

    // Fetch user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' }
    })
    if (!userRes.ok) {
      const text = await userRes.text()
      console.error('GitHub user fetch failed:', text)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_user_failed`)
    }
    const ghUser = await userRes.json()

    const providerId = String(ghUser.id)
    const username = ghUser.login || `gh_${providerId}`
    const displayName = ghUser.name || username
    const avatar = ghUser.avatar_url || ''

    // Reuse existing twitter_* columns to avoid schema changes
    let { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('twitter_id', providerId)
      .single()

    let user
    if (existingUser) {
      const { data: updated, error: updateError } = await supabase
        .from('users')
        .update({
          twitter_access_token: accessToken,
          twitter_username: username,
          twitter_name: displayName,
          twitter_profile_image: avatar,
          last_login: new Date().toISOString()
        })
        .eq('twitter_id', providerId)
        .select()
        .single()
      if (updateError) {
        console.error('Failed to update GitHub user:', updateError)
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_user_update_failed`)
      }
      user = updated
    } else {
      const { data: created, error: insertError } = await supabase
        .from('users')
        .insert({
          twitter_id: providerId,
          twitter_username: username,
          twitter_name: displayName,
          twitter_profile_image: avatar,
          twitter_access_token: accessToken,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString()
        })
        .select()
        .single()
      if (insertError) {
        console.error('Failed to create GitHub user:', insertError)
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_user_create_failed`)
      }
      user = created
    }

    // Create session
    const sessionToken = crypto.randomUUID()
    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        session_token: sessionToken,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      })

    if (sessionError) {
      console.error('Failed to create session (github):', sessionError)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=session_creation_failed`)
    }

    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`)
    response.cookies.set('cribble_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60
    })
    response.cookies.delete('github_oauth_state')
    return response
  } catch (err) {
    console.error('GitHub OAuth callback error:', err)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=github_callback_failed`)
  }
}

