import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function DELETE(request: NextRequest) {
  try {
    // Get session token from cookie
    const sessionToken = request.cookies.get('cribble_session')?.value

    if (!sessionToken) {
      return NextResponse.json(
        { error: 'No session found' },
        { status: 401 }
      )
    }

    // Find active session
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('user_id')
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
      )
    }

    const userId = session.user_id

    console.log(`Deleting account for user ${userId}`)

    // Delete all user data in correct order (due to foreign key constraints)

    // 1. Delete events_raw
    const { error: eventsError } = await supabase
      .from('events_raw')
      .delete()
      .eq('user_id', userId)

    if (eventsError) {
      console.error('Failed to delete events:', eventsError)
    }

    // 2. Delete user devices
    await supabase
      .from('user_devices')
      .delete()
      .eq('user_id', userId)

    // 4. Delete user scores
    await supabase
      .from('user_scores')
      .delete()
      .eq('user_id', userId)

    // 5. Delete user sessions
    await supabase
      .from('user_sessions')
      .delete()
      .eq('user_id', userId)

    // 6. Delete user
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId)

    if (deleteError) {
      console.error('Failed to delete user:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete account' },
        { status: 500 }
      )
    }

    console.log(`Account deleted successfully for user ${userId}`)

    // Clear the session cookie
    const response = NextResponse.json({
      success: true,
      message: 'Account deleted successfully'
    })
    response.cookies.delete('cribble_session')

    return response

  } catch (error) {
    console.error('Delete account error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
