import type { SupabaseClient } from '@supabase/supabase-js'

// The /u/[team] Affiliates section: who is on the roster, publicly.
// Deliberately separate from src/lib/teams.ts (badge joins + seat
// counting) so surface code and roster-management code don't share a
// file. Service-role client required — team_affiliations is
// service-role-only (migration 029).

/** One row of the public Affiliates section on a team's /u/ page. */
export interface TeamAffiliateListItem {
  userId: number
  username: string
  display_name: string
  profile_image: string | null
  tier: string | null
}

export interface TeamAffiliatesList {
  members: TeamAffiliateListItem[]
  /** Full ACTIVE-member count, even when `members` is capped. */
  total: number
}

/** Row shape of the affiliation -> member join below (client has no
 *  generated DB types). */
interface MemberJoinRow {
  member: {
    id: number
    twitter_username: string | null
    twitter_name: string | null
    twitter_profile_image: string | null
    subscription_tier: string | null
    status: string | null
  } | null
}

/**
 * ACTIVE members of a team, for the public Affiliates section: oldest
 * affiliation first, capped (default 50 — the seat limit is 10 today,
 * the cap is head-room, not pagination). Banned/suspended members are
 * excluded in the query itself (status NULL predates migration 003 and
 * reads as active, same as the leaderboard). Callers gate on
 * isApprovedTeam(team) BEFORE calling — this helper only answers "who",
 * not "may the roster be shown". Read failures degrade to an empty
 * list — the section must never break the profile page (same contract
 * as getAffiliatedTeamsBatch).
 */
export async function getTeamAffiliatesList(
  supabase: SupabaseClient,
  teamUserId: number,
  limit = 50
): Promise<TeamAffiliatesList> {
  // Two FKs point at users, so the embed names the member-side
  // constraint; !inner makes the member-status filter drop rows (and
  // keep the count honest) instead of null-ing the embed.
  const { data, error, count } = await supabase
    .from('team_affiliations')
    .select(
      `member:users!team_affiliations_member_user_id_fkey!inner(
         id, twitter_username, twitter_name, twitter_profile_image,
         subscription_tier, status
       )`,
      { count: 'exact' }
    )
    .eq('team_user_id', teamUserId)
    .eq('status', 'active')
    .or('status.is.null,status.eq.active', { referencedTable: 'member' })
    .order('accepted_at', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) {
    console.error('[TeamAffiliates] Failed to load roster:', error)
    return { members: [], total: 0 }
  }

  const members: TeamAffiliateListItem[] = []
  for (const row of (data ?? []) as unknown as MemberJoinRow[]) {
    const member = row.member
    if (!member) continue
    const username = member.twitter_username || `User${member.id}`
    members.push({
      userId: Number(member.id),
      username,
      display_name: member.twitter_name || username,
      profile_image: member.twitter_profile_image || null,
      tier: member.subscription_tier || null
    })
  }

  return { members, total: count ?? members.length }
}
