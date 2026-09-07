import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assessUserFraud,
  type FraudAssessment,
  type FraudCategoryAssessment,
  type TokenDay
} from './fraudDetection'
import { fetchAllEventPages } from './eventsFetch'
import { getEventsIdentityColumn } from './eventsIdentity'
import { insertMissingNotifications } from './notifications'
import type { ScoreEventWithTimestamp } from './scoring'

// Service layer for the fraud-detection engine: fetch a user's recent
// activity + token history, run the pure assessor (fraudDetection.ts), persist
// one flag per tripped category into fraud_flags, and alert staff the first
// time a distinct signal set appears. Everything here is best-effort and NEVER
// throws — a detection outage must not break the sync path or the cron it
// piggybacks on. Persistence and alerting are split out from the fetch so the
// decision logic stays unit-testable against a mock Supabase client.

/** How far back the sweep looks. Activity is dense (heartbeats); tokens are one
 *  row per day, so a wider token window costs almost nothing. */
export const FRAUD_ACTIVITY_WINDOW_DAYS = 30
export const FRAUD_TOKEN_WINDOW_DAYS = 90

/** Enough pages to cover a heavy 30-day window post-coalescing without letting
 *  a single pathological account stall the whole sweep. */
const ACTIVITY_MAX_PAGES = 30

/** Ceiling on how many users one sweep assesses, so the cron stays bounded. */
export const SWEEP_MAX_USERS = 200

interface TokenDayRow {
  date: string | null
  total_tokens: number | string | null
  cost_usd: number | string | null
}

/** Map agent_usage_daily rows into the engine's TokenDay shape. */
export function mapTokenDayRows(rows: TokenDayRow[] | null | undefined): TokenDay[] {
  return (rows ?? [])
    .filter((row): row is TokenDayRow & { date: string } => typeof row.date === 'string')
    .map((row) => ({
      date: row.date,
      totalTokens: Math.max(0, Number(row.total_tokens ?? 0)),
      costUsd: Math.max(0, Number(row.cost_usd ?? 0))
    }))
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

function dateDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** Recent events_raw rows for a user, schema-compat and page-bounded. */
export async function fetchRecentUserActivity(
  supabase: SupabaseClient,
  userId: number,
  now: Date
): Promise<ScoreEventWithTimestamp[]> {
  const column = await getEventsIdentityColumn(supabase)
  if (!column) return []

  const since = isoDaysAgo(now, FRAUD_ACTIVITY_WINDOW_DAYS)
  const { rows, error } = await fetchAllEventPages<ScoreEventWithTimestamp>(
    (from, to) =>
      supabase
        .from('events_raw')
        .select('active_ms, total_ms, visits, timestamp, domain')
        .eq(column, userId)
        .gte('timestamp', since)
        .order('timestamp', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as PromiseLike<{
          data: ScoreEventWithTimestamp[] | null
          error: { message: string } | null
        }>,
    { maxPages: ACTIVITY_MAX_PAGES }
  )

  if (error) {
    console.error(`[FraudDetection] Activity fetch failed (user ${userId}):`, error)
    return []
  }
  return rows
}

/** Recent agent_usage_daily rows for a user. */
export async function fetchRecentUserTokenDays(
  supabase: SupabaseClient,
  userId: number,
  now: Date
): Promise<TokenDay[]> {
  const { data, error } = await supabase
    .from('agent_usage_daily')
    .select('date, total_tokens, cost_usd')
    .eq('user_id', userId)
    .gte('date', dateDaysAgo(now, FRAUD_TOKEN_WINDOW_DAYS))

  if (error) {
    console.error(`[FraudDetection] Token fetch failed (user ${userId}):`, error)
    return []
  }
  return mapTokenDayRows(data as TokenDayRow[] | null)
}

export interface FraudPersistResult {
  /** Categories whose flag was newly opened (a distinct signal set). */
  opened: FraudCategoryAssessment[]
  /** Categories whose existing flag was refreshed. */
  updated: FraudCategoryAssessment[]
}

/**
 * Upsert one flag per tripped category, deduped on (user_id, fingerprint).
 * A recurring signal set refreshes the existing row's risk fields and bumps
 * detection_count + last_detected_at WITHOUT resurrecting a staff decision
 * (status is left untouched). A materially different set opens a fresh flag.
 * Best-effort per category: one write failure never blocks the others.
 */
export async function persistFraudAssessment(
  supabase: SupabaseClient,
  userId: number,
  assessment: FraudAssessment,
  now: Date = new Date()
): Promise<FraudPersistResult> {
  const result: FraudPersistResult = { opened: [], updated: [] }
  const nowIso = now.toISOString()

  for (const category of assessment.categories) {
    try {
      const { data: existing, error: lookupError } = await supabase
        .from('fraud_flags')
        .select('id, detection_count')
        .eq('user_id', userId)
        .eq('fingerprint', category.fingerprint)
        .maybeSingle()

      if (lookupError) {
        console.error('[FraudDetection] Flag lookup failed:', lookupError)
        continue
      }

      if (existing) {
        const { error: updateError } = await supabase
          .from('fraud_flags')
          .update({
            risk_score: category.riskScore,
            level: category.level,
            signals: category.signals,
            detection_count: Number(existing.detection_count ?? 1) + 1,
            last_detected_at: nowIso,
            updated_at: nowIso
          })
          .eq('id', existing.id)
        if (updateError) {
          console.error('[FraudDetection] Flag refresh failed:', updateError)
          continue
        }
        result.updated.push(category)
        continue
      }

      const { error: insertError } = await supabase.from('fraud_flags').insert({
        user_id: userId,
        category: category.category,
        risk_score: category.riskScore,
        level: category.level,
        signals: category.signals,
        fingerprint: category.fingerprint,
        status: 'open',
        detection_count: 1,
        first_detected_at: nowIso,
        last_detected_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso
      })

      if (insertError) {
        // 23505: a concurrent sweep opened the same flag between our lookup
        // and insert. Treat as an update so the detection still lands.
        if (insertError.code === '23505') {
          result.updated.push(category)
          continue
        }
        console.error('[FraudDetection] Flag insert failed:', insertError)
        continue
      }
      result.opened.push(category)
    } catch (error) {
      console.error('[FraudDetection] Flag persistence error:', error)
    }
  }

  return result
}

/**
 * Alert every staff account once per newly-opened flag. Deduped by the flag's
 * fingerprint, so a recurring pattern (which only refreshes the row) never
 * re-pings staff, mirroring the leaderboard-integrity alert discipline.
 */
export async function alertStaffOfFraudFlags(
  supabase: SupabaseClient,
  userId: number,
  opened: FraudCategoryAssessment[],
  now: Date = new Date()
): Promise<void> {
  if (opened.length === 0) return

  try {
    const { data: staff, error } = await supabase
      .from('users')
      .select('id')
      .not('staff_role', 'is', null)

    if (error) {
      console.error('[FraudDetection] Staff lookup failed:', error)
      return
    }
    if (!staff || staff.length === 0) return

    for (const category of opened) {
      const codes = category.signals.map((signal) => signal.code).join(', ')
      const body =
        `User #${userId} tripped ${category.category} abuse signals ` +
        `(${category.level.toUpperCase()}, risk ${category.riskScore}): ${codes}`
      for (const member of staff) {
        await insertMissingNotifications(supabase, Number(member.id), [
          {
            type: 'system',
            title: 'FRAUD FLAG RAISED',
            body: body.slice(0, 1000),
            data: {
              kind: 'fraud_flag',
              userId,
              category: category.category,
              level: category.level,
              riskScore: category.riskScore,
              fingerprint: category.fingerprint,
              detectedAt: now.toISOString()
            },
            dedupeKey: category.fingerprint
          }
        ])
      }
    }
  } catch (error) {
    console.error('[FraudDetection] Staff alert failed:', error)
  }
}

export interface AssessUserResult {
  opened: FraudCategoryAssessment[]
  updated: FraudCategoryAssessment[]
}

/**
 * Fetch a user's recent history, assess it, persist any flags, and alert staff
 * on newly-opened ones. Never throws — returns empty on any failure.
 */
export async function assessAndPersistUser(
  supabase: SupabaseClient,
  userId: number,
  now: Date = new Date()
): Promise<AssessUserResult> {
  try {
    const [activity, tokenDays] = await Promise.all([
      fetchRecentUserActivity(supabase, userId, now),
      fetchRecentUserTokenDays(supabase, userId, now)
    ])

    const assessment = assessUserFraud({ activity, tokenDays, now })
    if (assessment.categories.length === 0) {
      return { opened: [], updated: [] }
    }

    const persisted = await persistFraudAssessment(supabase, userId, assessment, now)
    await alertStaffOfFraudFlags(supabase, userId, persisted.opened, now)
    return persisted
  } catch (error) {
    console.error(`[FraudDetection] Assessment failed for user ${userId}:`, error)
    return { opened: [], updated: [] }
  }
}

/**
 * Candidate set for a sweep: everyone with a foothold on a competitive board.
 * The top of the score leaderboard (where activity abuse pays off) plus every
 * account that opted into the token/Burn Board. Deduped and capped.
 */
export async function collectSweepCandidates(
  supabase: SupabaseClient,
  limit: number = SWEEP_MAX_USERS
): Promise<number[]> {
  const ids = new Set<number>()

  const { data: topScores, error: scoreError } = await supabase
    .from('user_scores')
    .select('user_id')
    .order('total_score', { ascending: false })
    .limit(limit)
  if (scoreError) {
    console.error('[FraudDetection] Candidate score query failed:', scoreError)
  } else {
    for (const row of topScores ?? []) {
      const id = Number(row.user_id)
      if (Number.isInteger(id) && id > 0) ids.add(id)
    }
  }

  const { data: sharers, error: sharingError } = await supabase
    .from('agent_usage_sharing')
    .select('user_id')
    .eq('leaderboard_enabled', true)
    .limit(limit)
  if (sharingError) {
    console.error('[FraudDetection] Candidate sharing query failed:', sharingError)
  } else {
    for (const row of sharers ?? []) {
      const id = Number(row.user_id)
      if (Number.isInteger(id) && id > 0) ids.add(id)
    }
  }

  return [...ids].slice(0, limit)
}

export interface FraudSweepSummary {
  scanned: number
  usersFlagged: number
  flagsOpened: number
  flagsRefreshed: number
}

/**
 * Assess every candidate user and persist/alert on anything suspicious.
 * Designed to piggyback the leaderboard-integrity cron. Never throws; a single
 * user's failure is isolated so the rest of the sweep still runs.
 */
export async function sweepFraudSignals(
  supabase: SupabaseClient,
  options: { now?: Date; limit?: number } = {}
): Promise<FraudSweepSummary> {
  const now = options.now ?? new Date()
  const summary: FraudSweepSummary = {
    scanned: 0,
    usersFlagged: 0,
    flagsOpened: 0,
    flagsRefreshed: 0
  }

  try {
    const candidates = await collectSweepCandidates(supabase, options.limit ?? SWEEP_MAX_USERS)
    for (const userId of candidates) {
      summary.scanned += 1
      const result = await assessAndPersistUser(supabase, userId, now)
      const touched = result.opened.length + result.updated.length
      if (touched > 0) summary.usersFlagged += 1
      summary.flagsOpened += result.opened.length
      summary.flagsRefreshed += result.updated.length
    }
  } catch (error) {
    console.error('[FraudDetection] Sweep failed:', error)
  }

  return summary
}
