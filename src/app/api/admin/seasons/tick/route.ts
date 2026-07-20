import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// "Run tick now" (owner-only): executes the same idempotent season_tick()
// that pg_cron fires every 15 minutes. Useful right after editing the
// calendar instead of waiting out the next scheduled pass. No reason
// required — the tick never does anything the calendar doesn't already
// say to do — but the press itself is still audited.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const staff = await getStaffUser(request, 'season.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    await logAdminAction(supabase, {
      adminUserId: staff.staff.userId,
      targetUserId: null,
      action: 'season.tick',
      newValues: { trigger: 'admin_panel' }
    })

    const { data, error } = await supabase.rpc('season_tick')
    if (error) {
      console.error('[AdminSeasons] Tick failed:', error)
      return NextResponse.json({ error: 'Season tick failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, tick: data })
  } catch (error) {
    console.error('[AdminSeasons] Tick error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
