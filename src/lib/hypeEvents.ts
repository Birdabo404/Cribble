// One-shot Billboard hype events (migrations 052 + 065). A snapshot
// diff pass is the only place a climb and the fall it caused exist
// side by side — the derivations here capture that pairing into
// billboard_hype_events rows before it is lost to the persisted
// snapshot. Two boards feed the same table: the score leaderboard
// (deriveHypeEvents, via refreshLeaderboardSnapshot) and the Burn
// Board (deriveBurnHypeEvents, via refreshBurnBoardSnapshot), sharing
// one classify/victim core so the tier and pairing rules can't drift.
// Kept pure like leaderboardEngine so those rules are unit-testable
// without a database; recordHypeEvents is the tolerant insert every
// producer (both snapshot diff passes, the score-notification flow
// and the usage route's burn-club pass) shares.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillboardHypeTier } from './billboard'
import { MOVEMENT_WINDOW_MS, type SnapshotUpdate } from './leaderboardEngine'
import { compareExactDecimals } from './tokenLeaderboard'

/** The Burn Board's rank-tier kinds — the burn twins of the score
 *  tiers, distinct so priority, dedupe and staging can diverge. */
export type BurnHypeEventKind = 'burn_throne' | 'burn_top3' | 'burn_top10'

/** Everything billboard_hype_events can store: the score rank tiers
 *  plus the score-milestone club kind (migration 052), and the Burn
 *  Board's rank tiers plus the $-milestone burn club (migration 065).
 *  Clubs air as their own BillboardItem kind — see lib/billboard.ts —
 *  because they carry no rank story. */
export type HypeEventKind = BillboardHypeTier | 'club' | BurnHypeEventKind | 'burn_club'

/** The rank-movement kinds — the ones carrying a rank pair and a
 *  windowed dedupe key, as opposed to the forever-once clubs. */
export type HypeRankKind = Exclude<HypeEventKind, 'club' | 'burn_club'>

/** Airing priority, tightest story first with score edging its burn
 *  twin at each tier. The billboard API sorts fetched events by this
 *  before recency, and victim claiming below walks the same order so
 *  a throne event names the fallen #1 before a TOP 3 event can. */
export const HYPE_KIND_PRIORITY: Record<HypeEventKind, number> = {
  throne: 0,
  burn_throne: 1,
  top3: 2,
  burn_top3: 3,
  top10: 4,
  burn_top10: 5,
  club: 6,
  burn_club: 7
}

/** Lowest score milestone that airs publicly as a club event. Private
 *  milestone notifications keep firing below it — the billboard only
 *  celebrates the big rooms. */
export const HYPE_MILESTONE_FLOOR = 100_000

/** The $-milestones a lifetime burn celebrates, ascending. Mirrors
 *  tokenPersona's spend ladder (WHALE at $100 up to COMPUTE BARON at
 *  $25K) so the burn club a player joins is the persona the board
 *  already brands them with. */
export const BURN_CLUB_THRESHOLDS = [100, 500, 2_500, 10_000, 25_000] as const

/** Row shape written to billboard_hype_events (id and created_at are
 *  the database's). Rank kinds carry the rank pair and optionally a
 *  victim; clubs carry only the threshold (points on score, whole USD
 *  on burn). burn_usd is the celebrant's season burn at climb time —
 *  burn rank kinds only, null everywhere else. */
export interface HypeEventInsert {
  kind: HypeEventKind
  user_id: number
  rank: number | null
  prev_rank: number | null
  victim_user_id: number | null
  threshold: number | null
  burn_usd: string | null
  dedupe_key: string
}

/** The slice of a snapshot diff update the derivation reads —
 *  refreshLeaderboardSnapshot passes its SnapshotUpdate[] straight in. */
export type HypeDiffRow = Pick<
  SnapshotUpdate,
  'user_id' | 'rank' | 'prev_rank' | 'rank_moved_at'
>

/** A Burn Board diff row: the same movement slice plus the row's
 *  season burn (exact decimal string), which the derived event carries
 *  so the announcement can flaunt the dollar figure. */
export type BurnHypeDiffRow = HypeDiffRow & { burn_usd: string }

/** Time-windowed like notifications' demotionDedupeKey, sized to the
 *  same 48h window the board's movement arrows and the billboard's
 *  read cutoff use: retaking the throne in a later window airs again,
 *  a rank oscillation inside one window doesn't. Burn kinds key
 *  separately by carrying their prefix in the kind itself
 *  (hype_burn_throne_{window} vs hype_throne_{window}). */
export function hypeRankDedupeKey(kind: HypeRankKind, now: Date): string {
  return `hype_${kind}_${Math.floor(now.getTime() / MOVEMENT_WINDOW_MS)}`
}

/** Forever-once: a lifetime score crosses each club threshold exactly
 *  once, so the key carries no window. */
export function hypeClubDedupeKey(threshold: number): string {
  return `hype_club_${threshold}`
}

/** Forever-once like hypeClubDedupeKey, for the $-milestone burn
 *  clubs (threshold in whole dollars). */
export function hypeBurnClubDedupeKey(threshold: number): string {
  return `hype_burn_club_${threshold}`
}

/** The tightest tier a climb lands in, or null when it tells no story
 *  (a shuffle inside a bucket, or a landing outside all tiers).
 *  Callers guarantee rank < prevRank; the else-ladder is what makes a
 *  12 -> 1 jump one throne event instead of three. Rank 1 needs no
 *  prev check — any climb TO the throne came from below it, 2 -> 1
 *  included. */
export function classifyHypeTier(
  rank: number,
  prevRank: number
): BillboardHypeTier | null {
  if (rank === 1) return 'throne'
  if (rank <= 3 && prevRank > 3) return 'top3'
  if (rank <= 10 && prevRank > 10) return 'top10'
  return null
}

/** The bucket a tier's victim must have fallen out of: the throne is
 *  rank 1 itself, the others their numeric bucket. */
function tierBucket(tier: BillboardHypeTier): number {
  switch (tier) {
    case 'throne':
      return 1
    case 'top3':
      return 3
    case 'top10':
      return 10
    default: {
      const exhaustive: never = tier
      return exhaustive
    }
  }
}

/** Which snapshot ledger a rank derivation reads — decides the event
 *  kind family and the dedupe-key prefix, nothing else: the tier and
 *  victim rules are deliberately identical across boards. */
type HypeBoard = 'score' | 'burn'

const BURN_RANK_KIND: Record<BillboardHypeTier, BurnHypeEventKind> = {
  throne: 'burn_throne',
  top3: 'burn_top3',
  top10: 'burn_top10'
}

function rankKindOf(board: HypeBoard, tier: BillboardHypeTier): HypeRankKind {
  switch (board) {
    case 'score':
      return tier
    case 'burn':
      return BURN_RANK_KIND[tier]
    default: {
      const exhaustive: never = board
      return exhaustive
    }
  }
}

interface HypeMove {
  userId: number
  rank: number
  prevRank: number
  burnUsd: string | null
}

/** The unclaimed faller who left the tier's bucket (held prev_rank
 *  inside it, landed outside), best prev_rank first — the highest-
 *  placed player displaced is the story worth telling. user_id breaks
 *  the tie a valid standing can't produce. Null when nobody qualifies
 *  (the board grew, or a tighter event already claimed them all). */
function pickVictim(
  tier: BillboardHypeTier,
  fallers: readonly HypeMove[],
  claimed: ReadonlySet<number>
): number | null {
  const bucket = tierBucket(tier)
  let best: HypeMove | null = null
  for (const faller of fallers) {
    if (claimed.has(faller.userId)) continue
    if (faller.prevRank > bucket || faller.rank <= bucket) continue
    if (
      best === null ||
      faller.prevRank < best.prevRank ||
      (faller.prevRank === best.prevRank && faller.userId < best.userId)
    ) {
      best = faller
    }
  }
  return best === null ? null : best.userId
}

/**
 * The shared classify/victim core both boards derive through. Reads
 * the same signal as the demotion pass in the snapshot refreshers:
 * rank_moved_at === now means the move happened on THIS diff
 * (measure-only updates keep their old timestamp and are skipped).
 *
 * Each climber gets at most one event, in the tightest tier the climb
 * reached. Victim pairing is deterministic and exclusive: events claim
 * in tier-priority order (throne, then top3, then top10; best landing
 * rank first within a tier), each taking the unclaimed faller with the
 * best (lowest) prev_rank who left that tier's bucket — no faller is
 * named twice, and a climb with no qualifying faller stays victimless.
 */
function deriveRankHypeEvents(
  updates: readonly (HypeDiffRow & { burn_usd?: string | null })[],
  now: Date,
  board: HypeBoard
): HypeEventInsert[] {
  const nowIso = now.toISOString()

  const climbs: (HypeMove & { tier: BillboardHypeTier })[] = []
  const fallers: HypeMove[] = []
  for (const update of updates) {
    if (update.rank_moved_at !== nowIso || update.prev_rank === null) continue
    const move: HypeMove = {
      userId: update.user_id,
      rank: update.rank,
      prevRank: update.prev_rank,
      burnUsd: update.burn_usd ?? null
    }
    if (update.rank < update.prev_rank) {
      const tier = classifyHypeTier(move.rank, move.prevRank)
      if (tier !== null) climbs.push({ ...move, tier })
    } else if (update.rank > update.prev_rank) {
      fallers.push(move)
    }
  }
  if (climbs.length === 0) return []

  climbs.sort(
    (a, b) =>
      HYPE_KIND_PRIORITY[rankKindOf(board, a.tier)] -
        HYPE_KIND_PRIORITY[rankKindOf(board, b.tier)] ||
      a.rank - b.rank ||
      a.userId - b.userId
  )

  const claimed = new Set<number>()
  return climbs.map((climb) => {
    const victim = pickVictim(climb.tier, fallers, claimed)
    if (victim !== null) claimed.add(victim)
    const kind = rankKindOf(board, climb.tier)
    return {
      kind,
      user_id: climb.userId,
      rank: climb.rank,
      prev_rank: climb.prevRank,
      victim_user_id: victim,
      threshold: null,
      burn_usd: board === 'burn' ? climb.burnUsd : null,
      dedupe_key: hypeRankDedupeKey(kind, now)
    }
  })
}

/** Derive the score-board hype events one snapshot diff pass produced
 *  (throne / top3 / top10) — refreshLeaderboardSnapshot feeds this. */
export function deriveHypeEvents(
  updates: readonly HypeDiffRow[],
  now: Date
): HypeEventInsert[] {
  return deriveRankHypeEvents(updates, now, 'score')
}

/** Derive the Burn Board hype events one burn snapshot diff pass
 *  produced (burn_throne / burn_top3 / burn_top10, each carrying the
 *  celebrant's season burn) — refreshBurnBoardSnapshot feeds this. */
export function deriveBurnHypeEvents(
  updates: readonly BurnHypeDiffRow[],
  now: Date
): HypeEventInsert[] {
  return deriveRankHypeEvents(updates, now, 'burn')
}

/**
 * The club event a crossed score milestone should air, or null below
 * the public floor — private notifications celebrate every milestone,
 * the billboard only the 100K+ clubs. The forever-once dedupe key
 * makes the caller's per-sync re-evaluation land on the unique index
 * instead of airing twice.
 */
export function buildClubHypeEvent(
  userId: number,
  threshold: number
): HypeEventInsert | null {
  if (threshold < HYPE_MILESTONE_FLOOR) return null
  return {
    kind: 'club',
    user_id: userId,
    rank: null,
    prev_rank: null,
    victim_user_id: null,
    threshold,
    burn_usd: null,
    dedupe_key: hypeClubDedupeKey(threshold)
  }
}

/**
 * The BURN_CLUB_THRESHOLDS a lifetime burn crossed between two reads
 * (exclusive of the baseline, inclusive of the new total), ascending.
 * Exact-decimal comparison because lifetime burn is NUMERIC money that
 * must never round-trip through Number. The usage route reads the
 * lifetime total on both sides of an ingest and feeds the pair here.
 */
export function burnClubCrossings(
  prevBurnUsd: string,
  nextBurnUsd: string
): number[] {
  return BURN_CLUB_THRESHOLDS.filter(
    (threshold) =>
      compareExactDecimals(prevBurnUsd, String(threshold)) < 0 &&
      compareExactDecimals(nextBurnUsd, String(threshold)) >= 0
  )
}

/** The burn twin of buildClubHypeEvent, minus the floor: every ladder
 *  rung is billboard-worthy (the ladder starts at WHALE money), and
 *  the forever-once dedupe key absorbs re-derivations. threshold is
 *  whole dollars, matching BURN_CLUB_THRESHOLDS. */
export function buildBurnClubHypeEvent(
  userId: number,
  threshold: number
): HypeEventInsert {
  return {
    kind: 'burn_club',
    user_id: userId,
    rank: null,
    prev_rank: null,
    victim_user_id: null,
    threshold,
    burn_usd: null,
    dedupe_key: hypeBurnClubDedupeKey(threshold)
  }
}

/**
 * Insert derived events, riding the (user_id, dedupe_key) unique
 * index: ignoreDuplicates turns a re-run of the same diff or
 * notification pass into a no-op instead of a second airing. Never
 * throws and tolerates a missing table (migration 052 not applied) —
 * hype must never break the sync that produced it, the same stance the
 * billboard route takes on the announcements read.
 */
export async function recordHypeEvents(
  supabase: SupabaseClient,
  events: HypeEventInsert[]
): Promise<void> {
  if (events.length === 0) return
  try {
    const { error } = await supabase
      .from('billboard_hype_events')
      .upsert(events, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
    if (error) {
      console.warn('[Billboard] Hype event insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[Billboard] Hype event insert unavailable:', err)
  }
}
