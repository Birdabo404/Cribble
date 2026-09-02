import type { SupabaseClient } from '@supabase/supabase-js'
import { grantProEntitlement } from '@/lib/entitlementGrant'
import { isApprovedTeam, isProTier } from '@/lib/entitlements'
import { insertMissingNotifications } from '@/lib/notifications'

// House complimentary entitlements — never billed, never Polar-backed.
// @birdabo keeps Cribble Pro and @cribble_ai keeps the approved Team
// plan even if a Polar subscription lapses, an admin clicks revoke, or
// the identity tripwire fires. Login and subscription sync re-apply the
// grant if anything knocks the row off. Match by handle (survives a
// rebuilt account) and by production user id (survives a rename).

export type HouseGrant = 'PRO' | 'TEAM'

/** Production users.id values — the fallback when a house handle changes. */
const HOUSE_BY_USER_ID: ReadonlyMap<number, HouseGrant> = new Map([
  [8, 'PRO'],
  [19, 'TEAM']
])

/** Login handles, compared case-insensitively after trim. */
const HOUSE_BY_USERNAME: ReadonlyMap<string, HouseGrant> = new Map([
  ['birdabo', 'PRO'],
  ['cribble_ai', 'TEAM']
])

export interface HouseEntitlementSubject {
  id?: number | null
  twitter_username?: string | null
}

function normHandle(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * Complimentary house grant for this account, or null. Handle wins when
 * both sides match (the public house identity); user id is the fallback
 * so a rename cannot drop the grant.
 */
export function houseGrantFor(user: HouseEntitlementSubject): HouseGrant | null {
  const handle = normHandle(user.twitter_username)
  if (handle) {
    const fromHandle = HOUSE_BY_USERNAME.get(handle)
    if (fromHandle) return fromHandle
  }
  if (typeof user.id === 'number' && Number.isInteger(user.id) && user.id > 0) {
    return HOUSE_BY_USER_ID.get(user.id) ?? null
  }
  return null
}

export function isHouseAccount(user: HouseEntitlementSubject): boolean {
  return houseGrantFor(user) !== null
}

/**
 * Flip a house account to an approved Team plan — no Polar, no review
 * queue. team_since / team_approved_at stamp once. The welcome
 * notification is deduped so login re-applies never re-announce.
 */
export async function grantHouseTeamEntitlement(
  supabase: SupabaseClient,
  userId: number
): Promise<void> {
  const { data: user, error: readError } = await supabase
    .from('users')
    .select('metadata, team_review_status, team_approved_at')
    .eq('id', userId)
    .single()

  if (readError || !user) {
    throw new Error(
      `Failed to read user ${userId} for house Team grant: ${readError?.message ?? 'user not found'}`
    )
  }

  const metadata = (user.metadata ?? {}) as Record<string, unknown>
  const now = new Date().toISOString()
  const hasTeamSince =
    typeof metadata.team_since === 'string' && metadata.team_since.length > 0
  const hasApprovedAt =
    typeof user.team_approved_at === 'string' && user.team_approved_at.length > 0

  const update: Record<string, unknown> = {
    subscription_tier: 'TEAM',
    team_review_status: 'approved'
  }
  if (!hasApprovedAt) {
    update.team_approved_at = now
  }
  if (!hasTeamSince) {
    update.metadata = { ...metadata, team_since: now }
  }

  const { error: updateError } = await supabase.from('users').update(update).eq('id', userId)

  if (updateError) {
    throw new Error(
      `Failed to set house TEAM entitlement for user ${userId}: ${updateError.message}`
    )
  }

  await insertMissingNotifications(supabase, userId, [
    {
      type: 'premium',
      title: 'TEAM VERIFIED — GOLD BADGE ACTIVE',
      body: 'House complimentary Team — never billed. The gold badge is live and affiliate seats are open.',
      data: { kind: 'team_review', result: 'approved', house: true },
      dedupeKey: 'house_team_welcome'
    }
  ])
}

/**
 * Re-apply a house grant when the row is missing it. Never throws —
 * login and sync must not fail over a complimentary write.
 */
export async function ensureHouseEntitlements(
  supabase: SupabaseClient,
  user: HouseEntitlementSubject & {
    subscription_tier?: string | null
    team_review_status?: string | null
  }
): Promise<void> {
  try {
    if (typeof user.id !== 'number' || !Number.isInteger(user.id) || user.id <= 0) {
      return
    }

    const grant = houseGrantFor(user)
    if (!grant) return

    switch (grant) {
      case 'PRO': {
        if (isProTier(user.subscription_tier)) return
        if (
          typeof user.subscription_tier === 'string' &&
          user.subscription_tier.trim().toUpperCase() === 'TEAM'
        ) {
          return
        }
        await grantProEntitlement(supabase, user.id)
        return
      }
      case 'TEAM': {
        if (
          isApprovedTeam({
            subscription_tier: user.subscription_tier,
            team_review_status: user.team_review_status
          })
        ) {
          return
        }
        await grantHouseTeamEntitlement(supabase, user.id)
        return
      }
      default: {
        const exhaustive: never = grant
        return exhaustive
      }
    }
  } catch (error) {
    console.error('[HouseEntitlements] Failed to ensure grant:', error)
  }
}
