import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { fetchSeasonState } from '@/lib/seasonServer'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  buildTeamBoard,
  type TeamBoardMemberInput,
  type TeamBoardTeamInput
} from '@/lib/teamLeaderboard'

// THE TEAMS BOARD is the same payload for every viewer (no session, no
// cookies), so like the AI board it caches hard: the handler stays
// force-dynamic (never prerendered at build, where no DB should be
// hit), while the assembled board lives in the Data Cache for a minute
// via unstable_cache — every roster is embedded, so expanding a row
// never fetches. The s-maxage header adds a CDN layer with the same
// lifetime. Service-role client required — team_affiliations is
// service-role-only (migration 029).
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

// Row shapes for the selects below (client has no generated DB types).
interface TeamUserRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
}

interface RosterJoinRow {
  team_user_id: number
  member: {
    id: number
    twitter_username: string | null
    twitter_name: string | null
    twitter_profile_image: string | null
    subscription_tier: string | null
    status: string | null
    user_scores: {
      season_score: number | null
      last_calculated_at: string | null
    } | null
  } | null
}

const loadTeamBoard = unstable_cache(
  async () => {
    const supabase = createServiceClient()

    // Season calendar decides the staleness guard (active season) vs
    // raw season_score (intermission / no calendar). Fetched inside the
    // cache window — a rollover is picked up within the minute.
    const seasonState = await fetchSeasonState(supabase)

    // Eligible teams: the isApprovedTeam gate as a query — tier TEAM
    // (the DB CHECK stores exactly 'TEAM') + past review + not
    // banned/suspended (status NULL predates migration 003 and reads
    // as active).
    const { data: teamData, error: teamsError } = await supabase
      .from('users')
      .select('id, twitter_username, twitter_name, twitter_profile_image')
      .eq('subscription_tier', 'TEAM')
      .eq('team_review_status', 'approved')
      .or('status.is.null,status.eq.active')

    if (teamsError) {
      throw new Error(`Teams query failed: ${teamsError.message}`)
    }

    const teams: TeamBoardTeamInput[] = (
      (teamData ?? []) as unknown as TeamUserRow[]
    ).map((team) => ({
      id: Number(team.id),
      twitter_username: team.twitter_username,
      twitter_name: team.twitter_name,
      twitter_profile_image: team.twitter_profile_image
    }))

    // Active rosters for every board team in one query. Two FKs point
    // at users, so the embed names the member-side constraint; !inner
    // makes the member-status filter drop banned/suspended members
    // instead of null-ing the embed. Scores ride the nested embed —
    // user_scores keys on user_id, so it lands as a single object.
    const members: TeamBoardMemberInput[] = []
    if (teams.length > 0) {
      const { data: rosterData, error: rosterError } = await supabase
        .from('team_affiliations')
        .select(
          `team_user_id,
           member:users!team_affiliations_member_user_id_fkey!inner(
             id, twitter_username, twitter_name, twitter_profile_image,
             subscription_tier, status,
             user_scores(season_score, last_calculated_at)
           )`
        )
        .eq('status', 'active')
        .in('team_user_id', teams.map((team) => team.id))
        .or('status.is.null,status.eq.active', { referencedTable: 'member' })

      if (rosterError) {
        throw new Error(`Roster query failed: ${rosterError.message}`)
      }

      for (const row of (rosterData ?? []) as unknown as RosterJoinRow[]) {
        const member = row.member
        if (!member) continue
        members.push({
          teamUserId: Number(row.team_user_id),
          userId: Number(member.id),
          twitter_username: member.twitter_username,
          twitter_name: member.twitter_name,
          twitter_profile_image: member.twitter_profile_image,
          tier: member.subscription_tier,
          season_score: member.user_scores?.season_score ?? null,
          last_calculated_at: member.user_scores?.last_calculated_at ?? null
        })
      }
    }

    const { rows, totals } = buildTeamBoard(teams, members, seasonState)

    return {
      rows,
      totals,
      season: seasonState,
      generatedAt: new Date().toISOString()
    }
  },
  ['team-leaderboard'],
  { revalidate: REVALIDATE_SECONDS }
)

export async function GET() {
  try {
    const { rows, totals, season, generatedAt } = await loadTeamBoard()

    return NextResponse.json(
      {
        success: true,
        data: rows,
        totals,
        season,
        generatedAt,
        serverTime: new Date().toISOString()
      },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`
        }
      }
    )
  } catch (err) {
    console.error('[Team Leaderboard] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Failed to load the team leaderboard' },
      { status: 500 }
    )
  }
}
