import type { SupabaseClient } from '@supabase/supabase-js'
import { applyEventsUserEq, canUseScoreRpc } from './eventsIdentity'

type ScoreEvent = {
  active_ms?: number | null
  total_ms?: number | null
  visits?: number | null
  domain?: string | null
}

type ScoreEventWithTimestamp = ScoreEvent & {
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
}

type ScoreBreakdown = {
  baseActivePoints: number
  baseVisitPoints: number
  multiplier: number
  finalPoints: number
}

export type ScorePolicy = {
  version: string
  activeMsPerPoint: number
  visitPoints: number
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
  // "v2" replaces implicit weighting with explicit multiplier steps.
  version: 'v2',
  activeMsPerPoint: 1_000,
  visitPoints: 40,
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
let scoreRecalcMode: 'rpc' | 'fallback' = ENABLE_LEGACY_SCORE_RPC ? 'rpc' : 'fallback'

export function normalizeLegacyEventValues(event: ScoreEvent) {
  const rawActive = Math.max(0, Number(event.active_ms || 0))
  const rawVisits = Math.max(0, Number(event.visits || 0))
  if (rawVisits <= 1) {
    return { activeMs: rawActive, visits: rawVisits }
  }

  // Older extension batches could merge duplicate payload entries into one row.
  // For read-time scoring, normalize merged rows to one visit-equivalent event.
  return {
    activeMs: Math.round(rawActive / rawVisits),
    visits: 1
  }
}

function normalizeTotalMs(event: ScoreEvent, normalizedActiveMs: number) {
  const rawTotal = Math.max(0, Number(event.total_ms || 0))
  if (rawTotal <= 0) return normalizedActiveMs
  return Math.max(rawTotal, normalizedActiveMs)
}

function clamp(min: number, value: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function eventMultiplier(event: ScoreEvent, normalizedActiveMs: number) {
  const totalMs = normalizeTotalMs(event, normalizedActiveMs)
  const focusRatio = totalMs > 0 ? normalizedActiveMs / totalMs : 0
  let multiplier = 1

  if (normalizedActiveMs > 0 && normalizedActiveMs < SCORE_POLICY.shortSessionThresholdMs) {
    multiplier *= SCORE_POLICY.shortSessionMultiplier
  } else if (normalizedActiveMs >= SCORE_POLICY.deepSessionThresholdMs) {
    multiplier *= SCORE_POLICY.deepSessionMultiplier
  }

  if (focusRatio >= SCORE_POLICY.highFocusThreshold) {
    multiplier *= SCORE_POLICY.highFocusMultiplier
  } else if (focusRatio > 0 && focusRatio <= SCORE_POLICY.lowFocusThreshold) {
    multiplier *= SCORE_POLICY.lowFocusMultiplier
  }

  return clamp(0.25, multiplier, 2)
}

export function scoreEventBreakdown(event: ScoreEvent): ScoreBreakdown {
  const normalized = normalizeLegacyEventValues(event)
  const baseActivePoints = normalized.activeMs / SCORE_POLICY.activeMsPerPoint
  const baseVisitPoints = normalized.visits * SCORE_POLICY.visitPoints
  const multiplier = eventMultiplier(event, normalized.activeMs)
  const finalPoints = (baseActivePoints + baseVisitPoints) * multiplier

  return {
    baseActivePoints,
    baseVisitPoints,
    multiplier,
    finalPoints
  }
}

export function eventScore(event: ScoreEvent) {
  return scoreEventBreakdown(event).finalPoints
}

export function scoreFromEvents(events: ScoreEvent[]) {
  return Math.round(events.reduce((sum, event) => sum + eventScore(event), 0))
}

export function visitsFromEvents(events: Array<{ visits?: number | null }>) {
  return events.reduce((sum, event) => {
    const normalized = normalizeLegacyEventValues({ visits: event.visits })
    return sum + normalized.visits
  }, 0)
}

function toUtcDayStartIso(baseDate: Date) {
  return new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate()
  )).toISOString()
}

function splitScoreWindows(events: ScoreEventWithTimestamp[], now: Date): ScoreWindow {
  const todayStartIso = toUtcDayStartIso(now)
  const weekStartIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const monthStartIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const byStartIso = (startIso: string) =>
    events.filter((event) => String(event.timestamp || '') >= startIso)

  return {
    total: events,
    today: byStartIso(todayStartIso),
    week: byStartIso(weekStartIso),
    month: byStartIso(monthStartIso)
  }
}

export function calculateScoreBuckets(events: ScoreEventWithTimestamp[], now: Date = new Date()) {
  const windows = splitScoreWindows(events, now)
  return {
    totalScore: scoreFromEvents(windows.total),
    todayScore: scoreFromEvents(windows.today),
    weekScore: scoreFromEvents(windows.week),
    monthScore: scoreFromEvents(windows.month),
    windows
  }
}

async function recalculateUserScoreFallback(supabase: SupabaseClient, userId: number) {
  let eventsQuery = supabase
    .from('events_raw')
    .select('active_ms, total_ms, visits, timestamp, domain')
  const { query: scopedEventsQuery, column } = await applyEventsUserEq(
    supabase,
    eventsQuery,
    userId
  )
  eventsQuery = scopedEventsQuery

  if (!column) {
    console.warn(
      `[Scoring] No compatible events_raw user column for fallback score calc (user ${userId})`
    )
    return false
  }

  const { data: events, error: eventsError } = await eventsQuery
  if (eventsError) {
    console.error('[Scoring] Fallback score query failed:', eventsError)
    return false
  }

  const now = new Date()
  const allEvents = (events || []) as ScoreEventWithTimestamp[]
  const scoreBuckets = calculateScoreBuckets(allEvents, now)

  const nowIso = now.toISOString()
  const payload = {
    user_id: userId,
    total_score: scoreBuckets.totalScore,
    today_score: scoreBuckets.todayScore,
    week_score: scoreBuckets.weekScore,
    month_score: scoreBuckets.monthScore,
    last_calculated_at: nowIso,
    updated_at: nowIso
  }

  const { error: upsertError } = await supabase
    .from('user_scores')
    .upsert(payload, { onConflict: 'user_id' })

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
    // RPC is legacy-only: it still uses the old formula and no multipliers.
    // Keep it opt-in so score writes remain consistent with read-time scoring.
    if (ENABLE_LEGACY_SCORE_RPC && scoreRecalcMode === 'rpc') {
      const rpcCompatible = await canUseScoreRpc(supabase)
      if (!rpcCompatible) {
        scoreRecalcMode = 'fallback'
      }
    }

    if (ENABLE_LEGACY_SCORE_RPC && scoreRecalcMode === 'rpc') {
      const { error: scoreError } = await supabase.rpc('recalculate_user_score', {
        p_user_id: userId
      })

      if (!scoreError) {
        return { scoresStale: false }
      }

      console.error('[Scoring] Failed to recalculate user score via RPC:', scoreError)
      scoreRecalcMode = 'fallback'
    }

    const fallbackOk = await recalculateUserScoreFallback(supabase, userId)
    return { scoresStale: !fallbackOk }
  } catch (error) {
    console.error('[Scoring] Error recalculating user score:', error)
    return { scoresStale: true }
  }
}
