// One-shot Billboard hype events (migration 052). The leaderboard
// snapshot diff pass is the only place a climb and the fall it caused
// exist side by side — deriveHypeEvents captures that pairing into
// billboard_hype_events rows before it is lost to the persisted
// snapshot. Kept pure like leaderboardEngine so the tier and victim
// rules are unit-testable without a database; recordHypeEvents is the
// tolerant insert both producers (the snapshot diff pass and the
// score-notification flow) share.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillboardHypeTier } from './billboard'
import { MOVEMENT_WINDOW_MS, type SnapshotUpdate } from './leaderboardEngine'

/** Everything billboard_hype_events can store: the rank tiers plus the
 *  score-milestone club kind (clubs air as their own BillboardItem
 *  kind — see lib/billboard.ts — because they carry no rank story). */
export type HypeEventKind = BillboardHypeTier | 'club'

/** Airing priority, tightest story first. The billboard API sorts
 *  fetched events by this before recency, and victim claiming below
 *  walks the same order so the throne event names the fallen #1 before
 *  a TOP 3 event can. */
export const HYPE_KIND_PRIORITY: Record<HypeEventKind, number> = {
  throne: 0,
  top3: 1,
  top10: 2,
  club: 3
}

/** Lowest score milestone that airs publicly as a club event. Private
 *  milestone notifications keep firing below it — the billboard only
 *  celebrates the big rooms. */
export const HYPE_MILESTONE_FLOOR = 100_000

/** Row shape written to billboard_hype_events (id and created_at are
 *  the database's). Rank kinds carry the rank pair and optionally a
 *  victim; clubs carry only the threshold. */
export interface HypeEventInsert {
  kind: HypeEventKind
  user_id: number
  rank: number | null
  prev_rank: number | null
  victim_user_id: number | null
  threshold: number | null
  dedupe_key: string
}

/** The slice of a snapshot diff update the derivation reads —
 *  refreshLeaderboardSnapshot passes its SnapshotUpdate[] straight in. */
export type HypeDiffRow = Pick<
  SnapshotUpdate,
  'user_id' | 'rank' | 'prev_rank' | 'rank_moved_at'
>

/** Time-windowed like notifications' demotionDedupeKey, sized to the
 *  same 48h window the board's movement arrows and the billboard's
 *  read cutoff use: retaking the throne in a later window airs again,
 *  a rank oscillation inside one window doesn't. */
export function hypeRankDedupeKey(tier: BillboardHypeTier, now: Date): string {
  return `hype_${tier}_${Math.floor(now.getTime() / MOVEMENT_WINDOW_MS)}`
}

/** Forever-once: a lifetime score crosses each club threshold exactly
 *  once, so the key carries no window. */
export function hypeClubDedupeKey(threshold: number): string {
  return `hype_club_${threshold}`
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

interface HypeMove {
  userId: number
  rank: number
  prevRank: number
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
 * Derive the hype events one snapshot diff pass produced. Reads the
 * same signal as the demotion pass in refreshLeaderboardSnapshot:
 * rank_moved_at === now means the move happened on THIS diff
 * (score-only updates keep their old timestamp and are skipped).
 *
 * Each climber gets at most one event, in the tightest tier the climb
 * reached. Victim pairing is deterministic and exclusive: events claim
 * in tier-priority order (throne, then top3, then top10; best landing
 * rank first within a tier), each taking the unclaimed faller with the
 * best (lowest) prev_rank who left that tier's bucket — no faller is
 * named twice, and a climb with no qualifying faller stays victimless.
 */
export function deriveHypeEvents(
  updates: readonly HypeDiffRow[],
  now: Date
): HypeEventInsert[] {
  const nowIso = now.toISOString()

  const climbs: (HypeMove & { tier: BillboardHypeTier })[] = []
  const fallers: HypeMove[] = []
  for (const update of updates) {
    if (update.rank_moved_at !== nowIso || update.prev_rank === null) continue
    const move: HypeMove = {
      userId: update.user_id,
      rank: update.rank,
      prevRank: update.prev_rank
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
      HYPE_KIND_PRIORITY[a.tier] - HYPE_KIND_PRIORITY[b.tier] ||
      a.rank - b.rank ||
      a.userId - b.userId
  )

  const claimed = new Set<number>()
  return climbs.map((climb) => {
    const victim = pickVictim(climb.tier, fallers, claimed)
    if (victim !== null) claimed.add(victim)
    return {
      kind: climb.tier,
      user_id: climb.userId,
      rank: climb.rank,
      prev_rank: climb.prevRank,
      victim_user_id: victim,
      threshold: null,
      dedupe_key: hypeRankDedupeKey(climb.tier, now)
    }
  })
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
    dedupe_key: hypeClubDedupeKey(threshold)
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
