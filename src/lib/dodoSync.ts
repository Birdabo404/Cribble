import type { SupabaseClient } from '@supabase/supabase-js'
import { APIError } from 'dodopayments'
import { getPlate } from '@/lib/cosmetics/plates'
import {
  grantPlatePurchase,
  grantProEntitlement,
  grantTeamEntitlement
} from '@/lib/entitlementGrant'
import { getOwnedPlateIds, isProTier } from '@/lib/entitlements'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { insertMissingNotifications } from '@/lib/notifications'
import {
  getDodoClient,
  isDodoTeamProduct,
  plateIdForProduct,
  readPlateId,
  readUserId
} from '@/lib/dodo'

// Fulfillment shared by the Dodo webhook and the pull-based sync. Grants
// go through the same helpers as Polar, so tier, review gate, and plate
// ownership stay one code path. Upgrade-only on the sync side; take-backs
// happen here only for webhook cancel/expire/fail/refund.

export interface DodoSyncResult {
  tier: string
  isPro: boolean
  changed: boolean
  grantedPlates: number
}

interface SubShape {
  subscription_id: string
  product_id: string
  metadata?: Record<string, unknown> | null
  customer?: { customer_id?: string | null } | null
  cancel_at_next_billing_date?: boolean
}

interface PayShape {
  payment_id: string
  metadata?: Record<string, unknown> | null
  customer?: { customer_id?: string | null } | null
  subscription_ids?: string[]
  product_cart?: Array<{ product_id: string }> | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asSub(data: unknown): SubShape | null {
  const record = asRecord(data)
  if (!record) return null
  if (typeof record.subscription_id !== 'string' || typeof record.product_id !== 'string') return null
  const customer = asRecord(record.customer)
  return {
    subscription_id: record.subscription_id,
    product_id: record.product_id,
    metadata: asRecord(record.metadata),
    customer: customer ? { customer_id: typeof customer.customer_id === 'string' ? customer.customer_id : null } : null,
    cancel_at_next_billing_date: record.cancel_at_next_billing_date === true
  }
}

function asPay(data: unknown): PayShape | null {
  const record = asRecord(data)
  if (!record || typeof record.payment_id !== 'string') return null
  const customer = asRecord(record.customer)
  const cart = Array.isArray(record.product_cart)
    ? record.product_cart.flatMap((item) => {
        const row = asRecord(item)
        return row && typeof row.product_id === 'string' ? [{ product_id: row.product_id }] : []
      })
    : null
  return {
    payment_id: record.payment_id,
    metadata: asRecord(record.metadata),
    customer: customer ? { customer_id: typeof customer.customer_id === 'string' ? customer.customer_id : null } : null,
    subscription_ids: Array.isArray(record.subscription_ids)
      ? record.subscription_ids.filter((id): id is string => typeof id === 'string')
      : [],
    product_cart: cart
  }
}

async function productMetadata(productId: string): Promise<Record<string, unknown> | null> {
  const client = getDodoClient()
  if (!client) return null
  try {
    const product = await client.products.retrieve(productId)
    return product.metadata ?? null
  } catch (error) {
    console.error(`[Dodo] Failed to read product ${productId}:`, error)
    return null
  }
}

async function rememberCustomer(
  supabase: SupabaseClient,
  userId: number,
  customerId: string | null | undefined
): Promise<void> {
  if (!customerId) return
  const { data, error } = await supabase.from('users').select('metadata').eq('id', userId).single()
  if (error || !data) return
  const metadata = (data.metadata ?? {}) as Record<string, unknown>
  if (metadata.dodo_customer_id === customerId) return
  const { error: updateError } = await supabase
    .from('users')
    .update({ metadata: { ...metadata, dodo_customer_id: customerId } })
    .eq('id', userId)
  if (updateError) {
    console.error(`[Dodo] Failed to store customer ${customerId} for user ${userId}:`, updateError.message)
  }
}

async function activateSubscription(supabase: SupabaseClient, data: unknown): Promise<void> {
  const subscription = asSub(data)
  if (!subscription) return
  const userId = readUserId(subscription.metadata)
  if (!userId) {
    console.warn('[Dodo] Subscription event without usable recipient — skipping')
    return
  }
  await rememberCustomer(supabase, userId, subscription.customer?.customer_id)
  const meta = await productMetadata(subscription.product_id)
  const grant = isDodoTeamProduct(subscription.product_id, meta) ? grantTeamEntitlement : grantProEntitlement
  await grant(supabase, userId, {
    productId: subscription.product_id,
    sourceId: subscription.subscription_id
  })
}

/** Immediate cancel revokes now. Cancel-at-period-end stays until expired. */
export function cancelRevokesNow(data: unknown): boolean {
  const subscription = asSub(data)
  if (!subscription) return false
  return subscription.cancel_at_next_billing_date !== true
}

async function revokeSubscription(supabase: SupabaseClient, data: unknown): Promise<void> {
  const subscription = asSub(data)
  if (!subscription) return
  const userId = readUserId(subscription.metadata)
  if (!userId) {
    console.warn('[Dodo] Subscription event without usable recipient — skipping')
    return
  }
  if (houseGrantFor({ id: userId })) {
    console.warn(`[Dodo] Refusing to revoke house entitlement for user ${userId}`)
    return
  }
  const meta = await productMetadata(subscription.product_id)
  const grantedTier = isDodoTeamProduct(subscription.product_id, meta) ? 'TEAM' : 'PRO'
  const { error } = await supabase
    .from('users')
    .update({ subscription_tier: 'FREE' })
    .eq('id', userId)
    .eq('subscription_tier', grantedTier)
  if (error) {
    throw new Error(`Failed to set subscription_tier=FREE for user ${userId}: ${error.message}`)
  }
}

function plateIdFromPayment(payment: PayShape): string | null {
  const fromMeta = readPlateId(payment.metadata)
  if (fromMeta) return fromMeta
  for (const item of payment.product_cart ?? []) {
    const plateId = plateIdForProduct(item.product_id)
    if (plateId) return plateId
  }
  return null
}

async function grantPlateFromPayment(supabase: SupabaseClient, data: unknown): Promise<void> {
  const payment = asPay(data)
  if (!payment) return
  if ((payment.subscription_ids?.length ?? 0) > 0) return
  const plateId = plateIdFromPayment(payment)
  if (!plateId || !getPlate(plateId)) return
  const userId = readUserId(payment.metadata)
  if (!userId) {
    console.warn('[Dodo] payment.succeeded without usable recipient — skipping')
    return
  }
  await rememberCustomer(supabase, userId, payment.customer?.customer_id)
  await grantPlatePurchase(supabase, userId, { plateId, orderId: payment.payment_id })
}

async function revokePlateFromRefund(supabase: SupabaseClient, data: unknown): Promise<void> {
  const record = asRecord(data)
  const paymentId = record && typeof record.payment_id === 'string' ? record.payment_id : null
  if (!paymentId) return
  const { error } = await supabase.from('user_cosmetics').delete().eq('source_order_id', paymentId)
  if (error) {
    throw new Error(`Failed to revoke cosmetics for payment ${paymentId}: ${error.message}`)
  }
}

export async function applyDodoEvent(
  supabase: SupabaseClient,
  event: { type: string; data: unknown }
): Promise<void> {
  switch (event.type) {
    case 'subscription.active':
    case 'subscription.plan_changed':
      await activateSubscription(supabase, event.data)
      return
    case 'subscription.expired':
    case 'subscription.failed':
      await revokeSubscription(supabase, event.data)
      return
    case 'subscription.cancelled':
      if (cancelRevokesNow(event.data)) await revokeSubscription(supabase, event.data)
      return
    case 'payment.succeeded':
      await grantPlateFromPayment(supabase, event.data)
      return
    case 'refund.succeeded':
      await revokePlateFromRefund(supabase, event.data)
      return
    default:
      return
  }
}

async function ackCheckout(
  supabase: SupabaseClient,
  userId: number,
  checkoutId: string,
  plateId: string | null
): Promise<void> {
  await insertMissingNotifications(supabase, userId, [
    {
      type: 'shop',
      title: 'THANK YOU FOR YOUR PURCHASE',
      body: 'Order confirmed — we are currently delivering it to your hangar.',
      data: { kind: 'purchase_ack', checkoutId, ...(plateId ? { plateId } : {}) },
      dedupeKey: `purchase_ack_${checkoutId}`
    }
  ])
}

async function syncCheckoutSession(
  supabase: SupabaseClient,
  userId: number,
  checkoutId: string
): Promise<number> {
  const client = getDodoClient()
  if (!client) return 0
  try {
    const session = await client.checkoutSessions.retrieve(checkoutId)
    if (session.payment_status !== 'succeeded' || !session.payment_id) return 0
    const payment = await client.payments.retrieve(session.payment_id)
    const owner = readUserId(payment.metadata)
    if (owner !== null && owner !== userId) {
      console.warn(`[Dodo] Checkout ${checkoutId} belongs to user ${owner}, not ${userId} — skipping`)
      return 0
    }
    const metadata = owner === null ? { ...payment.metadata, userId } : payment.metadata
    await rememberCustomer(supabase, userId, payment.customer.customer_id)
    const plateId = plateIdFromPayment({ ...payment, metadata })
    await ackCheckout(supabase, userId, checkoutId, plateId)
    if ((payment.subscription_ids?.length ?? 0) > 0) {
      const subscription = await client.subscriptions.retrieve(payment.subscription_ids[0])
      const subMetadata = readUserId(subscription.metadata)
        ? subscription.metadata
        : { ...subscription.metadata, userId }
      await activateSubscription(supabase, { ...subscription, metadata: subMetadata })
      return 0
    }
    if (plateId && getPlate(plateId)) {
      await grantPlatePurchase(supabase, userId, { plateId, orderId: payment.payment_id })
      return 1
    }
    return 0
  } catch (error) {
    if (error instanceof APIError && (error.status === 404 || error.status === 422)) return 0
    console.error(`[Dodo] Checkout sync failed for ${checkoutId}:`, error)
    return 0
  }
}

async function storedCustomerId(supabase: SupabaseClient, userId: number): Promise<string | null> {
  const { data, error } = await supabase.from('users').select('metadata').eq('id', userId).single()
  if (error || !data) return null
  const metadata = (data.metadata ?? {}) as Record<string, unknown>
  return typeof metadata.dodo_customer_id === 'string' && metadata.dodo_customer_id
    ? metadata.dodo_customer_id
    : null
}

/** Pull active subscriptions and paid plates for a customer we already know. */
export async function syncFromDodo(
  supabase: SupabaseClient,
  userId: number,
  checkoutId: string | null
): Promise<DodoSyncResult> {
  const { data: user } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()
  const before =
    user && typeof user.subscription_tier === 'string' && user.subscription_tier
      ? user.subscription_tier
      : 'FREE'

  let grantedPlates = 0
  if (checkoutId) grantedPlates += await syncCheckoutSession(supabase, userId, checkoutId)

  const client = getDodoClient()
  const customerId = await storedCustomerId(supabase, userId)
  if (client && customerId) {
    try {
      for await (const subscription of client.subscriptions.list({
        customer_id: customerId,
        status: 'active'
      })) {
        const subMetadata = readUserId(subscription.metadata)
          ? subscription.metadata
          : { ...subscription.metadata, userId }
        await activateSubscription(supabase, { ...subscription, metadata: subMetadata })
      }
      const owned = new Set(await getOwnedPlateIds(supabase, userId))
      for await (const payment of client.payments.list({ customer_id: customerId })) {
        if (payment.status !== 'succeeded') continue
        if (payment.refund_status) continue
        if ((payment.subscription_ids?.length ?? 0) > 0) continue
        const plateId = readPlateId(payment.metadata)
        if (!plateId || !getPlate(plateId) || owned.has(plateId)) continue
        await grantPlatePurchase(supabase, userId, { plateId, orderId: payment.payment_id })
        owned.add(plateId)
        grantedPlates += 1
      }
    } catch (error) {
      console.error(`[Dodo] Customer sync failed for user ${userId}:`, error)
    }
  }

  const { data: afterRow } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single()
  const tier =
    afterRow && typeof afterRow.subscription_tier === 'string' && afterRow.subscription_tier
      ? afterRow.subscription_tier
      : before
  return {
    tier,
    isPro: isProTier(tier),
    changed: tier !== before,
    grantedPlates
  }
}
