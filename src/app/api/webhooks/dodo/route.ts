import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Webhook, WebhookVerificationError } from 'standardwebhooks'
import { z } from 'zod'
import {
  getDodoWebhookSecret,
  isTeamSubscription,
  readMetadataPlateId,
  readMetadataUserId,
  resolvePlateIdForProduct,
  type DodoMetadata
} from '@/lib/dodo'
import { findUserIdByDodoCustomer, linkDodoCustomer } from '@/lib/dodoCustomer'
import {
  grantPlatePurchase,
  grantProEntitlement,
  grantTeamEntitlement
} from '@/lib/entitlementGrant'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { createServiceClient } from '@/lib/supabaseServer'

// Dodo Payments webhook receiver. Signature-verified (Standard Webhooks
// HMAC), idempotent via the payment_events table (unique event_id): an
// event id that inserts cleanly is processed, a duplicate delivery is
// acked and skipped.
//
// Dodo delivers the LATEST snapshot of the object with every event (not
// the state at event time), so subscription handling keys off
// data.status rather than the event name — a delayed or reordered
// delivery still carries the truth:
//   subscription.* with status 'active'
//                         -> team product (configured id): grantTeamEntitlement
//                            (tier 'TEAM', review gate, team_since);
//                            anything else: grantProEntitlement (tier
//                            'PRO', premium_since, welcome notification
//                            — shared with the sync endpoint)
//   subscription.* with status 'cancelled' | 'expired' | 'on_hold'
//                         -> tier back to 'FREE', guarded to the tier
//                            this integration granted ('TEAM' for team
//                            products, 'PRO' otherwise); manually set
//                            tiers and house complimentary accounts
//                            (see houseEntitlements) are left alone.
//                            on_hold = a renewal failed for good after
//                            the past_due grace period; Dodo re-fires
//                            subscription.active when the customer fixes
//                            their card, which re-grants.
//   subscription.* with any other status (pending, past_due, paused,
//                            failed) -> no-op; past_due keeps access
//                            until the grace deadline by Dodo's contract.
//   payment.succeeded     -> grant plate in user_cosmetics if the payment
//                            is a plate purchase (checkout metadata
//                            plateId, or the product id reverse-mapped
//                            through DODO_PLATE_PRODUCT_MAP); subscription
//                            cycle payments carry subscription_id and are
//                            a no-op
//   refund.succeeded      -> delete user_cosmetics rows by
//                            source_order_id = payment_id
// Everything else is recorded for audit and acked. Every processed object
// also links its Dodo customer id to the resolved user (dodoCustomer.ts)
// so the pull-based sync and the portal can find the customer later.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

/** The event types this endpoint subscribes to (scripts/setup-dodo.ts).
 *  If one of THESE fails shape validation, acking would silently drop a
 *  grant or revoke — so the route asks Dodo to retry instead. Anything
 *  outside this set keeps the audit-and-ack behavior. */
const SUBSCRIBED_EVENT_TYPES = new Set([
  'subscription.active',
  'subscription.renewed',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.expired',
  'subscription.on_hold',
  'payment.succeeded',
  'refund.succeeded'
])

const metadataSchema = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .nullable()
  .optional()

const customerSchema = z
  .object({ customer_id: z.string() })
  .nullable()
  .optional()

const envelopeSchema = z.object({
  type: z.string(),
  data: z.record(z.unknown())
})

const subscriptionSchema = z.object({
  subscription_id: z.string(),
  product_id: z.string(),
  status: z.string(),
  customer: customerSchema,
  metadata: metadataSchema
})
type SubscriptionData = z.infer<typeof subscriptionSchema>

const paymentSchema = z.object({
  payment_id: z.string(),
  status: z.string().nullable().optional(),
  subscription_id: z.string().nullable().optional(),
  product_cart: z
    .array(z.object({ product_id: z.string(), quantity: z.number() }))
    .nullable()
    .optional(),
  customer: customerSchema,
  metadata: metadataSchema
})
type PaymentData = z.infer<typeof paymentSchema>

const refundSchema = z.object({
  refund_id: z.string(),
  payment_id: z.string(),
  status: z.string()
})

/** Statuses that end access. `failed` (mandate never created — nothing
 *  was granted) and `paused` (merchant-side, no customer path) are
 *  deliberately not here. */
const REVOKING_SUBSCRIPTION_STATUSES = new Set(['cancelled', 'expired', 'on_hold'])

/** The recipient of a grant/revoke. Checkout metadata `userId` wins:
 *  /api/checkout stamps it server-side from the authenticated session, so
 *  it is the buyer's identity. The customer record is only a fallback for
 *  dashboard-created objects — Dodo attaches same-email checkouts (and
 *  live sessions) to an EXISTING customer record, so the object's
 *  customer can belong to a different Cribble account than the one that
 *  clicked buy. (The Polar-era incident this guards against: order
 *  01b96e56 carried metadata userId 13 on customer external_id 19.) */
async function resolveRecipientUserId(data: {
  metadata?: DodoMetadata | null
  customer?: { customer_id: string } | null
}): Promise<number | null> {
  const fromMetadata = readMetadataUserId(data.metadata)
  const customerId = data.customer?.customer_id ?? null

  if (fromMetadata !== null) {
    // Remember the customer for the sync/portal paths. First link wins;
    // a mismatch is logged inside and never blocks fulfillment.
    if (customerId) await linkDodoCustomer(supabase, fromMetadata, customerId)
    return fromMetadata
  }
  if (!customerId) return null
  return findUserIdByDodoCustomer(supabase, customerId)
}

/** Plate id for a payment: checkout metadata `plateId` (set by
 *  /api/checkout) or its snake_case variant (hand-created payments), else
 *  the single cart product reverse-mapped through DODO_PLATE_PRODUCT_MAP
 *  (Dodo payments carry no product metadata). Null for subscription-cycle
 *  payments and anything else — nothing to grant. */
function readPlateId(payment: PaymentData): string | null {
  if (payment.subscription_id) return null
  const fromMetadata = readMetadataPlateId(payment.metadata)
  if (fromMetadata) return fromMetadata
  const cart = payment.product_cart ?? []
  if (cart.length === 1) return resolvePlateIdForProduct(cart[0].product_id)
  return null
}

/** status 'active' -> full fulfillment via the shared helpers. Team
 *  products (matched by configured Dodo product id — see
 *  isTeamSubscription) set tier 'TEAM' and open the manual review gate;
 *  every other subscription is a Pro product — that grant is identical
 *  for every Pro interval. */
async function activateSubscription(subscription: SubscriptionData) {
  const userId = await resolveRecipientUserId(subscription)
  if (!userId) {
    console.warn('[DodoWebhook] Subscription event without usable recipient — skipping')
    return
  }

  const grant = isTeamSubscription(subscription)
    ? grantTeamEntitlement
    : grantProEntitlement

  await grant(supabase, userId, {
    productId: subscription.product_id,
    sourceId: subscription.subscription_id
  })
}

/** Access-ending status -> tier back to FREE, guarded to the tier this
 *  integration granted for the product ('TEAM' for team products —
 *  classified exactly like the grant — 'PRO' otherwise). A manually
 *  granted PREMIUM/PREMIUM+ survives a lapsed Dodo sub (mirroring the
 *  upgrade-only sync); the admin panel's revoke_pro stays the explicit
 *  path for clearing manual tiers. team_review_status is deliberately
 *  left untouched: approval is a fact about identity, not payment —
 *  badges are gated on tier AND approval, so the lapse hides them and a
 *  renewal re-lights them without a second review. Owned plate rows are
 *  never touched (one-time purchases outlive the sub); pro-exclusive
 *  equips self-heal at read time via resolveEquippedPlate. */
async function revokeSubscription(subscription: SubscriptionData) {
  const userId = await resolveRecipientUserId(subscription)
  if (!userId) {
    console.warn('[DodoWebhook] Subscription event without usable recipient — skipping')
    return
  }

  // House complimentary Pro / Team is not Dodo-backed. A leftover or
  // cancelled Dodo subscription must never FREE those rows.
  if (houseGrantFor({ id: userId })) {
    console.warn(`[DodoWebhook] Refusing to revoke house entitlement for user ${userId}`)
    return
  }

  const grantedTier = isTeamSubscription(subscription) ? 'TEAM' : 'PRO'

  const { error } = await supabase
    .from('users')
    .update({ subscription_tier: 'FREE' })
    .eq('id', userId)
    .eq('subscription_tier', grantedTier)

  if (error) {
    throw new Error(`Failed to set subscription_tier=FREE for user ${userId}: ${error.message}`)
  }
}

async function processSubscriptionEvent(subscription: SubscriptionData) {
  if (subscription.status === 'active') {
    await activateSubscription(subscription)
  } else if (REVOKING_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    await revokeSubscription(subscription)
  }
  // pending / past_due / paused / failed: audit only.
}

/** payment.succeeded -> plate fulfillment via the shared purchase helper
 *  (ownership upsert + "delivered" notification), shared with the
 *  pull-based payment reconciliation in subscriptionSync. */
async function grantPlateFromPayment(payment: PaymentData) {
  // Dodo sends the latest snapshot; a payment that has since failed or
  // been cancelled must not grant even under a payment.succeeded label.
  if (payment.status && payment.status !== 'succeeded') return

  const plateId = readPlateId(payment)
  if (!plateId) {
    // Subscription-cycle payment or unmapped product — still worth
    // linking the customer for the sync/portal paths.
    await resolveRecipientUserId(payment)
    return
  }

  const userId = await resolveRecipientUserId(payment)
  if (!userId) {
    console.warn('[DodoWebhook] payment.succeeded without usable recipient — skipping')
    return
  }

  await grantPlatePurchase(supabase, userId, { plateId, orderId: payment.payment_id })
}

async function revokePlateFromRefund(paymentId: string) {
  const { error } = await supabase
    .from('user_cosmetics')
    .delete()
    .eq('source_order_id', paymentId)

  if (error) {
    throw new Error(`Failed to revoke cosmetics for payment ${paymentId}: ${error.message}`)
  }
}

type ParsedEvent =
  | { kind: 'subscription'; data: SubscriptionData }
  | { kind: 'payment'; data: PaymentData }
  | { kind: 'refund'; paymentId: string }
  | { kind: 'other' }

/** Narrow a verified envelope to the shape its handler needs. Returns
 *  null when a SUBSCRIBED type fails validation — the caller turns that
 *  into a retry rather than a silent ack. */
function parseEvent(type: string, data: Record<string, unknown>): ParsedEvent | null {
  if (type.startsWith('subscription.')) {
    const parsed = subscriptionSchema.safeParse(data)
    return parsed.success ? { kind: 'subscription', data: parsed.data } : null
  }
  if (type === 'payment.succeeded') {
    const parsed = paymentSchema.safeParse(data)
    return parsed.success ? { kind: 'payment', data: parsed.data } : null
  }
  if (type === 'refund.succeeded') {
    const parsed = refundSchema.safeParse(data)
    if (!parsed.success) return null
    // A refund that later failed/reversed arrives with its current status.
    return parsed.data.status === 'succeeded'
      ? { kind: 'refund', paymentId: parsed.data.payment_id }
      : { kind: 'other' }
  }
  return { kind: 'other' }
}

async function processEvent(event: ParsedEvent) {
  switch (event.kind) {
    case 'subscription':
      await processSubscriptionEvent(event.data)
      return
    case 'payment':
      await grantPlateFromPayment(event.data)
      return
    case 'refund':
      await revokePlateFromRefund(event.paymentId)
      return
    case 'other':
      return
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export async function POST(request: NextRequest) {
  const secret = getDodoWebhookSecret()
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'Webhook not configured' },
      { status: 503 }
    )
  }

  const rawBody = await request.text()

  // Signature check first — nothing touches the database on a bad signature.
  try {
    new Webhook(secret).verify(rawBody, {
      'webhook-id': request.headers.get('webhook-id') ?? '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': request.headers.get('webhook-signature') ?? ''
    })
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ received: false }, { status: 403 })
    }
    throw error
  }

  let rawPayload: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rawPayload = parsed as Record<string, unknown>
    }
  } catch {
    rawPayload = null
  }

  const envelope = envelopeSchema.safeParse(rawPayload)
  const eventType = envelope.success
    ? envelope.data.type
    : typeof rawPayload?.type === 'string'
      ? rawPayload.type
      : 'unknown'

  // A subscribed event whose shape this route doesn't recognize must NOT
  // be acked (and must not burn its idempotency row) — 500 here makes
  // Dodo redeliver, and a later fix processes the retry.
  const event = envelope.success ? parseEvent(envelope.data.type, envelope.data.data) : null
  if (!event && SUBSCRIBED_EVENT_TYPES.has(eventType)) {
    console.error(`[DodoWebhook] Failed to parse subscribed event ${eventType} — asking Dodo to retry`)
    return NextResponse.json(
      { success: false, error: 'Failed to parse event' },
      { status: 500 }
    )
  }

  const eventId =
    request.headers.get('webhook-id') ||
    createHash('sha256').update(rawBody).digest('hex')

  // Idempotency gate: first writer wins on event_id; a duplicate delivery
  // hits the unique constraint and gets acked without side effects.
  const { error: insertError } = await supabase.from('payment_events').insert({
    event_id: eventId,
    event_type: eventType,
    payload: rawPayload
  })

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, skipped: true })
    }
    console.error('[DodoWebhook] Failed to record event:', insertError)
    return NextResponse.json(
      { success: false, error: 'Failed to record event' },
      { status: 500 }
    )
  }

  if (!event) {
    return NextResponse.json({ received: true })
  }

  try {
    await processEvent(event)
  } catch (error) {
    console.error(`[DodoWebhook] Failed to process ${eventType} (${eventId}):`, error)
    // Release the idempotency marker so Dodo's retry can re-process.
    await supabase.from('payment_events').delete().eq('event_id', eventId)
    return NextResponse.json(
      { success: false, error: 'Failed to process event' },
      { status: 500 }
    )
  }

  return NextResponse.json({ received: true })
}
