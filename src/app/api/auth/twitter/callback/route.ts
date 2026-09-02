import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { resolveAppUrl, resolveTwitterRedirectUri } from '@/lib/appUrl'
import { ensureHouseEntitlements } from '@/lib/houseEntitlements'
import { publicProfileCacheTag } from '@/lib/publicProfile'
import { checkRateLimit, rateLimitConfigs } from '@/lib/rateLimit'
import { runTeamIdentityTripwire } from '@/lib/teamTripwire'
import {
  logSignupInviteRedemption,
  redeemedInviteId,
  redeemSignupInvite,
  releaseSignupInviteUse,
  signupInviteRedirectError
} from '@/lib/signupInvite'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// X (Twitter) OAuth callback. Mirrors the GitHub callback: returning users
// (matched on twitter_id) sign straight in. First-time signups are open;
// a cribble_invite cookie still redeems staff keys and friend referrals.
export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request)

  // Same convention as the init route: OAuth callbacks are navigations, so
  // rate-limited attempts land on /login with an error instead of a raw 429.
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
  if (!rateLimitResult.success) {
    return NextResponse.redirect(`${appUrl}/login?error=twitter_rate_limited`)
  }

  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      console.error('X OAuth error:', error)
      return NextResponse.redirect(`${appUrl}/login?error=twitter_oauth_denied`)
    }
    if (!code) {
      return NextResponse.redirect(`${appUrl}/login?error=twitter_missing_code`)
    }

    const storedState = request.cookies.get('twitter_oauth_state')?.value
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(`${appUrl}/login?error=twitter_invalid_state`)
    }

    const codeVerifier = request.cookies.get('twitter_code_verifier')?.value
    if (!codeVerifier) {
      return NextResponse.redirect(`${appUrl}/login?error=twitter_missing_verifier`)
    }

    // Exchange code for token (PKCE). Confidential clients authenticate with
    // Basic auth; public clients rely on client_id in the body.
    const clientId = process.env.TWITTER_CLIENT_ID!
    const clientSecret = process.env.TWITTER_CLIENT_SECRET
    const redirectUri = resolveTwitterRedirectUri(request, appUrl)

    const tokenHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
    if (clientSecret) {
      tokenHeaders.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    }

    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: tokenHeaders,
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: clientId
      })
    })

    if (!tokenRes.ok) {
      // Never log the response body: it can carry tokens or account details.
      console.error(`X token exchange failed with status ${tokenRes.status}`)
      return NextResponse.redirect(`${appUrl}/login?error=twitter_token_failed`)
    }

    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token
    if (!accessToken) {
      return NextResponse.redirect(`${appUrl}/login?error=twitter_no_token`)
    }

    // Fetch user profile
    const userRes = await fetch(
      'https://api.x.com/2/users/me?user.fields=profile_image_url',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!userRes.ok) {
      // Never log the response body: it can carry tokens or account details.
      console.error(`X user fetch failed with status ${userRes.status}`)
      return NextResponse.redirect(`${appUrl}/login?error=twitter_user_failed`)
    }
    const xUser = (await userRes.json())?.data
    if (!xUser?.id) {
      return NextResponse.redirect(`${appUrl}/login?error=twitter_user_failed`)
    }

    const providerId = String(xUser.id)
    const username = xUser.username || `x_${providerId}`
    const displayName = xUser.name || username
    const avatar = xUser.profile_image_url || ''

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

      // Like the GitHub flow, the access token is deliberately not stored:
      // the app never uses it after login. Empty string also scrubs tokens
      // persisted by the old Twitter flow.
      //
      // Unlike GitHub, X logins never re-grant admin from ADMIN_USERNAMES:
      // that allowlist holds GitHub usernames, and the matching X handle may
      // belong to someone else entirely.
      const { data: updated, error: updateError } = await supabase
        .from('users')
        .update({
          twitter_access_token: '',
          twitter_username: username,
          twitter_name: displayName,
          twitter_profile_image: avatar,
          last_login: new Date().toISOString()
        })
        .eq('twitter_id', providerId)
        .select()
        .single()
      if (updateError) {
        console.error('Failed to update X user:', updateError)
        return NextResponse.redirect(`${appUrl}/login?error=twitter_user_update_failed`)
      }
      user = updated

      // The update above is the only path that refreshes handle, display
      // name and avatar — bust the cached public profile (old handle too,
      // when it changed) so the refreshed identity shows up right away.
      revalidateTag(publicProfileCacheTag(username))
      const previousHandle = (existingUser.twitter_username as string | null) ?? ''
      if (previousHandle && previousHandle.toLowerCase() !== username.toLowerCase()) {
        revalidateTag(publicProfileCacheTag(previousHandle))
      }

      // Anti-impersonation tripwire: the update above re-synced handle,
      // display name and avatar from X — if this account is an APPROVED
      // team and any of them genuinely changed, its approval drops back
      // to pending and staff are alerted. Never throws; a tripwire
      // failure must not break login.
      await runTeamIdentityTripwire(supabase, existingUser, {
        username,
        name: displayName,
        avatar
      })
    } else {
      // Open signup. A cribble_invite cookie still redeems — staff keys
      // and friend referrals both land here so referral points still pay.
      const invite = await redeemSignupInvite(
        supabase,
        request.cookies.get('cribble_invite')?.value
      )
      const inviteError = signupInviteRedirectError(invite)
      if (inviteError) {
        return NextResponse.redirect(`${appUrl}/login?error=${inviteError}`)
      }
      const inviteCodeId = redeemedInviteId(invite)

      const { data: created, error: insertError } = await supabase
        .from('users')
        .insert({
          twitter_id: providerId,
          twitter_access_token: '',
          twitter_username: username,
          twitter_name: displayName,
          twitter_profile_image: avatar,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString()
        })
        .select()
        .single()
      if (insertError) {
        console.error('Failed to create X user:', insertError)
        if (inviteCodeId) await releaseSignupInviteUse(supabase, inviteCodeId)
        return NextResponse.redirect(`${appUrl}/login?error=twitter_user_create_failed`)
      }
      user = created

      if (inviteCodeId) {
        await logSignupInviteRedemption(supabase, inviteCodeId, created.id)
      }
    }

    // House complimentary Pro / Team — never billed. Re-applies on every
    // login if Polar, an admin action, or the tripwire knocked the row
    // off. Never throws.
    await ensureHouseEntitlements(supabase, user)

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
      console.error('Failed to create session (twitter):', sessionError)
      return NextResponse.redirect(`${appUrl}/login?error=session_creation_failed`)
    }

    // Land every successful login on /welcome, same as GitHub.
    const response = NextResponse.redirect(`${appUrl}/welcome`)
    response.cookies.set('cribble_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60
    })
    response.cookies.delete('twitter_oauth_state')
    response.cookies.delete('twitter_code_verifier')
    response.cookies.delete('cribble_invite')
    return response
  } catch (err) {
    console.error('X OAuth callback error:', err)
    return NextResponse.redirect(`${appUrl}/login?error=twitter_callback_failed`)
  }
}
