import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import crypto from 'crypto'
import { resolveAppUrl, resolveGithubRedirectUri } from '@/lib/appUrl'
import { isAllowlistedAdmin } from '@/lib/adminAuth'
import { checkRateLimit, rateLimitConfigs } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request)

  // Same convention as the init route: OAuth callbacks are navigations, so
  // rate-limited attempts land on /login with an error instead of a raw 429.
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
  if (!rateLimitResult.success) {
    return NextResponse.redirect(`${appUrl}/login?error=github_rate_limited`)
  }

  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      console.error('GitHub OAuth error:', error)
      return NextResponse.redirect(`${appUrl}/login?error=github_oauth_denied`)
    }
    if (!code) {
      return NextResponse.redirect(`${appUrl}/login?error=github_missing_code`)
    }

    const storedState = request.cookies.get('github_oauth_state')?.value
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(`${appUrl}/login?error=github_invalid_state`)
    }

    // Exchange code for token
    const redirectUri = resolveGithubRedirectUri(request, appUrl)

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
      // Never log the response body: it can carry tokens or account details.
      console.error(`GitHub token exchange failed with status ${tokenRes.status}`)
      return NextResponse.redirect(`${appUrl}/login?error=github_token_failed`)
    }

    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token
    if (!accessToken) {
      return NextResponse.redirect(`${appUrl}/login?error=github_no_token`)
    }

    // Fetch user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' }
    })
    if (!userRes.ok) {
      // Never log the response body: it can carry tokens or account details.
      console.error(`GitHub user fetch failed with status ${userRes.status}`)
      return NextResponse.redirect(`${appUrl}/login?error=github_user_failed`)
    }
    const ghUser = await userRes.json()

    const providerId = String(ghUser.id)
    const username = ghUser.login || `gh_${providerId}`
    const displayName = ghUser.name || username
    const avatar = ghUser.avatar_url || ''

    // Reuse existing twitter_* columns to avoid schema changes
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('twitter_id', providerId)
      .single()

    let user
    if (existingUser) {
      // Banned accounts stop at the door: no profile refresh, no session.
      // (Their live sessions were already destroyed when the ban landed.)
      if (existingUser.status === 'banned') {
        return NextResponse.redirect(`${appUrl}/login?error=account_banned`)
      }

      // Deliberately not storing the GitHub access token: the app never uses
      // it after login, so persisting it would only widen the blast radius of
      // a database leak. Empty string (the column is NOT NULL) also scrubs
      // tokens stored by older versions.
      const { data: updated, error: updateError } = await supabase
        .from('users')
        .update({
          twitter_access_token: '',
          twitter_username: username,
          twitter_name: displayName,
          twitter_profile_image: avatar,
          last_login: new Date().toISOString(),
          // Keep the env allowlist as a recovery path: admins listed in
          // ADMIN_USERNAMES regain the flag on every login.
          ...(isAllowlistedAdmin(username) ? { is_admin: true } : {})
        })
        .eq('twitter_id', providerId)
        .select()
        .single()
      if (updateError) {
        console.error('Failed to update GitHub user:', updateError)
        return NextResponse.redirect(`${appUrl}/login?error=github_user_update_failed`)
      }
      user = updated
    } else {
      // New signups are invite-gated. The code was stashed in a cookie by
      // /api/auth/github before the OAuth redirect.
      const inviteCode = request.cookies.get('cribble_invite')?.value
      if (!inviteCode) {
        return NextResponse.redirect(`${appUrl}/login?error=invite_required`)
      }

      // Atomically claims one use of the code; returns null when the code
      // is unknown, revoked, expired, or fully used.
      const { data: inviteCodeId, error: redeemError } = await supabase.rpc(
        'redeem_invite_code',
        { p_code: inviteCode }
      )
      if (redeemError) {
        console.error('Invite redemption failed:', redeemError)
        return NextResponse.redirect(`${appUrl}/login?error=invite_check_failed`)
      }
      if (!inviteCodeId) {
        return NextResponse.redirect(`${appUrl}/login?error=invite_invalid`)
      }

      const { data: created, error: insertError } = await supabase
        .from('users')
        .insert({
          twitter_id: providerId,
          twitter_access_token: '',
          twitter_username: username,
          twitter_name: displayName,
          twitter_profile_image: avatar,
          is_admin: isAllowlistedAdmin(username),
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString()
        })
        .select()
        .single()
      if (insertError) {
        console.error('Failed to create GitHub user:', insertError)
        // Give the claimed use back so the invite still works on retry.
        const { data: invite } = await supabase
          .from('invite_codes')
          .select('use_count')
          .eq('id', inviteCodeId)
          .single()
        if (invite && invite.use_count > 0) {
          await supabase
            .from('invite_codes')
            .update({ use_count: invite.use_count - 1 })
            .eq('id', inviteCodeId)
        }
        return NextResponse.redirect(`${appUrl}/login?error=github_user_create_failed`)
      }
      user = created

      const { error: redemptionLogError } = await supabase
        .from('invite_redemptions')
        .insert({ invite_code_id: inviteCodeId, user_id: user.id })
      if (redemptionLogError) {
        console.error('Failed to log invite redemption:', redemptionLogError)
      }
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
      return NextResponse.redirect(`${appUrl}/login?error=session_creation_failed`)
    }

    // Land every successful login on /welcome. That page plays the boot
    // animation, then either runs the onboarding wizard (first-time users)
    // or bounces straight to the dashboard (returning users).
    const response = NextResponse.redirect(`${appUrl}/welcome`)
    response.cookies.set('cribble_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60
    })
    response.cookies.delete('github_oauth_state')
    response.cookies.delete('cribble_invite')
    return response
  } catch (err) {
    console.error('GitHub OAuth callback error:', err)
    return NextResponse.redirect(`${appUrl}/login?error=github_callback_failed`)
  }
}
