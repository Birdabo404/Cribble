// Rank-movement engine for the leaderboard.
//
// The /api/leaderboard route computes a fresh standing on every read, then
// diffs it against the persisted per-user snapshots (leaderboard_ranks,
// migration 012). This module owns that diff as pure logic so it can be
// unit-tested without a database: given "where everyone was" and "where
// everyone is now", it reports who climbed, who dropped, who is new —
// and exactly which rows need to be written back.

export interface RankSnapshotRow {
  user_id: number
  rank: number
  score: number
  prev_rank: number | null
  rank_moved_at: string | null
  first_seen_at: string
}

export interface StandingEntry {
  userId: number
  rank: number
  score: number
}

export interface RankMovement {
  /** prev rank − current rank at the last movement. Positive = climbed. */
  rankDelta: number
  /** When the movement happened (ISO). Null when the user has never moved. */
  movedAt: string | null
  /** True while the user is inside the "new to the board" window. */
  isNew: boolean
}

/** Row shapes written back to leaderboard_ranks. Inserts carry the full
 *  shape with ignoreDuplicates (racing reads must not clobber each other);
 *  updates deliberately omit first_seen_at so it is never overwritten. */
export interface SnapshotInsert {
  user_id: number
  rank: number
  score: number
  prev_rank: null
  rank_moved_at: null
  /** Only present on bootstrap passes — backdated past the entrant window
   *  so existing players are not flagged NEW when tracking first ships. */
  first_seen_at?: string
}

export interface SnapshotUpdate {
  user_id: number
  rank: number
  score: number
  prev_rank: number | null
  rank_moved_at: string | null
  updated_at: string
}

export interface StandingsDiff {
  movements: Map<number, RankMovement>
  inserts: SnapshotInsert[]
  updates: SnapshotUpdate[]
}

/** Most players a board read serves — a payload safety valve, not a
 *  product ceiling. Every ranked player appears until the population
 *  passes this. Must stay within the validation ceiling of the
 *  leaderboard_standings database function (migration 060). */
export const BOARD_LIMIT = 1000

/** How long a climb/drop arrow stays visible after the movement. */
export const MOVEMENT_WINDOW_MS = 48 * 3_600_000

/** How long the NEW chip stays on a first-time entrant. */
export const NEW_ENTRANT_WINDOW_MS = 48 * 3_600_000

export function diffStandings(
  previous: ReadonlyMap<number, RankSnapshotRow>,
  standings: readonly StandingEntry[],
  now: Date = new Date()
): StandingsDiff {
  const nowIso = now.toISOString()
  const nowMs = now.getTime()

  // An empty snapshot table means tracking just shipped (or was reset) —
  // nobody actually "joined the board" on this pass, so suppress NEW and
  // backdate first_seen_at past the entrant window.
  const bootstrap = previous.size === 0
  const bootstrapFirstSeen = new Date(
    nowMs - NEW_ENTRANT_WINDOW_MS
  ).toISOString()

  const movements = new Map<number, RankMovement>()
  const inserts: SnapshotInsert[] = []
  const updates: SnapshotUpdate[] = []

  for (const entry of standings) {
    const prev = previous.get(entry.userId)

    if (!prev) {
      movements.set(entry.userId, {
        rankDelta: 0,
        movedAt: null,
        isNew: !bootstrap
      })
      inserts.push({
        user_id: entry.userId,
        rank: entry.rank,
        score: entry.score,
        prev_rank: null,
        rank_moved_at: null,
        ...(bootstrap ? { first_seen_at: bootstrapFirstSeen } : {})
      })
      continue
    }

    const firstSeenMs = Date.parse(prev.first_seen_at)
    const isNew =
      Number.isFinite(firstSeenMs) && nowMs - firstSeenMs < NEW_ENTRANT_WINDOW_MS

    if (prev.rank !== entry.rank) {
      // Movement detected on this pass — record it.
      movements.set(entry.userId, {
        rankDelta: prev.rank - entry.rank,
        movedAt: nowIso,
        isNew
      })
      updates.push({
        user_id: entry.userId,
        rank: entry.rank,
        score: entry.score,
        prev_rank: prev.rank,
        rank_moved_at: nowIso,
        updated_at: nowIso
      })
      continue
    }

    // Rank unchanged — keep showing the last movement while it is fresh.
    const movedMs = prev.rank_moved_at ? Date.parse(prev.rank_moved_at) : NaN
    const movementFresh =
      Number.isFinite(movedMs) && nowMs - movedMs < MOVEMENT_WINDOW_MS
    const rankDelta =
      movementFresh && prev.prev_rank !== null ? prev.prev_rank - entry.rank : 0

    movements.set(entry.userId, {
      rankDelta,
      movedAt: movementFresh ? prev.rank_moved_at : null,
      isNew
    })

    if (prev.score !== entry.score) {
      updates.push({
        user_id: entry.userId,
        rank: entry.rank,
        score: entry.score,
        prev_rank: prev.prev_rank,
        rank_moved_at: prev.rank_moved_at,
        updated_at: nowIso
      })
    }
  }

  return { movements, inserts, updates }
}
