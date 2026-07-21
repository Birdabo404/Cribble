import type { SupabaseClient } from '@supabase/supabase-js'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate'
import type { Order } from '@polar-sh/sdk/models/components/order'
import { getPlate } from '@/lib/cosmetics/plates'
import { grantPlatePurchase, grantProEntitlement } from '@/lib/entitlementGrant'
import { getOwnedPlateIds, isProTier } from '@/lib/entitlements'
import { insertMissingNotifications } from '@/lib/notifications'
import { getPolarClient, resolveProProductId, type ProProductKey } from '@/lib/polar'

// Pull-based entitlement reconciliation: ask Polar for the customer's
// state (subscription tier + paid plate orders) and upgrade the local
// records to match. Exists because webhooks can't reach localhost in
// dev; in production it doubles as a fallback for missed deliveries.
// Upgrade-only by design — it never downgrades or revokes, protecting
// manually-set Pro accounts and leaving take-backs to the
// subscription.revoked / order.refunded webhooks.

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

/** Money went back — these orders must never grant. OrderStatus is an
 *  open enum, so membership is checked as plain strings. */
const REFUNDED_ORDER_STATUSES = new Set<string>(['refunded', 'partially_refunded'])

/** Plate id attached to an order — same resolution as the webhook's
 *  readPlateId: Polar product metadata `plate_id` (dashboard convention),
 *  checkout metadata `plateId` (set by /api/checkout), or its snake_case
 *  variant. Null for plain subscription-cycle orders. */
function readOrderPlateId(order: Order): string | null {
  const candidates = [
    order.product?.metadata?.['plate_id'],
    order.metadata?.['plateId'],
    order.metadata?.['plate_id']
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number') return String(value)
  }
  return null
}

/**
 * Reconcile one-time plate purchases straight from Polar's order history:
 * every paid, non-refunded order that carries a catalog plate id and
 * isn't owned locally yet is granted via the shared purchase helper
 * (ownership row + "delivered" notification). Safe to run on every sync —
 * already-owned plates are skipped and the grant itself is idempotent.
 *
 * Returns the number of plates granted. Returns 0 without calling out
 * when Polar isn't configured, and quietly when Polar has no customer
 * for this external id (404/422, same as syncSubscriptionFromPolar).
 * A single order failing to grant is logged and skipped so one bad
 * order can't block the rest; anything else (network/scope errors)
 * throws to the caller.
 */
export async function syncPlateOrdersFromPolar(
  supabase: SupabaseClient,
  userId: number
): Promise<number> {
  const polar = getPolarClient()
  if (!polar) return 0

  const orders: Order[] = []
  try {
    const pages = await polar.orders.list({
      externalCustomerId: String(userId),
      limit: 100
    })
    for await (const page of pages) orders.push(...page.result.items)
  } catch (error) {
    if (
      error instanceof PolarError &&
      (error.statusCode === 404 || error.statusCode === 422)
    ) {
      return 0
    }
    throw error
  }

  const owned = new Set(await getOwnedPlateIds(supabase, userId))
  let granted = 0

  for (const order of orders) {
    if (order.paid !== true) continue
    if (REFUNDED_ORDER_STATUSES.has(order.status)) continue

    const plateId = readOrderPlateId(order)
    if (!plateId) continue // subscription-cycle order, no cosmetic attached
    if (!getPlate(plateId)) continue // unknown/retired catalog id
    if (owned.has(plateId)) continue

    try {
      await grantPlatePurchase(supabase, userId, { plateId, orderId: order.id })
      // Track locally so a second paid order for the same plate doesn't
      // re-notify under a different order id.
      owned.add(plateId)
      granted++
    } catch (error) {
      console.error(
        `[SubscriptionSync] Failed to grant plate ${plateId} from order ${order.id}:`,
        error
      )
    }
  }

  return granted
}

/** Sane Polar checkout id shape — anything else is dropped unfetched. */
const CHECKOUT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Insert the "order confirmed" ack notification when the shop bounces
 * back from a successful Polar checkout with its checkout_id. The
 * checkout is fetched from Polar and must carry this user's external
 * customer id — a forged or foreign checkout id inserts nothing. Deduped
 * per checkout id, so success-page reloads never re-notify. Best-effort
 * by contract: every failure is logged and swallowed — the surrounding
 * sync must never fail over the ack.
 */
export async function insertCheckoutAckNotification(
  supabase: SupabaseClient,
  userId: number,
  checkoutId: string
): Promise<void> {
  if (!CHECKOUT_ID_RE.test(checkoutId)) {
    console.warn(`[SubscriptionSync] Ignoring malformed checkout id for user ${userId}`)
    return
  }

  const polar = getPolarClient()
  if (!polar) return

  try {
    const checkout = await polar.checkouts.get({ id: checkoutId })
    if (checkout.externalCustomerId !== String(userId)) {
      console.warn(
        `[SubscriptionSync] Checkout ${checkoutId} does not belong to user ${userId} — skipping ack`
      )
      return
    }

    const plateIdRaw = checkout.metadata?.['plateId'] ?? checkout.metadata?.['plate_id']
    const plateId =
      typeof plateIdRaw === 'string' && plateIdRaw
        ? plateIdRaw
        : typeof plateIdRaw === 'number'
          ? String(plateIdRaw)
          : null

    await insertMissingNotifications(supabase, userId, [
      {
        type: 'shop',
        title: 'THANK YOU FOR YOUR PURCHASE',
        body: 'Order confirmed — we are currently delivering it to your hangar.',
        data: { kind: 'purchase_ack', checkoutId, ...(plateId ? { plateId } : {}) },
        dedupeKey: `purchase_ack_${checkoutId}`
      }
    ])
  } catch (error) {
    console.error(`[SubscriptionSync] Checkout ack failed for ${checkoutId}:`, error)
  }
}
