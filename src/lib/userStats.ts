// Per-user stats rollup (migration 036). Top tools, active days, longest
// streak, and total active ms live as columns on user_scores so the read
// paths (/api/user/me, /api/user/tools, /api/leaderboard top-tools
// decoration, public profiles) never replay events_raw per request. The
// extension-sync score recalculation writes them for free — it already
// holds the full event list — and rows that predate the migration carry
// stats_updated_at = NULL, which flags them for a one-time lazy backfill
// on their next read.

import type { SupabaseClient } from '@supabase/supabase-js'
import { longestStreakFromDayKeys } from './achievements'
import {
  fetchAllUserEvents,
  normalizeLegacyEventValues,
  type ScoreEventWithTimestamp
} from './scoring'
import { rankToolsFromEvents, type RankedTool } from './topTools'

/** The rollup stores more tools than any surface renders (profiles and
 *  the board show 3, the dashboard tools API up to 20), so slicing stays
 *  a read-time choice instead of a write-time loss. */
export const TOP_TOOLS_ROLLUP_LIMIT = 20

export interface UserStatsRollup {
  /** rankToolsFromEvents output, capped at TOP_TOOLS_ROLLUP_LIMIT. */
  topTools: RankedTool[]
  activeDays: number
  longestStreak: number
  totalActiveMs: number
}

/** Rollup columns as they come back from a user_scores select. */
export interface UserStatsRollupColumns {
  top_tools?: unknown
  active_days?: number | null
  longest_streak?: number | null
  total_active_ms?: number | null
  stats_updated_at?: string | null
}

export const USER_STATS_ROLLUP_SELECT =
  'top_tools, active_days, longest_streak, total_active_ms, stats_updated_at'

/**
 * Compute the rollup from a user's full event history — the exact
 * aggregation loadPublicProfile used to run per view, so the numbers do
 * not change: distinct UTC event days, longest consecutive-day streak,
 * verified active ms (normalized so visit rows contribute none), and the
 * shared score-first tool ranking.
 */
export function computeUserStatsRollup(
  events: ScoreEventWithTimestamp[]
): UserStatsRollup {
  const dayKeys = new Set<string>()
  let totalActiveMs = 0
  for (const ev of events) {
    totalActiveMs += normalizeLegacyEventValues(ev).activeMs
    const t = ev.timestamp ? Date.parse(String(ev.timestamp)) : NaN
    if (Number.isFinite(t)) {
      dayKeys.add(new Date(t).toISOString().split('T')[0])
    }
  }
  return {
    topTools: rankToolsFromEvents(events).slice(0, TOP_TOOLS_ROLLUP_LIMIT),
    activeDays: dayKeys.size,
    longestStreak: longestStreakFromDayKeys(dayKeys),
    totalActiveMs
  }
}

/** The user_scores column payload a rollup write contributes. */
export function buildRollupWriteColumns(
  rollup: UserStatsRollup,
  nowIso: string
): Record<string, RankedTool[] | number | string> {
  return {
    top_tools: rollup.topTools,
    active_days: rollup.activeDays,
    longest_streak: rollup.longestStreak,
    total_active_ms: rollup.totalActiveMs,
    stats_updated_at: nowIso
  }
}

const toFiniteNumber = (value: unknown): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Parse a stored top_tools jsonb value back into RankedTool[]. Anything
 *  malformed (or null — row not backfilled yet) reads as an empty list. */
export function parseStoredTopTools(value: unknown): RankedTool[] {
  if (!Array.isArray(value)) return []
  const tools: RankedTool[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name : ''
    if (!name) continue
    tools.push({
      name,
      visits: toFiniteNumber(raw.visits),
      active_ms: toFiniteNumber(raw.active_ms),
      score: toFiniteNumber(raw.score),
      percent: toFiniteNumber(raw.percent),
      visitsPercent: toFiniteNumber(raw.visitsPercent)
    })
  }
  return tools
}

function rollupFromColumns(row: UserStatsRollupColumns): UserStatsRollup {
  return {
    topTools: parseStoredTopTools(row.top_tools),
    activeDays: Math.max(0, Math.round(toFiniteNumber(row.active_days))),
    longestStreak: Math.max(0, Math.round(toFiniteNumber(row.longest_streak))),
    totalActiveMs: Math.max(0, Math.round(toFiniteNumber(row.total_active_ms)))
  }
}

/**
 * Read a user's rollup with lazy backfill.
 *
 * `preloaded` is the rollup column set from a user_scores row the caller
 * already fetched (pass null when the row is known to be missing); leave
 * it undefined and the helper reads the row itself. When
 * stats_updated_at is set the stored values are returned as-is — zero
 * extra queries. When it is null (pre-migration row, or no row at all)
 * the user's events are fetched ONCE, the rollup is computed and
 * persisted, and the fresh values are returned, so the backfill cost is
 * paid a single time per user instead of on every read.
 *
 * Returns null only when the rollup could not be determined at all
 * (row read failed, or backfill needed but the events fetch failed) —
 * callers degrade the same way they did when a live events scan failed.
 */
export async function ensureUserStatsRollup(
  supabase: SupabaseClient,
  userId: number,
  preloaded?: UserStatsRollupColumns | null
): Promise<UserStatsRollup | null> {
  let row: UserStatsRollupColumns | null

  if (preloaded !== undefined) {
    row = preloaded
  } else {
    const { data, error } = await supabase
      .from('user_scores')
      .select(USER_STATS_ROLLUP_SELECT)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error(
        `[UserStats] Rollup read failed (user ${userId}):`,
        error.message
      )
      return null
    }
    row = (data as UserStatsRollupColumns | null) ?? null
  }

  if (row?.stats_updated_at) {
    return rollupFromColumns(row)
  }

  // Backfill: one full (paged) events read, then the columns are written
  // so every later read is column-only. A failed events fetch returns
  // null WITHOUT persisting, so the next read retries the backfill.
  const { events, column } = await fetchAllUserEvents(supabase, userId)
  if (!column) {
    console.warn(
      `[UserStats] No compatible events_raw user column for backfill (user ${userId})`
    )
    return null
  }
  if (events === null) return null

  const rollup = computeUserStatsRollup(events)
  const nowIso = new Date().toISOString()
  const { error: upsertError } = await supabase.from('user_scores').upsert(
    {
      user_id: userId,
      ...buildRollupWriteColumns(rollup, nowIso),
      updated_at: nowIso
    },
    { onConflict: 'user_id' }
  )

  // The computed values are correct either way; a failed persist just
  // means the next read pays the backfill again.
  if (upsertError) {
    console.error(
      `[UserStats] Rollup backfill upsert failed (user ${userId}):`,
      upsertError.message
    )
  }

  return rollup
}
