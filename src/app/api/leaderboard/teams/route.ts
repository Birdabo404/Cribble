import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchSeasonState } from '@/lib/seasonServer'
import type { SeasonState } from '@/lib/season'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  buildTeamBoard,
  type TeamBoardMemberInput,
  type TeamBoardTeamInput
} from '@/lib/teamLeaderboard'
import { exactDecimal, resolveTokenBoardWindow } from '@/lib/tokenLeaderboard'

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

// Same known-compatibility signal the tokens route checks: PostgREST
// resolves functions by argument names, so a not-yet-deployed migration
// 047 answers PGRST202/42883 to the five-argument call.
function missingLeaderboardFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
}

/**
 * Opt-in USD burn per user from the consent-gated agent_token_leaderboard
 * RPC (leaderboard_enabled AND consent_version >= 2 is enforced inside
 * the function). Season window matches the tokens route: calendar dates
 * bound leftover v1 daily rows, absolute timestamps bound v2 events.
 * No season calendar means both bounds are null (all-time burn). Any
 * failure — including the migration-pending PGRST202/42883 — degrades
 * to an empty map: burn is display-only and must never sink the board.
 */
async function fetchBurnByUser(
  supabase: SupabaseClient,
  seasonState: SeasonState
): Promise<Map<number, string>> {
  const burnByUser = new Map<number, string>()
  try {
    const seasonWindow = seasonState.current
      ? resolveTokenBoardWindow('season', seasonState, Date.now(), 'UTC')
      : null
    const { data, error } = await supabase.rpc('agent_token_leaderboard', {
      p_since: seasonWindow?.since ?? null,
      p_until: seasonWindow?.until ?? null,
      p_timezone: 'UTC',
      p_since_at: seasonState.current?.startsAt ?? null,
      p_until_at: seasonState.current?.endsAt ?? null
    })

    if (error) {
      if (missingLeaderboardFunction(error)) {
        console.warn('[Team Leaderboard] Burn RPC not deployed yet:', error.message)
      } else {
        console.warn('[Team Leaderboard] Burn aggregate failed:', error.message)
      }
      return burnByUser
    }

    for (const row of (data ?? []) as {
      user_id: number | string
      cost_usd: number | string | null
    }[]) {
      burnByUser.set(Math.round(Number(row.user_id)), exactDecimal(row.cost_usd))
    }
  } catch (err) {
    console.warn('[Team Leaderboard] Burn aggregate unavailable:', err)
  }
  return burnByUser
}

const loadTeamBoard = unstable_cache(
  async () => {
    const supabase = createServiceClient()

    // Season calendar decides the staleness guard (active season) vs
    // raw season_score (intermission / no calendar). Fetched inside the
    // cache window — a rollover is picked up within the minute.
    const seasonState = await fetchSeasonState(supabase)

    // Display-only burn column: opted-in members' USD over the season
    // window. Fetched alongside the roster queries below; never ranks.
    const burnByUserPromise = fetchBurnByUser(supabase, seasonState)

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

    const burnByUser = await burnByUserPromise
    const { rows, totals } = buildTeamBoard(teams, members, seasonState, burnByUser)

    return {
      rows,
      totals,
      season: seasonState,
      generatedAt: new Date().toISOString()
    }
  },
  ['team-leaderboard-v2'],
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
