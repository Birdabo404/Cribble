// Shared contract for the Billboard ticker: the train of free
// announcements shown under the navbar on the dashboard and
// leaderboard — hype events (rank breakthroughs and score-milestone
// clubs from billboard_hype_events, migrations 052 + 065) and
// operator-pushed announcements (billboard_announcements, migration
// 051). The train route, the admin announcements page and the ticker
// all build against the shapes and helpers here. Pure and isomorphic —
// safe to import from 'use client' components.
//
// Public API contract:
//   GET /api/billboard -> { items: BillboardItem[] }
//     Live operator announcements first, then hype/club items.

/** Caps on operator-announcement copy (migration 051), counted in code
 *  points: the headline is the strip's title line, the body its text
 *  line. */
export const BILLBOARD_ANNOUNCE_HEADLINE_MAX = 40
export const BILLBOARD_ANNOUNCE_BODY_MAX = 80

/** The rank tiers a hype event can announce, tightest first. A climb
 *  lands in exactly one — a 12 -> 1 jump is one throne event, not
 *  three. Score-milestone clubs are their own BillboardItem kind, not
 *  a tier here: they carry no rank story. */
export type BillboardHypeTier = 'throne' | 'top3' | 'top10'

/** Which leaderboard a hype/club item celebrates: the score season
 *  board or the Burn Board (migration 065). One discriminator instead
 *  of doubled item kinds — the staging swaps copy and accent on it
 *  while the cadence/chrome contract stays board-blind. */
export type BillboardHypeBoard = 'score' | 'burn'

/** The displaced player a rank hype event optionally calls out. */
export type BillboardHypeVictim = {
  username: string
  displayName: string | null
  avatarUrl: string | null
}

/** One card in the train, as served by GET /api/billboard. Every kind
 *  is free copy on the same announcement cadence and chrome. */
export type BillboardItem =
  | {
      /** A one-shot rank hype event from billboard_hype_events
       *  (migration 052), recorded by the leaderboard snapshot diff
       *  pass at the moment of the climb. */
      kind: 'hype'
      /** Event row id — the ticker's per-visitor seen-once gate keys
       *  on it. */
      id: number
      /** Which board the climb happened on: 'score' airs the classic
       *  gold staging, 'burn' the ember Burn Board staging. */
      board: BillboardHypeBoard
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
      /** The celebrant's season burn at climb time, an exact decimal
       *  string ('412.5'). Non-null only on burn items — the ember
       *  staging's dollar chip renders from it. */
      burnUsd: string | null
      /** The player this climb displaced. Absent/null when nobody fell
       *  out of the tier or the victim is banned/deleted — the
       *  celebration survives, the callout doesn't. */
      victim?: BillboardHypeVictim | null
    }
  | {
      /** A score-milestone club event (100K+) from
       *  billboard_hype_events, riding the same announcement cadence
       *  and chrome as hype. No rank story: the staging lands the club
       *  label where hype rolls the rank reel. */
      kind: 'club'
      id: number
      /** Which ladder was crossed: 'score' the lifetime-points clubs,
       *  'burn' the lifetime-$ burn clubs (migration 065). */
      board: BillboardHypeBoard
      userId: number
      username: string
      displayName: string | null
      avatarUrl: string | null
      /** The lifetime milestone crossed — points on the score board,
       *  whole USD on the burn board. */
      threshold: number
      reachedAt: string
    }
  | {
      /** An operator-pushed site announcement from
       *  billboard_announcements (migration 051), pushed from /admin. */
      kind: 'announce'
      id: number
      /** Title line, <= BILLBOARD_ANNOUNCE_HEADLINE_MAX code points. */
      headline: string
      /** Text line, <= BILLBOARD_ANNOUNCE_BODY_MAX code points. */
      body: string
      /** Operator-supplied link; NULL renders a non-interactive card.
       *  Operator-trusted, so cards link it directly. */
      linkUrl: string | null
    }

/** The hype variant of BillboardItem — the announcement component and
 *  the climb helpers below take this narrowed shape. */
export type BillboardHypeItem = Extract<BillboardItem, { kind: 'hype' }>

/** The club variant of BillboardItem — the announcement component's
 *  club payload and the sentence helper below take this. */
export type BillboardClubItem = Extract<BillboardItem, { kind: 'club' }>

/* ------------------------------------------------------------------ *
 * Ticker cadence + chrome — the per-kind timing contract. Hype events,
 * club events and operator announcements (kind 'announce') are all
 * free copy on identical cadence: each gets one unhurried hold, and a
 * train plays a single pass and retracts instead of looping — that
 * one-pass close, not the hold length, is what bounds the ticker's
 * airtime. Pure so BillboardTicker's scheduling stays unit-testable
 * without mounting the component.
 * ------------------------------------------------------------------ */

/** Per-appearance hold for an announcement — one unhurried beat so the
 *  moment reads, affordable because each item only ever airs once per
 *  show. */
export const BILLBOARD_HYPE_HOLD_MS = 30_000
/** Wall-clock cap on a show. Shows normally end themselves after one
 *  pass (billboardShouldCloseAfterHold); this backstops that, e.g.
 *  against hover-pausing the rotation forever. Sized to fit a full
 *  pass of the API's max three hype items; live operator announcements
 *  riding along can overflow it, and the backstop trims that pass
 *  short — acceptable for a cap that exists to bound airtime. */
export const BILLBOARD_HYPE_SHOW_FOR_MS = 90_000

/** True when the fetched train has something to announce. Every kind
 *  aboard is free copy (hype events, club events, operator
 *  announcements), so this is just non-emptiness — an empty train is
 *  nobody's announcement. Kept as the one predicate the ticker's
 *  one-pass close and the tests key on. */
export function isAnnouncementOnly(items: BillboardItem[]): boolean {
  return items.length > 0
}

/** How long the given item holds on screen before the ticker advances:
 *  one announcement beat for every kind, solo or not. */
export function billboardHoldMs(item: BillboardItem): number {
  switch (item.kind) {
    case 'hype':
    case 'club':
    case 'announce':
      return BILLBOARD_HYPE_HOLD_MS
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

/** Wall-clock show length for a fetched train: one hold per item,
 *  capped at BILLBOARD_HYPE_SHOW_FOR_MS. */
export function billboardShowForMs(items: BillboardItem[]): number {
  return Math.min(BILLBOARD_HYPE_SHOW_FOR_MS, items.length * BILLBOARD_HYPE_HOLD_MS)
}

/** Broadcast chrome for the active item: the inverted-mono label block
 *  and the banner's aria-label. Every kind is an announcement. */
export function billboardChrome(item: BillboardItem): { label: string; ariaLabel: string } {
  switch (item.kind) {
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

/** A train ends after the last item's hold instead of wrapping (or,
 *  solo, replaying): true exactly when the train has items and
 *  `activeIndex` is the final one. */
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
 *  so sr users hear the same story sighted users see. Burn items tell
 *  the same story in Burn Board language: seized/burned/outburned. */
export function billboardHypeSentence(item: BillboardHypeItem): string {
  const name = item.displayName || item.username
  const victim = item.victim ? item.victim.displayName || item.victim.username : null
  switch (item.board) {
    case 'score':
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
    case 'burn':
      switch (item.tier) {
        case 'throne':
          return victim
            ? `${name} took the top burner spot from ${victim}`
            : `${name} took the top burner spot`
        case 'top3':
        case 'top10': {
          const climb = `${name} burned from rank ${item.prevRank} to rank ${item.rank}`
          return victim ? `${climb}, outburning ${victim}` : climb
        }
        default: {
          const exhaustive: never = item.tier
          return exhaustive
        }
      }
    default: {
      const exhaustive: never = item.board
      return exhaustive
    }
  }
}

/** The screen-reader sentence for a club announcement, same aria role
 *  as billboardHypeSentence. */
export function billboardClubSentence(item: BillboardClubItem): string {
  const name = item.displayName || item.username
  switch (item.board) {
    case 'score':
      return `${name} joined the ${billboardClubLabel(item.threshold)} club`
    case 'burn':
      return `${name} torched past ${billboardBurnClubLabel(item.threshold)}`
    default: {
      const exhaustive: never = item.board
      return exhaustive
    }
  }
}

/* ------------------------------------------------------------------ *
 * Per-tier staging copy — one theme drives the announcement's marquee,
 * kinetic line and accent so a tier can't half-change. The staging
 * sets the theme's accentVar into --hype-accent on its root; the hype
 * CSS and shader bed read that instead of hardcoded gold.
 * ------------------------------------------------------------------ */

/** The --lb-* variables a tier's accent may point at. They hold bare
 *  rgb triplets in globals.css (`255 214 68`), so consumers compose
 *  colors as `rgb(var(--hype-accent) / a)`, never use the value raw.
 *  The ember trio is the Burn Board's ladder (hot spark, brand ember,
 *  deep coal), defined in both theme blocks like the medals. */
export type BillboardAccentVar =
  | '--lb-gold-hi'
  | '--lb-gold'
  | '--lb-silver'
  | '--lb-score'
  | '--lb-ember-hi'
  | '--lb-ember'
  | '--lb-ember-lo'

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

/** Static staging copy for the score rank tiers: "just took THE
 *  THRONE" on the hot gold, the classic "just entered the TOP 3" on
 *  leaderboard gold, TOP 10 on silver. */
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

/** The Burn Board's rank staging: same tiers, ember ladder instead of
 *  medals, and copy that speaks the board's language — "just seized
 *  THE TOP BURNER" at #1, "just burned into the TOP 3/10" below. */
export const BURN_HYPE_TIER_THEME: Record<BillboardHypeTier, BillboardStageTheme> = {
  throne: {
    marquee: '#1 BURN',
    kineticWords: ['just', 'seized'],
    accentWord: 'THE TOP BURNER',
    accentVar: '--lb-ember-hi'
  },
  top3: {
    marquee: 'TOP 3 · BURN',
    kineticWords: ['just', 'burned', 'into', 'the'],
    accentWord: 'TOP 3',
    accentVar: '--lb-ember'
  },
  top10: {
    marquee: 'TOP 10 · BURN',
    kineticWords: ['just', 'burned', 'into', 'the'],
    accentWord: 'TOP 10',
    accentVar: '--lb-ember-lo'
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

/** Compact dollar label for the burn club ladder (100 -> '$100',
 *  2_500 -> '$2.5K') — billboardClubLabel with the currency sign, so
 *  the two ladders can't drift apart in formatting. */
export function billboardBurnClubLabel(threshold: number): string {
  return `$${billboardClubLabel(threshold)}`
}

/** Compact dollar figure for the burn announcement's EST. BURN chip
 *  ('412.5' -> '$412', '2534' -> '$2.5K', '1250000' -> '$1.3M') —
 *  whole dollars, K/M compression from four digits. burnUsd rides the
 *  API as an exact decimal NUMERIC string, and comparison math must
 *  stay exact (burnClubCrossings) — but this is display compaction of
 *  money nowhere near 2^53, so one Number round-trip is safe. Null for
 *  a malformed string — armor against hand-edited rows, the
 *  burnClubPersonaLabel stance. */
export function billboardBurnUsdLabel(burnUsd: string): string | null {
  const value = Number(burnUsd)
  if (burnUsd.trim() === '' || !Number.isFinite(value) || value < 0) return null
  const whole = Math.floor(value)
  if (whole < 1_000) return `$${whole}`
  const compact = (scaled: number) => scaled.toFixed(1).replace(/\.0$/, '')
  if (whole < 1_000_000) return `$${compact(whole / 1_000)}K`
  return `$${compact(whole / 1_000_000)}M`
}

/** The persona the Burn Board already brands each spend tier with
 *  (tokenPersona's descending $-ladder in lib/tokenLeaderboard.ts) —
 *  mirrored here because that module is server-leaning and this one
 *  must stay importable from 'use client' components. The burn club
 *  staging wears it as the right-register chip. Null for a threshold
 *  outside the ladder (impossible through the producers — armor
 *  against hand-edited rows). */
const BURN_CLUB_PERSONA_LABELS: Record<number, string> = {
  100: 'WHALE',
  500: 'FINANCIAL INCIDENT',
  2_500: 'PAYROLL EXPENSE',
  10_000: 'AUDIT RISK',
  25_000: 'COMPUTE BARON'
}

export function burnClubPersonaLabel(threshold: number): string | null {
  return BURN_CLUB_PERSONA_LABELS[threshold] ?? null
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

/** The burn club's staging: "just torched $2.5K" on the hot ember,
 *  '$2.5K TORCHED' rolling the marquee. */
export function billboardBurnClubTheme(threshold: number): BillboardStageTheme {
  const label = billboardBurnClubLabel(threshold)
  return {
    marquee: `${label} TORCHED`,
    kineticWords: ['just', 'torched'],
    accentWord: label,
    accentVar: '--lb-ember-hi'
  }
}

/** The one theme dispatch for everything the hype staging renders —
 *  components take either item kind and can't pick a mismatched
 *  board/tier/copy pair. */
export function billboardStageTheme(
  item: BillboardHypeItem | BillboardClubItem
): BillboardStageTheme {
  switch (item.kind) {
    case 'hype':
      switch (item.board) {
        case 'score':
          return HYPE_TIER_THEME[item.tier]
        case 'burn':
          return BURN_HYPE_TIER_THEME[item.tier]
        default: {
          const exhaustive: never = item.board
          return exhaustive
        }
      }
    case 'club':
      switch (item.board) {
        case 'score':
          return billboardClubTheme(item.threshold)
        case 'burn':
          return billboardBurnClubTheme(item.threshold)
        default: {
          const exhaustive: never = item.board
          return exhaustive
        }
      }
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}
