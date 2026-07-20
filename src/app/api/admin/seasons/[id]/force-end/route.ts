import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Force-end the active season NOW (owner-only). Pulls ends_at to the
// current instant and runs season_tick() immediately, so the close takes
// the exact same path as a scheduled one: archive standings, placement
// notifications, auto-schedule the next season.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params
    const seasonId = Number(id)
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      return NextResponse.json({ error: 'Invalid season id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const reason = cleanReason(body.reason)
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason of at least 10 characters is required' },
        { status: 400 }
      )
    }

    const { data: season, error: loadError } = await supabase
      .from('seasons')
      .select('id, number, name, ends_at, status')
      .eq('id', seasonId)
      .maybeSingle()

    if (loadError) {
      console.error('[AdminSeasons] Force-end load failed:', loadError)
      return NextResponse.json({ error: 'Failed to load season' }, { status: 500 })
    }
    if (!season) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 })
    }
    if (season.status !== 'active') {
      return NextResponse.json(
        { error: 'Only the active season can be force-ended' },
        { status: 400 }
      )
    }

    const nowIso = new Date().toISOString()

    const tick = await withAudit(
      supabase,
      {
        adminUserId: staff.staff.userId,
        targetUserId: null,
        action: 'season.force_end',
        oldValues: { seasonId, number: season.number, ends_at: season.ends_at },
        newValues: { ends_at: nowIso },
        reason
      },
      async () => {
        const { error: updateError } = await supabase
          .from('seasons')
          .update({ ends_at: nowIso, updated_at: nowIso })
          .eq('id', seasonId)
          .eq('status', 'active')
        if (updateError) {
          throw new Error(`Force-end update failed: ${updateError.message}`)
        }

        const { data, error: tickError } = await supabase.rpc('season_tick')
        if (tickError) {
          throw new Error(`Season tick failed: ${tickError.message}`)
        }
        return data
      }
    )

    return NextResponse.json({ success: true, tick })
  } catch (error) {
    console.error('[AdminSeasons] Force-end error:', error)
    return NextResponse.json({ error: 'Failed to force-end season' }, { status: 500 })
  }
}
