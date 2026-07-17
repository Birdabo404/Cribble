import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'
import { getDebugStaffUser, hasValidDebugToken } from '@/lib/debugRouteAuth'
import { cleanReason } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

const supabase = createServiceClient()

/**
 * Dangerous reset endpoint - explicit local opt-in only.
 * Protected by: development + feature flag + owner role + unique token.
 */
export async function POST(request: NextRequest) {
  try {
    const staff = await getDebugStaffUser(request)
    if (!staff.ok) {
      return NextResponse.json({ success: false, error: staff.error }, { status: staff.status })
    }

    const body = await request.json().catch(() => ({}))
    const { action, confirmToken } = body
    const reason = cleanReason(body.reason)

    if (!hasValidDebugToken(confirmToken, 'DEBUG_RESET_TOKEN')) {
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
    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'A reason of at least 10 characters is required' },
        { status: 400 }
      )
    }

    const results: Record<string, string | number> = {}
    const errors: string[] = []

    const safeExec = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn()
        results[label] = 'ok'
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${label}: ${msg}`)
        results[label] = msg
      }
    }

    // Audit first and fail closed. This reset is intentionally multi-step,
    // so the row records the attempt even if a later table operation only
    // partially succeeds.
    await logAdminAction(supabase, {
      adminUserId: staff.staff.userId,
      targetUserId: null,
      action: 'debug.reset_all',
      oldValues: { scope: ['events_raw', 'user_devices', 'user_scores', 'user_sessions'] },
      newValues: { intended_result: 'clear development analytics data' },
      reason
    })

    // Delete dependent rows first
    await safeExec('events_raw', async () => {
      const { error } = await supabase.from('events_raw').delete().neq('id', 0)
      if (error) throw new Error(error.message)
    })

    await safeExec('user_devices', async () => {
      const { error } = await supabase.from('user_devices').delete().neq('id', 0)
      if (error) throw new Error(error.message)
    })

    await safeExec('user_scores', async () => {
      const { error } = await supabase.from('user_scores').delete().neq('user_id', 0)
      if (error) throw new Error(error.message)
    })

    await safeExec('user_sessions', async () => {
      const { error } = await supabase.from('user_sessions').delete().neq('user_id', 0)
      if (error) throw new Error(error.message)
    })

    // Reset users.total_score and last_extension_sync
    await safeExec('users_reset', async () => {
      const { error } = await supabase
        .from('users')
        .update({
          total_score: 0,
          last_extension_sync: null,
          active_device_uuid: null
        })
        .neq('id', 0)
      if (error) throw new Error(error.message)
    })

    return NextResponse.json({
      success: errors.length === 0,
      results,
      errors: errors.length ? errors : undefined
    })
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
