import type { SupabaseClient } from '@supabase/supabase-js'
import { PolarError } from '@polar-sh/sdk/models/errors/polarerror'
import type { Order } from '@polar-sh/sdk/models/components/order'
import { logAdminAction } from '@/lib/adminAudit'
import type { BillboardStatus } from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_PENDING_TTL_MS,
  LEADERBOARD_SPONSOR_WINDOW_MS,
  classifySponsorRun,
  formatSponsorUsd,
  leaderboardMinTargetCents,
  rankLeaderboardSponsors,
  type LeaderboardContribution,
  type LeaderboardSponsorEntry,
  type LeaderboardStanding
} from '@/lib/leaderboardSponsor'
import { insertMissingNotifications, type NotificationInput } from '@/lib/notifications'
import { getPolarClient, resolveLeaderboardBidProductId } from '@/lib/polar'
import type { SponsorBuyer } from '@/lib/sponsorAuth'

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
  /** Exactly one of user_id / guest_id is set (migration 063's CHECK)
   *  — the buyer column activation verifies the payer against. */
  user_id: number | null
  guest_id: number | null
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
    .select('id, ad_id, user_id, guest_id, status, amount_cents, polar_order_id')
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

  // The payer must be the buyer who created the checkout, checked
  // against whichever buyer column the ledger row carries (exactly one
  // by migration 063's CHECK). Metadata userId/guestId is stamped
  // server-side at checkout creation, so it is the stronger witness
  // (see the webhook's resolveRecipientUserId story).
  if (row.user_id !== null && row.user_id !== undefined) {
    const metaUserId = Number(order.metadata?.['userId'])
    if (!Number.isSafeInteger(metaUserId) || metaUserId !== Number(row.user_id)) {
      console.warn(
        `[LeaderboardSponsor] Order ${order.id} metadata userId=${String(order.metadata?.['userId'])} does not exactly match ledger row ${row.id} user ${row.user_id} — refusing`
      )
      return 'refused'
    }
  } else {
    const metaGuestId = Number(order.metadata?.['guestId'])
    if (!Number.isSafeInteger(metaGuestId) || metaGuestId !== Number(row.guest_id)) {
      console.warn(
        `[LeaderboardSponsor] Order ${order.id} metadata guestId=${String(order.metadata?.['guestId'])} does not exactly match ledger row ${row.id} guest ${row.guest_id} — refusing`
      )
      return 'refused'
    }
  }

  // The pre-activation board, read just before the guarded update so the
  // outbid/spot-taken diff below sees the world this payment displaces.
  // Best-effort: a failed read only skips the notices, never the money.
  const activationTime = new Date()
  let preBoard: LeaderboardSponsorEntry[] | null = null
  try {
    preBoard = await loadSponsorBoard(supabase, activationTime)
  } catch (error) {
    console.error(
      `[LeaderboardSponsor] Pre-activation board read failed for bid ${row.id} — outbid notices skipped:`,
      error
    )
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
  if (updated && updated.length > 0) {
    // Best-effort fan-out to displaced sponsors and queued advertisers.
    // A notification failure must never throw out of the payment path —
    // the contribution is already live at this point.
    if (preBoard !== null) {
      try {
        await notifySponsorBoardShift(supabase, {
          preBoard,
          activatedAdId: Number(row.ad_id),
          // A guest payer is null here: their own ads carry no owner to
          // exclude, and displaced USER sponsors must still hear about
          // the shift a guest's money caused.
          payerUserId:
            row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
          amountCents: Number(row.amount_cents),
          paidAtMs: order.createdAt.getTime(),
          ledgerRowId: Number(row.id),
          nowMs: activationTime.getTime()
        })
      } catch (error) {
        console.error(
          `[LeaderboardSponsor] Board-shift notifications failed for bid ${row.id}:`,
          error
        )
      }
    }
    return 'activated'
  }

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
 * is proven against the service-role ledger before Polar is queried —
 * filtered on whichever buyer column (user_id / guest_id) the resolved
 * sponsor identity names — then Orders is filtered by checkout_id
 * rather than external_customer_id. That distinction matters because
 * Polar may merge a same-email buyer into an existing customer whose
 * external id belongs to another Cribble account, and guest checkouts
 * carry no external id at all; checkout metadata + this ledger row
 * remain the reliable pair.
 */
export async function syncSponsorBidCheckoutFromPolar(
  supabase: SupabaseClient,
  buyer: SponsorBuyer,
  checkoutId: string
): Promise<SponsorBidCheckoutSync> {
  if (!POLAR_CHECKOUT_ID_RE.test(checkoutId)) return 'not_found'

  const ledgerQuery = supabase
    .from('leaderboard_sponsor_bids')
    .select('id, ad_id, user_id, guest_id, status, amount_cents, polar_order_id')
    .eq('polar_checkout_id', checkoutId)
  const { data, error: ledgerError } = await ('userId' in buyer
    ? ledgerQuery.eq('user_id', buyer.userId)
    : ledgerQuery.eq('guest_id', buyer.guestId)
  ).maybeSingle()

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
  const voidUpdate = supabase
    .from('leaderboard_sponsor_bids')
    .update({
      status: 'VOID',
      failure_reason: 'payment_verification_failed',
      updated_at: new Date().toISOString()
    })
    .eq('polar_checkout_id', checkoutId)
    .eq('status', 'PENDING')
  const { error: voidError } = await ('userId' in buyer
    ? voidUpdate.eq('user_id', buyer.userId)
    : voidUpdate.eq('guest_id', buyer.guestId))

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

/* ------------------------------------------------------------------ *
 * Lifecycle side effects — the outbid/spot-taken fan-out on activation
 * and the run-complete/auto-archive sweep. Everything here is best-
 * effort by contract: activation and archival are the writes that
 * matter, notifications and audit rows never block them.
 * ------------------------------------------------------------------ */

type SponsorBoardShift = {
  /** The board as loaded just BEFORE the activating update. */
  preBoard: LeaderboardSponsorEntry[]
  activatedAdId: number
  /** null when the activated bid belongs to a guest — no ads of the
   *  payer's to exempt from the fan-out, nobody to skip. */
  payerUserId: number | null
  amountCents: number
  paidAtMs: number
  /** The activated ledger row id — the outbid dedupe anchor, so a
   *  webhook retry or a webhook/sync race can never double-notify. */
  ledgerRowId: number
  nowMs: number
}

/** UTC day bucket for the once-a-day price-move throttle. */
function utcDayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

/**
 * After one bid activates: recompute the post-activation board in
 * memory (pure rankLeaderboardSponsors over the pre-board's standings
 * plus the new contribution), then notify
 *   - OUTBID: every owner whose rank worsened, keyed on this ledger row;
 *   - SPOT TAKEN / PRICE MOVED: owners of APPROVED leaderboard
 *     creatives with no active contribution, whenever the top total
 *     rose (a new bid always takes #1 — the checkout gate enforces it),
 *     throttled to one notice per ad per UTC day. The quoted minimum is
 *     informational only — checkout stays the sole pricing authority.
 * The payer's own ads are always excluded. Throws propagate to the
 * caller's catch — never past the payment path.
 */
async function notifySponsorBoardShift(
  supabase: SupabaseClient,
  shift: SponsorBoardShift
): Promise<void> {
  const { data, error } = await supabase
    .from('billboard_ads')
    .select('id, owner_user_id')
    .eq('placement', 'leaderboard')
    .eq('status', 'APPROVED')

  if (error) {
    console.error(
      '[LeaderboardSponsor] Approved-creatives read failed — board-shift notices skipped:',
      error.message
    )
    return
  }
  const ownerByAdId = new Map<number, number | null>()
  for (const row of (data || []) as Array<{ id: number; owner_user_id: number | null }>) {
    ownerByAdId.set(
      Number(row.id),
      row.owner_user_id === null ? null : Number(row.owner_user_id)
    )
  }
  // A contribution to a non-approved creative never shows on the board,
  // so nobody was displaced and no price moved.
  if (!ownerByAdId.has(shift.activatedAdId)) return

  // Each pre-board entry collapses to one synthetic contribution: its
  // active total stamped at its first active paid_at (nextDropAt minus
  // the window). Totals and tie-break evidence both survive, so ranking
  // these reproduces the pre-board exactly — and adding the new
  // contribution yields the post-activation board.
  const contributions: LeaderboardContribution[] = shift.preBoard.map((entry) => ({
    adId: entry.adId,
    amountCents: entry.activeCents,
    paidAtMs: Date.parse(entry.nextDropAt) - LEADERBOARD_SPONSOR_WINDOW_MS
  }))
  const postBoard = rankLeaderboardSponsors(
    [
      ...contributions,
      {
        adId: shift.activatedAdId,
        amountCents: shift.amountCents,
        paidAtMs: shift.paidAtMs
      }
    ],
    shift.nowMs
  )
  const postRankByAdId = new Map(postBoard.map((standing) => [standing.adId, standing.rank]))
  const preTopCents = shift.preBoard[0]?.activeCents ?? 0
  const postTopCents = postBoard[0]?.activeCents ?? 0

  const candidatesByOwner = new Map<number, (NotificationInput & { dedupeKey: string })[]>()
  const queueFor = (
    ownerUserId: number,
    candidate: NotificationInput & { dedupeKey: string }
  ) => {
    const queued = candidatesByOwner.get(ownerUserId)
    if (queued) queued.push(candidate)
    else candidatesByOwner.set(ownerUserId, [candidate])
  }

  for (const entry of shift.preBoard) {
    if (entry.adId === shift.activatedAdId) continue
    const ownerUserId = ownerByAdId.get(entry.adId)
    if (ownerUserId === null || ownerUserId === undefined) continue
    if (ownerUserId === shift.payerUserId) continue
    const postRank = postRankByAdId.get(entry.adId)
    if (postRank === undefined || postRank <= entry.rank) continue
    queueFor(ownerUserId, {
      type: 'premium',
      title: 'SPONSOR SPOT OUTBID',
      body: `Your leaderboard spot dropped to #${postRank}. Bid again to retake it.`,
      data: {
        kind: 'leaderboard_sponsor',
        result: 'outbid',
        adId: entry.adId,
        fromRank: entry.rank,
        toRank: postRank
      },
      dedupeKey: `lb_outbid_${entry.adId}_bid_${shift.ledgerRowId}`
    })
  }

  if (postTopCents > preTopCents) {
    const minTargetCents = leaderboardMinTargetCents(postTopCents)
    const day = utcDayOf(shift.nowMs)
    const onBoard = new Set(postBoard.map((standing) => standing.adId))
    for (const [adId, ownerUserId] of ownerByAdId) {
      if (onBoard.has(adId)) continue
      if (ownerUserId === null || ownerUserId === shift.payerUserId) continue
      queueFor(ownerUserId, {
        type: 'premium',
        title: 'SPONSOR SPOT TAKEN',
        body: `The sponsor spot was just taken — claiming #1 now starts from ${formatSponsorUsd(minTargetCents)}. Place your bid from the sponsorship page.`,
        data: {
          kind: 'leaderboard_sponsor',
          result: 'price_move',
          adId,
          minTargetCents
        },
        // One nudge per ad per UTC day, however many bids land.
        dedupeKey: `lb_price_move_${adId}_${day}`
      })
    }
  }

  for (const [ownerUserId, candidates] of candidatesByOwner) {
    await insertMissingNotifications(supabase, ownerUserId, candidates)
  }
}

export interface SponsorSweepSummary {
  /** Finished runs archived this pass. */
  archived: number
  /** Creatives currently inside the run-complete grace window. */
  runComplete: number
}

/**
 * Archive every APPROVED leaderboard creative whose run is finished
 * (last PAID contribution expired more than the grace period ago) and
 * notify owners entering or leaving the grace window. Called lazily
 * from the admin billboard GET and daily from the leaderboard-integrity
 * cron. Creatives that never had a paid bid are untouched — bidding
 * stays open forever.
 *
 * The archive itself is the guarded compare-and-set the manual archive
 * route uses (.eq status APPROVED), so a concurrent admin action wins
 * cleanly. The audit row follows the teamTripwire precedent for system
 * actions: written best-effort AFTER the status flip (withAudit's
 * fail-closed ordering would let an audit outage keep dead runs on the
 * books), attributed to the ad's owner; ownerless ads skip the row and
 * log to the console instead. NEVER throws — a sweep outage must not
 * take down the admin queue or the cron ride-along.
 */
export async function sweepFinishedLeaderboardSponsorAds(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<SponsorSweepSummary> {
  const summary: SponsorSweepSummary = { archived: 0, runComplete: 0 }
  try {
    const { data: adData, error: adsError } = await supabase
      .from('billboard_ads')
      .select('id, owner_user_id')
      .eq('placement', 'leaderboard')
      .eq('status', 'APPROVED')

    if (adsError) {
      console.error('[LeaderboardSponsor] Sweep ads read failed:', adsError.message)
      return summary
    }
    const ads = ((adData || []) as Array<{ id: number; owner_user_id: number | null }>).map(
      (row) => ({
        adId: Number(row.id),
        ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id)
      })
    )
    if (ads.length === 0) return summary

    const { data: bidData, error: bidsError } = await supabase
      .from('leaderboard_sponsor_bids')
      .select('ad_id, paid_at')
      .eq('status', 'PAID')
      .in('ad_id', ads.map((ad) => ad.adId))

    if (bidsError) {
      console.error('[LeaderboardSponsor] Sweep bids read failed:', bidsError.message)
      return summary
    }

    // Latest paid_at per creative — the classifier's single input.
    const lastPaidAtByAdId = new Map<number, string>()
    for (const row of (bidData || []) as Array<{ ad_id: number; paid_at: string }>) {
      const adId = Number(row.ad_id)
      const current = lastPaidAtByAdId.get(adId)
      if (current === undefined || row.paid_at > current) {
        lastPaidAtByAdId.set(adId, row.paid_at)
      }
    }

    for (const { adId, ownerUserId } of ads) {
      try {
        const lastPaidAt = lastPaidAtByAdId.get(adId)
        // Never paid = bidding_open: not the sweep's business.
        if (lastPaidAt === undefined) continue
        const state = classifySponsorRun(Date.parse(lastPaidAt), now.getTime())

        switch (state) {
          case 'bidding_open':
          case 'live':
            break

          case 'run_complete': {
            summary.runComplete++
            if (ownerUserId !== null) {
              // Keyed on the run's last payment: a re-bid then a later
              // expiry notifies again, a re-run of the sweep cannot.
              await insertMissingNotifications(supabase, ownerUserId, [
                {
                  type: 'premium',
                  title: 'SPONSOR RUN COMPLETE',
                  body: 'Your sponsor run is complete. Bid again within 24h to keep your spot, or it archives automatically.',
                  data: { kind: 'leaderboard_sponsor', result: 'run_complete', adId },
                  dedupeKey: `lb_runcomplete_${adId}_${lastPaidAt}`
                }
              ])
            }
            break
          }

          case 'finished': {
            // The one write that matters, guarded exactly like the
            // manual archive: a concurrent status change matches zero
            // rows and this pass simply moves on.
            const { data: archivedRows, error: archiveError } = await supabase
              .from('billboard_ads')
              .update({ status: 'ARCHIVED', updated_at: now.toISOString() })
              .eq('id', adId)
              .eq('status', 'APPROVED')
              .select('id')

            if (archiveError) {
              console.error(
                `[LeaderboardSponsor] Sweep failed to archive ad ${adId}:`,
                archiveError.message
              )
              break
            }
            if (!archivedRows || archivedRows.length === 0) break
            summary.archived++

            if (ownerUserId !== null) {
              try {
                await logAdminAction(supabase, {
                  adminUserId: ownerUserId,
                  targetUserId: ownerUserId,
                  action: 'billboard_auto_archive',
                  oldValues: { ad_id: adId, status: 'APPROVED', last_paid_at: lastPaidAt },
                  newValues: { ad_id: adId, status: 'ARCHIVED' },
                  reason: 'Automatic: leaderboard run complete'
                })
              } catch (auditError) {
                console.error(
                  `[LeaderboardSponsor] Sweep audit write failed for ad ${adId}:`,
                  auditError
                )
              }
              await insertMissingNotifications(supabase, ownerUserId, [
                {
                  type: 'premium',
                  title: 'SPONSOR RUN ARCHIVED',
                  body: 'Your sponsor run ended and was archived. Submit again anytime.',
                  data: { kind: 'leaderboard_sponsor', result: 'auto_archived', adId },
                  dedupeKey: `lb_autoarchive_${adId}_${lastPaidAt}`
                }
              ])
            } else {
              // No owner to attribute the audit row to (external-sponsor
              // ads) — the console line is the trail instead.
              console.log(
                `[LeaderboardSponsor] Auto-archived ownerless leaderboard ad ${adId} (run finished; no audit row)`
              )
            }
            break
          }

          default: {
            const exhaustive: never = state
            return exhaustive
          }
        }
      } catch (adError) {
        // One creative failing must not strand the rest of the sweep.
        console.error(`[LeaderboardSponsor] Sweep failed on ad ${adId}:`, adError)
      }
    }
  } catch (error) {
    console.error('[LeaderboardSponsor] Sweep failed:', error)
  }
  return summary
}
