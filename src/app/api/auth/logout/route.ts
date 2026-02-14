import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // Get session token from cookie
    const sessionToken = request.cookies.get('cribble_session')?.value
    
    if (sessionToken) {
      // Delete session from database
      await supabase
        .from('user_sessions')
        .delete()
        .eq('session_token', sessionToken)
    }
    
    // Clear the session cookie
    const response = NextResponse.json({ message: 'Logged out successfully' })
    response.cookies.delete('cribble_session')
    
    return response
    
  } catch (error) {
    console.error('Logout API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 