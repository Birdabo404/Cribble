import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlate } from '@/lib/cosmetics/plates'
import {
  getDodoClient,
  getTeamProductIds,
  isDodoMissing,
  readMetadataPlateId,
  readMetadataUserId,
  resolveProProductId,
  type DodoMetadata,
  type ProProductKey
} from '@/lib/dodo'
import { linkDodoCustomer } from '@/lib/dodoCustomer'
import {
  grantPlatePurchase,
  grantProEntitlement,
  grantTeamEntitlement
} from '@/lib/entitlementGrant'
import { getOwnedPlateIds, isApprovedTeam, isProTier } from '@/lib/entitlements'
import { grantHouseTeamEntitlement, houseGrantFor } from '@/lib/houseEntitlements'
import { insertMissingNotifications } from '@/lib/notifications'

// Pull-based entitlement reconciliation: ask Dodo for the linked
// customer's active subscriptions and succeeded payments and upgrade the
// local records to match. Exists because webhooks can't reach localhost
// in dev; in production it doubles as a fallback for missed deliveries.
// Upgrade-only by design — it never downgrades or revokes, protecting
// manually-set Pro accounts and leaving take-backs to the webhook.
//
// The customer link (users.dodo_customer_id) is what makes the pull
// possible: Dodo has no external customer id, so the shop's success
// bounce first acknowledges the returned payment/subscription (which
// links the customer — acknowledgeCheckoutReturn below) and only then
// runs the two syncs.

export interface SubscriptionSyncResult {
  tier: string
  isPro: boolean
  changed: boolean
}

const PRO_PRODUCT_KEYS: readonly ProProductKey[] = ['pro_monthly', 'pro_yearly']

/** Configured Dodo product ids that map to the Pro tier (unset keys skipped). */
function collectProProductIds(): Set<string> {
  const ids = new Set<string>()
  for (const key of PRO_PRODUCT_KEYS) {
    const id = resolveProProductId(key)
    if (id) ids.add(id)
  }
  return ids
}

/** Dodo attaches same-email checkouts to an existing customer, so one
 *  Dodo customer can hold objects bought by different Cribble accounts.
 *  An object stamped with another account's userId must never fulfill
 *  here; objects without a stamp (dashboard-created) belong to whoever
 *  the customer is linked to — the same rule the webhook applies. */
function belongsToUser(metadata: DodoMetadata | null | undefined, userId: number): boolean {
  const stamped = readMetadataUserId(metadata)
  return stamped === null || stamped === userId
}

interface UserBillingRow {
  subscription_tier: string
  twitter_username: string | null
  team_review_status: string | null
  dodo_customer_id: string | null
}

async function readUserBillingRow(
  supabase: SupabaseClient,
  userId: number
): Promise<UserBillingRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('subscription_tier, twitter_username, team_review_status, dodo_customer_id')
    .eq('id', userId)
    .single()

  if (error || !data) {
    console.error(
      `[SubscriptionSync] Failed to read tier for user ${userId}:`,
      error?.message ?? 'user not found'
    )
    return null
  }
  return {
    subscription_tier:
      typeof data.subscription_tier === 'string' && data.subscription_tier
        ? data.subscription_tier
        : 'FREE',
    twitter_username: typeof data.twitter_username === 'string' ? data.twitter_username : null,
    team_review_status:
      typeof data.team_review_status === 'string' ? data.team_review_status : null,
    dodo_customer_id:
      typeof data.dodo_customer_id === 'string' && data.dodo_customer_id
        ? data.dodo_customer_id
        : null
  }
}

/**
 * Reconcile a user's subscription tier straight from Dodo. If Dodo shows
 * an active subscription on one of the Team products, run the shared team
 * grant (TEAM tier, pending review, team_since, welcome notification) and
 * report changed: true; otherwise an active Pro-product subscription runs
 * the full Pro grant (tier, premium_since, welcome notification). The team
 * check runs BEFORE the already-Pro short-circuit — Pro -> TEAM is an
 * upgrade this reconciler must make (it is the backstop for a webhook
 * that misgranted a Team purchase as Pro), and a customer somehow
 * holding both subscriptions is a company account, so the team grant is
 * what opens the review gate.
 *
 * Callers get the current DB tier back untouched (changed: false) when:
 *   - the user is already TEAM (top tier here — Dodo isn't even asked),
 *   - the user is already on a Pro tier and Dodo shows no active team
 *     subscription (Pro is never re-granted),
 *   - the user has no linked Dodo customer (never checked out), or Dodo
 *     no longer knows the linked customer (404/422),
 *   - no active subscription matches a Team or Pro product,
 *   - Dodo isn't configured, or the tier read fails (logged, not thrown).
 * Anything else (network failures, auth errors) throws to the caller.
 */
export async function syncSubscriptionFromDodo(
  supabase: SupabaseClient,
  userId: number
): Promise<SubscriptionSyncResult> {
  const user = await readUserBillingRow(supabase, userId)
  if (!user) return { tier: 'FREE', isPro: false, changed: false }

  const currentTier = user.subscription_tier
  const unchanged: SubscriptionSyncResult = {
    tier: currentTier,
    isPro: isProTier(currentTier),
    changed: false
  }

  // House complimentary accounts are not Dodo-backed. Apply the grant
  // here so a missed login still heals the row, and never ask Dodo —
  // a leftover cancelled sub must not participate in fulfillment.
  const house = houseGrantFor({ id: userId, twitter_username: user.twitter_username })
  if (house === 'TEAM') {
    const alreadyApproved = isApprovedTeam({
      subscription_tier: currentTier,
      team_review_status: user.team_review_status
    })
    if (!alreadyApproved) {
      await grantHouseTeamEntitlement(supabase, userId)
    }
    return { tier: 'TEAM', isPro: false, changed: !alreadyApproved }
  }
  if (house === 'PRO') {
    if (currentTier === 'TEAM') return unchanged
    if (!unchanged.isPro) {
      await grantProEntitlement(supabase, userId)
      return { tier: 'PRO', isPro: true, changed: true }
    }
    return unchanged
  }

  // Only TEAM short-circuits before asking Dodo: it is the top tier this
  // reconciler can grant, so there is nothing left to upgrade (team revoke
  // lives in the webhook). A Pro tier must NOT bail here — an active team
  // subscription still has to lift it to TEAM below.
  if (currentTier === 'TEAM') return unchanged

  const dodo = getDodoClient()
  if (!dodo) return unchanged
  if (!user.dodo_customer_id) return unchanged

  const activeSubscriptions: Array<{
    subscription_id: string
    product_id: string
    metadata: DodoMetadata
  }> = []
  try {
    const pages = await dodo.subscriptions.list({
      customer_id: user.dodo_customer_id,
      status: 'active'
    })
    for await (const subscription of pages) {
      if (!belongsToUser(subscription.metadata, userId)) continue
      activeSubscriptions.push(subscription)
    }
  } catch (error) {
    // The linked customer is gone on Dodo's side — nothing to reconcile.
    if (isDodoMissing(error)) return unchanged
    throw error
  }

  // Team products first — this is the instant-grant path for a buyer
  // landing back on /team from checkout, before the webhook arrives, and
  // it runs even when the DB already says Pro so a misgranted Pro can be
  // reconciled up to TEAM.
  const teamProductIds = getTeamProductIds()
  const activeTeamSub = activeSubscriptions.find((subscription) =>
    teamProductIds.has(subscription.product_id)
  )
  if (activeTeamSub) {
    await grantTeamEntitlement(supabase, userId, {
      productId: activeTeamSub.product_id,
      sourceId: activeTeamSub.subscription_id
    })
    // TEAM is deliberately not a Pro tier (see isProTier).
    return { tier: 'TEAM', isPro: false, changed: true }
  }

  // Only now does an existing Pro tier end the sync: the team check above
  // found nothing, and re-running the Pro grant would re-stamp
  // premium_since and re-notify. Manually-set Pro tiers stay protected.
  if (unchanged.isPro) return unchanged

  const proProductIds = collectProProductIds()
  const activeProSub = activeSubscriptions.find((subscription) =>
    proProductIds.has(subscription.product_id)
  )
  if (!activeProSub) return unchanged

  await grantProEntitlement(supabase, userId, {
    productId: activeProSub.product_id,
    sourceId: activeProSub.subscription_id
  })

  return { tier: 'PRO', isPro: true, changed: true }
}

/**
 * Reconcile one-time plate purchases straight from Dodo's payment history:
 * every succeeded, non-refunded, non-subscription payment that carries a
 * catalog plate id in its checkout metadata and isn't owned locally yet is
 * granted via the shared purchase helper (ownership row + "delivered"
 * notification). Safe to run on every sync — already-owned plates are
 * skipped and the grant itself is idempotent.
 *
 * Only checkout metadata identifies the plate here: Dodo's payment list
 * carries no cart, and every shop checkout stamps plateId. A dashboard-
 * created plate payment (no stamp) is fulfilled by the webhook, which has
 * the full payment object and reverse-maps the product id.
 *
 * Returns the number of plates granted. Returns 0 without calling out
 * when Dodo isn't configured or the user has no linked customer, and
 * quietly when Dodo no longer knows the customer (404/422). A single
 * payment failing to grant is logged and skipped so one bad payment
 * can't block the rest; anything else (network/auth errors) throws to
 * the caller.
 */
export async function syncPlateOrdersFromDodo(
  supabase: SupabaseClient,
  userId: number
): Promise<number> {
  const dodo = getDodoClient()
  if (!dodo) return 0

  const user = await readUserBillingRow(supabase, userId)
  if (!user?.dodo_customer_id) return 0

  const candidates: Array<{ paymentId: string; plateId: string }> = []
  try {
    const pages = await dodo.payments.list({
      customer_id: user.dodo_customer_id,
      status: 'succeeded'
    })
    for await (const payment of pages) {
      if (payment.status && payment.status !== 'succeeded') continue
      if (payment.refund_status) continue // partial or full — money went back
      if (payment.subscription_id) continue // subscription cycle, no cosmetic attached
      if (!belongsToUser(payment.metadata, userId)) continue
      const plateId = readMetadataPlateId(payment.metadata)
      if (!plateId) continue
      candidates.push({ paymentId: payment.payment_id, plateId })
    }
  } catch (error) {
    if (isDodoMissing(error)) return 0
    throw error
  }

  const owned = new Set(await getOwnedPlateIds(supabase, userId))
  let granted = 0

  for (const { paymentId, plateId } of candidates) {
    if (!getPlate(plateId)) continue // unknown/retired catalog id
    if (owned.has(plateId)) continue

    try {
      await grantPlatePurchase(supabase, userId, { plateId, orderId: paymentId })
      // Track locally so a second paid payment for the same plate doesn't
      // re-notify under a different payment id.
      owned.add(plateId)
      granted++
    } catch (error) {
      console.error(
        `[SubscriptionSync] Failed to grant plate ${plateId} from payment ${paymentId}:`,
        error
      )
    }
  }

  return granted
}

/** Sane Dodo object id shape (pay_…, sub_…) — anything else is dropped unfetched. */
const DODO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface CheckoutReturnRef {
  /** `payment_id` Dodo appended to the return URL (one-time purchases). */
  paymentId?: string | null
  /** `subscription_id` Dodo appended to the return URL (subscriptions). */
  subscriptionId?: string | null
}

/**
 * Acknowledge the object the shop bounced back with after a successful
 * Dodo checkout: fetch it, confirm it carries THIS user's checkout
 * metadata (a forged or foreign id does nothing), link its Dodo customer
 * to the account — the step that makes the pull-based syncs above
 * possible on a first purchase — and insert the "order confirmed" ack
 * notification, deduped per object id so success-page reloads never
 * re-notify. Best-effort by contract: every failure is logged and
 * swallowed — the surrounding sync must never fail over the ack.
 */
export async function acknowledgeCheckoutReturn(
  supabase: SupabaseClient,
  userId: number,
  ref: CheckoutReturnRef
): Promise<void> {
  const dodo = getDodoClient()
  if (!dodo) return

  const paymentId = ref.paymentId ?? null
  const subscriptionId = ref.subscriptionId ?? null
  const objectId = paymentId ?? subscriptionId
  if (!objectId) return
  if (!DODO_ID_RE.test(objectId)) {
    console.warn(`[SubscriptionSync] Ignoring malformed checkout return id for user ${userId}`)
    return
  }

  try {
    const object = paymentId
      ? await dodo.payments.retrieve(paymentId)
      : await dodo.subscriptions.retrieve(objectId)

    if (readMetadataUserId(object.metadata) !== userId) {
      console.warn(
        `[SubscriptionSync] ${objectId} does not belong to user ${userId} — skipping ack`
      )
      return
    }

    await linkDodoCustomer(supabase, userId, object.customer.customer_id)

    const plateId = paymentId ? readMetadataPlateId(object.metadata) : null
    await insertMissingNotifications(supabase, userId, [
      {
        type: 'shop',
        title: 'THANK YOU FOR YOUR PURCHASE',
        body: 'Order confirmed — we are currently delivering it to your hangar.',
        data: {
          kind: 'purchase_ack',
          ...(paymentId ? { paymentId } : { subscriptionId: objectId }),
          ...(plateId ? { plateId } : {})
        },
        dedupeKey: `purchase_ack_${objectId}`
      }
    ])
  } catch (error) {
    console.error(`[SubscriptionSync] Checkout ack failed for ${objectId}:`, error)
  }
}
