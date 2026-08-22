// Shared contract for the Billboard ad-spot system (migration 030):
// the horizontally-scrolling train of paid ads + free hype items
// (crown takeovers and podium entries) shown under the navbar on the
// dashboard and leaderboard. The API routes, admin queue, buyer page
// and ticker all build against the shapes and helpers here. Pure and
// isomorphic — safe to import from 'use client' components. URL
// validation (cleanBillboardUrl) needs node builtins and lives in
// @/lib/billboardServer.
//
// Public API contract:
//   GET /api/billboard -> { items: BillboardItem[] }
//     Hype items first (crown, then podium, by rank), then live
//     flipper ads ordered by starts_at ascending.
//   GET /api/billboard/rails -> { items: RailItem[] }
//     Live rail ads (placement 'rail'), in RAIL_SLOTS order.
//   GET /api/billboard/slots -> SlotBoard
//     Public availability board: flipper occupancy + per-slot rail state.
//   GET /api/billboard/[id]/click
//     Increments the ad's clicks and 302-redirects to its link_url.
//     Ad cards must link here, never to link_url directly.

export type BillboardStatus =
  | 'PENDING'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ARCHIVED'

/** Which Billboard product an ad occupies (migration 035): the rotating
 *  flipper train under the navbar, or one of the always-on sponsor rails
 *  flanking the profile pages. */
export type BillboardPlacement = 'flipper' | 'rail'

/** The 8 fixed rail slots in board/render order: L1-L4 down the left
 *  column, R1-R4 down the right. */
export const RAIL_SLOTS = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'] as const
export type RailSlot = (typeof RAIL_SLOTS)[number]

export function isRailSlot(value: unknown): value is RailSlot {
  return (RAIL_SLOTS as readonly unknown[]).includes(value)
}

/** Ceiling on concurrently live flipper ads — enforced by the admin
 *  activation route in application code, not the database. Rail ads are
 *  capped by slot uniqueness instead (one live ad per RAIL_SLOTS entry,
 *  enforced at the same point). */
export const BILLBOARD_MAX_LIVE = 8
export const BILLBOARD_TEXT_MAX = 80
/** Cap on the company/brand title line (migration 034), counted in
 *  code points like BILLBOARD_TEXT_MAX. */
export const BILLBOARD_COMPANY_MAX = 40
/** $200 per flipper slot per rolling 7 days; payment is manual in v1. */
export const BILLBOARD_PRICE_CENTS = 20000
/** Weekly rail price per slot: a scarcity ladder by row — the top row
 *  (L1/R1) dearest, the bottom (L4/R4) cheapest — same price on both
 *  sides. Same manual-payment flow as the flipper. */
export const RAIL_SLOT_PRICE_CENTS: Record<RailSlot, number> = {
  L1: 49900,
  R1: 49900,
  L2: 39900,
  R2: 39900,
  L3: 29900,
  R3: 29900,
  L4: 19900,
  R4: 19900
}
/** The ladder's floor — every "from $199/wk" surface derives from this. */
export const BILLBOARD_RAIL_PRICE_MIN_CENTS = 19900
export const BILLBOARD_DURATION_DAYS = 7
/** Payment is manual in v1, arranged over email since migration 040:
 *  approval emails the instructions to the ad's billing_email. This is
 *  the client-safe address shown in UI copy — the server's reply-to
 *  inbox comes from SPONSORSHIP_EMAIL_REPLY_TO instead, never from a
 *  bundled constant. */
export const BILLBOARD_PAYMENT_EMAIL = 'birdabo@cribble.dev'
/** The backup channel — for ads with no billing_email on file (external
 *  sponsors, pre-040 rows) or when the email goes unanswered. These feed
 *  every "or DM @birdabo" surface (notifications, tracker, admin). */
export const BILLBOARD_PAYMENT_X_HANDLE = 'birdabo'
export const BILLBOARD_PAYMENT_X_URL = 'https://x.com/birdabo'

/** Row shape of billboard_ads (timestamptz columns arrive as ISO strings). */
export type BillboardAd = {
  id: number
  /** NULL = admin-created external-sponsor ad. */
  owner_user_id: number | null
  text: string
  /** Title line of the two-line sub-banner. Required on new
   *  submissions/edits (<= BILLBOARD_COMPANY_MAX code points); NULL on
   *  pre-034 rows, rendered with the link-domain fallback instead. */
  company_name: string | null
  link_url: string
  /** NULL falls back to the owner's avatar at render time. */
  logo_url: string | null
  /** Sub-banner tint auto-extracted from the ad's logo (or the owner-
   *  avatar fallback) at submit/edit time. Lowercase '#rrggbb'
   *  (migration 031's CHECK); NULL = no image or extraction failed,
   *  rendered with the neutral monochrome look. */
  accent_color: string | null
  /** Which product the buyer purchased (migration 035); pre-035 rows
   *  backfill to 'flipper'. */
  placement: BillboardPlacement
  /** The rail slot a rail ad occupies while live — assigned by the
   *  admin activate route at go-live, never buyer-settable (the buyer's
   *  wish travels in requested_rail_slot instead). NULL on flipper ads
   *  and on rail ads not yet activated. */
  rail_slot: RailSlot | null
  /** The slot a rail buyer asked for at submission (migration 038) — a
   *  preference, never a hold: slots go to the first confirmed payment,
   *  and the admin still assigns the live rail_slot at activation.
   *  Buyer-settable, unlike rail_slot. NULL = any slot; always NULL on
   *  flipper ads. */
  requested_rail_slot: RailSlot | null
  /** Billing contact for the email-first payment flow (migration 040):
   *  approval emails the payment instructions here. Required on buyer
   *  submissions/edits since 040; NULL on pre-040 rows and on admin-
   *  created external-sponsor ads — the approve flow then skips the
   *  send and ops falls back to X DM. */
  billing_email: string | null
  status: BillboardStatus
  /** Admin feedback shown to the buyer on redo / reject. */
  review_note: string | null
  reviewed_by: number | null
  reviewed_at: string | null
  paid_at: string | null
  starts_at: string | null
  ends_at: string | null
  clicks: number
  created_at: string
  updated_at: string
}

/** Crown = just became #1 from anywhere; podium = entered #2/#3 from
 *  outside the top 3. Intra-podium #3↔#2 swaps are not ticker-worthy. */
export type HypeVariant = 'crown' | 'podium'

/** The fallen #1 named on a crown card. Null when no victim can be
 *  resolved (left, banned, or a bootstrap pass with no prior holder). */
export type HypeDisplaced = {
  username: string
  displayName: string | null
  avatarUrl: string | null
}

export type BillboardHypeItem = {
  kind: 'hype'
  variant: HypeVariant
  userId: number
  username: string
  displayName: string | null
  avatarUrl: string | null
  rank: number
  prevRank: number
  movedAt: string
  displaced: HypeDisplaced | null
}

/** One card in the train, as served by GET /api/billboard. */
export type BillboardItem =
  | {
      kind: 'ad'
      id: number
      text: string
      /** Title line; NULL on pre-034 ads — render linkHost instead. */
      companyName: string | null
      /** link_url's hostname, lowercased, leading 'www.' stripped —
       *  the title-line fallback. '' if the stored URL fails to parse. */
      linkHost: string
      logoUrl: string | null
      /** '#rrggbb' sub-banner tint; NULL renders neutral. */
      accentColor: string | null
    }
  | BillboardHypeItem

/** One live rail ad, as served by GET /api/billboard/rails. Field
 *  semantics match BillboardItem's ad variant; slot is where the card
 *  mounts on the profile pages. */
export type RailItem = {
  id: number
  slot: RailSlot
  companyName: string | null
  linkHost: string
  text: string
  logoUrl: string | null
  accentColor: string | null
}

/** Public availability board served by GET /api/billboard/slots — the
 *  pitch page's "The slots" section renders straight from this. */
export type SlotBoard = {
  flipper: {
    /** Live flipper ads right now, of max. */
    taken: number
    max: number
    priceCents: number
    /** Earliest live window end while the flipper is full; null when
     *  a slot is open. */
    nextOpensAt: string | null
  }
  rails: Array<{
    slot: RailSlot
    /** Which profile-page column the slot mounts in (L* left, R* right). */
    side: 'left' | 'right'
    priceCents: number
    /** Live occupant's window end; null = slot open right now. */
    takenUntil: string | null
    /** Live occupant's title line (company name, falling back to its
     *  link host) — null only when the slot is open. */
    companyName: string | null
  }>
}

/**
 * Mirrors the LIVE definition documented in migration 030:
 * status = 'APPROVED' AND paid_at IS NOT NULL AND now() BETWEEN
 * starts_at AND ends_at — inclusive on both ends, like SQL BETWEEN.
 */
export function isLiveAd(
  ad: Pick<BillboardAd, 'status' | 'paid_at' | 'starts_at' | 'ends_at'>,
  now: Date = new Date()
): boolean {
  if (ad.status !== 'APPROVED' || !ad.paid_at || !ad.starts_at || !ad.ends_at) return false
  const t = now.getTime()
  return t >= new Date(ad.starts_at).getTime() && t <= new Date(ad.ends_at).getTime()
}

/* ------------------------------------------------------------------ *
 * Flipper cadence + chrome — the ticker's per-kind timing contract.
 * Paid ads are the product and keep the long exposure. Hype
 * announcements (crown takeovers, podium entries) are a free courtesy:
 * each gets one unhurried hold, but announcement-only trains play a
 * single pass and retract instead of looping for the full sponsored
 * show — that one-pass close, not the hold length, is what keeps free
 * hype short of a sponsor's airtime. Pure so BillboardTicker's
 * scheduling stays unit-testable without mounting the component.
 * ------------------------------------------------------------------ */

/** Per-rotation hold for a paid ad on a multi-item show. */
export const BILLBOARD_AD_HOLD_MS = 8_000
/** Per-appearance hold for a hype announcement — a longer beat than
 *  an ad's rotation so the moment reads, affordable because hype only
 *  ever airs once per show. */
export const BILLBOARD_HYPE_HOLD_MS = 10_000
/** A train that is a single paid ad re-keys its build-in at this
 *  cadence instead of flipping. */
export const BILLBOARD_AD_SOLO_REPLAY_MS = 24_000
/** Wall-clock show length whenever at least one paid ad is aboard. */
export const BILLBOARD_AD_SHOW_FOR_MS = 180_000
/** Wall-clock cap on announcement-only shows. They normally end
 *  themselves after one pass (billboardShouldCloseAfterHold); this
 *  backstops that, e.g. against hover-pausing the rotation forever.
 *  Sized to fit a full pass of the API's max three hype items. */
export const BILLBOARD_HYPE_SHOW_FOR_MS = 30_000

/** True when the fetched train carries no paid ads — only hype
 *  announcements. An empty train is nobody's announcement. */
export function isAnnouncementOnly(items: BillboardItem[]): boolean {
  return items.length > 0 && items.every((item) => item.kind === 'hype')
}

/** True when the train names a new #1. */
export function hasCrownHype(items: BillboardItem[]): boolean {
  return items.some((item) => item.kind === 'hype' && item.variant === 'crown')
}

/** Stable id for a crown event — challenger + the movement timestamp.
 *  The ticker stores the last one it aired so the cooldown bypass
 *  fires once per takeover, not on every parked retry while the same
 *  #1 is still inside the 48h hype window. */
export function crownEventKey(item: BillboardHypeItem): string {
  return `${item.userId}:${item.movedAt}`
}

/**
 * Key of a crown on this train that this visitor has not aired yet.
 * Null when the train has no crown, or only the same takeover already
 * stored in `lastKey`. The first crown in contract order (rank-asc,
 * so the current #1) is the one that counts.
 */
export function freshCrownKey(items: BillboardItem[], lastKey: string | null): string | null {
  for (const item of items) {
    if (item.kind !== 'hype' || item.variant !== 'crown') continue
    const key = crownEventKey(item)
    return key === lastKey ? null : key
  }
  return null
}

/**
 * Which ticker story a rank movement tells, or null when it is not
 * worth airing. Crown: just became #1 from any other rank. Podium:
 * entered #2 or #3 from outside the top 3. Drops, #3↔#2 swaps, and
 * never-moved rows (null prev) stay off the train.
 */
export function classifyHype(rank: number, prevRank: number | null): HypeVariant | null {
  if (!Number.isFinite(rank) || prevRank === null || !Number.isFinite(prevRank)) return null
  if (rank === 1 && prevRank > 1) return 'crown'
  if ((rank === 2 || rank === 3) && prevRank > 3) return 'podium'
  return null
}

/**
 * Among recently-fallen #1s, pick the victim for this challenger's
 * crown card: closest `movedAt` to the takeover, never the challenger
 * themselves. Null when the throne has no named prior holder.
 */
export function pickDisplacedUserId(
  challengerId: number,
  challengerMovedAt: string,
  fallen: ReadonlyArray<{ userId: number; movedAt: string }>
): number | null {
  const candidates = fallen.filter((row) => row.userId !== challengerId)
  if (candidates.length === 0) return null
  const t = Date.parse(challengerMovedAt)
  if (!Number.isFinite(t)) return candidates[0].userId
  let best = candidates[0]
  let bestDelta = Number.POSITIVE_INFINITY
  for (const row of candidates) {
    const moved = Date.parse(row.movedAt)
    const delta = Number.isFinite(moved) ? Math.abs(moved - t) : Number.POSITIVE_INFINITY
    if (delta < bestDelta) {
      best = row
      bestDelta = delta
    }
  }
  return Number.isFinite(bestDelta) ? best.userId : candidates[0].userId
}

/** Medal CSS custom-property name for a podium rank's stripe / wash /
 *  emphasis. Ranks outside 1–3 fall back to gold rather than inventing
 *  a fourth metal — the ticker only airs podium ranks. */
export function hypeMedalVar(rank: number): '--lb-gold' | '--lb-silver' | '--lb-bronze' {
  if (rank === 2) return '--lb-silver'
  if (rank === 3) return '--lb-bronze'
  return '--lb-gold'
}

export type HypeCopy = {
  title: string
  prefix: string
  emphasis: string
  suffix: string
}

/** Title + body for a hype card. `emphasis` is the medal token the
 *  ticker paints in metal (`#1` / `#2` / `#3`); prefix/suffix wrap it. */
export function hypeCopy(item: BillboardHypeItem): HypeCopy {
  const title = item.displayName || item.username
  switch (item.variant) {
    case 'crown':
      if (item.displaced) {
        return {
          title,
          prefix: `dethroned @${item.displaced.username} — now `,
          emphasis: '#1',
          suffix: ''
        }
      }
      return {
        title,
        prefix: 'seized the crown — now ',
        emphasis: '#1',
        suffix: ''
      }
    case 'podium':
      if (item.rank === 2) {
        return { title, prefix: 'claimed ', emphasis: '#2', suffix: '' }
      }
      return { title, prefix: 'stormed the podium at ', emphasis: '#3', suffix: '' }
    default: {
      const exhaustive: never = item.variant
      return exhaustive
    }
  }
}

/** How long the given item holds on screen before the ticker advances.
 *  `multi` = more than one item in the train: a solo ad's "hold" is the
 *  replay cadence of its build-in; a hype item never earns the solo
 *  replay treatment — its hold is one announcement beat either way. */
export function billboardHoldMs(item: BillboardItem, multi: boolean): number {
  if (item.kind === 'hype') return BILLBOARD_HYPE_HOLD_MS
  return multi ? BILLBOARD_AD_HOLD_MS : BILLBOARD_AD_SOLO_REPLAY_MS
}

/** Wall-clock show length for a fetched train: any paid ad buys the
 *  full sponsored loop; announcement-only trains get one hold per
 *  item, capped. */
export function billboardShowForMs(items: BillboardItem[]): number {
  if (items.some((item) => item.kind === 'ad')) return BILLBOARD_AD_SHOW_FOR_MS
  return Math.min(BILLBOARD_HYPE_SHOW_FOR_MS, items.length * BILLBOARD_HYPE_HOLD_MS)
}

/** Broadcast chrome for the active item: the inverted-mono label block
 *  and the banner's aria-label. Hype is never an ad — mislabeling it
 *  SPONSOR is the bug this exists to prevent. Crown and podium get
 *  their own labels so a throne change does not read as a generic
 *  announcement. */
export function billboardChrome(item: BillboardItem): { label: string; ariaLabel: string } {
  switch (item.kind) {
    case 'ad':
      return { label: 'SPONSOR', ariaLabel: 'Sponsorship' }
    case 'hype':
      switch (item.variant) {
        case 'crown':
          return { label: 'CROWN', ariaLabel: 'Crown change' }
        case 'podium':
          return { label: 'PODIUM', ariaLabel: 'Podium announcement' }
        default: {
          const exhaustive: never = item.variant
          return exhaustive
        }
      }
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

/** Announcement-only trains end after the last item's hold instead of
 *  wrapping (or, solo, replaying): true exactly when every item is hype
 *  and `activeIndex` is the final one. Always false once an ad is
 *  aboard — mixed trains keep the sponsored loop. */
export function billboardShouldCloseAfterHold(
  items: BillboardItem[],
  activeIndex: number
): boolean {
  return isAnnouncementOnly(items) && activeIndex === items.length - 1
}
