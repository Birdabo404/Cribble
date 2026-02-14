import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
    
    // Check for Twitter OAuth errors
    if (error) {
      console.error('Twitter OAuth error:', error)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=oauth_denied`)
    }
    
    if (!code) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=missing_code`)
    }
    
    // Verify state parameter against stored cookie
    const storedState = request.cookies.get('twitter_oauth_state')?.value
    if (!storedState || storedState !== state) {
      console.error('State mismatch:', { stored: storedState, received: state })
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=invalid_state`)
    }
    
    // Get the code verifier from cookie
    const codeVerifier = request.cookies.get('twitter_code_verifier')?.value
    if (!codeVerifier) {
      console.error('Missing code verifier')
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=missing_code_verifier`)
    }
    
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.TWITTER_REDIRECT_URI!,
        code_verifier: codeVerifier
      })
    })
    
    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text()
      console.error('Token exchange failed:', errorData)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=token_exchange_failed`)
    }
    
    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token
    
    // Get user data from Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,public_metrics', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })
    
    if (!userResponse.ok) {
      const errorBody = await userResponse.text()
      console.error('Failed to fetch user data:', errorBody)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=user_fetch_failed`)
    }
    
    const userData = await userResponse.json()
    const twitterUser = userData.data
    
    // Check if user exists in our database
    let { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('twitter_id', twitterUser.id)
      .single()
    
    let user
    if (existingUser) {
      // Update existing user
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          twitter_access_token: accessToken,
          twitter_username: twitterUser.username,
          twitter_name: twitterUser.name,
          twitter_profile_image: twitterUser.profile_image_url,
          last_login: new Date().toISOString()
        })
        .eq('twitter_id', twitterUser.id)
        .select()
        .single()
      
      if (updateError) {
        console.error('Failed to update user:', updateError)
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=user_update_failed`)
      }
      user = updatedUser
    } else {
      // Create new user
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          twitter_id: twitterUser.id,
          twitter_username: twitterUser.username,
          twitter_name: twitterUser.name,
          twitter_profile_image: twitterUser.profile_image_url,
          twitter_access_token: accessToken,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString()
        })
        .select()
        .single()
      
      if (createError) {
        console.error('Failed to create user:', createError)
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=user_creation_failed`)
      }
      user = newUser
    }
    
    // Create session
    const sessionToken = crypto.randomUUID()
    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        session_token: sessionToken,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        created_at: new Date().toISOString()
      })
    
    if (sessionError) {
      console.error('Failed to create session:', sessionError)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=session_creation_failed`)
    }
    
    // Set session cookie and redirect to dashboard
    const response = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`)
    response.cookies.set('cribble_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 // 30 days
    })
    
    // Clear the OAuth state and code verifier cookies
    response.cookies.delete('twitter_oauth_state')
    response.cookies.delete('twitter_code_verifier')
    
    return response
    
  } catch (error) {
    console.error('Twitter OAuth callback error:', error)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?error=oauth_callback_failed`)
  }
} 