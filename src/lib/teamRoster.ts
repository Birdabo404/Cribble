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

/** The team a session user may command, and on what grounds: their own
 *  users row when it is a live team, else the live team behind their
 *  ACTIVE + role='owner' affiliation (migration 066). */
export interface TeamAuthority {
  teamUserId: number
  via: 'team-account' | 'owner'
}

/** Row shape of the owner-affiliation -> team join below. */
interface OwnerAffiliationJoinRow {
  team_user_id: number
  team: TeamUserRow | null
}

/** resolveTeamCommand's verdict: the authority plus the users row of
 *  the team it commands — the caller's own row on the franchise arm,
 *  the joined team row on the owner arm. Both probes already have the
 *  row in hand, so surfaces that need the team's identity (the /me
 *  payload's team_handle behind INVITE TO TEAM) read it here instead
 *  of paying a second users read. */
export interface TeamCommand {
  authority: TeamAuthority
  team: TeamUserRow
}

/**
 * Resolve who this user speaks for, and for which team. Authority
 * rides the affiliation row and the team's liveness, so it dissolves
 * for free: an owner who leaves or is released loses the row (and with
 * it the role), and a lapsed/banned team fails teamIsLive — no cleanup
 * writes anywhere. A failed read never grants authority (it resolves
 * null); routes that must distinguish 500 from 403 load the user row
 * themselves first.
 */
export async function resolveTeamCommand(
  supabase: SupabaseClient,
  userId: number
): Promise<TeamCommand | null> {
  const loaded = await loadUserRow(supabase, userId)
  if (!loaded.ok) return null
  if (teamIsLive(loaded.user)) {
    return { authority: { teamUserId: userId, via: 'team-account' }, team: loaded.user }
  }

  // At most one row: the one-active partial index (029) caps ACTIVE
  // affiliations per member at one. Two FKs point at users, so the
  // embed names the team-side constraint.
  const { data, error } = await supabase
    .from('team_affiliations')
    .select(
      `team_user_id,
       team:users!team_affiliations_team_user_id_fkey(${TEAM_USER_SELECT})`
    )
    .eq('member_user_id', userId)
    .eq('status', 'active')
    .eq('role', 'owner')
    .maybeSingle()

  if (error) {
    console.error('[Team] Owner authority lookup failed:', error)
    return null
  }

  const row = data as unknown as OwnerAffiliationJoinRow | null
  if (!row?.team || !teamIsLive(row.team)) return null

  return {
    authority: { teamUserId: Number(row.team_user_id), via: 'owner' },
    team: row.team
  }
}

/** resolveTeamCommand's authority alone — the shape every /api/team/*
 *  mutation gate consumes. */
export async function resolveTeamAuthority(
  supabase: SupabaseClient,
  userId: number
): Promise<TeamAuthority | null> {
  const command = await resolveTeamCommand(supabase, userId)
  return command?.authority ?? null
}

/** Row shape of the any-role affiliation -> team join below. */
interface MemberAffiliationJoinRow {
  team_user_id: number
  team: TeamUserRow | null
}

/**
 * Resolve the team a signed member may VIEW: the id of the live team
 * behind their ACTIVE affiliation, any role, or null. The read-only
 * counterpart to resolveTeamAuthority — the same probe minus the owner
 * filter, the same dissolve-for-free shape (leaving or being released
 * drops the row; a lapsed or banned team fails teamIsLive), and the
 * same rule that a failed read never grants anything (it resolves
 * null). Command surfaces must keep gating on resolveTeamAuthority —
 * membership only ever earns a read.
 */
export async function resolveTeamMembership(
  supabase: SupabaseClient,
  userId: number
): Promise<number | null> {
  // At most one row: the one-active partial index (029) caps ACTIVE
  // affiliations per member at one, so maybeSingle stays honest even
  // without a role filter. Two FKs point at users, so the embed names
  // the team-side constraint.
  const { data, error } = await supabase
    .from('team_affiliations')
    .select(
      `team_user_id,
       team:users!team_affiliations_team_user_id_fkey(${TEAM_USER_SELECT})`
    )
    .eq('member_user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    console.error('[Team] Membership lookup failed:', error)
    return null
  }

  const row = data as unknown as MemberAffiliationJoinRow | null
  if (!row?.team || !teamIsLive(row.team)) return null

  return Number(row.team_user_id)
}
