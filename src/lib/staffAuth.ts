import { NextRequest } from 'next/server'
import { isAllowlistedAdmin } from '@/lib/adminAuth'
import { checkDistributedRateLimit, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Two-tier staff model for the admin panel:
//   owner     — the site operator. Everything, including entitlement
//               grants and staff management.
//   moderator — trusted helpers. Community moderation only.
//
// Roles live in users.staff_role (migration 018). The ADMIN_USERNAMES
// env allowlist and the legacy is_admin flag both resolve to 'owner' as
// a breakglass, so the operator can never be locked out by a bad DB
// write. The API can promote/demote moderators but can NEVER mint or
// remove an owner — owner changes require the env var or direct DB
// access, which keeps a stolen staff session from escalating itself.

export type StaffRole = 'owner' | 'moderator'

/** Every mutating or privileged panel capability, one gate per action. */
export type StaffAction =
  | 'user.view'
  | 'user.set_status'
  | 'user.moderate_content'
  | 'user.edit_notes'
  | 'audit.view'
  | 'feedback.view'
  | 'feedback.manage'
  | 'entitlement.grant_pro'
  | 'entitlement.revoke_pro'
  | 'entitlement.grant_plate'
  | 'entitlement.revoke_plate'
  | 'staff.manage'
  | 'invite.manage'
  | 'season.manage'
  | 'team.review'
  | 'billboard.review'
  | 'debug.manage'

export function minRoleFor(action: StaffAction): StaffRole {
  switch (action) {
    case 'user.view':
    case 'user.set_status':
    case 'user.moderate_content':
    case 'user.edit_notes':
    case 'audit.view':
    case 'feedback.view':
    case 'feedback.manage':
      return 'moderator'
    case 'entitlement.grant_pro':
    case 'entitlement.revoke_pro':
    case 'entitlement.grant_plate':
    case 'entitlement.revoke_plate':
    case 'staff.manage':
    // Invite codes create accounts — account-creation control is an
    // owner power, and (unlike the old getAdminUser gate) it now runs
    // through resolveStaffRole, so a demoted moderator can't reach it
    // via a stale is_admin flag.
    case 'invite.manage':
    // The season calendar controls every player's scores and standings —
    // rescheduling or force-ending a season is an owner power.
    case 'season.manage':
    // Team approval hands out the gold badge — the anti-impersonation
    // gate is an owner call, same as entitlements.
    case 'team.review':
    // Billboard ads are paid placements shown to every visitor —
    // approving copy and flipping paid/live state is an owner call,
    // same as team review (payment is handled manually via Polar).
    case 'billboard.review':
    case 'debug.manage':
      return 'owner'
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

export function roleAtLeast(role: StaffRole, min: StaffRole): boolean {
  switch (min) {
    case 'moderator':
      return true
    case 'owner':
      return role === 'owner'
    default: {
      const exhaustive: never = min
      return exhaustive
    }
  }
}

/** The user-row fields staff resolution needs. */
export interface StaffRoleFields {
  staff_role?: string | null
  is_admin?: boolean | null
  twitter_username?: string | null
}

/**
 * Owner status the panel cannot revoke: the ADMIN_USERNAMES breakglass
 * allowlist or a legacy is_admin flag. resolveStaffRole lets an explicit
 * staff_role='moderator' override this (so an allowlisted account can be
 * contained), which means clearing staff_role would let them fall back to
 * owner — so the staff-management route refuses to touch these accounts
 * and points the operator at the environment config instead.
 */
export function isBreakglassOwner(user: StaffRoleFields): boolean {
  return user.is_admin === true || isAllowlistedAdmin(user.twitter_username)
}

export function resolveStaffRole(user: StaffRoleFields): StaffRole | null {
  if (user.staff_role === 'owner') return 'owner'
  if (user.staff_role === 'moderator') return 'moderator'
  if (isBreakglassOwner(user)) return 'owner'
  return null
}

export interface StaffUser {
  userId: number
  username: string | null
  role: StaffRole
}

export type StaffUserResult =
  | { ok: true; staff: StaffUser }
  | { ok: false; status: number; error: string }

const supabase = createServiceClient()

/**
 * Resolve the requesting staff member and (optionally) gate on an action.
 * 401 = no valid session, 403 = not staff / role too low. A staff account
 * that is itself banned or suspended loses panel access outright.
 */
export async function getStaffUser(
  request: NextRequest,
  action?: StaffAction
): Promise<StaffUserResult> {
  const session = await getSessionUserId(request)
  if (!session.ok) {
    return session
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, twitter_username, staff_role, is_admin, status')
    .eq('id', session.userId)
    .single()

  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const role = resolveStaffRole(user)
  if (!role) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (typeof user.status === 'string' && user.status !== 'active') {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (action && !roleAtLeast(role, minRoleFor(action))) {
    return { ok: false, status: 403, error: 'Owner access required' }
  }

  const isRead = request.method === 'GET' || request.method === 'HEAD'
  const rateLimitConfig = isRead ? rateLimitConfigs.api : rateLimitConfigs.admin
  const distributedLimit = await checkDistributedRateLimit(
    request,
    rateLimitConfig,
    `staff:${user.id}:${isRead ? 'read' : 'write'}`
  )
  if (!distributedLimit.success) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded. Try again in ${distributedLimit.retryAfter ?? 1} seconds.`
    }
  }

  return {
    ok: true,
    staff: {
      userId: Number(user.id),
      username: user.twitter_username ?? null,
      role
    }
  }
}

export type TargetGuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * Anti-abuse rules for every action aimed AT a user:
 *   - no self-targeting: staff moderate the community, never their own row
 *   - owners are untouchable through the panel — a rogue moderator (or a
 *     stolen moderator session) cannot ban or strip the operator
 *   - moderators act on regular users only; the owner may also act on
 *     moderators (containment for a misbehaving staff account)
 */
export function assertCanTarget(
  actor: StaffUser,
  targetId: number,
  targetRole: StaffRole | null
): TargetGuardResult {
  if (targetId === actor.userId) {
    return {
      ok: false,
      status: 403,
      error: 'You cannot perform staff actions on your own account'
    }
  }
  if (targetRole === 'owner') {
    return { ok: false, status: 403, error: 'Owner accounts cannot be targeted' }
  }
  if (targetRole === 'moderator' && actor.role !== 'owner') {
    return { ok: false, status: 403, error: 'Only the owner can act on staff accounts' }
  }
  return { ok: true }
}

export const REASON_MIN = 10
export const REASON_MAX = 500

/**
 * Every mutation requires a human-written reason that lands in the audit
 * log. Control characters are stripped; anything shorter than REASON_MIN
 * after trimming is rejected (null), overlong text is cut at REASON_MAX.
 */
export function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, REASON_MAX)
    .trim()
  return cleaned.length >= REASON_MIN ? cleaned : null
}
