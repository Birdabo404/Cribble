import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { isApprovedTeam } from '@/lib/entitlements'

// Shared plumbing for the /api/team/* routes: user-row loading with the
// columns every guard needs, identity mapping for roster/invite payloads,
// and the Postgres error codes the affiliation flow leans on. Pure data
// helpers — routes translate results into HTTP responses.

/** Unique-violation SQLSTATE: the race backstop for double invites (the
 *  (team, member) UNIQUE) and double memberships (the partial unique
 *  index on member_user_id WHERE status='active'). */
export const UNIQUE_VIOLATION = '23505'

export function isUniqueViolation(error: Pick<PostgrestError, 'code'> | null): boolean {
  return error?.code === UNIQUE_VIOLATION
}

/** Columns the team guards read off a users row. */
export const TEAM_USER_SELECT =
  'id, twitter_username, twitter_name, twitter_profile_image, subscription_tier, team_review_status, status'

export interface TeamUserRow {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  subscription_tier: string | null
  team_review_status: string | null
  status: string | null
}

/** True for the TEAM tier regardless of review status — the tier gate for
 *  the management page; mutations additionally require isApprovedTeam. */
export function isTeamTier(tier: string | null | undefined): boolean {
  return typeof tier === 'string' && tier.trim().toUpperCase() === 'TEAM'
}

/** A team a member can meaningfully join/stay with: still on the TEAM
 *  tier, past review, and not banned/suspended. */
export function teamIsLive(team: TeamUserRow): boolean {
  return (
    isApprovedTeam(team) &&
    (team.status === null || team.status === 'active')
  )
}

/** Identity fields the team surfaces render, with the same fallbacks the
 *  rest of the app uses for handle-less rows. */
export function teamIdentity(user: TeamUserRow): {
  userId: number
  username: string
  name: string
  avatar: string | null
} {
  const username = user.twitter_username || `User${user.id}`
  return {
    userId: Number(user.id),
    username,
    name: user.twitter_name || username,
    avatar: user.twitter_profile_image || null
  }
}

export type LoadUserResult =
  | { ok: true; user: TeamUserRow }
  | { ok: false; status: number; error: string }

/** Load one users row by id. A read failure is a 500 (never proof the
 *  user is missing); a definitive miss is a 404. */
export async function loadUserRow(
  supabase: SupabaseClient,
  userId: number
): Promise<LoadUserResult> {
  const { data, error } = await supabase
    .from('users')
    .select(TEAM_USER_SELECT)
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('[Team] User lookup failed:', error)
    return { ok: false, status: 500, error: 'Lookup failed' }
  }
  if (!data) {
    return { ok: false, status: 404, error: 'User not found' }
  }
  return { ok: true, user: data as TeamUserRow }
}

/** Escape LIKE wildcards so a callsign like "j_doe" matches literally in
 *  the case-insensitive ilike lookup. */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/([%_\\])/g, '\\$1')
}
