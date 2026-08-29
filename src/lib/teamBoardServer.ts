import type { SupabaseClient } from '@supabase/supabase-js'
import type { SeasonState } from '@/lib/season'
import { fetchSeasonState } from '@/lib/seasonServer'
import {
  buildTeamBoard,
  type TeamBoardMemberInput,
  type TeamBoardRow,
  type TeamBoardTeamInput,
  type TeamBoardTotals
} from '@/lib/teamLeaderboard'
import { exactDecimal, resolveTokenBoardWindow } from '@/lib/tokenLeaderboard'

// The TEAMS board's queries + assembly, extracted verbatim from
// /api/leaderboard/teams so the team command deck (/api/team/dashboard)
// and the public recruitment board (/api/teams/directory) rank against
// the exact same inputs as the leaderboard — one board, three readers.
// Service-role client required: team_affiliations is service-role-only
// (migration 029). Caching stays with the callers (the leaderboard and
// directory routes wrap this in unstable_cache; the dashboard reads
// fresh).

// Row shapes for the selects below (client has no generated DB types).
interface BoardTeamRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
}

interface BoardRosterJoinRow {
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

export interface AssembledTeamBoard {
  rows: TeamBoardRow[]
  totals: TeamBoardTotals
  /** The season state the member scores were guarded against — callers
   *  scoring extra rows (dashboard roster/applicants) must reuse it so
   *  their numbers can't disagree with the board's. */
  season: SeasonState
}

/**
 * Run the full TEAMS-board pipeline: eligible teams, their active
 * rosters with staleness-guarded season scores, the opt-in burn
 * decoration, and buildTeamBoard's ranking. Throws on a failed
 * teams/roster read — a board must never render from guessed inputs.
 */
export async function assembleTeamBoard(supabase: SupabaseClient): Promise<AssembledTeamBoard> {
  // Season calendar decides the staleness guard (active season) vs
  // raw season_score (intermission / no calendar).
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
    (teamData ?? []) as unknown as BoardTeamRow[]
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

    for (const row of (rosterData ?? []) as unknown as BoardRosterJoinRow[]) {
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

  return { rows, totals, season: seasonState }
}
