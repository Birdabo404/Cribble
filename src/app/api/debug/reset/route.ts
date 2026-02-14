import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ResetAction = 'reset_all'

/**
 * Dangerous reset endpoint - DEVELOPMENT ONLY.
 * Protected by: NODE_ENV check + session auth + confirmation token.
 */
export async function POST(request: NextRequest) {
  try {
    // Layer 1: Dev-only
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    // Layer 2: Must be authenticated
    const sessionToken = request.cookies.get('cribble_session')?.value
    if (!sessionToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data: session } = await supabase
      .from('user_sessions')
      .select('user_id')
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!session) {
      return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 })
    }

    // Layer 3: Confirmation token (env var if set, otherwise static phrase for dev)
    const expectedToken = process.env.DEBUG_RESET_TOKEN || 'RESET_ALL_DATA'
    const { action, confirmToken } = await request.json()

    if (confirmToken !== expectedToken) {
      return NextResponse.json(
        { success: false, error: 'Invalid confirmation token' },
        { status: 400 }
      )
    }

    if (action !== 'reset_all') {
      return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
      )
    }

    const results: Record<string, string | number> = {}
    const errors: string[] = []

    async function safeExec(label: string, fn: () => Promise<void>) {
      try {
        await fn()
        results[label] = 'ok'
      } catch (err: any) {
        const msg = err?.message || String(err)
        errors.push(`${label}: ${msg}`)
        results[label] = msg
      }
    }

    // Delete dependent rows first
    await safeExec('events_raw', async () => {
      await supabase.from('events_raw').delete().neq('id', 0)
    })

    await safeExec('extension_data_queue', async () => {
      await supabase.from('extension_data_queue').delete().neq('id', 0)
    })

    await safeExec('user_devices', async () => {
      await supabase.from('user_devices').delete().neq('id', 0)
    })

    await safeExec('user_scores', async () => {
      await supabase.from('user_scores').delete().neq('user_id', 0)
    })

    await safeExec('user_sessions', async () => {
      await supabase.from('user_sessions').delete().neq('user_id', 0)
    })

    // Reset users.total_score and last_extension_sync
    await safeExec('users_reset', async () => {
      await supabase
        .from('users')
        .update({
          total_score: 0,
          last_extension_sync: null,
          active_device_uuid: null
        })
        .neq('id', 0)
    })

    return NextResponse.json({
      success: errors.length === 0,
      results,
      errors: errors.length ? errors : undefined
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error?.message || String(error)
      },
      { status: 500 }
    )
  }
}
