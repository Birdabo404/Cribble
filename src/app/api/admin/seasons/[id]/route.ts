import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { cleanSeasonName, parseSeasonInstant } from '@/lib/adminSeasons'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { SEASON_COLUMNS } from '@/lib/seasonServer'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Edit one season (owner-only). Upcoming seasons are fully editable;
// active seasons can be renamed and have their end moved (extend or cut
// short — the tick closes it on the next pass if the new end is in the
// past); completed seasons are immutable history.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function PATCH(
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
      .select(SEASON_COLUMNS)
      .eq('id', seasonId)
      .maybeSingle()

    if (loadError) {
      console.error('[AdminSeasons] Load failed:', loadError)
      return NextResponse.json({ error: 'Failed to load season' }, { status: 500 })
    }
    if (!season) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 })
    }
    if (season.status === 'complete') {
      return NextResponse.json(
        { error: 'Completed seasons are immutable' },
        { status: 400 }
      )
    }

    const updates: Record<string, string> = {}
    const oldValues: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = cleanSeasonName(body.name)
      if (!name) {
        return NextResponse.json(
          { error: 'Name must be 3–40 characters' },
          { status: 400 }
        )
      }
      if (name !== season.name) {
        updates.name = name
        oldValues.name = season.name
      }
    }

    if (body.startsAt !== undefined) {
      if (season.status !== 'upcoming') {
        return NextResponse.json(
          { error: 'Only upcoming seasons can change their start' },
          { status: 400 }
        )
      }
      const startsAt = parseSeasonInstant(body.startsAt)
      if (!startsAt) {
        return NextResponse.json({ error: 'startsAt must be a valid timestamp' }, { status: 400 })
      }
      updates.starts_at = startsAt
      oldValues.starts_at = season.starts_at
    }

    if (body.endsAt !== undefined) {
      const endsAt = parseSeasonInstant(body.endsAt)
      if (!endsAt) {
        return NextResponse.json({ error: 'endsAt must be a valid timestamp' }, { status: 400 })
      }
      updates.ends_at = endsAt
      oldValues.ends_at = season.ends_at
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    // The final window must stay coherent (the table CHECK enforces it
    // too, but a clean 400 beats a constraint violation).
    const finalStart = Date.parse(updates.starts_at ?? String(season.starts_at))
    const finalEnd = Date.parse(updates.ends_at ?? String(season.ends_at))
    if (finalEnd <= finalStart) {
      return NextResponse.json({ error: 'endsAt must be after startsAt' }, { status: 400 })
    }

    updates.updated_at = new Date().toISOString()

    const updated = await withAudit(
      supabase,
      {
        adminUserId: staff.staff.userId,
        targetUserId: null,
        action: 'season.update',
        oldValues: { seasonId, number: season.number, ...oldValues },
        newValues: updates,
        reason
      },
      async () => {
        const { data, error } = await supabase
          .from('seasons')
          .update(updates)
          .eq('id', seasonId)
          .select(SEASON_COLUMNS)
          .single()
        if (error || !data) {
          throw new Error(`Season update failed: ${error?.message ?? 'no row'}`)
        }
        return data
      }
    )

    return NextResponse.json({ success: true, season: updated })
  } catch (error) {
    console.error('[AdminSeasons] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update season' }, { status: 500 })
  }
}
