import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cursorBurnDayFloor,
  cursorEstimateUsd,
  sumCursorTokensFromDay
} from '@/lib/cursorBurn'
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
  invited_at: string
  accepted_at: string | null
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

/** One ACTIVE affiliation's coordinates for the Cursor day floor: the
 *  member, the team, and when the member's seat on THAT team went live
 *  (accepted_at; rows predating the accept stamp fall back to
 *  invited_at, NOT NULL since migration 029). */
interface RosterAffiliation {
  teamUserId: number
  userId: number
  activeAt: string
}

/**
 * Cursor-token burn estimates per (team, member) — the CURSOR fuel of
 * the team burn column, beside fetchBurnByUser's CLI dollars. Roster
 * members with a cursor_profiles row that is board_enabled (the
 * consent bit) AND ownership-verified (verified_at set by the claim
 * flow's display-name challenge, NULL until proven, reset on handle
 * change) get their cursor_profile_daily tokens summed over the same
 * season window fetchBurnByUser uses, floored per (team, member) at
 * max(verified day, affiliation activation day, season start) so a
 * late claim can't import pre-claim or pre-roster history, and priced
 * at the season house rate (read time only — no USD is ever stored).
 * A verified member with zero counted tokens still maps at '0': like
 * the CLI map, a mapped zero is a real opted-in zero, not a null.
 * Same degradation contract as fetchBurnByUser: estimates are
 * display-only and must never sink the board, so any failure —
 * including the verified_at column's migration not being deployed
 * yet — answers an empty map.
 */
async function fetchCursorBurnByTeamMember(
  supabase: SupabaseClient,
  seasonState: SeasonState,
  affiliations: readonly RosterAffiliation[]
): Promise<Map<number, Map<number, string>>> {
  const estimates = new Map<number, Map<number, string>>()
  if (affiliations.length === 0) return estimates
  try {
    // Mirror fetchBurnByUser's window: the season's calendar dates
    // bound the daily rows; no season calendar means all-time.
    const seasonWindow = seasonState.current
      ? resolveTokenBoardWindow('season', seasonState, Date.now(), 'UTC')
      : null

    const memberIds = [...new Set(affiliations.map((row) => row.userId))]
    const { data: profileData, error: profilesError } = await supabase
      .from('cursor_profiles')
      .select('user_id, verified_at')
      .in('user_id', memberIds)
      .eq('board_enabled', true)
      .not('verified_at', 'is', null)

    if (profilesError) {
      console.warn(
        '[Team Leaderboard] Cursor profiles read failed:',
        profilesError.message
      )
      return estimates
    }

    const verifiedAtByUser = new Map<number, string>()
    for (const row of (profileData ?? []) as {
      user_id: number | string
      verified_at: string | null
    }[]) {
      if (row.verified_at) {
        verifiedAtByUser.set(Math.round(Number(row.user_id)), row.verified_at)
      }
    }
    if (verifiedAtByUser.size === 0) return estimates

    let dailyQuery = supabase
      .from('cursor_profile_daily')
      .select('user_id, day, tokens')
      .in('user_id', [...verifiedAtByUser.keys()])
    if (seasonWindow?.since) dailyQuery = dailyQuery.gte('day', seasonWindow.since)
    if (seasonWindow?.until) dailyQuery = dailyQuery.lte('day', seasonWindow.until)
    const { data: dailyData, error: dailyError } = await dailyQuery

    if (dailyError) {
      console.warn('[Team Leaderboard] Cursor daily read failed:', dailyError.message)
      return estimates
    }

    const dailyByUser = new Map<number, { day: string; tokens: number | string | null }[]>()
    for (const row of (dailyData ?? []) as {
      user_id: number | string
      day: string
      tokens: number | string | null
    }[]) {
      const userId = Math.round(Number(row.user_id))
      const rows = dailyByUser.get(userId)
      const fact = { day: row.day, tokens: row.tokens }
      if (rows) rows.push(fact)
      else dailyByUser.set(userId, [fact])
    }

    for (const affiliation of affiliations) {
      const verifiedAt = verifiedAtByUser.get(affiliation.userId)
      if (verifiedAt === undefined) continue
      const floorDay = cursorBurnDayFloor(
        verifiedAt,
        affiliation.activeAt,
        seasonWindow?.since ?? null
      )
      const tokens = sumCursorTokensFromDay(
        dailyByUser.get(affiliation.userId) ?? [],
        floorDay
      )
      const teamEstimates =
        estimates.get(affiliation.teamUserId) ?? new Map<number, string>()
      teamEstimates.set(affiliation.userId, cursorEstimateUsd(tokens))
      estimates.set(affiliation.teamUserId, teamEstimates)
    }
  } catch (err) {
    console.warn('[Team Leaderboard] Cursor burn estimates unavailable:', err)
  }
  return estimates
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

  // Display-only burn column, CLI fuel: opted-in members' reported USD
  // over the season window. Fetched alongside the roster queries below;
  // never ranks. (The Cursor fuel needs the roster's affiliation dates,
  // so it fetches after the roster query.)
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
  const affiliations: RosterAffiliation[] = []
  if (teams.length > 0) {
    const { data: rosterData, error: rosterError } = await supabase
      .from('team_affiliations')
      .select(
        `team_user_id, invited_at, accepted_at,
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
      affiliations.push({
        teamUserId: Number(row.team_user_id),
        userId: Number(member.id),
        activeAt: row.accepted_at ?? row.invited_at
      })
    }
  }

  const [burnByUser, cursorBurnByTeamMember] = await Promise.all([
    burnByUserPromise,
    fetchCursorBurnByTeamMember(supabase, seasonState, affiliations)
  ])
  const { rows, totals } = buildTeamBoard(
    teams,
    members,
    seasonState,
    burnByUser,
    cursorBurnByTeamMember
  )

  return { rows, totals, season: seasonState }
}
