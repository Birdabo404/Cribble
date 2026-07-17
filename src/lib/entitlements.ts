import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlate } from '@/lib/cosmetics/plates'

// Data-layer entitlement reads: "what does this user own / what tier are
// they" from the database only. `resolveEquippedPlate` is the one place
// that joins those facts against the plate catalog — every surface that
// renders an equipped plate must go through it so stored metadata is
// never trusted raw.

const PRO_TIERS = new Set(['PRO', 'PREMIUM', 'PREMIUM+'])

/** True when the subscription tier includes Pro perks. */
export function isProTier(tier: string | null | undefined): boolean {
  return typeof tier === 'string' && PRO_TIERS.has(tier.trim().toUpperCase())
}

/** Plate ids the user owns outright (user_cosmetics purchases/grants).
 *  Read failures degrade to [] so cosmetics can never break a page. */
export async function getOwnedPlateIds(
  supabase: SupabaseClient,
  userId: number
): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_cosmetics')
    .select('item_id')
    .eq('user_id', userId)
    .eq('item_type', 'plate')

  if (error) {
    console.error('[Entitlements] Failed to load owned plates:', error)
    return []
  }

  return (data ?? []).map((row) => String(row.item_id))
}

/** Owned plate ids for many users in one query (leaderboard: up to ~100
 *  rows). Users with no plates have no map entry — callers should treat a
 *  missing key as an empty set. Read failures degrade to an empty map. */
export async function getOwnedPlateIdsBatch(
  supabase: SupabaseClient,
  userIds: number[]
): Promise<Map<number, Set<string>>> {
  const owned = new Map<number, Set<string>>()
  if (userIds.length === 0) return owned

  const { data, error } = await supabase
    .from('user_cosmetics')
    .select('user_id, item_id')
    .eq('item_type', 'plate')
    .in('user_id', userIds)

  if (error) {
    console.error('[Entitlements] Failed to batch-load owned plates:', error)
    return owned
  }

  for (const row of data ?? []) {
    const userId = Number(row.user_id)
    let set = owned.get(userId)
    if (!set) {
      set = new Set<string>()
      owned.set(userId, set)
    }
    set.add(String(row.item_id))
  }

  return owned
}

export interface ResolveEquippedPlateInput {
  /** Raw `users.metadata.equipped_plate` value — untrusted JSONB. */
  equippedPlateId: unknown
  /** Raw `users.subscription_tier` value. */
  tier: string | null | undefined
  /** Plate ids the user owns (getOwnedPlateIds / a getOwnedPlateIdsBatch entry). */
  ownedPlateIds: ReadonlySet<string> | readonly string[]
}

/**
 * Resolve the plate a user is allowed to RENDER right now. The stored
 * equipped id is re-checked on every read: it must exist in the catalog
 * AND still be usable — owned outright (purchases, founder grants,
 * champion grants), or a Pro-exclusive plate while a Pro-tier
 * subscription is active. Anything else resolves to null, so downgrades,
 * refunds and retired catalog ids self-heal at read time with no
 * cleanup job.
 */
export function resolveEquippedPlate({
  equippedPlateId,
  tier,
  ownedPlateIds
}: ResolveEquippedPlateInput): string | null {
  if (typeof equippedPlateId !== 'string') return null
  const id = equippedPlateId.trim()
  if (!id) return null

  const plate = getPlate(id)
  if (!plate) return null

  const owned =
    ownedPlateIds instanceof Set ? ownedPlateIds.has(id) : new Set(ownedPlateIds).has(id)
  if (owned) return id
  if (plate.proExclusive === true && isProTier(tier)) return id
  return null
}
