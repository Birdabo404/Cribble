import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventsIdentityColumn } from './eventsIdentity'
import { fetchAllEventPages } from './eventsFetch'
import { fetchActiveSeasonWindow, type SeasonWindowMs } from './seasonServer'
import { buildRollupWriteColumns, computeUserStatsRollup } from './userStats'
import type { RankedTool } from './topTools'

// ============================================================================
// Cribble scoring — policy v3 (session-based)
//
// The extension reports two kinds of events_raw rows:
//   - heartbeat rows (visits = 0): active_ms of VERIFIED activity, emitted
//     every ~5s while the user is genuinely interacting with a tracked tool
//     (the ingest route may coalesce several ticks into one row).
//   - visit rows (visits >= 1): one page visit. Their active_ms/total_ms
//     hold unverified wall-clock page time, NOT activity.
//
// v2 applied engagement multipliers per ROW, which broke down because rows
// are 5-second ticks: every event was "short session" (x0.5) and "high
// focus" (x1.1, since total_ms always equalled active_ms), so the documented
// "1 pt per active second + 40 per visit" silently paid a flat 0.55x, the
// deep-session bonus was unreachable, and visit rows double-counted their
// wall-clock duration as active time.
//
// v3 scores SESSIONS: contiguous same-domain rows (gaps <= sessionGapMs)
// aggregate into one session, and the multipliers apply to the session's
// real totals. Visits pay exactly visitPoints; only heartbeat rows earn
// active-time points.
// ============================================================================

export type ScoreEvent = {
  active_ms?: number | null
  total_ms?: number | null
  visits?: number | null
  domain?: string | null
}

export type ScoreEventWithTimestamp = ScoreEvent & {
  timestamp?: string | null
}

export type RecalculateUserScoreResult = {
  scoresStale: boolean
}

type ScoreWindow = {
  total: ScoreEventWithTimestamp[]
  today: ScoreEventWithTimestamp[]
  week: ScoreEventWithTimestamp[]
  month: ScoreEventWithTimestamp[]
  /** Events inside the active season's [start, end) window; empty during
   *  intermission or when no season window was supplied. */
  season: ScoreEventWithTimestamp[]
}

export type ScorePolicy = {
  version: string
  activeMsPerPoint: number
  visitPoints: number
  /** A gap longer than this between same-domain events closes the session. */
  sessionGapMs: number
  shortSessionThresholdMs: number
  shortSessionMultiplier: number
  deepSessionThresholdMs: number
  deepSessionMultiplier: number
  highFocusThreshold: number
  highFocusMultiplier: number
  lowFocusThreshold: number
  lowFocusMultiplier: number
}

export const SCORE_POLICY: ScorePolicy = {
  // "v3" applies the v2 multiplier steps to real sessions instead of rows.
  version: 'v3',
  activeMsPerPoint: 1_000,
  visitPoints: 40,
  sessionGapMs: 5 * 60_000,
  shortSessionThresholdMs: 15_000,
  shortSessionMultiplier: 0.5,
  deepSessionThresholdMs: 10 * 60_000,
  deepSessionMultiplier: 1.15,
  highFocusThreshold: 0.85,
  highFocusMultiplier: 1.1,
  lowFocusThreshold: 0.35,
  lowFocusMultiplier: 0.85
}

const ENABLE_LEGACY_SCORE_RPC = process.env.ENABLE_LEGACY_SCORE_RPC === 'true'

/**
 * Per-row scoring contribution.
 *
 * Heartbeat rows (visits = 0) contribute verified active time. Visit rows
 * (visits >= 1) contribute exactly one visit and NO active time: their
 * active_ms is wall-clock page-open time (median ~2s, but up to 30 min for
 * throttled background tabs) that was never verified as activity and is
 * already covered by the parallel heartbeat stream. Legacy merged rows
 * (visits > 1, from old batches that collapsed duplicates) also normalize
 * to a single visit.
 */
export function normalizeLegacyEventValues(event: ScoreEvent) {
  const rawActive = Math.max(0, Number(event.active_ms || 0))
  const rawVisits = Math.max(0, Number(event.visits || 0))
  if (rawVisits === 0) {
    return { activeMs: rawActive, visits: 0 }
  }
  return { activeMs: 0, visits: 1 }
}

function clamp(min: number, value: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export type ScoreSession = {
  domain: string
  startMs: number
  endMs: number
  /** Verified active milliseconds (heartbeat contributions only). */
  activeMs: number
  visits: number
  /** Wall-clock span the session covers; always >= activeMs when active. */
  wallMs: number
  eventCount: number
}

type SessionRow = {
  ts: number
  activeMs: number
  visits: number
  /** Wall-clock span this row itself covers (0 for visit markers). */
  spanMs: number
}

function toSessionRow(event: ScoreEventWithTimestamp): SessionRow {
  const normalized = normalizeLegacyEventValues(event)
  const ts = Date.parse(String(event.timestamp || ''))
  const rawTotal = Math.max(0, Number(event.total_ms || 0))
  // Heartbeat rows cover their own tick (total_ms >= active_ms for rows the
  // ingest route coalesced); visit markers cover no verified span.
  const spanMs =
    normalized.visits > 0 ? 0 : Math.max(normalized.activeMs, rawTotal)
  return {
    ts: Number.isFinite(ts) ? ts : NaN,
    activeMs: normalized.activeMs,
    visits: normalized.visits,
    spanMs
  }
}

function buildSession(domain: string, rows: SessionRow[]): ScoreSession {
  let activeMs = 0
  let visits = 0
  for (const row of rows) {
    activeMs += row.activeMs
    visits += row.visits
  }
  const first = rows[0]
  const last = rows[rows.length - 1]
  const startMs = first.ts
  const endMs = last.ts
  const span = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, endMs - startMs) + last.spanMs
    : last.spanMs
  return {
    domain,
    startMs,
    endMs,
    activeMs,
    visits,
    wallMs: Math.max(activeMs, span),
    eventCount: rows.length
  }
}

/**
 * Group rows into engagement sessions: per domain, ordered by timestamp,
 * split wherever the gap between consecutive rows exceeds sessionGapMs.
 * Rows without a parseable timestamp become single-row sessions so their
 * points are never dropped.
 */
export function sessionizeEvents(
  events: ScoreEventWithTimestamp[],
  policy: ScorePolicy = SCORE_POLICY
): ScoreSession[] {
  const sessions: ScoreSession[] = []
  const byDomain = new Map<string, SessionRow[]>()

  for (const event of events) {
    const row = toSessionRow(event)
    if (row.activeMs === 0 && row.visits === 0) continue
    const domain = String(event.domain || '').toLowerCase()
    if (!Number.isFinite(row.ts)) {
      sessions.push(buildSession(domain, [row]))
      continue
    }
    const rows = byDomain.get(domain)
    if (rows) rows.push(row)
    else byDomain.set(domain, [row])
  }

  for (const [domain, rows] of byDomain) {
    rows.sort((a, b) => a.ts - b.ts)
    let current: SessionRow[] = []
    for (const row of rows) {
      if (
        current.length > 0 &&
        row.ts - current[current.length - 1].ts > policy.sessionGapMs
      ) {
        sessions.push(buildSession(domain, current))
        current = []
      }
      current.push(row)
    }
    if (current.length > 0) sessions.push(buildSession(domain, current))
  }

  return sessions
}

export function sessionMultiplier(
  session: Pick<ScoreSession, 'activeMs' | 'wallMs'>,
  policy: ScorePolicy = SCORE_POLICY
): number {
  let multiplier = 1

  if (
    session.activeMs > 0 &&
    session.activeMs < policy.shortSessionThresholdMs
  ) {
    multiplier *= policy.shortSessionMultiplier
  } else if (session.activeMs >= policy.deepSessionThresholdMs) {
    multiplier *= policy.deepSessionMultiplier
  }

  const focusRatio = session.wallMs > 0 ? session.activeMs / session.wallMs : 0
  if (focusRatio >= policy.highFocusThreshold) {
    multiplier *= policy.highFocusMultiplier
  } else if (focusRatio > 0 && focusRatio <= policy.lowFocusThreshold) {
    multiplier *= policy.lowFocusMultiplier
  }

  return clamp(0.25, multiplier, 2)
}

export function sessionScore(
  session: ScoreSession,
  policy: ScorePolicy = SCORE_POLICY
): number {
  const basePoints =
    session.activeMs / policy.activeMsPerPoint +
    session.visits * policy.visitPoints
  return basePoints * sessionMultiplier(session, policy)
}

/** Total (unrounded would drift per-caller — always rounded) session score. */
export function scoreFromEvents(events: ScoreEventWithTimestamp[]): number {
  const total = sessionizeEvents(events).reduce(
    (sum, session) => sum + sessionScore(session),
    0
  )
  return Math.round(total)
}

export function visitsFromEvents(events: Array<{ visits?: number | null }>) {
  return events.reduce((sum, event) => {
    const normalized = normalizeLegacyEventValues({ visits: event.visits })
    return sum + normalized.visits
  }, 0)
}

export type WindowAggregate = {
  score: number
  activeMs: number
  wallMs: number
  visits: number
  sessions: number
}

function aggregateWindow(events: ScoreEventWithTimestamp[]): WindowAggregate {
  const sessions = sessionizeEvents(events)
  let score = 0
  let activeMs = 0
  let wallMs = 0
  let visits = 0
  for (const session of sessions) {
    score += sessionScore(session)
    activeMs += session.activeMs
    wallMs += session.wallMs
    visits += session.visits
  }
  return {
    score: Math.round(score),
    activeMs,
    wallMs,
    visits,
    sessions: sessions.length
  }
}

function toUtcDayStartIso(baseDate: Date) {
  return new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate()
  )).toISOString()
}

function splitScoreWindows(
  events: ScoreEventWithTimestamp[],
  now: Date,
  seasonWindow: SeasonWindowMs | null = null
): ScoreWindow {
  const todayStartMs = Date.parse(toUtcDayStartIso(now))
  const weekStartMs = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const monthStartMs = now.getTime() - 30 * 24 * 60 * 60 * 1000

  const since = (startMs: number) =>
    events.filter((event) => {
      const ts = Date.parse(String(event.timestamp || ''))
      return Number.isFinite(ts) && ts >= startMs
    })

  // The season window is bounded on both sides: a sync that lands after
  // ends_at (but before the tick closes the season) must not move the
  // final standings, so trailing events fall outside the bucket.
  const season = seasonWindow
    ? events.filter((event) => {
        const ts = Date.parse(String(event.timestamp || ''))
        return (
          Number.isFinite(ts) && ts >= seasonWindow.startMs && ts < seasonWindow.endMs
        )
      })
    : []

  return {
    total: events,
    today: since(todayStartMs),
    week: since(weekStartMs),
    month: since(monthStartMs),
    season
  }
}

export function calculateScoreBuckets(
  events: ScoreEventWithTimestamp[],
  now: Date = new Date(),
  seasonWindow: SeasonWindowMs | null = null
) {
  const windows = splitScoreWindows(events, now, seasonWindow)
  const total = aggregateWindow(windows.total)
  const today = aggregateWindow(windows.today)
  const week = aggregateWindow(windows.week)
  const month = aggregateWindow(windows.month)
  const season = aggregateWindow(windows.season)
  return {
    totalScore: total.score,
    todayScore: today.score,
    weekScore: week.score,
    monthScore: month.score,
    seasonScore: season.score,
    aggregates: { total, today, week, month, season },
    windows
  }
}

/**
 * Fetch a user's complete event history, paging past the PostgREST max-rows
 * cap (1000 on hosted Supabase). Without paging, users with more than 1000
 * events silently plateau — and because the un-ordered subset is arbitrary,
 * their recalculated score can even fluctuate between syncs.
 */
export async function fetchAllUserEvents(
  supabase: SupabaseClient,
  userId: number,
  select = 'active_ms, total_ms, visits, timestamp, domain'
): Promise<{ events: ScoreEventWithTimestamp[] | null; column: string | null }> {
  const column = await getEventsIdentityColumn(supabase)
  if (!column) return { events: null, column: null }

  const { rows, error, truncated } = await fetchAllEventPages<ScoreEventWithTimestamp>(
    (from, to) =>
      supabase
        .from('events_raw')
        .select(select)
        .eq(column, userId)
        .order('timestamp', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as PromiseLike<{
          data: ScoreEventWithTimestamp[] | null
          error: { message: string } | null
        }>
  )

  if (error) {
    console.error(`[Scoring] Paged events fetch failed (user ${userId}):`, error)
    return { events: null, column }
  }
  if (truncated) {
    console.warn(`[Scoring] Event history truncated at page cap (user ${userId})`)
  }
  return { events: rows, column }
}

/**
 * Referral bonus points (migration 026) live outside event math: the
 * recalc rebuilds total_score from events_raw, so a raw increment would
 * be wiped on the next sync. When the column is missing (migration not
 * applied) the read errors and the recalc behaves exactly as before.
 */
async function fetchUserBonusScore(
  supabase: SupabaseClient,
  userId: number
): Promise<number> {
  const { data, error } = await supabase
    .from('user_scores')
    .select('bonus_score')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return 0
  const bonus = Math.round(Number(data?.bonus_score ?? 0))
  return Number.isFinite(bonus) && bonus > 0 ? bonus : 0
}

async function recalculateUserScoreFallback(supabase: SupabaseClient, userId: number) {
  const [{ events, column }, seasonLookup, bonusScore] = await Promise.all([
    fetchAllUserEvents(supabase, userId),
    fetchActiveSeasonWindow(supabase),
    fetchUserBonusScore(supabase, userId)
  ])

  if (!column) {
    console.warn(
      `[Scoring] No compatible events_raw user column for fallback score calc (user ${userId})`
    )
    return false
  }
  if (events === null) return false

  const now = new Date()
  const scoreBuckets = calculateScoreBuckets(events, now, seasonLookup.window)

  const nowIso = now.toISOString()
  const payload: Record<string, number | string | RankedTool[]> = {
    user_id: userId,
    // Lifetime total carries the referral bonus; today/week/month/season
    // buckets stay pure event competition.
    total_score: scoreBuckets.totalScore + bonusScore,
    today_score: scoreBuckets.todayScore,
    week_score: scoreBuckets.weekScore,
    month_score: scoreBuckets.monthScore,
    last_calculated_at: nowIso,
    updated_at: nowIso
  }
  // Season score is written whenever the calendar is reachable: the live
  // window's score during a season, 0 during intermission. When the
  // seasons table is missing (migration 025 not applied) the column is
  // missing too, so it must stay out of the upsert entirely.
  if (seasonLookup.available) {
    payload.season_score = seasonLookup.window ? scoreBuckets.seasonScore : 0
  }

  // Stats rollup (migration 036) rides the same upsert: this path already
  // holds the full event list, so refreshing top_tools / active_days /
  // longest_streak / total_active_ms here is what lets every read path
  // skip events_raw entirely.
  const rollupColumns = buildRollupWriteColumns(
    computeUserStatsRollup(events),
    nowIso
  )

  let { error: upsertError } = await supabase
    .from('user_scores')
    .upsert({ ...payload, ...rollupColumns }, { onConflict: 'user_id' })

  // PGRST204 = a payload column is missing from the schema cache. If the
  // rollup columns are what's missing (migration 036 not applied on this
  // database), the score write itself must still land — retry without
  // them rather than letting scores go permanently stale.
  if (
    upsertError &&
    upsertError.code === 'PGRST204' &&
    /top_tools|active_days|longest_streak|total_active_ms|stats_updated_at/.test(
      upsertError.message || ''
    )
  ) {
    console.warn(
      '[Scoring] Stats rollup columns missing (apply migrations/036_user_stats_rollup.sql); writing scores only.'
    )
    ;({ error: upsertError } = await supabase
      .from('user_scores')
      .upsert(payload, { onConflict: 'user_id' }))
  }

  if (upsertError) {
    console.error('[Scoring] Fallback score upsert failed:', upsertError)
    return false
  }

  return true
}

export async function recalculateUserScore(
  supabase: SupabaseClient,
  userId: number
): Promise<RecalculateUserScoreResult> {
  try {
    // The legacy RPC still uses the v1 formula (50/visit, no sessions, and
    // it counts visit-row wall time as active time). It must stay opt-in;
    // enabling it would desync user_scores from read-time scoring.
    if (ENABLE_LEGACY_SCORE_RPC) {
      const { error: scoreError } = await supabase.rpc('recalculate_user_score', {
        p_user_id: userId
      })

      if (!scoreError) {
        return { scoresStale: false }
      }

      console.error('[Scoring] Failed to recalculate user score via RPC:', scoreError)
    }

    const fallbackOk = await recalculateUserScoreFallback(supabase, userId)
    return { scoresStale: !fallbackOk }
  } catch (error) {
    console.error('[Scoring] Error recalculating user score:', error)
    return { scoresStale: true }
  }
}
