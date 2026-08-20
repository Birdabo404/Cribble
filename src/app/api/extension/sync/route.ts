import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { z } from 'zod'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { resolveTrackedAiDomain } from '@/lib/aiDomains'
import { evaluateAchievements } from '@/lib/achievementsServer'
import { refreshLeaderboardSnapshot } from '@/lib/leaderboardSnapshot'
import { evaluateScoreNotifications } from '@/lib/notifications'
import { maybeGrantReferralReward } from '@/lib/referrals'
import { recalculateUserScore } from '@/lib/scoring'
import { applyEventsUserEq, buildEventsUserInsertFields } from '@/lib/eventsIdentity'
import {
  DEVICE_TOKEN_HEADER,
  generateDeviceSyncToken,
  hashDeviceSyncToken,
  verifyDeviceSyncToken
} from '@/lib/deviceToken'

const supabase = createServiceClient()

interface DeviceInfo {
  userAgent: string
  browserName: string
  browserVersion: string
  os: string
  deviceName: string
}

interface ExtensionEvent {
  type: string
  domain: string
  timestamp: number
  duration?: number
  score?: number
  metadata?: Record<string, unknown>
}

const extensionEventSchema = z.object({
  // Strict enum: the 30-min per-event bound and the 24h anti-inflation
  // ceilings key on the type, while inserts store active_ms for any
  // non-visit type — an unknown type ("foo") would bank uncapped active
  // time. The extension only ever emits these two.
  type: z.enum(['visit', 'active_time']),
  domain: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative().optional(),
  score: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional()
})

const syncRequestSchema = z.object({
  deviceUuid: z.string().uuid(),
  userId: z.number().int().positive().optional(),
  events: z.array(extensionEventSchema).max(200),
  batchId: z.string().min(1),
  // IANA zone name sent by the dashboard handshake ("Europe/Berlin"),
  // stored on user_devices as a coarse cohort dimension for aggregate
  // insights. Length-capped and charset-checked so junk can't land in
  // the column; anything malformed just fails validation of the field.
  timezone: z.string().min(1).max(64).regex(/^[A-Za-z0-9_+/-]+$/).optional()
})

// Helper function to parse user agent
function parseUserAgent(userAgent: string): DeviceInfo {
  const browserRegex = /(Chrome|Firefox|Safari|Edge)\/(\d+\.\d+)/i
  const osRegex = /(Windows|Mac|Linux|Android|iOS)/i

  const browserMatch = userAgent.match(browserRegex)
  const osMatch = userAgent.match(osRegex)

  const browserName = browserMatch ? browserMatch[1] : 'Unknown'
  const browserVersion = browserMatch ? browserMatch[2] : '0.0'
  const os = osMatch ? osMatch[1] : 'Unknown'

  return {
    userAgent,
    browserName,
    browserVersion,
    os,
    deviceName: `${browserName} ${browserVersion} on ${os}`
  }
}

// Register or update device atomically via the register_user_device RPC.
// The RPC (migrations 002/007/027) deactivates the user's other devices and,
// since migration 027, treats a session-authorized registration by a
// DIFFERENT user as an atomic transfer: it rebinds the row, revokes the
// previous owner's sync token (hash cleared in the same statement), and
// clears the previous owner's active_device_uuid pointer.
// There is deliberately NO manual fallback: replaying the registration with
// raw table writes on RPC failure would bypass the DB-level transfer
// semantics and could corrupt the binding on any transient error. If the
// RPC fails, registration fails closed.
type RegisterDeviceResult =
  | { ok: true }
  // The deployed RPC is still the pre-027 version, which raises
  // check_violation (23514) instead of transferring. Surfaced as a 409 so
  // the client sees a clear, retryable-after-migration signal instead of a
  // generic 500.
  | { ok: false; reason: 'transfer_blocked' }
  | { ok: false; reason: 'rpc_failed' }

function isLegacyNoStealViolation(error: { code?: string; message?: string }): boolean {
  if (error.code === '23514') return true
  return (error.message || '').includes('already linked to another active account')
}

async function registerDevice(
  userId: number,
  deviceUuid: string,
  deviceInfo: DeviceInfo
): Promise<RegisterDeviceResult> {
  console.log(`[Extension Sync] Registering device ${deviceUuid.slice(0, 8)}... for user ${userId}`)

  const { error } = await supabase.rpc('register_user_device', {
    p_user_id: userId,
    p_device_uuid: deviceUuid,
    p_device_name: deviceInfo.deviceName,
    p_browser_info: deviceInfo,
    p_last_sync_at: new Date().toISOString()
  })

  if (error) {
    if (isLegacyNoStealViolation(error)) {
      console.warn(
        `[Extension Sync] Device transfer blocked by pre-027 RPC for ${deviceUuid.slice(0, 8)}...` +
        ' — apply migrations/027_device_relink_transfer.sql to enable account switching.'
      )
      return { ok: false, reason: 'transfer_blocked' }
    }
    console.error(`[Extension Sync] Device registration RPC failed:`, error)
    return { ok: false, reason: 'rpc_failed' }
  }

  return { ok: true }
}

// Validate device is active for user
async function validateDevice(userId: number, deviceUuid: string) {
  const { data: device } = await supabase
    .from('user_devices')
    .select('id')
    .eq('user_id', userId)
    .eq('device_uuid', deviceUuid)
    .eq('is_active', true)
    .single()

  return !!device
}

// Server-side ceilings on how much a single user can bank per rolling 24h
// window. Bounds score inflation from a modified client even though
// individual durations are client-reported. Visits must be capped too:
// they score a flat 40 points each and a zero-duration visit consumes no
// active time, so without a visit ceiling the active-time cap could be
// bypassed entirely by spamming visit events at unique timestamps.
const MAX_CUMULATIVE_ACTIVE_MS_PER_24H = 16 * 60 * 60 * 1000
const MAX_CUMULATIVE_VISITS_PER_24H = 600

async function getUsageLast24h(userId: number): Promise<{ activeMs: number; visits: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const query = supabase
    .from('events_raw')
    .select('active_ms, visits')
    .gte('timestamp', since)
  const { query: scopedQuery, column } = await applyEventsUserEq(supabase, query, userId)
  if (!column) return { activeMs: 0, visits: 0 }

  const { data, error } = await scopedQuery
  if (error) {
    console.error('[Extension Sync] 24h cumulative query failed:', error)
    // Fail closed: pretend the caps are reached so a DB error can't be used
    // to bypass the ceilings.
    return {
      activeMs: MAX_CUMULATIVE_ACTIVE_MS_PER_24H,
      visits: MAX_CUMULATIVE_VISITS_PER_24H
    }
  }
  return (data || []).reduce(
    (acc, row) => ({
      activeMs: acc.activeMs + (row.active_ms || 0),
      visits: acc.visits + (row.visits || 0)
    }),
    { activeMs: 0, visits: 0 }
  )
}

// Same-domain active-time ticks within this window merge into one row at
// ingest. The extension emits a heartbeat every 5s, which at ~720 rows/hour
// bloats events_raw and every full-history recalculation; coalescing keeps
// the same totals (durations sum) while cutting row growth ~12x. The window
// is kept small so session boundaries stay accurate at read time.
const HEARTBEAT_COALESCE_WINDOW_MS = 60 * 1000

// Merge consecutive same-domain active_time events (already sorted oldest
// first) whose span fits inside the coalesce window. Visit events are never
// merged. Merged rows keep the FIRST tick's timestamp, so a retried batch
// re-merges identically and lands on the same dedupe key.
function coalesceActiveTimeEvents(events: ExtensionEvent[], maxEventMs: number): ExtensionEvent[] {
  const result: ExtensionEvent[] = []
  const openGroupByDomain = new Map<string, ExtensionEvent>()

  for (const event of events) {
    if (event.type !== 'active_time') {
      result.push(event)
      continue
    }

    const domain = event.domain
    const open = openGroupByDomain.get(domain)
    const duration = Math.min(event.duration || 0, maxEventMs)

    if (open && event.timestamp - open.timestamp <= HEARTBEAT_COALESCE_WINDOW_MS) {
      const mergedDuration = Math.min((open.duration || 0) + duration, maxEventMs)
      // total span covered by the merged row: first tick start -> last tick end
      const spanMs = Math.max(
        event.timestamp - open.timestamp + duration,
        mergedDuration
      )
      open.duration = mergedDuration
      open.metadata = { ...(open.metadata || {}), coalescedSpanMs: spanMs }
      continue
    }

    const group: ExtensionEvent = { ...event, duration }
    openGroupByDomain.set(domain, group)
    result.push(group)
  }

  return result
}

// Result of ingesting one batch. `insertFailed` is set ONLY when the final
// events_raw upsert itself errored — i.e. rows that should have persisted
// did not. Benign zero-processed outcomes (everything filtered as invalid,
// duplicate, or already stored) are still successes: the extension may
// safely delete those events from its queue.
interface ProcessEventsResult {
  processed: number
  errors: string[]
  insertFailed?: boolean
}

// Process extension events
async function processEvents(
  userId: number,
  deviceUuid: string,
  events: ExtensionEvent[]
): Promise<ProcessEventsResult> {
  if (!events || events.length === 0) return { processed: 0, errors: [] }

  // Validation constants
  const MAX_ACTIVE_TIME_MS = 30 * 60 * 1000 // 30 minutes max per event

  // Filter, validate, and canonicalize events
  const validEvents = events.flatMap<ExtensionEvent>(event => {
    const duration = event.duration || 0

    // Server-side allowlist: only accept events for known AI tool usage
    // surfaces. The reported hostname is normalized to its canonical
    // registry key ("www.kimi.com" → "kimi.com", "chat.z.ai" → "z.ai") so
    // stored rows group exactly under one domain per tool surface.
    const canonicalDomain = resolveTrackedAiDomain(event.domain)
    if (!canonicalDomain) {
      console.warn(`[Extension Sync] Rejecting event with untracked domain: ${event.domain}`)
      return []
    }

    // Only active-time events are duration-bounded: their duration earns
    // score. A visit's duration is informational wall-clock page time (it
    // earns nothing and is clamped at insert), so a long-lived tab must not
    // cost the user the visit itself.
    if (event.type === 'active_time' && duration > MAX_ACTIVE_TIME_MS) {
      console.warn(`[Extension Sync] Rejecting event with excessive duration: ${duration}ms on ${event.domain}`)
      return []
    }

    // Ensure reasonable timestamp
    const eventTime = new Date(event.timestamp).getTime()
    const now = Date.now()
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000)
    const oneHourFuture = now + (60 * 60 * 1000)

    if (eventTime < oneWeekAgo || eventTime > oneHourFuture) {
      console.warn(`[Extension Sync] Rejecting event with invalid timestamp: ${event.timestamp} on ${event.domain}`)
      return []
    }

    return [{ ...event, domain: canonicalDomain }]
  })

  if (validEvents.length !== events.length) {
    console.warn(`[Extension Sync] Filtered ${events.length - validEvents.length} invalid events out of ${events.length}`)
  }

  // Only verified active time counts toward the ms ceiling — visit rows
  // store active_ms = 0, so their wall-clock duration must not consume the
  // budget either. Visits are bounded by their own ceiling.
  const activeMsOf = (event: ExtensionEvent) =>
    event.type === 'active_time' ? Math.min(event.duration || 0, MAX_ACTIVE_TIME_MS) : 0

  // Enforce the rolling 24h active-time and visit ceilings. Events are
  // admitted oldest first until a ceiling is reached; the rest are dropped
  // (not queued), so a forged high-volume client cannot bank unbounded score.
  const batchActiveMs = validEvents.reduce((sum, event) => sum + activeMsOf(event), 0)
  const batchVisits = validEvents.reduce(
    (sum, event) => sum + (event.type === 'visit' ? 1 : 0),
    0
  )
  let cappedEvents = validEvents
  if (batchActiveMs > 0 || batchVisits > 0) {
    const used = await getUsageLast24h(userId)
    const activeCapHit = used.activeMs + batchActiveMs > MAX_CUMULATIVE_ACTIVE_MS_PER_24H
    const visitCapHit = used.visits + batchVisits > MAX_CUMULATIVE_VISITS_PER_24H
    if (activeCapHit || visitCapHit) {
      let remainingMs = Math.max(0, MAX_CUMULATIVE_ACTIVE_MS_PER_24H - used.activeMs)
      let remainingVisits = Math.max(0, MAX_CUMULATIVE_VISITS_PER_24H - used.visits)
      cappedEvents = [...validEvents]
        .sort((a, b) => a.timestamp - b.timestamp)
        .filter(event => {
          const eventMs = activeMsOf(event)
          const eventVisits = event.type === 'visit' ? 1 : 0
          if (eventMs > remainingMs || eventVisits > remainingVisits) return false
          remainingMs -= eventMs
          remainingVisits -= eventVisits
          return true
        })
      console.warn(
        `[Extension Sync] 24h cap hit for user ${userId}: ` +
        `usedMs=${used.activeMs}, batchMs=${batchActiveMs}, ` +
        `usedVisits=${used.visits}, batchVisits=${batchVisits}, ` +
        `kept ${cappedEvents.length}/${validEvents.length} events`
      )
    }
  }

  const orderedEvents = [...cappedEvents].sort((a, b) => a.timestamp - b.timestamp)
  const coalescedEvents = coalesceActiveTimeEvents(orderedEvents, MAX_ACTIVE_TIME_MS)

  // Resolve the identity column(s) this Supabase project expects. Some
  // deployments still key events_raw on the legacy twitter_user_id integer
  // column (with user_id as a UUID), so we must not hardcode user_id.
  const userInsertFields = await buildEventsUserInsertFields(supabase, userId)

  // Convert extension events to events_raw format. Visit rows carry NO
  // active_ms: their duration is unverified wall-clock page time (activity
  // is reported separately by heartbeat events), so storing it as active
  // time double-counted and rewarded idle tabs. total_ms keeps the wall
  // span for both kinds of rows.
  const processedEvents = coalescedEvents.map(event => {
    const isVisit = event.type === 'visit'
    const activeMs = isVisit ? 0 : Math.min(event.duration || 0, MAX_ACTIVE_TIME_MS)
    const coalescedSpanMs = Number(event.metadata?.coalescedSpanMs || 0)
    const totalMs = isVisit
      ? Math.min(event.duration || 0, MAX_ACTIVE_TIME_MS)
      : Math.max(activeMs, Math.min(coalescedSpanMs, MAX_ACTIVE_TIME_MS))
    return {
      ...userInsertFields,
      device_uuid: deviceUuid,
      timestamp: new Date(event.timestamp).toISOString(),
      domain: event.domain?.toLowerCase(),
      active_ms: activeMs,
      total_ms: totalMs,
      visits: isVisit ? 1 : 0,
      client_version: 'extension_v1'
    }
  })

  // Check for duplicates within the batch first (domain + timestamp)
  const uniqueEvents = []
  const seenKeys = new Set()

  for (const event of processedEvents) {
    const key = `${event.domain}-${event.timestamp}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      uniqueEvents.push(event)
    }
  }

  if (uniqueEvents.length === 0) {
    return { processed: 0, errors: ['All events were filtered out as invalid or duplicates'] }
  }

  // Check for existing events already stored for this user, scoped through the
  // schema-compat identity column, then dedup by (domain, timestamp).
  // Timestamps are compared as epoch ms: PostgREST returns "+00:00"-suffixed
  // strings while ours end in "Z", so raw string keys would never match.
  const dedupeKey = (domain: string | undefined, timestamp: string) =>
    `${domain}-${Date.parse(timestamp)}`
  const batchTimestamps = uniqueEvents.map(e => e.timestamp)
  const existingQuery = supabase
    .from('events_raw')
    .select('domain, timestamp')
    .in('timestamp', batchTimestamps)
  const { query: scopedExistingQuery } = await applyEventsUserEq(
    supabase,
    existingQuery,
    userId
  )
  const { data: existingEvents } = await scopedExistingQuery

  const existingEventKeys = new Set(
    (existingEvents || []).map(event => dedupeKey(event.domain, event.timestamp))
  )

  const finalEvents = uniqueEvents.filter(event => {
    return !existingEventKeys.has(dedupeKey(event.domain, event.timestamp))
  })

  if (finalEvents.length === 0) {
    return { processed: 0, errors: ['All events already exist in database'] }
  }

  // Insert idempotently: a plain bulk INSERT aborts on the first duplicate
  // (23505), silently dropping the genuinely-new rows in a retried batch.
  // ignoreDuplicates makes true duplicates a no-op while new rows persist.
  const { data, error } = await supabase
    .from('events_raw')
    .upsert(finalEvents, {
      onConflict: 'user_id,domain,timestamp',
      ignoreDuplicates: true
    })
    .select()

  if (error) {
    console.error(`[Extension Sync] Failed to insert events:`, error)
    // Hard failure: these events were NOT stored. The route must not answer
    // success:true, or the extension would delete the batch from its queue
    // and the data would be lost silently.
    return { processed: 0, errors: [error.message], insertFailed: true }
  }

  console.log(`[Extension Sync] Successfully inserted ${data.length} events (from ${events.length} submitted)`)
  return { processed: data.length, errors: [] }
}

// NOTE: the old GET stats endpoint was removed. It authenticated with
// spoofable X-Extension-User-ID / X-Extension-Device-UUID headers, used a
// stale score formula, and had no callers in the extension or dashboard.

// POST - Sync extension data
//
// Two paths:
// 1. Ingestion: the device UUID is registered, active, and the request
//    carries the device's secret sync token (issued at registration, stored
//    only as a hash). Events are attributed to the user the device is bound
//    to in the database — the client-supplied userId is never trusted.
// 2. Registration / re-binding / token (re-)issue: anything without a valid
//    token. This requires a valid dashboard session cookie; the device is
//    always bound to the SESSION user and receives a freshly rotated sync
//    token in the response, so nobody can attach devices (or events) to
//    another person's account, and possession of a device UUID alone is not
//    enough to submit events.
//
//    Re-registration by the CURRENT owner is an idempotent success (binding
//    unchanged, token rotated). Registration by a DIFFERENT signed-in user
//    is an account switch: the RPC transfers the binding atomically and
//    revokes the previous account's sync token, so the old extension state
//    starts receiving 401 REGISTRATION_REQUIRED and knows to re-link.
export async function POST(request: NextRequest) {
  try {
    // Rate limiting - allow higher limits for data ingestion
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.ingestion)
    if (!rateLimitResult.success) {
      const headers = createRateLimitResponse(rateLimitResult)
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429, headers }
      )
    }

    // Basic runtime validation
    const parsed = syncRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
    }
    const { deviceUuid, userId: claimedUserId, events, timezone } = parsed.data
    const batchId = parsed.data.batchId

    // Look up the current device binding. maybeSingle() only reports an
    // error for real query failures (no-row is data:null, error:null), so
    // any error here is transient infrastructure trouble — NOT an unknown
    // device. Falling through would route the request into the registration
    // path and answer 401 REGISTRATION_REQUIRED, making the extension
    // discard a perfectly valid sync token. 503 keeps it retrying instead.
    const { data: device, error: deviceLookupError } = await supabase
      .from('user_devices')
      .select('user_id, is_active, sync_token_hash')
      .eq('device_uuid', deviceUuid)
      .maybeSingle()

    if (deviceLookupError) {
      console.error('[Extension Sync] Device lookup failed:', deviceLookupError)
      return NextResponse.json({
        success: false,
        error: 'Temporary server error, please retry.',
        code: 'DEVICE_LOOKUP_FAILED'
      }, { status: 503 })
    }

    const deviceMatchesClaim =
      !!device && (!claimedUserId || Number(device.user_id) === claimedUserId)

    const presentedToken = request.headers.get(DEVICE_TOKEN_HEADER)
    const tokenValid =
      !!device && verifyDeviceSyncToken(presentedToken, device.sync_token_hash)

    let finalUserId: number
    let issuedSyncToken: string | null = null

    if (device && device.is_active && deviceMatchesClaim && tokenValid) {
      // Path 1: ingestion — device UUID + valid secret token.
      finalUserId = Number(device.user_id)
    } else {
      // Path 2: registration / re-activation / token issue — session required.
      const session = await getSessionUserId(request)
      if (!session.ok) {
        return NextResponse.json({
          success: false,
          error: 'Device not registered. Sign in on the dashboard to link this device.',
          code: 'REGISTRATION_REQUIRED'
        }, { status: 401 })
      }

      // The session decides ownership; a mismatched claim is rejected outright.
      if (claimedUserId && claimedUserId !== session.userId) {
        return NextResponse.json({
          success: false,
          error: 'User mismatch: you can only link devices to your own account.',
          code: 'USER_MISMATCH'
        }, { status: 403 })
      }

      // Account switch on the same browser (device bound to a different
      // user): this is a first-class RELINK. The register_user_device RPC
      // transfers the binding atomically and revokes the previous account's
      // sync token, so the old account stops ingesting the moment ownership
      // changes. Relinking to the same account is an idempotent success.
      if (device && Number(device.user_id) !== session.userId) {
        console.log(
          `[Extension Sync] Relinking device ${deviceUuid.slice(0, 8)}... ` +
          `from user ${device.user_id} to user ${session.userId}`
        )
      }

      finalUserId = session.userId

      const userAgent = request.headers.get('user-agent') || ''
      const registration = await registerDevice(finalUserId, deviceUuid, parseUserAgent(userAgent))
      if (!registration.ok) {
        switch (registration.reason) {
          case 'transfer_blocked':
            // Deployed database still runs the pre-027 RPC, which refuses
            // cross-account rebinds. Distinguishable so the client can show
            // a real message instead of a generic failure.
            return NextResponse.json({
              success: false,
              error: 'This device is still linked to another account. Relink is temporarily unavailable.',
              code: 'DEVICE_TRANSFER_BLOCKED'
            }, { status: 409 })
          case 'rpc_failed':
            console.error(`[Extension Sync] Device registration failed for ${deviceUuid.slice(0, 8)}...`)
            return NextResponse.json({
              success: false,
              error: 'Device registration failed',
              code: 'REGISTRATION_FAILED'
            }, { status: 500 })
          default: {
            const exhaustive: never = registration
            throw new Error(`Unhandled registration failure: ${JSON.stringify(exhaustive)}`)
          }
        }
      }

      // Rotate the device's sync token on every (re-)registration. The
      // plaintext token is returned exactly once, in this response; only its
      // hash is persisted.
      issuedSyncToken = generateDeviceSyncToken()
      const { error: tokenError } = await supabase
        .from('user_devices')
        .update({ sync_token_hash: hashDeviceSyncToken(issuedSyncToken) })
        .eq('device_uuid', deviceUuid)

      if (tokenError) {
        console.error('[Extension Sync] Failed to store sync token hash:', tokenError)
        return NextResponse.json({
          success: false,
          error: 'Device registration failed',
          code: 'REGISTRATION_FAILED'
        }, { status: 500 })
      }

      // Cohort dimension from the dashboard handshake. Best effort: a
      // registration must not fail over an insights column (e.g. before
      // migration 032 is applied).
      if (timezone) {
        const { error: timezoneError } = await supabase
          .from('user_devices')
          .update({ timezone })
          .eq('device_uuid', deviceUuid)
        if (timezoneError) {
          console.warn('[Extension Sync] Failed to store device timezone:', timezoneError.message)
        }
      }
    }

    // Final gate: device must be active and bound to the resolved user
    const isValidDevice = await validateDevice(finalUserId, deviceUuid)
    if (!isValidDevice) {
      return NextResponse.json({
        success: false,
        error: 'Device not active for this user',
        code: 'DEVICE_INACTIVE'
      }, { status: 403 })
    }

    // Process events
    const result = await processEvents(finalUserId, deviceUuid, events)

    // The upsert itself failed — nothing was stored. Answering success:true
    // here would make the extension delete the batch it just queued (it
    // treats HTTP 200 success:true as "safe to drop"), silently losing the
    // events. A 500 makes it keep the batch and retry with backoff.
    if (result.insertFailed) {
      return NextResponse.json({
        success: false,
        error: 'Failed to store events',
        code: 'EVENT_INSERT_FAILED'
      }, { status: 500 })
    }

    // Update device last sync time. The country cohort dimension rides the
    // same statement, refreshed on every sync: only the two-letter
    // x-vercel-ip-country edge header is persisted — the IP is never stored.
    const countryHeader = request.headers.get('x-vercel-ip-country')?.trim() ?? ''
    const countryCode = /^[A-Z]{2}$/i.test(countryHeader)
      ? countryHeader.toUpperCase()
      : null
    await supabase
      .from('user_devices')
      .update({
        last_sync_at: new Date().toISOString(),
        ...(countryCode ? { country_code: countryCode } : {})
      })
      .eq('device_uuid', deviceUuid)

    // Recalculate scores with the same policy the dashboard uses, so the
    // leaderboard (user_scores) and dashboard (/api/user/me) stay consistent.
    let serverScore: { totalScore: number; todayScore: number } | null = null
    // True only when this sync ingested rows AND the recalculation landed —
    // the deferred work below uses it to gate everything that reads this
    // user's fresh totals.
    let scoresRecalculated = false
    if (result.processed > 0) {
      const { scoresStale } = await recalculateUserScore(supabase, finalUserId)
      if (scoresStale) {
        console.error(`[Extension Sync] Score recalculation failed for user ${finalUserId}`)
      } else {
        scoresRecalculated = true
        // Read the totals recalculateUserScore just upserted so the
        // response carries the same numbers the dashboard shows (it only
        // returns a staleness flag, not the totals). The extension snaps
        // its optimistic local preview to these authoritative totals. Best
        // effort: on read error or missing row the field is simply omitted
        // and the extension keeps its preview. None of the deferred work
        // below writes THIS user's user_scores row (the referral reward
        // credits the referrer), so reading before it runs returns the
        // same values the old post-work read did.
        const { data: scoreRow, error: scoreReadError } = await supabase
          .from('user_scores')
          .select('total_score, today_score')
          .eq('user_id', finalUserId)
          .maybeSingle()
        if (!scoreReadError && scoreRow) {
          serverScore = {
            totalScore: Math.round(Number(scoreRow.total_score ?? 0)),
            todayScore: Math.round(Number(scoreRow.today_score ?? 0))
          }
        }
      }
    }

    // Rank buckets, score milestones, achievement unlocks, the referral
    // reward, and the top-100 rank snapshot are all deduped server-side,
    // safe to run on every sync — and none of them feeds this response,
    // which the dashboard's sync handshake blocks on. after() defers them
    // past the response. Score notifications and achievements read THIS
    // user's totals, so they stay gated on a fresh recalculation. The
    // referral grant deliberately is not: the reward credits the REFERRER,
    // and gating it on processed > 0 is exactly what let a missed first
    // grant stay missed forever — a duplicate batch reports processed === 0
    // ("all events already exist"), so the retry must ride those heartbeats
    // too. The helper is told whether this sync ingested anything so a bare
    // handshake still can't activate a recruit with no stored events. The
    // original order is preserved (the snapshot re-diffs everyone's rank,
    // so it must see the referral grant's effect on the referrer's score);
    // each step is isolated so one failure can't starve the rest.
    after(async () => {
      if (scoresRecalculated) {
        try {
          await evaluateScoreNotifications(supabase, finalUserId)
        } catch (error) {
          console.error(`[Extension Sync] Deferred score notifications failed for user ${finalUserId}:`, error)
        }
        try {
          await evaluateAchievements(supabase, finalUserId)
        } catch (error) {
          console.error(`[Extension Sync] Deferred achievements evaluation failed for user ${finalUserId}:`, error)
        }
      }
      let awardedPoints: number | null = null
      try {
        awardedPoints = await maybeGrantReferralReward(supabase, finalUserId, {
          ingestedNewEvents: result.processed > 0
        })
      } catch (error) {
        console.error(`[Extension Sync] Deferred referral reward failed for user ${finalUserId}:`, error)
      }
      // Snapshot when standings could have moved: this user's totals were
      // just recalculated, or the grant just credited the referrer.
      if (scoresRecalculated || (awardedPoints ?? 0) > 0) {
        try {
          // Rank snapshots + demotion notifications moved off the
          // leaderboard GET (which is now read-only): a fresh score can
          // shift everyone's rank, so the whole top-100 standing is
          // re-diffed here on the write path.
          await refreshLeaderboardSnapshot(supabase)
        } catch (error) {
          console.error('[Extension Sync] Deferred leaderboard snapshot failed:', error)
        }
      }
    })

    // Update user's last sync time
    await supabase
      .from('users')
      .update({ last_extension_sync: new Date().toISOString() })
      .eq('id', finalUserId)

    return NextResponse.json({
      success: true,
      processed: result.processed,
      errors: result.errors,
      batchId,
      ...(issuedSyncToken ? { syncToken: issuedSyncToken } : {}),
      ...(serverScore ? { serverScore } : {})
    })

  } catch (error) {
    console.error('[Extension Sync] POST error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}

// DELETE - Unregister device (session-authenticated, owner only)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ success: false, error: session.error }, { status: session.status })
    }

    const deviceUuid = request.headers.get('X-Extension-Device-UUID')

    if (!deviceUuid) {
      return NextResponse.json({
        success: false,
        error: 'Missing device UUID'
      }, { status: 400 })
    }

    // Only the owner can deactivate their device
    const { data: device } = await supabase
      .from('user_devices')
      .select('user_id')
      .eq('device_uuid', deviceUuid)
      .maybeSingle()

    if (!device) {
      return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 })
    }
    if (Number(device.user_id) !== session.userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('user_devices')
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString()
      })
      .eq('device_uuid', deviceUuid)

    if (error) throw error

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[Extension Sync] DELETE error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}
