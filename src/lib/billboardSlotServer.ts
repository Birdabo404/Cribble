import type { SupabaseClient } from '@supabase/supabase-js'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import type { Order } from '@polar-sh/sdk/models/components/order'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_MAX_LIVE,
  type BillboardPlacement,
  type RailSlot
} from '@/lib/billboard'
import { insertMissingNotifications } from '@/lib/notifications'
import { getPolarClient, resolveBillboardSlotProductId } from '@/lib/polar'

// Server side of the self-serve billboard slot checkout (migration
// 061): the queue-aware window-start derivation the checkout route and
// activation share, plus the payment integrity core — verifying a
// Polar order against its PENDING ledger row before the ad's 7-day
// LIVE window is stamped. The structural twin of
// @/lib/leaderboardSponsorServer; the pure pricing math
// (billboardSlotGrossCents) lives isomorphically in @/lib/billboard.
//
// Metadata contract (set by POST /api/billboard/checkout, echoed back
// on the order): kind='billboard_slot' classifies the order (a key
// plate and bid fulfillment never read, so the three one-time products
// can't collide), bbAdId / bbPlacement / bbSlot / bbListCents are
// audit copies — activation trusts the LEDGER ROW, never metadata.

/** The order metadata value that marks a billboard slot checkout. */
export const BILLBOARD_SLOT_METADATA_KIND = 'billboard_slot'

/** The two placements this checkout sells. 'leaderboard' creatives
 *  settle through leaderboard_sponsor_bids instead — the checkout
 *  route refuses them before a ledger row can exist. */
export type BillboardSlotPlacement = Exclude<BillboardPlacement, 'leaderboard'>

/** True when a Polar order is (or claims to be) a billboard slot
 *  purchase: checkout metadata kind, or the configured product id —
 *  the id fallback covers hand-created orders the same way plate and
 *  bid fulfillment fall back. */
export function isBillboardSlotOrder(order: Order): boolean {
  if (order.metadata?.['kind'] === BILLBOARD_SLOT_METADATA_KIND) return true
  const productId = resolveBillboardSlotProductId()
  return Boolean(productId && order.productId === productId)
}

/* ------------------------------------------------------------------ *
 * Queue-aware window start — the queue-behind core. A paid order that
 * lands while the flipper is full or the rail slot is occupied is
 * never refused or refunded; its window is stamped at the earliest
 * instant occupancy allows. The checkout route calls the same
 * derivation to disclose the estimated go-live before the buyer pays.
 * ------------------------------------------------------------------ */

const WINDOW_DURATION_MS = BILLBOARD_DURATION_DAYS * 86_400_000

type WindowMs = { startMs: number; endMs: number }

/** Earliest start for a new 7-day flipper window: the first candidate
 *  instant (now, or just past an existing window's end — windows are
 *  inclusive on both ends per migration 030's BETWEEN, so a window
 *  still occupies its ends_at instant and the opening is 1ms later)
 *  where FEWER than BILLBOARD_MAX_LIVE existing windows cover any
 *  instant of the whole new window. Coverage only rises at window
 *  starts, so probing the candidate itself plus each start inside the
 *  span checks the entire window — queued future windows count exactly
 *  like currently-live ones. */
function flipperWindowStartMs(windows: WindowMs[], nowMs: number): number {
  const candidates = [
    nowMs,
    ...windows.map((window) => window.endMs + 1).filter((t) => t > nowMs)
  ].sort((a, b) => a - b)
  const coverage = (t: number) =>
    windows.reduce((n, window) => (window.startMs <= t && t <= window.endMs ? n + 1 : n), 0)
  for (const candidate of candidates) {
    const probes = [
      candidate,
      ...windows
        .map((window) => window.startMs)
        .filter((s) => s > candidate && s <= candidate + WINDOW_DURATION_MS)
    ]
    if (probes.every((probe) => coverage(probe) < BILLBOARD_MAX_LIVE)) return candidate
  }
  // Unreachable — the last candidate sits past every window's end, so
  // its coverage is zero; kept for the type, not for a real path.
  return candidates[candidates.length - 1]
}

/**
 * The earliest instant a new 7-day window can start for `placement`
 * (rail: for the given `slot`), counting both currently-live and
 * queued future windows on APPROVED paid ads. Returns `now` exactly
 * when the product is free right now; anything later means the buyer
 * queues. Rails serialize per slot — the new window starts just past
 * the slot's last current/future window. `excludeAdId` drops the ad
 * being activated from the read (mirroring the admin route's .neq),
 * so a stale window of its own can never queue an ad behind itself.
 * Throws on read failures — a silently-empty read would promise "live
 * now" for a full board, and activation would stamp an overlapping
 * window from the same lie.
 */
export async function slotWindowStartAt(
  supabase: SupabaseClient,
  placement: BillboardSlotPlacement,
  slot: RailSlot | null,
  now: Date = new Date(),
  excludeAdId?: number
): Promise<Date> {
  if (placement === 'rail' && !slot) {
    throw new Error('slotWindowStartAt: rail placement requires a slot')
  }

  let query = supabase
    .from('billboard_ads')
    .select('starts_at, ends_at')
    .eq('status', 'APPROVED')
    .not('paid_at', 'is', null)
    .gte('ends_at', now.toISOString())
    .eq('placement', placement)
  if (placement === 'rail') query = query.eq('rail_slot', slot)
  if (excludeAdId !== undefined) query = query.neq('id', excludeAdId)

  const { data, error } = await query
  if (error) {
    throw new Error(`billboard_ads occupancy read failed: ${error.message}`)
  }

  const windows: WindowMs[] = ((data || []) as Array<{
    starts_at: string | null
    ends_at: string | null
  }>)
    .filter((row) => row.starts_at !== null && row.ends_at !== null)
    .map((row) => ({ startMs: Date.parse(row.starts_at!), endMs: Date.parse(row.ends_at!) }))

  const nowMs = now.getTime()
  if (windows.length === 0) return now

  switch (placement) {
    case 'flipper':
      return new Date(flipperWindowStartMs(windows, nowMs))
    case 'rail': {
      // One occupant per slot: the new window starts just past the
      // slot's last current-or-future window (inclusive ends, so +1ms).
      const lastEndMs = Math.max(...windows.map((window) => window.endMs))
      return new Date(Math.max(nowMs, lastEndMs + 1))
    }
    default: {
      const exhaustive: never = placement
      return exhaustive
    }
  }
}

/* ------------------------------------------------------------------ *
 * Payment integrity — activation and revocation, shared verbatim by
 * the webhook and the pull-based sync so both paths verify the same
 * things.
 * ------------------------------------------------------------------ */

type SlotOrderRow = {
  id: number
  ad_id: number
  user_id: number
  placement: BillboardSlotPlacement
  rail_slot: RailSlot | null
  status: string
  amount_cents: number
  polar_order_id: string | null
}

export type BillboardSlotActivation =
  | 'activated'
  /** Already PAID (duplicate delivery / sync raced the webhook). */
  | 'already_active'
  /** A refund won the final PENDING -> PAID compare-and-set race. */
  | 'refunded'
  /** Not a billboard slot order — nothing to do here. */
  | 'not_a_slot_order'
  /** Verification refused the order (no ledger row, product or amount
   *  mismatch, wrong buyer, refunded row). Logged inside; retrying the
   *  delivery cannot fix these, so callers ack instead of erroring. */
  | 'refused'

/** Exact-checkout result for the post-Polar return leg. */
export type BillboardSlotCheckoutSync =
  | 'activated'
  | 'already_active'
  | 'pending'
  | 'refunded'
  | 'refused'
  | 'not_found'

const POLAR_CHECKOUT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/**
 * order.paid -> activate the PENDING ledger row the order's checkout
 * created, after verifying the money trail end to end (the same gate
 * as sponsor bids):
 *   - the ledger row for order.checkoutId exists (a paid checkout this
 *     server never created is refused, whatever its metadata claims),
 *   - the order is on the configured billboard slot product,
 *   - the charged amount (netAmount: after discounts, before taxes)
 *     equals the ledger row's server-computed GROSS amount_cents,
 *   - the payer matches the row's user_id.
 * The winner of the PENDING -> PAID compare-and-set then stamps the
 * ad's 7-day window: paid_at kept if already set (a renewal never
 * rewrites payment history), starts_at from slotWindowStartAt (now, or
 * the queued opening when the product is full — paid money is never
 * refused for a momentarily-full board), ends_at = starts_at + 7 days,
 * rail_slot from the ledger row. The ad update carries the same
 * status + starts_at concurrency guard as the admin activate route; a
 * lost guard (concurrent admin action, or the ad archived after
 * checkout) keeps the PAID ledger row as the money truth and logs for
 * ops instead of pretending the payment didn't happen. Occupancy
 * read-then-write between two racing webhooks stays best-effort — the
 * accepted stance documented on the admin route.
 * Idempotent: duplicate deliveries and webhook/sync races collapse to
 * 'already_active'. Throws only on database failures (retryable);
 * every permanent verification refusal logs and returns 'refused'.
 */
export async function activateBillboardSlotFromOrder(
  supabase: SupabaseClient,
  order: Order
): Promise<BillboardSlotActivation> {
  if (!isBillboardSlotOrder(order)) return 'not_a_slot_order'

  if (!order.checkoutId) {
    console.warn(`[BillboardSlot] Slot order ${order.id} carries no checkout id — refusing`)
    return 'refused'
  }

  const { data, error: readError } = await supabase
    .from('billboard_slot_orders')
    .select('id, ad_id, user_id, placement, rail_slot, status, amount_cents, polar_order_id')
    .eq('polar_checkout_id', order.checkoutId)
    .maybeSingle()

  if (readError) {
    throw new Error(
      `Failed to read slot ledger for checkout ${order.checkoutId}: ${readError.message}`
    )
  }
  const row = data as unknown as SlotOrderRow | null
  if (!row) {
    console.warn(
      `[BillboardSlot] Order ${order.id} claims a slot purchase but no ledger row exists for checkout ${order.checkoutId} — refusing`
    )
    return 'refused'
  }
  if (row.status === 'PAID') return 'already_active'
  if (row.status === 'REFUNDED') {
    console.warn(
      `[BillboardSlot] Order ${order.id} arrived for an already-REFUNDED slot order ${row.id} — refusing`
    )
    return 'refused'
  }
  if (row.status === 'VOID') return 'refused'

  const productId = resolveBillboardSlotProductId()
  if (!productId || order.productId !== productId) {
    console.warn(
      `[BillboardSlot] Order ${order.id} product ${order.productId} does not match the configured slot product — refusing slot order ${row.id}`
    )
    return 'refused'
  }

  // The ledger's amount_cents are USD cents (the ad-hoc price is pinned
  // to 'usd' at checkout creation), so the order must be USD before its
  // minor units are compared at all.
  if (order.currency !== 'usd') {
    console.warn(
      `[BillboardSlot] Order ${order.id} is in '${order.currency}', not usd — refusing slot order ${row.id}`
    )
    return 'refused'
  }

  // The amount Polar actually charged must be exactly the GROSS
  // fee-grossed-up price this server computed into the ledger — never
  // the advertised sticker.
  if (order.netAmount !== Number(row.amount_cents)) {
    console.warn(
      `[BillboardSlot] Order ${order.id} charged ${order.netAmount}c but ledger row ${row.id} expects ${row.amount_cents}c — refusing`
    )
    return 'refused'
  }

  // The payer must be the buyer who created the checkout. Metadata
  // userId is stamped server-side at checkout creation, so it is the
  // stronger witness (see the webhook's resolveRecipientUserId story).
  const metaUserId = Number(order.metadata?.['userId'])
  if (!Number.isSafeInteger(metaUserId) || metaUserId !== Number(row.user_id)) {
    console.warn(
      `[BillboardSlot] Order ${order.id} metadata userId=${String(order.metadata?.['userId'])} does not exactly match ledger row ${row.id} user ${row.user_id} — refusing`
    )
    return 'refused'
  }

  // The window this payment grants, derived just before the guarded
  // update so it sees the freshest occupancy. Both racing activators
  // compute it; only the compare-and-set winner stamps anything.
  const now = new Date()
  const nowMs = now.getTime()
  const adId = Number(row.ad_id)
  const railSlot: RailSlot | null = row.placement === 'rail' ? row.rail_slot : null

  const { data: adData, error: adReadError } = await supabase
    .from('billboard_ads')
    .select('id, status, paid_at, starts_at, ends_at')
    .eq('id', adId)
    .maybeSingle()
  if (adReadError) {
    throw new Error(`Failed to read ad ${adId} for slot order ${row.id}: ${adReadError.message}`)
  }
  const ad = adData as unknown as {
    id: number
    status: string
    paid_at: string | null
    starts_at: string | null
    ends_at: string | null
  } | null

  const startsAt = await slotWindowStartAt(supabase, row.placement, railSlot, now, adId)
  const startsAtIso = startsAt.toISOString()
  const endsAtIso = new Date(startsAt.getTime() + WINDOW_DURATION_MS).toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('billboard_slot_orders')
    .update({
      status: 'PAID',
      polar_order_id: order.id,
      // paid_at is the ORDER's creation moment, not webhook arrival —
      // delivery lag never rewrites when the money actually landed.
      paid_at: order.createdAt.toISOString(),
      window_starts_at: startsAtIso,
      window_ends_at: endsAtIso,
      updated_at: now.toISOString()
    })
    .eq('id', row.id)
    .eq('status', 'PENDING')
    .select('id')

  if (updateError) {
    throw new Error(`Failed to activate slot order ${row.id}: ${updateError.message}`)
  }
  if (!updated || updated.length === 0) {
    // A concurrent writer won the PENDING guard. Distinguish a
    // duplicate activation from a racing refund instead of telling the
    // returning buyer a refunded window is live.
    const { data: finalData, error: finalReadError } = await supabase
      .from('billboard_slot_orders')
      .select('status')
      .eq('id', row.id)
      .maybeSingle()
    if (finalReadError) {
      throw new Error(
        `Failed to confirm final status for slot order ${row.id}: ${finalReadError.message}`
      )
    }
    const finalStatus = (finalData as unknown as { status?: string } | null)?.status
    if (finalStatus === 'PAID') return 'already_active'
    if (finalStatus === 'REFUNDED') return 'refunded'
    return 'refused'
  }

  // The CAS winner stamps the ad window, guarded on status AND the
  // starts_at read above (the admin route's guard): a concurrent
  // manual activation or archive matches zero rows here, and the PAID
  // ledger row stays the money truth for ops to reconcile.
  if (!ad || ad.status !== 'APPROVED') {
    console.error(
      `[BillboardSlot] Slot order ${row.id} is PAID but ad ${adId} is ${ad ? ad.status : 'missing'} — no window stamped; refund or restore manually`
    )
    return 'activated'
  }

  let adUpdate = supabase
    .from('billboard_ads')
    .update({
      // Kept if already set — a renewal of an expired window doesn't
      // rewrite payment history (the admin route's rule).
      paid_at: ad.paid_at ?? order.createdAt.toISOString(),
      starts_at: startsAtIso,
      ends_at: endsAtIso,
      rail_slot: railSlot,
      updated_at: now.toISOString()
    })
    .eq('id', adId)
    .eq('status', 'APPROVED')
  adUpdate =
    ad.starts_at === null
      ? adUpdate.is('starts_at', null)
      : adUpdate.eq('starts_at', ad.starts_at)
  const { data: adUpdated, error: adUpdateError } = await adUpdate.select('id')

  if (adUpdateError) {
    // The money is settled (ledger PAID) but the window write failed —
    // throwing here would make Polar retry into 'already_active' and
    // never stamp, so surface the failure loudly instead.
    console.error(
      `[BillboardSlot] Slot order ${row.id} is PAID but stamping ad ${adId}'s window failed — fix manually:`,
      adUpdateError.message
    )
    return 'activated'
  }
  if (!adUpdated || adUpdated.length === 0) {
    console.error(
      `[BillboardSlot] Slot order ${row.id} is PAID but ad ${adId} changed concurrently — no window stamped; reconcile manually`
    )
    return 'activated'
  }

  // Best-effort: tell the buyer whether they're live right now or
  // queued behind a full board. Keyed on the granted window start so a
  // renewal notifies again while a redelivery cannot; a notification
  // failure must never throw out of the payment path.
  try {
    const queued = startsAt.getTime() > nowMs
    const goLiveDate = startsAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    })
    await insertMissingNotifications(supabase, Number(row.user_id), [
      queued
        ? {
            type: 'premium',
            title: 'SPONSORSHIP AD QUEUED',
            body: `Payment received — every slot is taken right now, so your sponsor ad goes LIVE ${goLiveDate} and runs ${BILLBOARD_DURATION_DAYS} days from there.`,
            data: {
              kind: BILLBOARD_SLOT_METADATA_KIND,
              result: 'queued',
              adId,
              startsAt: startsAtIso,
              endsAt: endsAtIso
            },
            dedupeKey: `billboard_${adId}_queued_${startsAtIso}`
          }
        : {
            type: 'premium',
            title: 'SPONSORSHIP AD LIVE',
            body: `Payment received — your sponsor ad is LIVE for the next ${BILLBOARD_DURATION_DAYS} days.`,
            data: {
              kind: BILLBOARD_SLOT_METADATA_KIND,
              result: 'live',
              adId,
              startsAt: startsAtIso,
              endsAt: endsAtIso
            },
            dedupeKey: `billboard_${adId}_live_${startsAtIso}`
          }
    ])
  } catch (notifyError) {
    console.error(
      `[BillboardSlot] Buyer notification failed for slot order ${row.id}:`,
      notifyError
    )
  }

  return 'activated'
}

/**
 * order.refunded -> revoke the purchase. Keyed by the order's CHECKOUT
 * id whenever it carries one (falling back to the stamped
 * polar_order_id), because the checkout id exists on the ledger row
 * from creation while polar_order_id is only stamped at activation: a
 * refund delivered before — or interleaved with — the order.paid leg
 * must still land, or the retried activation would stamp a window for
 * refunded money. The guarded PENDING/PAID -> REFUNDED update runs
 * FIRST (activation refuses REFUNDED rows, which closes the ordering
 * race), then the window this order granted is taken back from the
 * returned rows: a window that hasn't started is nulled off the ad
 * (rail_slot freed with it), a running one is cut to now, and a
 * long-finished one is left alone — every ad write is guarded on the
 * exact window_starts_at this order stamped, so a refund can never
 * strike a later renewal's window. Idempotent, and matches nothing
 * for non-slot orders (it runs blind, like plate revocation).
 */
export async function revokeBillboardSlotFromOrder(
  supabase: SupabaseClient,
  order: Order
): Promise<void> {
  const nowIso = new Date().toISOString()
  const revocation = supabase
    .from('billboard_slot_orders')
    .update({
      status: 'REFUNDED',
      refunded_at: nowIso,
      updated_at: nowIso
    })
    .in('status', ['PENDING', 'PAID'])

  const { data, error } = await (order.checkoutId
    ? revocation.eq('polar_checkout_id', order.checkoutId)
    : revocation.eq('polar_order_id', order.id)
  ).select('id, ad_id, window_starts_at')

  if (error) {
    throw new Error(`Failed to revoke slot order for order ${order.id}: ${error.message}`)
  }

  const rows = (data || []) as unknown as Array<{
    id: number
    ad_id: number
    window_starts_at: string | null
  }>
  for (const row of rows) {
    // A refund that struck a still-PENDING row granted no window.
    if (!row.window_starts_at) continue

    if (Date.parse(row.window_starts_at) > Date.parse(nowIso)) {
      // The granted window hasn't started: take the whole schedule
      // back (a rail slot frees with it). Guarded to THIS window so a
      // concurrent restamp survives untouched.
      const { error: clearError } = await supabase
        .from('billboard_ads')
        .update({ starts_at: null, ends_at: null, rail_slot: null, updated_at: nowIso })
        .eq('id', Number(row.ad_id))
        .eq('starts_at', row.window_starts_at)
      if (clearError) {
        throw new Error(
          `Failed to clear the refunded window on ad ${row.ad_id}: ${clearError.message}`
        )
      }
    } else {
      // Running window: cut it to now. The ends_at guard means an
      // already-finished window is never EXTENDED to now by a late
      // refund — a completed run stays history.
      const { error: cutError } = await supabase
        .from('billboard_ads')
        .update({ ends_at: nowIso, updated_at: nowIso })
        .eq('id', Number(row.ad_id))
        .eq('starts_at', row.window_starts_at)
        .gt('ends_at', nowIso)
      if (cutError) {
        throw new Error(
          `Failed to cut the refunded window on ad ${row.ad_id}: ${cutError.message}`
        )
      }
    }
  }
}

/** Money went back — these orders must never activate. Mirrors the
 *  sponsor sync's stance; OrderStatus is an open enum, so membership
 *  is checked as plain strings. */
const REFUNDED_ORDER_STATUSES = new Set<string>(['refunded', 'partially_refunded'])

/**
 * Reconcile the exact checkout Polar returned in success_url — the
 * slot twin of syncSponsorBidCheckoutFromPolar. Ownership is proven
 * against the service-role ledger before Polar is queried, then Orders
 * is filtered by checkout_id rather than external_customer_id (Polar
 * may merge a same-email buyer onto a customer whose external id
 * belongs to another Cribble account; checkout metadata + this ledger
 * row remain the reliable pair). A completed checkout that permanently
 * fails the shared integrity gate is VOIDed so it stops looking like
 * money in flight.
 */
export async function syncBillboardSlotCheckoutFromPolar(
  supabase: SupabaseClient,
  userId: number,
  checkoutId: string
): Promise<BillboardSlotCheckoutSync> {
  if (!POLAR_CHECKOUT_ID_RE.test(checkoutId)) return 'not_found'

  const { data, error: ledgerError } = await supabase
    .from('billboard_slot_orders')
    .select('id, ad_id, user_id, placement, rail_slot, status, amount_cents, polar_order_id')
    .eq('polar_checkout_id', checkoutId)
    .eq('user_id', userId)
    .maybeSingle()

  if (ledgerError) {
    throw new Error(
      `Failed to read slot ledger for checkout ${checkoutId}: ${ledgerError.message}`
    )
  }
  const row = data as unknown as SlotOrderRow | null
  if (!row) return 'not_found'
  if (row.status === 'PAID') return 'already_active'
  if (row.status === 'REFUNDED') return 'refunded'
  if (row.status === 'VOID') return 'refused'

  const polar = getPolarClient()
  if (!polar) return 'pending'

  const orders: Order[] = []
  try {
    const pages = await polar.orders.list({ checkoutId, limit: 10 })
    for await (const page of pages) orders.push(...page.result.items)
  } catch (error) {
    if (
      error instanceof PolarError &&
      (error.statusCode === 404 || error.statusCode === 422)
    ) {
      return 'pending'
    }
    throw error
  }

  const order = orders.find((candidate) => candidate.checkoutId === checkoutId && candidate.paid)
  if (!order) return 'pending'

  if (REFUNDED_ORDER_STATUSES.has(order.status)) {
    await revokeBillboardSlotFromOrder(supabase, order)
    return 'refunded'
  }

  const activation = await activateBillboardSlotFromOrder(supabase, order)
  if (
    activation === 'activated' ||
    activation === 'already_active' ||
    activation === 'refunded'
  ) {
    return activation
  }

  // A completed checkout that permanently fails the shared integrity
  // gate must stop looking like money still "in flight". Keep the row
  // for audit, but remove it from pending UI scans.
  const { error: voidError } = await supabase
    .from('billboard_slot_orders')
    .update({
      status: 'VOID',
      failure_reason: 'payment_verification_failed',
      updated_at: new Date().toISOString()
    })
    .eq('polar_checkout_id', checkoutId)
    .eq('user_id', userId)
    .eq('status', 'PENDING')

  if (voidError) {
    throw new Error(`Failed to void refused slot checkout ${checkoutId}: ${voidError.message}`)
  }
  return 'refused'
}
