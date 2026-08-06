import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllEventPages } from './eventsFetch'
import { getEventsIdentityColumn } from './eventsIdentity'
import {
  sessionizeEvents,
  type ScoreEventWithTimestamp,
  type ScoreSession
} from './scoring'
import { resolveToolTaxonomy } from './toolTaxonomy'

// Nightly aggregate-insights rollup (migrations 032/033).
//
// Sessionizes one UTC day of events_raw with the SAME logic the score
// policy uses (sessionizeEvents: same-domain rows, gaps <= 5 minutes) and
// writes two derived tables:
//
//   - usage_sessions: per-user session rows. Written for EVERY user,
//     including insights opt-outs — it is their own derived data, like
//     user_scores, service-role-locked and erased on account deletion.
//   - daily_tool_aggregates: true aggregates per (date, domain, country,
//     role) slice, vendor/category stamped from the tool taxonomy. Users
//     with metadata.insights_opt_out === true are excluded HERE, because
//     only aggregates can ever surface beyond the database.
//
// Idempotent per date: the day's rows are deleted and rewritten, so a
// rerun (or a backfill via ?date=) always converges to the same state.

export const ROLLUP_DAY_MS = 86_400_000

/** Postgres .in() lists ride the querystring — keep chunks well clear of URL limits. */
const COHORT_CHUNK_SIZE = 200
const INSERT_CHUNK_SIZE = 500

export interface UsageSessionRow {
  user_id: number
  domain: string
  started_at: string
  ended_at: string
  active_ms: number
  total_ms: number
  visits: number
  focus_ratio: number | null
}

export interface UserCohort {
  country: string
  role: string
  optedOut: boolean
}

export const UNKNOWN_COHORT: UserCohort = {
  country: 'unknown',
  role: 'unknown',
  optedOut: false
}

export interface DailyAggregateRow {
  date: string
  domain: string
  vendor: string
  category: string
  country: string
  role: string
  distinct_users: number
  total_active_ms: number
  total_visits: number
  session_count: number
  median_session_ms: number | null
  median_focus_ratio: number | null
}

export interface InsightsRollupResult {
  date: string
  usersProcessed: number
  sessionsWritten: number
  aggregateRowsWritten: number
  optedOutUsersExcluded: number
}

export function isValidRollupDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(ms)) return false
  // Round-trip guards calendar overflow ("2026-02-31" parses as March 3).
  return new Date(ms).toISOString().slice(0, 10) === value
}

/** The default rollup target: the last complete UTC day. */
export function previousUtcDate(nowMs: number = Date.now()): string {
  return new Date(nowMs - ROLLUP_DAY_MS).toISOString().slice(0, 10)
}

export function median(values: number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value))
  if (usable.length === 0) return null
  const sorted = [...usable].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

// Sessions built from rows with unparseable timestamps carry NaN bounds;
// they cannot be dated, so neither table stores them.
function isPersistableSession(session: ScoreSession): boolean {
  return Number.isFinite(session.startMs) && Number.isFinite(session.endMs)
}

export function sessionFocusRatio(session: ScoreSession): number | null {
  if (session.wallMs <= 0) return null
  return Math.min(1, session.activeMs / session.wallMs)
}

export function sessionsToUsageRows(
  userId: number,
  sessions: ScoreSession[]
): UsageSessionRow[] {
  return sessions.filter(isPersistableSession).map((session) => ({
    user_id: userId,
    domain: session.domain,
    started_at: new Date(session.startMs).toISOString(),
    ended_at: new Date(session.endMs).toISOString(),
    active_ms: Math.round(session.activeMs),
    total_ms: Math.round(session.wallMs),
    visits: session.visits,
    focus_ratio: sessionFocusRatio(session)
  }))
}

export function resolveCohortRole(userType: unknown): string {
  if (typeof userType !== 'string') return 'unknown'
  const role = userType.trim().toLowerCase()
  return role.length > 0 ? role : 'unknown'
}

export function resolveCohortOptOut(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false
  }
  return (metadata as Record<string, unknown>).insights_opt_out === true
}

export interface CohortDeviceRow {
  country_code: string | null
  last_sync_at: string | null
}

/** Cohort country = the user's most recently synced device with a valid code. */
export function resolveCohortCountry(devices: CohortDeviceRow[]): string {
  let best: { country: string; syncMs: number } | null = null
  for (const device of devices) {
    const raw = (device.country_code || '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(raw)) continue
    const syncMs = Date.parse(String(device.last_sync_at || ''))
    const rank = Number.isFinite(syncMs) ? syncMs : 0
    if (!best || rank > best.syncMs) {
      best = { country: raw, syncMs: rank }
    }
  }
  return best ? best.country : 'unknown'
}

interface SliceAccumulator {
  domain: string
  country: string
  role: string
  users: Set<number>
  activeMs: number
  visits: number
  sessionCount: number
  sessionActiveMs: number[]
  focusRatios: number[]
}

export function computeDailyAggregates(
  date: string,
  sessionsByUser: Map<number, ScoreSession[]>,
  cohorts: Map<number, UserCohort>
): DailyAggregateRow[] {
  const slices = new Map<string, SliceAccumulator>()

  for (const [userId, sessions] of sessionsByUser) {
    const cohort = cohorts.get(userId) ?? UNKNOWN_COHORT
    if (cohort.optedOut) continue

    for (const session of sessions) {
      if (!isPersistableSession(session)) continue
      const key = `${session.domain}|${cohort.country}|${cohort.role}`
      let slice = slices.get(key)
      if (!slice) {
        slice = {
          domain: session.domain,
          country: cohort.country,
          role: cohort.role,
          users: new Set<number>(),
          activeMs: 0,
          visits: 0,
          sessionCount: 0,
          sessionActiveMs: [],
          focusRatios: []
        }
        slices.set(key, slice)
      }
      slice.users.add(userId)
      slice.activeMs += Math.round(session.activeMs)
      slice.visits += session.visits
      slice.sessionCount += 1
      slice.sessionActiveMs.push(Math.round(session.activeMs))
      const focus = sessionFocusRatio(session)
      if (focus !== null) slice.focusRatios.push(focus)
    }
  }

  const rows = Array.from(slices.values()).map((slice) => {
    const taxonomy = resolveToolTaxonomy(slice.domain)
    const medianSession = median(slice.sessionActiveMs)
    return {
      date,
      domain: slice.domain,
      vendor: taxonomy.vendor,
      category: taxonomy.category,
      country: slice.country,
      role: slice.role,
      distinct_users: slice.users.size,
      total_active_ms: slice.activeMs,
      total_visits: slice.visits,
      session_count: slice.sessionCount,
      median_session_ms: medianSession === null ? null : Math.round(medianSession),
      median_focus_ratio: median(slice.focusRatios)
    }
  })

  // Deterministic order keeps reruns byte-identical and tests stable.
  rows.sort(
    (a, b) =>
      a.domain.localeCompare(b.domain) ||
      a.country.localeCompare(b.country) ||
      a.role.localeCompare(b.role)
  )
  return rows
}

type RawEventRow = Record<string, unknown>

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function loadUserCohorts(
  supabase: SupabaseClient,
  userIds: number[]
): Promise<Map<number, UserCohort>> {
  const cohorts = new Map<number, UserCohort>()
  const devicesByUser = new Map<number, CohortDeviceRow[]>()

  for (const ids of chunk(userIds, COHORT_CHUNK_SIZE)) {
    const [usersResult, devicesResult] = await Promise.all([
      supabase.from('users').select('id, user_type, metadata').in('id', ids),
      supabase
        .from('user_devices')
        .select('user_id, country_code, last_sync_at')
        .in('user_id', ids)
    ])
    if (usersResult.error) {
      throw new Error(`users cohort read failed: ${usersResult.error.message}`)
    }
    if (devicesResult.error) {
      throw new Error(`user_devices cohort read failed: ${devicesResult.error.message}`)
    }

    for (const device of devicesResult.data ?? []) {
      const uid = Number(device.user_id)
      if (!Number.isFinite(uid)) continue
      const list = devicesByUser.get(uid)
      const row: CohortDeviceRow = {
        country_code: device.country_code ?? null,
        last_sync_at: device.last_sync_at ?? null
      }
      if (list) list.push(row)
      else devicesByUser.set(uid, [row])
    }

    for (const user of usersResult.data ?? []) {
      const uid = Number(user.id)
      if (!Number.isFinite(uid)) continue
      cohorts.set(uid, {
        country: 'unknown',
        role: resolveCohortRole(user.user_type),
        optedOut: resolveCohortOptOut(user.metadata)
      })
    }
  }

  for (const [uid, cohort] of cohorts) {
    cohorts.set(uid, {
      ...cohort,
      country: resolveCohortCountry(devicesByUser.get(uid) ?? [])
    })
  }
  return cohorts
}

export async function runInsightsRollup(
  supabase: SupabaseClient,
  dateUtc: string
): Promise<InsightsRollupResult> {
  if (!isValidRollupDate(dateUtc)) {
    throw new Error(`Invalid rollup date: ${dateUtc}`)
  }

  const startMs = Date.parse(`${dateUtc}T00:00:00.000Z`)
  const startIso = new Date(startMs).toISOString()
  const endIso = new Date(startMs + ROLLUP_DAY_MS).toISOString()

  // Same schema-compat resolution the score paths use; the fallback keeps
  // repo-migration databases (integer user_id, no probe hit) working.
  const identityColumn = (await getEventsIdentityColumn(supabase)) ?? 'user_id'

  const events = await fetchAllEventPages<RawEventRow>((from, to) =>
    supabase
      .from('events_raw')
      .select(`${identityColumn}, domain, timestamp, active_ms, total_ms, visits`)
      .gte('timestamp', startIso)
      .lt('timestamp', endIso)
      .order('timestamp', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as PromiseLike<{
        data: RawEventRow[] | null
        error: { message: string } | null
      }>
  )
  if (events.error) {
    throw new Error(`events_raw read failed: ${events.error}`)
  }
  if (events.truncated) {
    console.warn(
      `[InsightsRollup] events_raw read for ${dateUtc} truncated at the page cap — aggregates will understate the day`
    )
  }

  const eventsByUser = new Map<number, ScoreEventWithTimestamp[]>()
  for (const row of events.rows) {
    const userId = Number(row[identityColumn])
    if (!Number.isFinite(userId) || userId <= 0) continue
    const event: ScoreEventWithTimestamp = {
      domain: String(row.domain || '').toLowerCase(),
      timestamp: String(row.timestamp || ''),
      active_ms: Number(row.active_ms || 0),
      total_ms: Number(row.total_ms || 0),
      visits: Number(row.visits || 0)
    }
    const list = eventsByUser.get(userId)
    if (list) list.push(event)
    else eventsByUser.set(userId, [event])
  }

  const sessionsByUser = new Map<number, ScoreSession[]>()
  for (const [userId, userEvents] of eventsByUser) {
    const sessions = sessionizeEvents(userEvents).filter(isPersistableSession)
    if (sessions.length > 0) sessionsByUser.set(userId, sessions)
  }

  const userIds = Array.from(sessionsByUser.keys())
  const cohorts = await loadUserCohorts(supabase, userIds)

  const sessionRows: UsageSessionRow[] = []
  for (const [userId, sessions] of sessionsByUser) {
    sessionRows.push(...sessionsToUsageRows(userId, sessions))
  }
  const aggregateRows = computeDailyAggregates(dateUtc, sessionsByUser, cohorts)

  // Delete-then-insert keeps the day idempotent. A failure between the two
  // steps leaves a partial day, but the job is safe to rerun and converges.
  const { error: deleteSessionsError } = await supabase
    .from('usage_sessions')
    .delete()
    .gte('started_at', startIso)
    .lt('started_at', endIso)
  if (deleteSessionsError) {
    throw new Error(`usage_sessions delete failed: ${deleteSessionsError.message}`)
  }

  const { error: deleteAggregatesError } = await supabase
    .from('daily_tool_aggregates')
    .delete()
    .eq('date', dateUtc)
  if (deleteAggregatesError) {
    throw new Error(`daily_tool_aggregates delete failed: ${deleteAggregatesError.message}`)
  }

  for (const rows of chunk(sessionRows, INSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('usage_sessions').insert(rows)
    if (error) {
      throw new Error(`usage_sessions insert failed: ${error.message}`)
    }
  }

  for (const rows of chunk(aggregateRows, INSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('daily_tool_aggregates').insert(rows)
    if (error) {
      throw new Error(`daily_tool_aggregates insert failed: ${error.message}`)
    }
  }

  let optedOutUsersExcluded = 0
  for (const userId of userIds) {
    if (cohorts.get(userId)?.optedOut) optedOutUsersExcluded += 1
  }

  return {
    date: dateUtc,
    usersProcessed: userIds.length,
    sessionsWritten: sessionRows.length,
    aggregateRowsWritten: aggregateRows.length,
    optedOutUsersExcluded
  }
}
