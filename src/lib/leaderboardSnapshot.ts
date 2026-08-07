// Rank-snapshot maintenance for the leaderboard, moved OFF the read path.
//
// The old /api/leaderboard GET diffed fresh standings against
// leaderboard_ranks and wrote the result (plus demotion notifications) on
// every read. Snapshots are now maintained where scores are written: the
// extension sync route calls refreshLeaderboardSnapshot after a user's
// user_scores row is recalculated. One user's score change can shift
// everyone else's rank, so the whole top-100 standing is recomputed and
// diffed in a single pass — same eligibility filters, staleness gates and
// tie-break as the board itself. GET now only READS the snapshots, via
// readRankMovements, to decorate rows with climb/drop/NEW state.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  diffStandings,
  MOVEMENT_WINDOW_MS,
  NEW_ENTRANT_WINDOW_MS,
  type RankMovement,
  type RankSnapshotRow
} from './leaderboardEngine'
import {
  evaluateDemotionNotifications,
  type DemotionEvent
} from './notifications'
import { fetchSeasonState } from './seasonServer'

interface SnapshotUserRow {
  id: number
  user_scores: {
    total_score: number | null
    season_score?: number | null
    last_calculated_at: string | null
  } | null
}

/**
 * Recompute the season-board standing and persist the rank diff.
 *
 * Mirrors the old read-path rules exactly: only the live season board
 * diffs (the frozen intermission board by definition does not move, and
 * a missing season calendar degrades the board to lifetime ordering, so
 * the snapshot follows it there too). Scores gate on last_calculated_at
 * the same way the board render does. Never throws — a failed refresh
 * must not break the sync that triggered it.
 */
export async function refreshLeaderboardSnapshot(
  supabase: SupabaseClient
): Promise<void> {
  try {
    const seasonState = await fetchSeasonState(supabase)
    const seasonReady = seasonState.current !== null
    // Intermission: the board serves archived season_results — no
    // movement to record until the next season goes live.
    if (seasonReady && seasonState.phase !== 'active') return
    const liveSeasonBoard = seasonReady && seasonState.phase === 'active'

    // Same eligibility + ordering as the board's users query: banned /
    // suspended accounts and TEAM company accounts never hold a slot.
    const scoresSelect = seasonReady
      ? 'total_score, season_score, last_calculated_at'
      : 'total_score, last_calculated_at'
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(`id, user_scores(${scoresSelect})`)
      .or('status.is.null,status.eq.active')
      .or('subscription_tier.is.null,subscription_tier.neq.TEAM')
      .order(liveSeasonBoard ? 'season_score' : 'total_score', {
        ascending: false,
        referencedTable: 'user_scores',
        nullsFirst: false
      })
      .limit(100)

    if (usersError) {
      console.warn('[Leaderboard] Snapshot standings read failed:', usersError.message)
      return
    }

    const rows = (users || []) as unknown as SnapshotUserRow[]
    if (rows.length === 0) return

    // A score row last recalculated before the season started can only
    // carry a previous season's value — same guard as the board render.
    const seasonStartMs = liveSeasonBoard
      ? Date.parse(seasonState.current!.startsAt)
      : 0

    const standings = rows
      .map((user) => {
        let score: number
        if (liveSeasonBoard) {
          const lastCalc = user.user_scores?.last_calculated_at || null
          const lastCalcMs = lastCalc ? new Date(lastCalc).getTime() : 0
          score =
            lastCalcMs >= seasonStartMs
              ? Math.round(user.user_scores?.season_score || 0)
              : 0
        } else {
          score = Math.round(user.user_scores?.total_score || 0)
        }
        return { userId: Number(user.id), score }
      })
      // userId tiebreak keeps equal scores in a stable order, exactly
      // like the board render — otherwise tied players would flip-flop
      // and spray bogus movement arrows.
      .sort((a, b) => b.score - a.score || a.userId - b.userId)
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }))

    const { data: snapshotRows, error: snapshotError } = await supabase
      .from('leaderboard_ranks')
      .select('user_id, rank, score, prev_rank, rank_moved_at, first_seen_at')

    // Tolerates a missing leaderboard_ranks table (migration 012 not
    // applied yet) by doing nothing, same as the old read-path pass.
    if (snapshotError) {
      console.warn('[Leaderboard] Snapshot read failed:', snapshotError.message)
      return
    }

    const previous = new Map<number, RankSnapshotRow>(
      ((snapshotRows || []) as unknown as RankSnapshotRow[]).map((row) => [
        Number(row.user_id),
        { ...row, score: Number(row.score) }
      ])
    )

    const now = new Date()
    const { inserts, updates } = diffStandings(previous, standings, now)

    // Inserts must not clobber a concurrent write; updates are idempotent
    // (the same diff produces the same row values).
    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from('leaderboard_ranks')
        .upsert(inserts, { onConflict: 'user_id', ignoreDuplicates: true })
      if (insertError) {
        console.warn('[Leaderboard] Snapshot insert failed:', insertError.message)
      }
    }
    if (updates.length > 0) {
      const { error: updateError } = await supabase
        .from('leaderboard_ranks')
        .upsert(updates, { onConflict: 'user_id' })
      if (updateError) {
        console.warn('[Leaderboard] Snapshot update failed:', updateError.message)
      }
    }

    // Demotion pass: rank_moved_at === now means the drop happened on
    // this diff (score-only updates keep their old timestamp).
    const nowIso = now.toISOString()
    const demotions: DemotionEvent[] = []
    for (const update of updates) {
      if (
        update.rank_moved_at === nowIso &&
        update.prev_rank !== null &&
        update.rank > update.prev_rank
      ) {
        demotions.push({
          userId: update.user_id,
          fromRank: update.prev_rank,
          toRank: update.rank
        })
      }
    }
    if (demotions.length > 0) {
      await evaluateDemotionNotifications(supabase, demotions, now)
    }
  } catch (err) {
    console.warn('[Leaderboard] Snapshot refresh unavailable:', err)
  }
}

/**
 * Read-only movement decoration for the leaderboard GET: derive each
 * board row's climb/drop delta and NEW state from the persisted
 * snapshots alone, writing nothing. Deltas are taken against the row's
 * LIVE rank so the arrow always agrees with the rank on screen, matching
 * how diffStandings reports unchanged rows. Users without a snapshot row
 * (not yet re-ranked by a sync, or the table is missing) read as no
 * movement. Never throws.
 */
export async function readRankMovements(
  supabase: SupabaseClient,
  standings: { userId: number; rank: number }[]
): Promise<Map<number, RankMovement>> {
  const movements = new Map<number, RankMovement>()
  if (standings.length === 0) return movements

  try {
    const { data: snapshotRows, error } = await supabase
      .from('leaderboard_ranks')
      .select('user_id, prev_rank, rank_moved_at, first_seen_at')
      .in('user_id', standings.map((entry) => entry.userId))

    if (error) {
      console.warn('[Leaderboard] Movement read failed:', error.message)
      return movements
    }

    const byUser = new Map(
      (snapshotRows || []).map((row) => [Number(row.user_id), row])
    )
    const nowMs = Date.now()

    for (const entry of standings) {
      const snapshot = byUser.get(entry.userId)
      if (!snapshot) continue

      const movedMs = snapshot.rank_moved_at
        ? Date.parse(String(snapshot.rank_moved_at))
        : NaN
      const movementFresh =
        Number.isFinite(movedMs) && nowMs - movedMs < MOVEMENT_WINDOW_MS
      const firstSeenMs = snapshot.first_seen_at
        ? Date.parse(String(snapshot.first_seen_at))
        : NaN

      movements.set(entry.userId, {
        rankDelta:
          movementFresh && snapshot.prev_rank != null
            ? Number(snapshot.prev_rank) - entry.rank
            : 0,
        movedAt: movementFresh ? String(snapshot.rank_moved_at) : null,
        isNew:
          Number.isFinite(firstSeenMs) &&
          nowMs - firstSeenMs < NEW_ENTRANT_WINDOW_MS
      })
    }

    return movements
  } catch (err) {
    console.warn('[Leaderboard] Movement decoration unavailable:', err)
    return movements
  }
}
