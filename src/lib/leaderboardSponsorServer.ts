import type { SupabaseClient } from '@supabase/supabase-js'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import type { Order } from '@polar-sh/sdk/models/components/order'
import type { BillboardStatus } from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_PENDING_TTL_MS,
  LEADERBOARD_SPONSOR_WINDOW_MS,
  rankLeaderboardSponsors,
  type LeaderboardSponsorEntry,
  type LeaderboardStanding
} from '@/lib/leaderboardSponsor'
import { getPolarClient, resolveLeaderboardBidProductId } from '@/lib/polar'

// Server side of the leaderboard sponsor ranking (migration 055): the
// board derivation the read routes and the checkout race check share,
// plus the payment integrity core — verifying a Polar order against
// its PENDING ledger row before a contribution activates. The pure
// math and payload shapes live in @/lib/leaderboardSponsor; this
// module owns everything that needs the database or the Polar SDK.
//
// Metadata contract (set by POST /api/billboard/leaderboard/checkout,
// echoed back on the order): kind='leaderboard_bid' classifies the
// order (a key plate fulfillment never reads, so the two one-time
// products can't collide), lbAdId / lbTargetCents / lbChargeCents are
// audit copies — activation trusts the LEDGER ROW, never metadata
// amounts.

/** The order metadata value that marks a leaderboard sponsor checkout. */
export const LEADERBOARD_BID_METADATA_KIND = 'leaderboard_bid'

/** True when a Polar order is (or claims to be) a leaderboard sponsor
 *  bid: checkout metadata kind, or the configured product id — the id
 *  fallback covers hand-created orders the same way plate fulfillment
 *  falls back to product metadata. */
export function isLeaderboardBidOrder(order: Order): boolean {
  if (order.metadata?.['kind'] === LEADERBOARD_BID_METADATA_KIND) return true
  const productId = resolveLeaderboardBidProductId()
  return Boolean(productId && order.productId === productId)
}

/* ------------------------------------------------------------------ *
 * Board derivation
 * ------------------------------------------------------------------ */

/** The billboard_ads slice every sponsor read needs. */
type SponsorAdRow = {
  id: number
  owner_user_id: number | null
  status: BillboardStatus
  review_note: string | null
  text: string
  company_name: string | null
  link_url: string
  logo_url: string | null
  accent_color: string | null
  clicks: number
}

type PaidBidRow = {
  ad_id: number
  amount_cents: number
  paid_at: string
}

/** Local mirror of /api/billboard's linkHostOf (kept in copy-sync —
 *  the fallback is a display rule, not a module): the link's bare
 *  hostname, lowercased, 'www.' stripped; '' when the stored URL
 *  fails to parse. */
export function sponsorLinkHostOf(linkUrl: string): string {
  try {
    return new URL(linkUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Derive the active sponsor board at `now`: PAID ledger rows inside
 * the rolling 24h window, restricted to APPROVED 'leaderboard'
 * creatives, aggregated and ranked by rankLeaderboardSponsors (total
 * desc, earlier first payment breaks ties). Contributions whose
 * creative is not currently APPROVED (archived, or hand-flipped in
 * the database) are excluded BEFORE ranking, so lower sponsors shift
 * up rather than queue behind a ghost. logoUrl carries the owner-
 * avatar fallback, exactly like the flipper feed. Throws on read
 * failures — the board is the paid product, a silent empty board
 * would misprice the next bid.
 */
export async function loadSponsorBoard(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<LeaderboardSponsorEntry[]> {
  const cutoffIso = new Date(now.getTime() - LEADERBOARD_SPONSOR_WINDOW_MS).toISOString()

  const { data: bidData, error: bidsError } = await supabase
    .from('leaderboard_sponsor_bids')
    .select('ad_id, amount_cents, paid_at')
    .eq('status', 'PAID')
    .gt('paid_at', cutoffIso)

  if (bidsError) {
    throw new Error(`leaderboard_sponsor_bids read failed: ${bidsError.message}`)
  }
  const bids = (bidData || []) as unknown as PaidBidRow[]
  if (bids.length === 0) return []

  const adIds = [...new Set(bids.map((bid) => Number(bid.ad_id)))]
  const { data: adData, error: adsError } = await supabase
    .from('billboard_ads')
    .select(
      'id, owner_user_id, status, review_note, text, company_name, link_url, logo_url, accent_color, clicks'
    )
    .in('id', adIds)
    .eq('placement', 'leaderboard')
    .eq('status', 'APPROVED')

  if (adsError) {
    throw new Error(`billboard_ads read failed: ${adsError.message}`)
  }
  const adsById = new Map<number, SponsorAdRow>()
  for (const ad of (adData || []) as unknown as SponsorAdRow[]) {
    adsById.set(Number(ad.id), ad)
  }

  // Approval is a liveness condition: contributions to a non-approved
  // creative are dropped before ranking, never ranked-then-hidden.
  const standings = rankLeaderboardSponsors(
    bids
      .filter((bid) => adsById.has(Number(bid.ad_id)))
      .map((bid) => ({
        adId: Number(bid.ad_id),
        amountCents: Number(bid.amount_cents),
        paidAtMs: Date.parse(bid.paid_at)
      })),
    now.getTime()
  )

  // Owner-avatar fallback for creatives without a logo — same source
  // (users.twitter_profile_image) and same active-account filter as
  // the flipper feed; a failed read degrades to no fallback.
  const fallbackOwnerIds = [
    ...new Set(
      standings
        .map((standing) => adsById.get(standing.adId)!)
        .filter((ad) => !ad.logo_url && ad.owner_user_id !== null)
        .map((ad) => Number(ad.owner_user_id))
    )
  ]
  const avatarByUserId = new Map<number, string | null>()
  if (fallbackOwnerIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, twitter_profile_image')
      .in('id', fallbackOwnerIds)
      .or('status.is.null,status.eq.active')
    if (usersError) {
      console.warn('[LeaderboardSponsor] Users read failed:', usersError.message)
    } else {
      for (const row of (users || []) as Array<{ id: number; twitter_profile_image: string | null }>) {
        avatarByUserId.set(Number(row.id), row.twitter_profile_image || null)
      }
    }
  }

  return standings.map((standing) => {
    const ad = adsById.get(standing.adId)!
    const ownerAvatar =
      ad.owner_user_id !== null
        ? avatarByUserId.get(Number(ad.owner_user_id)) || null
        : null
    return sponsorEntryOf(standing, ad, ownerAvatar)
  })
}

function sponsorEntryOf(
  standing: LeaderboardStanding,
  ad: SponsorAdRow,
  ownerAvatar: string | null
): LeaderboardSponsorEntry {
  return {
    adId: standing.adId,
    rank: standing.rank,
    companyName: ad.company_name || null,
    linkHost: sponsorLinkHostOf(ad.link_url),
    text: ad.text,
    logoUrl: ad.logo_url || ownerAvatar,
    accentColor: ad.accent_color || null,
    clicks: Number(ad.clicks) || 0,
    activeCents: standing.activeCents,
    nextDropAt: new Date(standing.nextDropAtMs).toISOString(),
    expiresAt: new Date(standing.expiresAtMs).toISOString()
  }
}

/* ------------------------------------------------------------------ *
 * Payment integrity — activation and revocation, shared verbatim by
 * the webhook and the pull-based sync so both paths verify the same
 * things.
 * ------------------------------------------------------------------ */

type PendingBidRow = {
  id: number
  ad_id: number
  user_id: number
  status: string
  amount_cents: number
  polar_order_id: string | null
}

export type SponsorBidActivation =
  | 'activated'
  /** Already PAID (duplicate delivery / sync raced the webhook). */
  | 'already_active'
  /** A refund won the final PENDING -> PAID compare-and-set race. */
  | 'refunded'
  /** Not a leaderboard bid order — nothing to do here. */
  | 'not_a_bid'
  /** Verification refused the order (no ledger row, product or amount
   *  mismatch, wrong buyer, refunded row). Logged inside; retrying the
   *  delivery cannot fix these, so callers ack instead of erroring. */
  | 'refused'

/** Exact-checkout result for the post-Polar return leg. Unlike the broad
 *  account reconciliation below, this can accurately tell the browser
 *  what happened to the checkout it just completed. */
export type SponsorBidCheckoutSync =
  | 'activated'
  | 'already_active'
  | 'pending'
  | 'refunded'
  | 'refused'
  | 'not_found'

const POLAR_CHECKOUT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/**
 * order.paid -> activate the PENDING ledger row the order's checkout
 * created, after verifying the money trail end to end:
 *   - the ledger row for order.checkoutId exists (a paid checkout this
 *     server never created is refused, whatever its metadata claims),
 *   - the order is on the configured sponsor product,
 *   - the charged amount (netAmount: after discounts, before taxes)
 *     equals the ledger row's server-computed amount_cents,
 *   - the payer matches the row's user_id.
 * paid_at is stamped from the ORDER's creation moment, not webhook
 * arrival, so delivery lag never extends a contribution's 24 hours.
 * Idempotent: the UPDATE is guarded on status='PENDING', so duplicate
 * deliveries and webhook/sync races collapse to 'already_active'.
 * Throws only on database failures (retryable); every permanent
 * verification refusal logs and returns 'refused'.
 */
export async function activateSponsorBidFromOrder(
  supabase: SupabaseClient,
  order: Order
): Promise<SponsorBidActivation> {
  if (!isLeaderboardBidOrder(order)) return 'not_a_bid'

  if (!order.checkoutId) {
    console.warn(`[LeaderboardSponsor] Bid order ${order.id} carries no checkout id — refusing`)
    return 'refused'
  }

  const { data, error: readError } = await supabase
    .from('leaderboard_sponsor_bids')
    .select('id, ad_id, user_id, status, amount_cents, polar_order_id')
    .eq('polar_checkout_id', order.checkoutId)
    .maybeSingle()

  if (readError) {
    throw new Error(`Failed to read bid ledger for checkout ${order.checkoutId}: ${readError.message}`)
  }
  const row = data as unknown as PendingBidRow | null
  if (!row) {
    console.warn(
      `[LeaderboardSponsor] Order ${order.id} claims a sponsor bid but no ledger row exists for checkout ${order.checkoutId} — refusing`
    )
    return 'refused'
  }
  if (row.status === 'PAID') return 'already_active'
  if (row.status === 'REFUNDED') {
    console.warn(
      `[LeaderboardSponsor] Order ${order.id} arrived for an already-REFUNDED bid ${row.id} — refusing`
    )
    return 'refused'
  }
  if (row.status === 'VOID') return 'refused'

  const productId = resolveLeaderboardBidProductId()
  if (!productId || order.productId !== productId) {
    console.warn(
      `[LeaderboardSponsor] Order ${order.id} product ${order.productId} does not match the configured sponsor product — refusing bid ${row.id}`
    )
    return 'refused'
  }

  // The ledger's amount_cents are USD cents (the ad-hoc price is pinned
  // to 'usd' at checkout creation), so the order must be USD before its
  // minor units are compared at all — 666 of a cheap currency must
  // never pass as 666 US cents.
  if (order.currency !== 'usd') {
    console.warn(
      `[LeaderboardSponsor] Order ${order.id} is in '${order.currency}', not usd — refusing bid ${row.id}`
    )
    return 'refused'
  }

  // The amount Polar actually charged for the product (after discounts
  // — none are ever attached — and before taxes) must be exactly the
  // ad-hoc price this server computed into the ledger.
  if (order.netAmount !== Number(row.amount_cents)) {
    console.warn(
      `[LeaderboardSponsor] Order ${order.id} charged ${order.netAmount}c but ledger row ${row.id} expects ${row.amount_cents}c — refusing`
    )
    return 'refused'
  }

  // The payer must be the buyer who created the checkout. Metadata
  // userId is stamped server-side at checkout creation, so it is the
  // stronger witness (see the webhook's resolveRecipientUserId story).
  const metaUserId = Number(order.metadata?.['userId'])
  if (!Number.isSafeInteger(metaUserId) || metaUserId !== Number(row.user_id)) {
    console.warn(
      `[LeaderboardSponsor] Order ${order.id} metadata userId=${String(order.metadata?.['userId'])} does not exactly match ledger row ${row.id} user ${row.user_id} — refusing`
    )
    return 'refused'
  }

  const { data: updated, error: updateError } = await supabase
    .from('leaderboard_sponsor_bids')
    .update({
      status: 'PAID',
      polar_order_id: order.id,
      paid_at: order.createdAt.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', row.id)
    .eq('status', 'PENDING')
    .select('id')

  if (updateError) {
    throw new Error(`Failed to activate bid ${row.id}: ${updateError.message}`)
  }
  if (updated && updated.length > 0) return 'activated'

  // A concurrent writer won the PENDING guard. Distinguish a duplicate
  // activation from a racing refund instead of telling the returning
  // buyer a refunded contribution is live.
  const { data: finalData, error: finalReadError } = await supabase
    .from('leaderboard_sponsor_bids')
    .select('status')
    .eq('id', row.id)
    .maybeSingle()

  if (finalReadError) {
    throw new Error(`Failed to confirm final status for bid ${row.id}: ${finalReadError.message}`)
  }
  const finalStatus = (finalData as unknown as { status?: string } | null)?.status
  if (finalStatus === 'PAID') return 'already_active'
  if (finalStatus === 'REFUNDED') return 'refunded'
  return 'refused'
}

/**
 * order.refunded -> revoke the contribution from the ranking. Keyed by
 * the order's CHECKOUT id whenever it carries one (falling back to the
 * stamped polar_order_id), because the checkout id exists on the ledger
 * row from creation while polar_order_id is only stamped at activation:
 * a refund delivered before — or interleaved with — the order.paid leg
 * must still land, or the retried activation would seat refunded money
 * on the board for 24 hours. Guarded to PENDING/PAID rows (a refund can
 * strike either: PAID after activation, PENDING when it wins the race),
 * so it is idempotent, matches nothing for non-sponsor orders
 * (mirroring how plate revocation runs blind against source_order_id),
 * and any refund — full or partial — revokes the whole contribution:
 * partial refunds of bids are not a supported flow, and leaving a
 * partially-refunded bid ranked would let money re-enter the board.
 * Activation refuses REFUNDED rows, which is what closes the ordering
 * race end to end.
 */
export async function revokeSponsorBidFromOrder(
  supabase: SupabaseClient,
  order: Order
): Promise<void> {
  const revocation = supabase
    .from('leaderboard_sponsor_bids')
    .update({
      status: 'REFUNDED',
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .in('status', ['PENDING', 'PAID'])

  const { error } = await (order.checkoutId
    ? revocation.eq('polar_checkout_id', order.checkoutId)
    : revocation.eq('polar_order_id', order.id))

  if (error) {
    throw new Error(`Failed to revoke sponsor bid for order ${order.id}: ${error.message}`)
  }
}

/** Money went back — these orders must never activate. Mirrors
 *  subscriptionSync's stance; OrderStatus is an open enum, so
 *  membership is checked as plain strings. */
const REFUNDED_ORDER_STATUSES = new Set<string>(['refunded', 'partially_refunded'])

/**
 * Reconcile the exact checkout Polar returned in success_url. Ownership
 * is proven against the service-role ledger before Polar is queried, then
 * Orders is filtered by checkout_id rather than external_customer_id.
 * That distinction matters because Polar may merge a same-email buyer
 * into an existing customer whose external id belongs to another Cribble
 * account; checkout metadata + this ledger row remain the reliable pair.
 */
export async function syncSponsorBidCheckoutFromPolar(
  supabase: SupabaseClient,
  userId: number,
  checkoutId: string
): Promise<SponsorBidCheckoutSync> {
  if (!POLAR_CHECKOUT_ID_RE.test(checkoutId)) return 'not_found'

  const { data, error: ledgerError } = await supabase
    .from('leaderboard_sponsor_bids')
    .select('id, ad_id, user_id, status, amount_cents, polar_order_id')
    .eq('polar_checkout_id', checkoutId)
    .eq('user_id', userId)
    .maybeSingle()

  if (ledgerError) {
    throw new Error(`Failed to read bid ledger for checkout ${checkoutId}: ${ledgerError.message}`)
  }
  const row = data as unknown as PendingBidRow | null
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
    await revokeSponsorBidFromOrder(supabase, order)
    return 'refunded'
  }

  const activation = await activateSponsorBidFromOrder(supabase, order)
  if (
    activation === 'activated' ||
    activation === 'already_active' ||
    activation === 'refunded'
  ) {
    return activation
  }

  // A completed checkout that permanently fails the shared integrity
  // gate must stop looking like money still "in flight" for two hours.
  // Keep the row for audit, but remove it from pending UI/sync scans.
  const { error: voidError } = await supabase
    .from('leaderboard_sponsor_bids')
    .update({
      status: 'VOID',
      failure_reason: 'payment_verification_failed',
      updated_at: new Date().toISOString()
    })
    .eq('polar_checkout_id', checkoutId)
    .eq('user_id', userId)
    .eq('status', 'PENDING')

  if (voidError) {
    throw new Error(`Failed to void refused sponsor checkout ${checkoutId}: ${voidError.message}`)
  }
  return 'refused'
}

/**
 * Pull-based bid reconciliation, the sponsor twin of
 * syncPlateOrdersFromPolar: while the signed-in buyer has PENDING
 * ledger rows, ask Polar for their paid orders and run each sponsor
 * order through the same activation gate as the webhook. Exists
 * because webhooks can't reach localhost in dev; in production it
 * lets the buyer returning from checkout see their rank before the
 * webhook lands. Activation-only — refunds stay the webhook's job.
 *
 * Returns the number of bids activated. Quietly returns 0 when the
 * user has no LIVE pending rows (Polar isn't even asked) — rows older
 * than the pending TTL belong to checkouts Polar has long expired, so
 * an abandoned checkout must not put this user on a forever-poll of
 * Polar's API — when Polar isn't configured, or when Polar has no
 * customer for this external id (404/422). Anything else throws to
 * the caller.
 */
export async function syncSponsorBidsFromPolar(
  supabase: SupabaseClient,
  userId: number
): Promise<number> {
  const pendingCutoffIso = new Date(
    Date.now() - LEADERBOARD_SPONSOR_PENDING_TTL_MS
  ).toISOString()
  const { data: pendingData, error: pendingError } = await supabase
    .from('leaderboard_sponsor_bids')
    .select('polar_checkout_id')
    .eq('user_id', userId)
    .eq('status', 'PENDING')
    .gt('created_at', pendingCutoffIso)

  if (pendingError) {
    throw new Error(`Failed to read pending bids for user ${userId}: ${pendingError.message}`)
  }
  const pendingCheckoutIds = new Set(
    ((pendingData || []) as Array<{ polar_checkout_id: string }>).map(
      (row) => row.polar_checkout_id
    )
  )
  if (pendingCheckoutIds.size === 0) return 0

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

  let activated = 0
  for (const order of orders) {
    if (order.paid !== true) continue
    if (REFUNDED_ORDER_STATUSES.has(order.status)) continue
    if (!order.checkoutId || !pendingCheckoutIds.has(order.checkoutId)) continue

    try {
      if ((await activateSponsorBidFromOrder(supabase, order)) === 'activated') {
        activated++
      }
    } catch (error) {
      // One bad order must not block the rest of the reconciliation.
      console.error(
        `[LeaderboardSponsor] Failed to activate bid from order ${order.id} during sync:`,
        error
      )
    }
  }

  return activated
}
