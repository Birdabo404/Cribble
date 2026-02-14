import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Generate code verifier and challenge for PKCE
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export async function GET(request: NextRequest) {
  try {
    // Generate a secure state parameter for CSRF protection
    const state = crypto.randomUUID()
    
    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    
    // Store state in session/cookie for validation later
    const response = NextResponse.redirect(
      `https://twitter.com/i/oauth2/authorize?` + new URLSearchParams({
        response_type: 'code',
        client_id: process.env.TWITTER_CLIENT_ID!,
        redirect_uri: process.env.TWITTER_REDIRECT_URI!,
        scope: 'users.read tweet.read offline.access',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      }).toString()
    )
    
    // Set state cookie for verification
    response.cookies.set('twitter_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600 // 10 minutes
    })
    
    // Set code verifier cookie for PKCE
    response.cookies.set('twitter_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600 // 10 minutes
    })
    
    return response
  } catch (error) {
    console.error('Twitter OAuth init error:', error)
    return NextResponse.json(
      { error: 'Failed to initialize Twitter OAuth' },
      { status: 500 }
    )
  }
} 