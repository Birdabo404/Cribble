// Shared contract for the Billboard ad-spot system (migration 030):
// the horizontally-scrolling train of paid ads + free top-3 hype items
// shown under the navbar on the dashboard and leaderboard. The API
// routes, admin queue, buyer page and ticker all build against the
// shapes and helpers here. Pure and isomorphic — safe to import from
// 'use client' components. URL validation (cleanBillboardUrl) needs
// node builtins and lives in @/lib/billboardServer.
//
// Public API contract:
//   GET /api/billboard -> { items: BillboardItem[] }
//     Hype items first, then live flipper ads ordered by starts_at
//     ascending.
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
/** $100 per flipper slot per rolling 7 days; payment is manual in v1. */
export const BILLBOARD_PRICE_CENTS = 10000
/** $150 per rail slot per rolling 7 days — same manual-payment flow. */
export const BILLBOARD_RAIL_PRICE_CENTS = 15000
export const BILLBOARD_DURATION_DAYS = 7

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
   *  admin activate route at go-live, never buyer-settable. NULL on
   *  flipper ads and on rail ads not yet activated. */
  rail_slot: RailSlot | null
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
  | {
      kind: 'hype'
      userId: number
      username: string
      displayName: string | null
      avatarUrl: string | null
      movedAt: string
    }

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
