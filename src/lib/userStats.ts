// Per-user stats rollup (migration 036). Top tools, active days, longest
// streak, and total active ms live as columns on user_scores so the read
// paths (/api/user/me, /api/user/tools, /api/leaderboard top-tools
// decoration, public profiles) never replay events_raw per request. The
// extension-sync score recalculation writes them for free — it already
// holds the full event list — and rows that predate the migration carry
// stats_updated_at = NULL, which flags them for a one-time lazy backfill
// on their next read.
//
// Migration 069 adds activity_days — per-UTC-day active ms for the last
// ACTIVITY_WINDOW_DAYS — to the same rollup, with the same write path and
// the same NULL-means-backfill contract. Those days also carry summed
// agent token totals (optional `tokens`) so the profile grid lights up
// when either the extension or the CLI was active. Focus time stays
// extension milliseconds: tokens are never turned into activeMs, and
// active_days / longest_streak / total_active_ms stay extension-only.

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

/** The activity grid shows 13 weeks; the rollup keeps exactly that many
 *  UTC days (today inclusive) so the column stays small and bounded. */
export const ACTIVITY_WINDOW_DAYS = 91

const DAY_MS = 86_400_000

/** One UTC day on the profile activity grid. Present when the extension
 *  recorded focus time, the CLI recorded token usage, or both. */
export interface ActivityDay {
  /** UTC date key, 'YYYY-MM-DD'. */
  date: string
  /** Verified extension focus time. 0 on a token-only day — never
   *  derived from tokens. */
  activeMs: number
  /** Summed agent_usage_daily.total_tokens for this date key. The CLI
   *  reports its local calendar day (agent_usage_daily.timezone), so a
   *  session near midnight can sit one cell off the UTC extension
   *  bucket; the grid treats both as the same day key. Omitted (not
   *  stored as 0) when the day has no token usage, so a pure extension
   *  rollup keeps the pre-token JSON shape. */
  tokens?: number
}

/** One UTC date of CLI token usage, before it is merged onto an
 *  ActivityDay. `tokens` is total_tokens, already summed across clients
 *  or still split per client (mergeTokenActivity sums the splits). */
export interface TokenActivityDay {
  /** UTC date key, 'YYYY-MM-DD'. */
  date: string
  tokens: number
}

export interface UserStatsRollup {
  /** rankToolsFromEvents output, capped at TOP_TOOLS_ROLLUP_LIMIT. */
  topTools: RankedTool[]
  activeDays: number
  longestStreak: number
  totalActiveMs: number
  /** Days inside the last ACTIVITY_WINDOW_DAYS UTC days with extension
   *  focus time and/or agent token usage, ascending by date.
   *  computeUserStatsRollup fills only the extension days;
   *  mergeTokenActivity attaches tokens. */
  activityDays: ActivityDay[]
}

/** Rollup columns as they come back from a user_scores select. */
export interface UserStatsRollupColumns {
  top_tools?: unknown
  active_days?: number | null
  longest_streak?: number | null
  total_active_ms?: number | null
  stats_updated_at?: string | null
  activity_days?: unknown
}

export const USER_STATS_ROLLUP_SELECT =
  'top_tools, active_days, longest_streak, total_active_ms, stats_updated_at, activity_days'

const utcDayKey = (ms: number): string => new Date(ms).toISOString().split('T')[0]

/** Inclusive UTC date keys for the rollup window: today and the
 *  preceding ACTIVITY_WINDOW_DAYS - 1 days. Lexical compare works
 *  because the keys are zero-padded ISO dates. Shared so the token
 *  merge clamps to the same window as the extension rollup. */
function activityWindowKeys(now: Date): { firstKey: string; todayKey: string } {
  return {
    todayKey: utcDayKey(now.getTime()),
    firstKey: utcDayKey(now.getTime() - (ACTIVITY_WINDOW_DAYS - 1) * DAY_MS)
  }
}

/**
 * Compute the rollup from a user's full event history — the exact
 * aggregation loadPublicProfile used to run per view, so the numbers do
 * not change: distinct UTC event days, longest consecutive-day streak,
 * verified active ms (normalized so visit rows contribute none), and the
 * shared score-first tool ranking. `now` bounds the activity_days window
 * (last ACTIVITY_WINDOW_DAYS UTC days, today inclusive) and is injectable
 * so tests can pin it.
 */
export function computeUserStatsRollup(
  events: ScoreEventWithTimestamp[],
  now: Date = new Date()
): UserStatsRollup {
  const dayKeys = new Set<string>()
  const dayActiveMs = new Map<string, number>()
  let totalActiveMs = 0
  for (const ev of events) {
    const activeMs = normalizeLegacyEventValues(ev).activeMs
    totalActiveMs += activeMs
    const t = ev.timestamp ? Date.parse(String(ev.timestamp)) : NaN
    if (Number.isFinite(t)) {
      const key = utcDayKey(t)
      dayKeys.add(key)
      if (activeMs > 0) dayActiveMs.set(key, (dayActiveMs.get(key) ?? 0) + activeMs)
    }
  }

  const { firstKey, todayKey } = activityWindowKeys(now)
  const activityDays: ActivityDay[] = []
  for (const [date, ms] of dayActiveMs) {
    if (date >= firstKey && date <= todayKey) activityDays.push({ date, activeMs: ms })
  }
  activityDays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return {
    topTools: rankToolsFromEvents(events).slice(0, TOP_TOOLS_ROLLUP_LIMIT),
    activeDays: dayKeys.size,
    longestStreak: longestStreakFromDayKeys(dayKeys),
    totalActiveMs,
    activityDays
  }
}

/** The user_scores column payload a rollup write contributes. */
export function buildRollupWriteColumns(
  rollup: UserStatsRollup,
  nowIso: string
): Record<string, RankedTool[] | ActivityDay[] | number | string> {
  return {
    top_tools: rollup.topTools,
    active_days: rollup.activeDays,
    longest_streak: rollup.longestStreak,
    total_active_ms: rollup.totalActiveMs,
    stats_updated_at: nowIso,
    activity_days: rollup.activityDays
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

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Non-negative integer, same guard the rollup uses for activeMs:
 *  non-finite becomes 0, then rounded. Negatives clamp to 0 so a
 *  token-only day can still be stored with activeMs 0. */
function roundedNonNegative(value: unknown): number {
  return Math.max(0, Math.round(toFiniteNumber(value)))
}

function sortActivityDays(days: ActivityDay[]): ActivityDay[] {
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return days
}

function inActivityWindow(date: string, now: Date): boolean {
  if (!DATE_KEY_RE.test(date)) return false
  const { firstKey, todayKey } = activityWindowKeys(now)
  return date >= firstKey && date <= todayKey
}

/** Parse a stored activity_days jsonb value back into ActivityDay[].
 *  A day is kept when activeMs > 0 or tokens > 0; a token-only day
 *  comes back as activeMs 0 plus tokens. Malformed entries are skipped,
 *  the tokens key is omitted when absent or not positive (so a pure
 *  extension day round-trips unchanged), and the result is re-sorted
 *  ascending. null (row not backfilled yet) reads as an empty list. */
export function parseStoredActivityDays(value: unknown): ActivityDay[] {
  if (!Array.isArray(value)) return []
  const days: ActivityDay[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    const date = typeof raw.date === 'string' ? raw.date : ''
    if (!DATE_KEY_RE.test(date)) continue
    const activeMs = roundedNonNegative(raw.activeMs)
    const tokens = roundedNonNegative(raw.tokens)
    if (activeMs <= 0 && tokens <= 0) continue
    const day: ActivityDay = { date, activeMs }
    if (tokens > 0) day.tokens = tokens
    days.push(day)
  }
  return sortActivityDays(days)
}

/**
 * Union extension focus days with CLI token days, clamped to the same
 * ACTIVITY_WINDOW_DAYS window as computeUserStatsRollup.
 *
 * `tokenDays` is the window's token total: one row per date, or several
 * client rows for the same date (those are summed). Tokens already on
 * `activityDays` are not added on top — callers pass a fresh aggregate
 * from agent_usage_daily, and adding it to a previously merged total
 * would double. Extension activeMs wins on days that have both. Days
 * where both signals are 0, days outside the window, and invalid date
 * keys are dropped. Result is ascending by date; the tokens key is
 * omitted when the date has none.
 */
export function mergeTokenActivity(
  activityDays: ActivityDay[],
  tokenDays: TokenActivityDay[],
  now: Date = new Date()
): ActivityDay[] {
  const activeMsByDate = new Map<string, number>()
  for (const day of activityDays) {
    if (!inActivityWindow(day.date, now)) continue
    const activeMs = roundedNonNegative(day.activeMs)
    if (activeMs <= 0) continue
    // Last positive row wins. The rollup already aggregates per day;
    // summing here would double a day that was listed twice.
    activeMsByDate.set(day.date, activeMs)
  }

  const tokensByDate = new Map<string, number>()
  for (const row of tokenDays) {
    if (!inActivityWindow(row.date, now)) continue
    const tokens = roundedNonNegative(row.tokens)
    if (tokens <= 0) continue
    tokensByDate.set(row.date, (tokensByDate.get(row.date) ?? 0) + tokens)
  }

  const dates = new Set<string>([...activeMsByDate.keys(), ...tokensByDate.keys()])
  const merged: ActivityDay[] = []
  for (const date of dates) {
    const activeMs = activeMsByDate.get(date) ?? 0
    const tokens = tokensByDate.get(date) ?? 0
    if (activeMs <= 0 && tokens <= 0) continue
    const day: ActivityDay = { date, activeMs }
    if (tokens > 0) day.tokens = tokens
    merged.push(day)
  }
  return sortActivityDays(merged)
}

function readDateKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  const date = value.length >= 10 ? value.slice(0, 10) : value
  return DATE_KEY_RE.test(date) ? date : ''
}

/** agent_usage_daily rows for this user inside the activity window,
 *  summed per UTC date. null on error so callers keep the extension-only
 *  rollup; an empty list means the user simply has no token days. */
export async function fetchTokenActivityDays(
  supabase: SupabaseClient,
  userId: number,
  now: Date = new Date()
): Promise<TokenActivityDay[] | null> {
  try {
    const { firstKey } = activityWindowKeys(now)
    const { data, error } = await supabase
      .from('agent_usage_daily')
      .select('date, total_tokens')
      .eq('user_id', userId)
      .gte('date', firstKey)

    if (error) {
      console.error(
        `[UserStats] Token activity read failed (user ${userId}):`,
        error.message
      )
      return null
    }

    const totals = new Map<string, number>()
    const rows = Array.isArray(data) ? data : []
    for (const row of rows) {
      const raw = row as { date?: unknown; total_tokens?: unknown }
      const date = readDateKey(raw.date)
      if (!date) continue
      const tokens = roundedNonNegative(raw.total_tokens)
      if (tokens <= 0) continue
      totals.set(date, (totals.get(date) ?? 0) + tokens)
    }

    const days: TokenActivityDay[] = []
    for (const [date, tokens] of totals) days.push({ date, tokens })
    return days
  } catch (err) {
    console.error(`[UserStats] Token activity read failed (user ${userId}):`, err)
    return null
  }
}

function rollupFromColumns(row: UserStatsRollupColumns): UserStatsRollup {
  return {
    topTools: parseStoredTopTools(row.top_tools),
    activeDays: Math.max(0, Math.round(toFiniteNumber(row.active_days))),
    longestStreak: Math.max(0, Math.round(toFiniteNumber(row.longest_streak))),
    totalActiveMs: Math.max(0, Math.round(toFiniteNumber(row.total_active_ms))),
    activityDays: parseStoredActivityDays(row.activity_days)
  }
}

/**
 * Read a user's rollup with lazy backfill.
 *
 * `preloaded` is the rollup column set from a user_scores row the caller
 * already fetched (pass null when the row is known to be missing); leave
 * it undefined and the helper reads the row itself. When
 * stats_updated_at is set and activity_days is present the stored values
 * are returned as-is — zero extra queries. When either is null (row
 * predates migration 036 or 069, or no row at all) the user's events are
 * fetched ONCE, the rollup is computed and persisted, and the fresh
 * values are returned, so the backfill cost is paid a single time per
 * user instead of on every read.
 *
 * The backfill merges CLI token days into activityDays before it
 * persists. A failed token read skips that merge and still writes the
 * extension rollup; active_days, longest_streak, and total_active_ms
 * are never touched by tokens.
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

  // activity_days NULL/undefined is the 069 analogue of stats_updated_at
  // NULL: rows the 036 backfill or a pre-069 sync already wrote carry the
  // other columns but no per-day list, so they replay events once more.
  // The write below always stores an array (empty when the window had no
  // activity), so the replay is one-time per user even for idle accounts.
  // Tradeoff: a database where 069 has not been applied yet keeps that
  // column undefined on every read and pays the replay each time — same
  // pre-migration behaviour 036 had, and the persist fails loudly below.
  if (row?.stats_updated_at && row.activity_days != null) {
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

  const now = new Date()
  const rollup = computeUserStatsRollup(events, now)
  const tokenDays = await fetchTokenActivityDays(supabase, userId, now)
  if (tokenDays !== null) {
    rollup.activityDays = mergeTokenActivity(rollup.activityDays, tokenDays, now)
  }
  const nowIso = now.toISOString()
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

/**
 * Fold the user's current agent_usage_daily totals into the stored
 * activity_days array and upsert only that column (plus updated_at).
 * Called after a CLI ingest, which does not replay events_raw.
 *
 * A missing row or NULL activity_days is left alone — the next profile
 * read's lazy backfill merges tokens itself, and inserting a partial
 * user_scores row here would publish a zero score. A non-array value
 * is left alone too. A failed token read does not write, so a stored
 * token total is not wiped by a transient error. Failures are logged
 * and swallowed; the ingest that called this must still succeed.
 */
export async function refreshTokenActivityDays(
  supabase: SupabaseClient,
  userId: number,
  now: Date = new Date()
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('user_scores')
      .select('activity_days')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error(
        `[UserStats] Activity days read failed (user ${userId}):`,
        error.message
      )
      return
    }

    const stored = (data as { activity_days?: unknown } | null)?.activity_days
    if (!Array.isArray(stored)) return

    const tokenDays = await fetchTokenActivityDays(supabase, userId, now)
    if (tokenDays === null) return

    const activityDays = mergeTokenActivity(
      parseStoredActivityDays(stored),
      tokenDays,
      now
    )
    const nowIso = now.toISOString()
    const { error: upsertError } = await supabase.from('user_scores').upsert(
      {
        user_id: userId,
        activity_days: activityDays,
        updated_at: nowIso
      },
      { onConflict: 'user_id' }
    )
    if (upsertError) {
      console.error(
        `[UserStats] Activity days token refresh failed (user ${userId}):`,
        upsertError.message
      )
    }
  } catch (err) {
    console.error(
      `[UserStats] Activity days token refresh failed (user ${userId}):`,
      err
    )
  }
}
