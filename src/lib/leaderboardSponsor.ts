// Shared contract for the leaderboard sponsor ranking (migration 055):
// a rolling 24-hour paid sponsor board on the leaderboard page, sold as
// the third Billboard product ('leaderboard' placement on
// billboard_ads). Approved creatives bid through Polar with server-
// priced ad-hoc checkouts; every paid contribution counts toward its
// creative's total for LEADERBOARD_SPONSOR_WINDOW_MS from paid_at,
// then drops off individually. Rank is DERIVED at read time — never
// assigned, never reserved by a checkout. Pure and isomorphic — safe
// to import from 'use client' components. Everything that needs the
// database or the Polar SDK lives in @/lib/leaderboardSponsorServer.
//
// Public API contract:
//   GET  /api/billboard/leaderboard -> LeaderboardSponsorBoard
//     The ranked active board (viewer-agnostic), current #1, and the
//     fresh minimum target to take #1. Clients poll ~15s.
//   GET  /api/billboard/leaderboard/mine -> LeaderboardSponsorMine
//     The signed-in owner's leaderboard creatives with approval
//     status, active/pending contribution totals and board position.
//   POST /api/billboard/leaderboard/checkout
//     { adId, targetTotalCents } -> { url } (Polar hosted checkout) or
//     409 + { minTargetCents } when the board moved under the buyer.
//   POST /api/billboard/leaderboard/sync
//     Pull-based reconciliation after checkout=success, mirroring
//     /api/user/subscription/sync — activates paid-but-unfulfilled
//     bids when webhook delivery lags (or can't reach localhost).

/** An empty board opens at $6.66 — the first bid must reach at least
 *  this total. */
export const LEADERBOARD_SPONSOR_OPENING_CENTS = 666

/** Floor on any single checkout ($2.00) — a top-up smaller than this
 *  charges the floor instead, so fee-heavy micro-payments can't
 *  happen. The overshoot still counts toward the buyer's total. */
export const LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS = 200

/** Fat-finger ceiling on a stated target total ($10,000). NOT an
 *  absolute board ceiling: once the live minimum challenge target
 *  passes it, the effective ceiling follows the minimum
 *  (leaderboardMaxTargetCents) so the board can never lock with an
 *  unoutbiddable #1 — a challenge at exactly the fresh minimum is
 *  always accepted. */
export const LEADERBOARD_SPONSOR_MAX_TARGET_CENTS = 1_000_000

/** How long one paid contribution counts for, from its paid_at. */
export const LEADERBOARD_SPONSOR_WINDOW_MS = 24 * 3_600_000

/** How long a PENDING ledger row counts as an in-flight checkout.
 *  Polar hosted checkouts expire about an hour after creation, so a
 *  row still PENDING past this window belongs to an abandoned checkout
 *  that can no longer be paid: the owner API stops counting it toward
 *  pendingCents and the pull-based sync stops polling Polar for it.
 *  Deliberately NOT an activation gate — a verified paid order always
 *  activates (the money was captured; Polar's own checkout expiry is
 *  what bounds how late an order can exist), so webhook delivery lag
 *  can never strand real money. */
export const LEADERBOARD_SPONSOR_PENDING_TTL_MS = 2 * 3_600_000

/** The beat-#1 increment: at least $1, or 10% of the current top
 *  total rounded UP to whole dollars, whichever is larger. */
export const LEADERBOARD_SPONSOR_MIN_INCREMENT_CENTS = 100
export const LEADERBOARD_SPONSOR_INCREMENT_RATE = 0.1

/* ------------------------------------------------------------------ *
 * Flip cadence — the leaderboard panel's stats-to-sponsor rotation
 * timing (a later UI phase mounts these; they live here so the
 * scheduling stays unit-testable and can't drift from the product
 * spec: stats 8s, flip ~450ms, sponsor 6s, flip back).
 * ------------------------------------------------------------------ */

/** How long the stats face holds before flipping to the sponsor. */
export const LEADERBOARD_FLIP_STATS_HOLD_MS = 8_000
/** How long the sponsor face holds before flipping back. */
export const LEADERBOARD_FLIP_SPONSOR_HOLD_MS = 6_000
/** One flip transition, either direction. */
export const LEADERBOARD_FLIP_TRANSITION_MS = 450
/** How often board consumers re-poll the public API. */
export const LEADERBOARD_SPONSOR_POLL_MS = 15_000

/** Ledger states of one leaderboard_sponsor_bids row (migration 055).
 *  Time-expiry is derived from paid_at at read time, never a status. */
export type LeaderboardBidStatus = 'PENDING' | 'PAID' | 'REFUNDED'

/* ------------------------------------------------------------------ *
 * Pricing math — every cent amount is an integer; the checkout route
 * recomputes all of this server-side and the UI only previews it.
 * ------------------------------------------------------------------ */

/** The increment a challenger must add on top of the current #1
 *  total: max($1, 10% of the top total rounded UP to whole dollars). */
export function leaderboardBidIncrementCents(topTotalCents: number): number {
  const tenPercentCeilDollars =
    Math.ceil((topTotalCents * LEADERBOARD_SPONSOR_INCREMENT_RATE) / 100) * 100
  return Math.max(LEADERBOARD_SPONSOR_MIN_INCREMENT_CENTS, tenPercentCeilDollars)
}

/** The minimum target total that takes #1 right now: the $6.66
 *  opening on an empty board, otherwise the top total plus the
 *  challenge increment. Computed against the CURRENT top — a buyer
 *  who already holds #1 tops up past their own total instead and is
 *  not held to this (the checkout route makes that distinction). */
export function leaderboardMinTargetCents(topTotalCents: number): number {
  if (topTotalCents <= 0) return LEADERBOARD_SPONSOR_OPENING_CENTS
  return topTotalCents + leaderboardBidIncrementCents(topTotalCents)
}

/** The highest target total a checkout accepts right now: the $10,000
 *  fat-finger ceiling, lifted to the fresh minimum challenge target
 *  whenever the board has grown past it. Guarantees min <= max always
 *  holds, so a challenger retrying at the 409's minTargetCents can
 *  never be refused by the ceiling — without this, a top total above
 *  ~$9,091 made every legal challenge exceed the static cap and locked
 *  #1 in place until contributions decayed. */
export function leaderboardMaxTargetCents(minTargetCents: number): number {
  return Math.max(LEADERBOARD_SPONSOR_MAX_TARGET_CENTS, minTargetCents)
}

/** What one checkout charges for a stated target total: the
 *  difference to the buyer's current active total, floored at the
 *  $2.00 minimum. 0 means there is nothing to buy (target already
 *  met) — the checkout route rejects that before Polar is involved.
 *  When the floor overshoots the difference, the whole charged
 *  amount still counts toward the total (contributions are what was
 *  paid, not what was aimed for). */
export function leaderboardChargeCents(
  targetTotalCents: number,
  activeCents: number
): number {
  const difference = targetTotalCents - activeCents
  if (difference <= 0) return 0
  return Math.max(difference, LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS)
}

/* ------------------------------------------------------------------ *
 * Display formatting — the one dollars renderer every sponsor surface
 * shares, so the same cents always print the same string. Presentation
 * only; it never feeds pricing decisions.
 * ------------------------------------------------------------------ */

/** Integer cents -> '$6.66' / '$200' / '$1,234.50'. Cents render only
 *  when non-zero — the $6.66 opening always keeps its cents while
 *  round amounts stay clean; dollars get thousands separators (the
 *  target ceiling is $10,000). */
export function formatSponsorUsd(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const remainder = cents % 100
  const base = `$${dollars.toLocaleString('en-US')}`
  return remainder === 0 ? base : `${base}.${String(remainder).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ *
 * Ranking derivation — pure so the read routes, the checkout race
 * check and the tests all share one definition of the board.
 * ------------------------------------------------------------------ */

/** One PAID ledger row, reduced to what ranking needs. Callers pass
 *  only non-refunded rows; expiry is applied here from `nowMs`. */
export type LeaderboardContribution = {
  adId: number
  amountCents: number
  /** paid_at in epoch ms. */
  paidAtMs: number
}

/** One creative's derived standing on the active board. */
export type LeaderboardStanding = {
  adId: number
  /** 1-based board position. */
  rank: number
  /** Sum of non-expired contributions, integer cents. */
  activeCents: number
  /** When the total next drops (soonest active contribution's
   *  expiry), epoch ms. */
  nextDropAtMs: number
  /** When the creative leaves the board entirely (latest active
   *  contribution's expiry), epoch ms. */
  expiresAtMs: number
  /** Earliest active paid_at — the tie-break evidence. */
  firstPaidAtMs: number
}

/** Derive the active board from PAID contributions at `nowMs`:
 *  contributions older than the 24h window are dropped, the rest
 *  aggregate per creative, and creatives order by total descending
 *  with ties broken by the earlier first ACTIVE payment (who reached
 *  the tied total first), then by ad id for a stable total order.
 *  Creatives whose every contribution expired simply aren't on the
 *  board — no empty entries. */
export function rankLeaderboardSponsors(
  contributions: LeaderboardContribution[],
  nowMs: number
): LeaderboardStanding[] {
  const byAd = new Map<
    number,
    { activeCents: number; firstPaidAtMs: number; lastPaidAtMs: number }
  >()

  for (const contribution of contributions) {
    const expiresAtMs = contribution.paidAtMs + LEADERBOARD_SPONSOR_WINDOW_MS
    if (expiresAtMs <= nowMs) continue
    const entry = byAd.get(contribution.adId)
    if (!entry) {
      byAd.set(contribution.adId, {
        activeCents: contribution.amountCents,
        firstPaidAtMs: contribution.paidAtMs,
        lastPaidAtMs: contribution.paidAtMs
      })
    } else {
      entry.activeCents += contribution.amountCents
      entry.firstPaidAtMs = Math.min(entry.firstPaidAtMs, contribution.paidAtMs)
      entry.lastPaidAtMs = Math.max(entry.lastPaidAtMs, contribution.paidAtMs)
    }
  }

  return [...byAd.entries()]
    .sort(
      ([adIdA, a], [adIdB, b]) =>
        b.activeCents - a.activeCents ||
        a.firstPaidAtMs - b.firstPaidAtMs ||
        adIdA - adIdB
    )
    .map(([adId, entry], index) => ({
      adId,
      rank: index + 1,
      activeCents: entry.activeCents,
      nextDropAtMs: entry.firstPaidAtMs + LEADERBOARD_SPONSOR_WINDOW_MS,
      expiresAtMs: entry.lastPaidAtMs + LEADERBOARD_SPONSOR_WINDOW_MS,
      firstPaidAtMs: entry.firstPaidAtMs
    }))
}

/* ------------------------------------------------------------------ *
 * API payload shapes — what the routes serve and the UI phase will
 * render. Timestamps travel as ISO strings, money as integer cents.
 * ------------------------------------------------------------------ */

/** One ranked creative on the public board. Creative field semantics
 *  match BillboardItem's ad variant (lib/billboard.ts): logoUrl
 *  already carries the owner-avatar fallback, cards must link through
 *  GET /api/billboard/[id]/click, never to the target directly. */
export type LeaderboardSponsorEntry = {
  adId: number
  rank: number
  companyName: string | null
  /** link_url's hostname, lowercased, 'www.' stripped — title-line
   *  fallback, '' if the stored URL fails to parse. */
  linkHost: string
  text: string
  logoUrl: string | null
  /** '#rrggbb' tint; null renders neutral. */
  accentColor: string | null
  clicks: number
  /** Sum of this creative's active (non-refunded, non-expired)
   *  contributions. */
  activeCents: number
  /** When the total next drops (soonest-expiring contribution). */
  nextDropAt: string
  /** When the creative leaves the board (last contribution expiry). */
  expiresAt: string
}

/** GET /api/billboard/leaderboard — the public, viewer-agnostic board. */
export type LeaderboardSponsorBoard = {
  board: LeaderboardSponsorEntry[]
  /** The current #1, duplicated out of board[0] for direct access;
   *  null on an empty board. */
  top: LeaderboardSponsorEntry | null
  /** Fresh minimum target total that takes #1 right now — the
   *  opening price on an empty board. */
  minTargetCents: number
  /** The empty-board opening, surfaced for "Claim #1 for $6.66" copy. */
  openingCents: number
  /** Server clock at derivation — expiry countdowns render against
   *  this, never the client clock. */
  serverTime: string
}

/** One of the signed-in owner's leaderboard creatives, with its
 *  review state and money standing. */
export type LeaderboardSponsorMineCreative = {
  adId: number
  /** billboard_ads review lifecycle (lib/billboard.ts). Only
   *  APPROVED creatives can bid. */
  status: string
  /** Admin feedback on redo/reject, null otherwise. */
  reviewNote: string | null
  companyName: string | null
  linkHost: string
  text: string
  logoUrl: string | null
  accentColor: string | null
  clicks: number
  /** Active contribution total; 0 when off the board. */
  activeCents: number
  /** Board position, null while not on the active board. */
  rank: number | null
  nextDropAt: string | null
  expiresAt: string | null
  /** Cents sitting in PENDING checkouts (created, not yet paid) —
   *  the UI warns rather than double-charging blindly. */
  pendingCents: number
}

/** GET /api/billboard/leaderboard/mine — owner view plus the same
 *  board context the public payload carries. */
export type LeaderboardSponsorMine = {
  creatives: LeaderboardSponsorMineCreative[]
  minTargetCents: number
  openingCents: number
  serverTime: string
}
