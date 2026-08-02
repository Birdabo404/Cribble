import type { SupabaseClient } from '@supabase/supabase-js'
import { isApprovedTeam } from '@/lib/entitlements'

// Team-affiliation reads shared by the badge joins (leaderboard, player
// cards, public profiles) and the /api/team/* roster routes. Everything
// here expects the service-role client — team_affiliations is
// service-role-only (migration 029).

/** Affiliate seats per team. Pending invites hold a seat, so the cap
 *  applies to rows with status IN ('pending', 'active'). */
export const TEAM_SEAT_LIMIT = 10

/** What badge surfaces need to render an affiliate's team mini-logo. */
export interface AffiliatedTeam {
  teamUserId: number
  username: string
  name: string
  avatar: string | null
}

/** Row shape of the affiliation -> team join below (client has no
 *  generated DB types). */
interface AffiliationJoinRow {
  member_user_id: number
  team: {
    id: number
    twitter_username: string | null
    twitter_name: string | null
    twitter_profile_image: string | null
    subscription_tier: string | null
    team_review_status: string | null
    status: string | null
  } | null
}

/**
 * The team behind each member, for badge joins: member ids -> their one
 * ACTIVE affiliation's team, kept only while the team row still earns
 * badges — subscription_tier='TEAM' AND team_review_status='approved'
 * AND not banned/suspended (status NULL predates migration 003 and
 * reads as active, same as the leaderboard query). Members without a
 * qualifying team get no map entry, so a team's lapse or ban silently
 * unlights every affiliate badge with zero writes. Read failures
 * degrade to an empty map — badges must never break a page (same
 * contract as getOwnedPlateIdsBatch).
 */
export async function getAffiliatedTeamsBatch(
  supabase: SupabaseClient,
  memberUserIds: number[]
): Promise<Map<number, AffiliatedTeam>> {
  const teams = new Map<number, AffiliatedTeam>()
  if (memberUserIds.length === 0) return teams

  // Two FKs point at users, so the embed names the team-side constraint.
  const { data, error } = await supabase
    .from('team_affiliations')
    .select(
      `member_user_id,
       team:users!team_affiliations_team_user_id_fkey(
         id, twitter_username, twitter_name, twitter_profile_image,
         subscription_tier, team_review_status, status
       )`
    )
    .eq('status', 'active')
    .in('member_user_id', memberUserIds)

  if (error) {
    console.error('[Teams] Failed to batch-load affiliations:', error)
    return teams
  }

  for (const row of (data ?? []) as unknown as AffiliationJoinRow[]) {
    const team = row.team
    if (!team) continue
    if (!isApprovedTeam(team)) continue
    if (team.status !== null && team.status !== 'active') continue

    teams.set(Number(row.member_user_id), {
      teamUserId: Number(team.id),
      username: team.twitter_username || `User${team.id}`,
      name: team.twitter_name || team.twitter_username || `User${team.id}`,
      avatar: team.twitter_profile_image || null
    })
  }

  return teams
}

/**
 * Seats a team is using right now: pending invites and active members
 * both count (TEAM_SEAT_LIMIT caps their sum). Throws on a failed read —
 * seat enforcement must never proceed on a guessed count.
 */
export async function getTeamSeatUsage(
  supabase: SupabaseClient,
  teamUserId: number
): Promise<number> {
  const { count, error } = await supabase
    .from('team_affiliations')
    .select('id', { count: 'exact', head: true })
    .eq('team_user_id', teamUserId)
    .in('status', ['pending', 'active'])

  if (error) {
    throw new Error(`Failed to count team seats for user ${teamUserId}: ${error.message}`)
  }

  return count ?? 0
}
