// Rank-snapshot maintenance for the leaderboard, moved OFF the read path.
//
// The extension sync route calls refreshLeaderboardSnapshot after a score
// changes. The database RPC performs the canonical rank read, diff, stale-row
// cleanup and writes in one advisory-locked transaction. This wrapper only
// delivers the best-effort notifications and billboard events described by
// the committed movement rows. GET remains read-only and uses
// readRankMovements to decorate rows with climb/drop/NEW state.

import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveHypeEvents, recordHypeEvents } from './hypeEvents'
import {
  MOVEMENT_WINDOW_MS,
  NEW_ENTRANT_WINDOW_MS,
  type RankMovement,
  type SnapshotUpdate
} from './leaderboardEngine'
import {
  evaluateDemotionNotifications,
  type DemotionEvent
} from './notifications'

interface SnapshotRefreshRow {
  user_id: number | string
  rank: number | string
  score: number | string
  prev_rank: number | string | null
  rank_moved_at: string | null
  first_seen_at: string
  updated_at: string
  refreshed_at: string
}

/**
 * Ask Postgres to recompute and persist the season-board rank diff.
 *
 * public.refresh_leaderboard_snapshot() owns the transaction, advisory lock,
 * canonical standings call and stale-row deletion. It returns only inserted
 * or changed rows, all carrying one refreshed_at timestamp so the existing
 * notification/hype derivation can identify movements from this pass.
 * Never throws — a failed refresh must not break the sync that triggered it.
 */
export async function refreshLeaderboardSnapshot(
  supabase: SupabaseClient
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('refresh_leaderboard_snapshot')
    if (error) {
      console.warn('[Leaderboard] Transactional snapshot refresh failed:', error.message)
      return
    }

    const rows = (data || []) as unknown as SnapshotRefreshRow[]
    if (rows.length === 0) return

    const refreshedAtMs = Date.parse(rows[0].refreshed_at)
    if (!Number.isFinite(refreshedAtMs)) {
      console.warn('[Leaderboard] Snapshot refresh returned an invalid timestamp')
      return
    }
    const now = new Date(refreshedAtMs)
    const nowIso = now.toISOString()
    const updates: SnapshotUpdate[] = rows.map((row) => ({
      user_id: Number(row.user_id),
      rank: Number(row.rank),
      score: Number(row.score),
      prev_rank: row.prev_rank === null ? null : Number(row.prev_rank),
      rank_moved_at: row.rank_moved_at
        ? new Date(row.rank_moved_at).toISOString()
        : null,
      updated_at: new Date(row.updated_at).toISOString()
    }))

    // Demotion pass: rank_moved_at === now means the drop happened on
    // this diff (score-only updates keep their old timestamp).
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

    // Hype pass, same signal: this updates array is the only place a
    // climb and the fall it caused exist side by side, so the one-shot
    // billboard events (throne / top3 / top10, victim attached) are
    // derived and recorded here, before the pairing is lost to the
    // persisted rows. recordHypeEvents never throws — hype must not
    // break the sync, same as this whole function.
    await recordHypeEvents(supabase, deriveHypeEvents(updates, now))
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
