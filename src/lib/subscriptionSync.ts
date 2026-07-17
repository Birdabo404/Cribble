import type { SupabaseClient } from '@supabase/supabase-js'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate'
import { grantProEntitlement } from '@/lib/entitlementGrant'
import { isProTier } from '@/lib/entitlements'
import { getPolarClient, resolveProProductId, type ProProductKey } from '@/lib/polar'

// Pull-based entitlement reconciliation: ask Polar for the customer's
// state and upgrade the local tier to match. Exists because webhooks
// can't reach localhost in dev; in production it doubles as a fallback
// for missed deliveries. Upgrade-only by design — it never downgrades,
// protecting manually-set Pro accounts and leaving downgrades to the
// subscription.revoked webhook.

export interface SubscriptionSyncResult {
  tier: string
  isPro: boolean
  changed: boolean
}

const PRO_PRODUCT_KEYS: readonly ProProductKey[] = ['pro_monthly', 'pro_yearly']

/** Configured Polar product ids that map to the Pro tier (unset keys skipped). */
function collectProProductIds(): Set<string> {
  const ids = new Set<string>()
  for (const key of PRO_PRODUCT_KEYS) {
    const id = resolveProProductId(key)
    if (id) ids.add(id)
  }
  return ids
}

/**
 * Reconcile a user's subscription tier straight from Polar. If Polar shows
 * an active subscription on one of the Pro products and the local tier
 * isn't Pro yet, run the full shared grant (tier, premium_since, welcome
 * notification) and report changed: true.
 *
 * Callers get the current DB tier back untouched (changed: false) when:
 *   - the user is already on a Pro tier (nothing to upgrade),
 *   - Polar has no customer for this external id (never checked out —
 *     404/422, same handling as the portal route),
 *   - no active subscription matches a Pro product,
 *   - Polar isn't configured, or the tier read fails (logged, not thrown).
 * Anything else (network failures, scope errors) throws to the caller.
 */
export async function syncSubscriptionFromPolar(
  supabase: SupabaseClient,
  userId: number
): Promise<SubscriptionSyncResult> {
  const { data: user, error: readError } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()

  if (readError || !user) {
    console.error(
      `[SubscriptionSync] Failed to read tier for user ${userId}:`,
      readError?.message ?? 'user not found'
    )
    return { tier: 'FREE', isPro: false, changed: false }
  }

  const currentTier =
    typeof user.subscription_tier === 'string' && user.subscription_tier
      ? user.subscription_tier
      : 'FREE'
  const unchanged: SubscriptionSyncResult = {
    tier: currentTier,
    isPro: isProTier(currentTier),
    changed: false
  }

  if (unchanged.isPro) return unchanged

  const polar = getPolarClient()
  if (!polar) return unchanged

  let state: CustomerState
  try {
    state = await polar.customers.getStateExternal({ externalId: String(userId) })
  } catch (error) {
    // A user who never checked out has no Polar customer — Polar answers
    // 404/422 for the unknown external id. Nothing to reconcile.
    if (
      error instanceof PolarError &&
      (error.statusCode === 404 || error.statusCode === 422)
    ) {
      return unchanged
    }
    throw error
  }

  const proProductIds = collectProProductIds()
  const activeProSub = (state.activeSubscriptions ?? []).find((subscription) =>
    proProductIds.has(subscription.productId)
  )
  if (!activeProSub) return unchanged

  await grantProEntitlement(supabase, userId, {
    productId: activeProSub.productId,
    sourceId: activeProSub.id
  })

  return { tier: 'PRO', isPro: true, changed: true }
}
