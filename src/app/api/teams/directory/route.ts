import { unstable_cache } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { createServiceClient } from '@/lib/supabaseServer'
import { assembleTeamBoard } from '@/lib/teamBoardServer'
import { TEAM_SEAT_LIMIT } from '@/lib/teams'

// The public recruitment board: every approved live team, ranked by the
// SAME pipeline as the TEAMS leaderboard, decorated with the two bits
// that make it a directory — open seats and the recruiting lamp.
// Identities and scores are already public on the board; no session
// required, but rate-limited like every other public read. The payload
// is the same for every viewer, so like its leaderboard twin it caches
// hard: a minute in the Data Cache via unstable_cache (decoration
// queries included), plus the same-lifetime s-maxage CDN layer. A
// 60s-stale seat meter or recruiting lamp is fine.

export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

const loadTeamsDirectory = unstable_cache(
  async () => {
    const supabase = createServiceClient()
    const { rows, totals } = await assembleTeamBoard(supabase)
    const teamIds = rows.map((row) => row.userId)

    // Seat meters and lamps for the whole board in two grouped reads —
    // never per-team. Seats count pending + active (applications are
    // seatless, same rule as getTeamSeatUsage). Throws on a failed read
    // like assembleTeamBoard — never decorate from guessed counts.
    const seatsByTeam = new Map<number, number>()
    const recruitingByTeam = new Map<number, boolean>()
    if (teamIds.length > 0) {
      const [seatsResult, lampsResult] = await Promise.all([
        supabase
          .from('team_affiliations')
          .select('team_user_id, status')
          .in('team_user_id', teamIds)
          .in('status', ['pending', 'active']),
        supabase.from('users').select('id, team_recruiting').in('id', teamIds)
      ])

      if (seatsResult.error) {
        throw new Error(`Directory seats query failed: ${seatsResult.error.message}`)
      }
      if (lampsResult.error) {
        throw new Error(`Directory recruiting query failed: ${lampsResult.error.message}`)
      }

      for (const row of (seatsResult.data ?? []) as { team_user_id: number }[]) {
        const teamId = Number(row.team_user_id)
        seatsByTeam.set(teamId, (seatsByTeam.get(teamId) ?? 0) + 1)
      }
      for (const row of (lampsResult.data ?? []) as {
        id: number
        team_recruiting: boolean | null
      }[]) {
        recruitingByTeam.set(Number(row.id), row.team_recruiting !== false)
      }
    }

    const teams = rows.map((row) => {
      const seatsUsed = seatsByTeam.get(row.userId) ?? 0
      return {
        userId: row.userId,
        rank: row.rank,
        username: row.username,
        name: row.display_name,
        avatar: row.profile_image,
        score: row.score,
        memberCount: row.memberCount,
        seatsUsed,
        seatLimit: TEAM_SEAT_LIMIT,
        openSeats: Math.max(0, TEAM_SEAT_LIMIT - seatsUsed),
        recruiting: recruitingByTeam.get(row.userId) !== false,
        burnUsd: row.burnUsd,
        burnPilots: row.burnPilots
      }
    })

    return {
      teams,
      totals: {
        teams: totals.teams,
        members: totals.members,
        topScore: totals.topScore
      }
    }
  },
  ['teams-directory-v1'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const { teams, totals } = await loadTeamsDirectory()

    return NextResponse.json(
      { success: true, teams, totals },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
        }
      }
    )
  } catch (error) {
    console.error('[Team] Directory GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
