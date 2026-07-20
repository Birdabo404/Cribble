import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { cleanSeasonName, parseSeasonInstant } from '@/lib/adminSeasons'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { deriveSeasonState, type SeasonRow } from '@/lib/season'
import { SEASON_COLUMNS } from '@/lib/seasonServer'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Season calendar management (owner-only). Automation runs the calendar —
// season_tick() closes/starts seasons on schedule; these endpoints edit
// the schedule itself. Every mutation requires a reason and lands in the
// audit log before it executes.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
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

    const { data: rows, error } = await supabase
      .from('seasons')
      .select(`${SEASON_COLUMNS}, created_at, updated_at, season_results(count)`)
      .order('number', { ascending: false })

    if (error) {
      console.error('[AdminSeasons] List failed:', error)
      return NextResponse.json({ error: 'Failed to list seasons' }, { status: 500 })
    }

    const seasons = (rows ?? []).map((row) => {
      const counts = row.season_results as unknown as { count: number }[] | null
      return {
        id: Number(row.id),
        number: Number(row.number),
        name: String(row.name),
        startsAt: new Date(String(row.starts_at)).toISOString(),
        endsAt: new Date(String(row.ends_at)).toISOString(),
        status: String(row.status),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedPlayers: counts?.[0]?.count ?? 0
      }
    })

    const state = deriveSeasonState((rows ?? []) as unknown as SeasonRow[])

    return NextResponse.json({
      seasons,
      phase: state.phase,
      serverTime: new Date().toISOString()
    })
  } catch (error) {
    console.error('[AdminSeasons] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    const body = await request.json().catch(() => ({}))
    const reason = cleanReason(body.reason)
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason of at least 10 characters is required' },
        { status: 400 }
      )
    }

    const startsAt = parseSeasonInstant(body.startsAt)
    const endsAt = parseSeasonInstant(body.endsAt)
    if (!startsAt || !endsAt) {
      return NextResponse.json(
        { error: 'startsAt and endsAt must be valid timestamps' },
        { status: 400 }
      )
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      return NextResponse.json({ error: 'endsAt must be after startsAt' }, { status: 400 })
    }
    if (Date.parse(startsAt) <= Date.now()) {
      return NextResponse.json(
        { error: 'A scheduled season must start in the future' },
        { status: 400 }
      )
    }

    const { data: latest, error: latestError } = await supabase
      .from('seasons')
      .select('number')
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestError) {
      console.error('[AdminSeasons] Number lookup failed:', latestError)
      return NextResponse.json({ error: 'Failed to create season' }, { status: 500 })
    }

    const number = Number(latest?.number ?? 0) + 1
    const name =
      cleanSeasonName(body.name) ?? `SEASON ${String(number).padStart(2, '0')}`

    const season = await withAudit(
      supabase,
      {
        adminUserId: staff.staff.userId,
        targetUserId: null,
        action: 'season.create',
        newValues: { number, name, startsAt, endsAt },
        reason
      },
      async () => {
        const { data, error } = await supabase
          .from('seasons')
          .insert({
            number,
            name,
            starts_at: startsAt,
            ends_at: endsAt,
            status: 'upcoming'
          })
          .select(SEASON_COLUMNS)
          .single()
        if (error || !data) {
          throw new Error(`Season insert failed: ${error?.message ?? 'no row'}`)
        }
        return data
      }
    )

    return NextResponse.json({ success: true, season }, { status: 201 })
  } catch (error) {
    console.error('[AdminSeasons] POST error:', error)
    return NextResponse.json({ error: 'Failed to create season' }, { status: 500 })
  }
}
