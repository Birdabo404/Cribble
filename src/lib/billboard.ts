// Shared contract for the Billboard ad-spot system (migration 030):
// the horizontally-scrolling train of paid ads + free hype events
// (rank breakthroughs and score-milestone clubs, migration 052)
// + operator-pushed announcements shown under the navbar on the
// dashboard and leaderboard. The API routes, admin queue, buyer page
// and ticker all build against the shapes and helpers here. Pure and
// isomorphic — safe to import from 'use client' components. URL
// validation (cleanBillboardUrl) needs node builtins and lives in
// @/lib/billboardServer.
//
// Public API contract:
//   GET /api/billboard -> { items: BillboardItem[] }
//     Live operator announcements first, then hype items, then live
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

/** Which Billboard product an ad occupies: the rotating flipper train
 *  under the navbar, one of the always-on sponsor rails flanking the
 *  profile pages (migration 035), or the rolling 24h sponsor ranking
 *  on the leaderboard page (migration 055). Leaderboard creatives ride
 *  the same review lifecycle and click redirect but NOT the 7-day LIVE
 *  window — their liveness is APPROVED + at least one active paid
 *  contribution (isLiveAd does not apply; see lib/leaderboardSponsor). */
export type BillboardPlacement = 'flipper' | 'rail' | 'leaderboard'

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
/** Ceiling on a logo upload (POST /api/billboard/logo). Isomorphic so
 *  the composer can pre-check the picked file for a friendly error;
 *  the route enforces it for real on both the declared and the actually
 *  read body size. */
export const BILLBOARD_LOGO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024
export const BILLBOARD_TEXT_MAX = 80
/** Cap on the company/brand title line (migration 034), counted in
 *  code points like BILLBOARD_TEXT_MAX. */
export const BILLBOARD_COMPANY_MAX = 40
/** Caps on operator-announcement copy (migration 051), counted in code
 *  points like BILLBOARD_COMPANY_MAX / BILLBOARD_TEXT_MAX: the headline
 *  is the strip's title line, the body its text line. */
export const BILLBOARD_ANNOUNCE_HEADLINE_MAX = 40
export const BILLBOARD_ANNOUNCE_BODY_MAX = 80
/** $200 per flipper slot per rolling 7 days — the advertised sticker
 *  price, and what Cribble nets: the self-serve Polar checkout
 *  (migration 061) charges the fee-grossed total instead
 *  (billboardSlotGrossCents below). */
export const BILLBOARD_PRICE_CENTS = 20000
/** Weekly rail price per slot: a scarcity ladder by row — the top row
 *  (L1/R1) dearest, the bottom (L4/R4) cheapest — same price on both
 *  sides. Advertised/netted like BILLBOARD_PRICE_CENTS; the checkout
 *  charges the grossed-up total. */
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

/* ------------------------------------------------------------------ *
 * Slot checkout pricing — the Polar fee gross-up (migration 061).
 * The sticker prices above stay on every advertised surface; only the
 * Polar checkout charges gross, so Cribble nets exactly the sticker.
 * Isomorphic so the tracker can preview the charged total from the
 * same math the checkout route prices with.
 * ------------------------------------------------------------------ */

/** Polar's processing cut on a one-time order: 4% of the charged total
 *  plus a fixed 40 cents. */
export const BILLBOARD_POLAR_FEE_RATE = 0.04
export const BILLBOARD_POLAR_FEE_FIXED_CENTS = 40

/** What the Polar checkout charges for a slot advertised at listCents:
 *  the smallest gross total that still nets the sticker price after
 *  Polar's cut — (list + 40) / 0.96 — rounded UP to whole dollars so
 *  the buyer never sees odd cents ($200 flipper charges $209; the
 *  rail ladder charges $521 / $417 / $312 / $208). The verification
 *  gate compares Polar's netAmount against THIS amount, stored in the
 *  ledger row's amount_cents. */
export function billboardSlotGrossCents(listCents: number): number {
  return (
    Math.ceil(
      (listCents + BILLBOARD_POLAR_FEE_FIXED_CENTS) /
        (1 - BILLBOARD_POLAR_FEE_RATE) /
        100
    ) * 100
  )
}

/** How long a PENDING billboard_slot_orders row counts as an in-flight
 *  checkout — the slot twin of LEADERBOARD_SPONSOR_PENDING_TTL_MS.
 *  Polar hosted checkouts expire about an hour after creation, so a
 *  row still PENDING past this window belongs to an abandoned checkout
 *  that can no longer be paid: the checkout route stops treating it as
 *  a duplicate-purchase block. Deliberately NOT an activation gate — a
 *  verified paid order always activates, however late the webhook. */
export const BILLBOARD_SLOT_PENDING_TTL_MS = 2 * 3_600_000
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

/** The rank tiers a hype event can announce, tightest first. A climb
 *  lands in exactly one — a 12 -> 1 jump is one throne event, not
 *  three. Score-milestone clubs are their own BillboardItem kind, not
 *  a tier here: they carry no rank story. */
export type BillboardHypeTier = 'throne' | 'top3' | 'top10'

/** The displaced player a rank hype event optionally calls out. */
export type BillboardHypeVictim = {
  username: string
  displayName: string | null
  avatarUrl: string | null
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
      /** A one-shot rank hype event from billboard_hype_events
       *  (migration 052), recorded by the leaderboard snapshot diff
       *  pass at the moment of the climb. */
      kind: 'hype'
      /** Event row id — the ticker's per-visitor seen-once gate keys
       *  on it. */
      id: number
      /** The tightest tier the climb reached; drives the staging's
       *  copy and accent via the theme config below. */
      tier: BillboardHypeTier
      userId: number
      username: string
      displayName: string | null
      avatarUrl: string | null
      /** Where the player landed and where they climbed from —
       *  captured into the event row at write time. The announcement's
       *  reel, delta chip and sr sentence all derive from this pair
       *  via the climb helpers below. */
      rank: number
      prevRank: number
      movedAt: string
      /** The player this climb displaced. Absent/null when nobody fell
       *  out of the tier or the victim is banned/deleted — the
       *  celebration survives, the callout doesn't. */
      victim?: BillboardHypeVictim | null
    }
  | {
      /** A score-milestone club event (100K+) from
       *  billboard_hype_events — free copy like hype, riding the same
       *  announcement cadence and chrome. No rank story: the staging
       *  lands the club label where hype rolls the rank reel. */
      kind: 'club'
      id: number
      userId: number
      username: string
      displayName: string | null
      avatarUrl: string | null
      /** The lifetime-score milestone crossed, in points. */
      threshold: number
      reachedAt: string
    }
  | {
      /** An operator-pushed site announcement from
       *  billboard_announcements (migration 051). Free copy like hype —
       *  it rides the announcement cadence and chrome, never dressed as
       *  SPONSOR. */
      kind: 'announce'
      id: number
      /** Title line, <= BILLBOARD_ANNOUNCE_HEADLINE_MAX code points. */
      headline: string
      /** Text line, <= BILLBOARD_ANNOUNCE_BODY_MAX code points. */
      body: string
      /** Operator-supplied link; NULL renders a non-interactive card.
       *  Operator-trusted, so cards link it directly — the click-redirect
       *  route is for paid ads only. */
      linkUrl: string | null
    }

/** The hype variant of BillboardItem — the announcement component and
 *  the climb helpers below take this narrowed shape. */
export type BillboardHypeItem = Extract<BillboardItem, { kind: 'hype' }>

/** The club variant of BillboardItem — the announcement component's
 *  club payload and the sentence helper below take this. */
export type BillboardClubItem = Extract<BillboardItem, { kind: 'club' }>

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
 * Flipper and rail ads only — a 'leaderboard' creative has no window
 * (its ad-row paid_at/starts_at/ends_at stay NULL) and is live while
 * APPROVED with an active bid ledger total; this helper would always
 * say false for it, which callers must not mistake for "not shown".
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
 * Paid ads are the product and keep the long exposure. Hype events,
 * club events and operator announcements (kind 'announce') are free
 * copy on identical cadence: each gets one unhurried hold, but
 * announcement-only trains play a single pass and retract instead of
 * looping for the full sponsored show — that one-pass close, not the
 * hold length, is what keeps free copy short of a sponsor's airtime.
 * Pure so BillboardTicker's scheduling stays unit-testable without
 * mounting the component.
 * ------------------------------------------------------------------ */

/** Per-rotation hold for a paid ad on a multi-item show. */
export const BILLBOARD_AD_HOLD_MS = 8_000
/** Per-appearance hold for a hype/club announcement — a longer beat
 *  than an ad's rotation so the moment reads, affordable because each
 *  event only ever airs once per show. */
export const BILLBOARD_HYPE_HOLD_MS = 30_000
/** A train that is a single paid ad re-keys its build-in at this
 *  cadence instead of flipping. */
export const BILLBOARD_AD_SOLO_REPLAY_MS = 24_000
/** Wall-clock show length whenever at least one paid ad is aboard. */
export const BILLBOARD_AD_SHOW_FOR_MS = 180_000
/** Wall-clock cap on announcement-only shows. They normally end
 *  themselves after one pass (billboardShouldCloseAfterHold); this
 *  backstops that, e.g. against hover-pausing the rotation forever.
 *  Sized to fit a full pass of the API's max three hype items; live
 *  operator announcements riding along can overflow it, and the
 *  backstop trims that pass short — acceptable for a cap that exists
 *  to bound free airtime. */
export const BILLBOARD_HYPE_SHOW_FOR_MS = 90_000

/** True when the fetched train carries no paid ads — only free copy
 *  (hype events, club events, operator announcements). An empty train
 *  is nobody's announcement. */
export function isAnnouncementOnly(items: BillboardItem[]): boolean {
  return (
    items.length > 0 &&
    items.every(
      (item) => item.kind === 'hype' || item.kind === 'club' || item.kind === 'announce'
    )
  )
}

/** How long the given item holds on screen before the ticker advances.
 *  `multi` = more than one item in the train: a solo ad's "hold" is the
 *  replay cadence of its build-in; hype, club and operator
 *  announcements never earn the solo replay treatment — their hold is
 *  one announcement beat either way. */
export function billboardHoldMs(item: BillboardItem, multi: boolean): number {
  switch (item.kind) {
    case 'hype':
    case 'club':
    case 'announce':
      return BILLBOARD_HYPE_HOLD_MS
    case 'ad':
      return multi ? BILLBOARD_AD_HOLD_MS : BILLBOARD_AD_SOLO_REPLAY_MS
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

/** Wall-clock show length for a fetched train: any paid ad buys the
 *  full sponsored loop; announcement-only trains get one hold per
 *  item, capped. */
export function billboardShowForMs(items: BillboardItem[]): number {
  if (items.some((item) => item.kind === 'ad')) return BILLBOARD_AD_SHOW_FOR_MS
  return Math.min(BILLBOARD_HYPE_SHOW_FOR_MS, items.length * BILLBOARD_HYPE_HOLD_MS)
}

/** Broadcast chrome for the active item: the inverted-mono label block
 *  and the banner's aria-label. Hype, club and operator announcements
 *  are announcements, not ads — mislabeling any of them as SPONSOR is
 *  the bug this exists to prevent. */
export function billboardChrome(item: BillboardItem): { label: string; ariaLabel: string } {
  switch (item.kind) {
    case 'ad':
      return { label: 'SPONSOR', ariaLabel: 'Sponsorship' }
    case 'hype':
    case 'club':
    case 'announce':
      return { label: 'ANNOUNCEMENT', ariaLabel: 'Announcement' }
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

/** Announcement-only trains end after the last item's hold instead of
 *  wrapping (or, solo, replaying): true exactly when every item is free
 *  copy (hype, club or announce) and `activeIndex` is the final one.
 *  Always false once an ad is aboard — mixed trains keep the sponsored
 *  loop. */
export function billboardShouldCloseAfterHold(
  items: BillboardItem[],
  activeIndex: number
): boolean {
  return isAnnouncementOnly(items) && activeIndex === items.length - 1
}

/* ------------------------------------------------------------------ *
 * Hype climb derivation — the announcement's rank story, kept pure so
 * the reel/chip/sentence math is unit-testable without mounting.
 * ------------------------------------------------------------------ */

/** Ceiling on reel rungs: a freak jump (rank 120 -> 2) compresses to
 *  this many steps instead of spinning through a hundred numbers. */
export const HYPE_LADDER_MAX_RUNGS = 8

/** The climb a hype item announces, derived once so the reel, the
 *  delta chip and the sr sentence can't disagree. `places` is clamped
 *  at zero: prev_rank <= rank is impossible through the API's filter,
 *  but a stale payload shouldn't render a negative climb. */
export function billboardRankClimb(item: BillboardHypeItem): {
  from: number
  to: number
  places: number
} {
  return {
    from: item.prevRank,
    to: item.rank,
    places: Math.max(0, item.prevRank - item.rank)
  }
}

/** The descending sequence the announcement reel rolls through, `from`
 *  first and `to` last. Short climbs step every rank (7 -> 2 is
 *  [7,6,5,4,3,2]); longer ones keep the endpoints exact and space the
 *  interior evenly across HYPE_LADDER_MAX_RUNGS — compression only
 *  kicks in when the spacing exceeds 1, so rounding can't produce
 *  duplicate rungs. A non-climb resolves straight to the landing. */
export function hypeRankLadder(from: number, to: number): number[] {
  if (from <= to) return [to]
  const span = from - to
  if (span < HYPE_LADDER_MAX_RUNGS) {
    return Array.from({ length: span + 1 }, (_, i) => from - i)
  }
  return Array.from({ length: HYPE_LADDER_MAX_RUNGS }, (_, i) =>
    Math.round(from - (span * i) / (HYPE_LADDER_MAX_RUNGS - 1))
  )
}

/** The single screen-reader sentence for a hype announcement — every
 *  animated visual fragment is aria-hidden behind it. Mentions the
 *  displaced player exactly when the card's victim register shows one,
 *  so sr users hear the same story sighted users see. */
export function billboardHypeSentence(item: BillboardHypeItem): string {
  const name = item.displayName || item.username
  const victim = item.victim ? item.victim.displayName || item.victim.username : null
  switch (item.tier) {
    case 'throne':
      return victim ? `${name} took rank 1 from ${victim}` : `${name} took rank 1`
    case 'top3':
    case 'top10': {
      const climb = `${name} climbed from rank ${item.prevRank} to rank ${item.rank}`
      return victim ? `${climb}, deranking ${victim}` : climb
    }
    default: {
      const exhaustive: never = item.tier
      return exhaustive
    }
  }
}

/** The screen-reader sentence for a club announcement, same aria role
 *  as billboardHypeSentence. */
export function billboardClubSentence(item: BillboardClubItem): string {
  const name = item.displayName || item.username
  return `${name} joined the ${billboardClubLabel(item.threshold)} club`
}

/* ------------------------------------------------------------------ *
 * Per-tier staging copy — one theme drives the announcement's marquee,
 * kinetic line and accent so a tier can't half-change. The staging
 * sets the theme's accentVar into --hype-accent on its root; the hype
 * CSS and shader bed read that instead of hardcoded gold.
 * ------------------------------------------------------------------ */

/** The --lb-* variables a tier's accent may point at. They hold bare
 *  rgb triplets in globals.css (`255 214 68`), so consumers compose
 *  colors as `rgb(var(--hype-accent) / a)`, never use the value raw. */
export type BillboardAccentVar = '--lb-gold-hi' | '--lb-gold' | '--lb-silver' | '--lb-score'

export type BillboardStageTheme = {
  /** One marquee copy unit ('TOP 3') — the component appends the
   *  NBSP-padded '·' separator and repeats it across the bed. */
  marquee: string
  /** The kinetic build words, in order, before the accent word. */
  kineticWords: readonly string[]
  /** The landing word of the kinetic line, rendered in the accent. */
  accentWord: string
  /** Which --lb-* variable feeds --hype-accent for this tier. */
  accentVar: BillboardAccentVar
}

/** Static staging copy for the rank tiers: "just took THE THRONE" on
 *  the hot gold, the classic "just entered the TOP 3" on leaderboard
 *  gold, TOP 10 on silver. */
export const HYPE_TIER_THEME: Record<BillboardHypeTier, BillboardStageTheme> = {
  throne: {
    marquee: '#1',
    kineticWords: ['just', 'took'],
    accentWord: 'THE THRONE',
    accentVar: '--lb-gold-hi'
  },
  top3: {
    marquee: 'TOP 3',
    kineticWords: ['just', 'entered', 'the'],
    accentWord: 'TOP 3',
    accentVar: '--lb-gold'
  },
  top10: {
    marquee: 'TOP 10',
    kineticWords: ['just', 'entered', 'the'],
    accentWord: 'TOP 10',
    accentVar: '--lb-silver'
  }
}

/** Compact milestone label (100_000 -> '100K', 1_000_000 -> '1M').
 *  Local mirror of notifications' formatMilestoneLabel — that module
 *  is server-only and this one must stay importable from 'use client'
 *  components. */
export function billboardClubLabel(threshold: number): string {
  if (threshold >= 1_000_000) return `${threshold / 1_000_000}M`
  if (threshold >= 1_000) return `${threshold / 1_000}K`
  return String(threshold)
}

/** Club staging copy is threshold-dependent, so it's built rather than
 *  looked up: "just joined the 100K CLUB" on the score lime. */
export function billboardClubTheme(threshold: number): BillboardStageTheme {
  const label = `${billboardClubLabel(threshold)} CLUB`
  return {
    marquee: label,
    kineticWords: ['just', 'joined', 'the'],
    accentWord: label,
    accentVar: '--lb-score'
  }
}

/** The one theme dispatch for everything the hype staging renders —
 *  components take either item kind and can't pick a mismatched
 *  tier/copy pair. */
export function billboardStageTheme(
  item: BillboardHypeItem | BillboardClubItem
): BillboardStageTheme {
  switch (item.kind) {
    case 'hype':
      return HYPE_TIER_THEME[item.tier]
    case 'club':
      return billboardClubTheme(item.threshold)
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}
