import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { hashAgentApiKey } from '@/lib/agentKey'
import { refreshBurnBoardSnapshot } from '@/lib/burnBoardSnapshot'
import {
  buildBurnClubHypeEvent,
  burnClubCrossings,
  recordHypeEvents
} from '@/lib/hypeEvents'
import {
  checkDistributedRateLimit,
  checkRateLimit,
  createRateLimitResponse,
  type RateLimitConfig
} from '@/lib/rateLimit'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  calendarDateInTimeZone,
  calendarDaysBetween,
  normalizeIanaTimeZone
} from '@/lib/timeZone'
import { exactDecimal } from '@/lib/tokenLeaderboard'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_BACKFILL_DAYS = 365
const MAX_TOKENS_PER_RECORD = 1_000_000_000_000
const MAX_COST_USD_PER_RECORD = 1_000_000

const ipRateLimit: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 60
}

const keyRateLimit: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 20
}

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

function cleanMachineName(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

function hasAtMostSixDecimals(value: number): boolean {
  return (
    Number.isSafeInteger(Math.round(value * 1_000_000)) &&
    Math.abs(Math.round(value * 1_000_000) - value * 1_000_000) < 1e-6
  )
}

const dailyDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: 'Invalid calendar date' })
const usageNameSchema = z.string().trim().min(1).max(128)
const tokenCountSchema = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .max(MAX_TOKENS_PER_RECORD)
const costUsdSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_COST_USD_PER_RECORD)
  .refine(hasAtMostSixDecimals, { message: 'Cost must have at most six decimal places' })
const machineNameSchema = z
  .string()
  .transform(cleanMachineName)
  .refine((name) => [...name].length >= 1 && [...name].length <= 80, {
    message: 'Machine name must be 1-80 characters'
  })
const timezoneSchema = z.string().trim().min(1).max(64)

const tokenFields = {
  inputTokens: tokenCountSchema,
  outputTokens: tokenCountSchema,
  cacheCreationTokens: tokenCountSchema,
  cacheReadTokens: tokenCountSchema,
  totalTokens: tokenCountSchema,
  costUsd: costUsdSchema
}

function validateTokenTotal(
  row: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
  },
  context: z.RefinementCtx
) {
  const total =
    row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens
  if (!Number.isSafeInteger(total) || total > MAX_TOKENS_PER_RECORD) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Token total exceeds the per-record limit',
      path: ['totalTokens']
    })
  }
}

const dailyUsageSchema = z
  .object({
    date: dailyDateSchema,
    agents: z.array(usageNameSchema).max(32),
    models: z.array(usageNameSchema).max(32),
    ...tokenFields
  })
  .strict()
  .superRefine(validateTokenTotal)

const eventUsageSchema = z
  .object({
    eventId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:/-]+$/),
    requestId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:/-]+$/).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    agent: usageNameSchema,
    provider: usageNameSchema.optional(),
    runtime: usageNameSchema.optional(),
    model: usageNameSchema,
    provenance: z.array(usageNameSchema).min(1).max(16).optional(),
    inputTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    cacheCreationTokens: tokenCountSchema.optional(),
    cacheReadTokens: tokenCountSchema.optional(),
    reasoningTokens: tokenCountSchema.optional(),
    totalTokens: tokenCountSchema.optional(),
    costUsd: costUsdSchema.optional(),
    billedCostUsd: z.literal(0).optional()
  })
  .strict()

const provenanceSchema = z
  .object({
    source: z.literal('ccusage'),
    cliVersion: z.string().trim().min(1).max(64)
  })
  .strict()
const eventProvenanceSchema = z.object({
  source: z.literal('cribble-agent'),
  sources: z.array(z.enum(['ccusage', 'prime-agent', 'ollama', 'hermes', 'opencode'])).min(1).max(16),
  cliVersion: z.string().trim().min(1).max(64)
}).strict()

const dailyRowsSchema = z
  .array(dailyUsageSchema)
  .min(1)
  .max(MAX_BACKFILL_DAYS)
  .superRefine((rows, context) => {
    const seen = new Set<string>()
    rows.forEach((row, index) => {
      if (seen.has(row.date)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate daily date',
          path: [index, 'date']
        })
      }
      seen.add(row.date)
    })
  })

const eventRowsSchema = z
  .array(eventUsageSchema)
  .min(1)
  .max(2_000)
  .superRefine((rows, context) => {
    const seen = new Set<string>()
    rows.forEach((row, index) => {
      if (seen.has(row.eventId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate event id',
          path: [index, 'eventId']
        })
      }
      seen.add(row.eventId)
    })
  })

const ingestSchema = z.discriminatedUnion('schemaVersion', [
  z
    .object({
      schemaVersion: z.literal(1),
      generatedAt: z.string().datetime({ offset: true }),
      clientId: z.string().uuid(),
      machineName: machineNameSchema.optional(),
      timezone: timezoneSchema.optional(),
      provenance: provenanceSchema,
      daily: dailyRowsSchema
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      generatedAt: z.string().datetime({ offset: true }),
      clientId: z.string().uuid(),
      machineName: machineNameSchema,
      timezone: timezoneSchema,
      provenance: z.union([provenanceSchema, eventProvenanceSchema]),
      events: eventRowsSchema
    })
    .strict()
])

type AgentKeyOwnerRow = {
  id: number | string
  user_id: number | string
  revoked_at: string | null
  expires_at: string | null
  users: { status: string | null } | null
}

type IngestResultRow = {
  inserted: number | string
  replaced: number | string
  stale: number | string
}

function bearerKey(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer (crib_ag_[0-9a-f]{64})$/)
  return match?.[1] ?? null
}

function rateLimited(result: Awaited<ReturnType<typeof checkDistributedRateLimit>>) {
  return NextResponse.json(
    { success: false, error: 'Rate limit exceeded. Please try again later.' },
    { status: 429, headers: createRateLimitResponse(result) }
  )
}

function totalTokens(row: {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}): number {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens
}

/* ------------------------------------------------------------------ *
 * Burn Board hype (migration 065) — best-effort by construction: the
 * paid product here is the ingest, so every read below degrades to
 * "no celebration" instead of failing or delaying the sync response.
 * ------------------------------------------------------------------ */

/** Whether the user shares usage on the Burn Board — the same gate the
 *  board ranks with (leaderboard_enabled AND consent v2+). False on
 *  any failure: no consent signal, no celebration. */
async function readBurnOptIn(userId: number): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('agent_usage_sharing')
      .select('leaderboard_enabled, consent_version')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.warn('[AgentUsage] Sharing opt-in read failed:', error.message)
      return false
    }
    return data?.leaderboard_enabled === true && Number(data.consent_version) >= 2
  } catch (err) {
    console.warn('[AgentUsage] Sharing opt-in unavailable:', err)
    return false
  }
}

/** The user's lifetime burn as an exact decimal string, or null when
 *  the RPC is missing/failing — the caller then skips club derivation
 *  for this sync (the forever-once dedupe keys make the next sync's
 *  re-derivation catch up harmlessly). */
async function readLifetimeBurn(userId: number): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('agent_lifetime_burn', {
      p_user_id: userId
    })
    if (error) {
      console.warn('[AgentUsage] Lifetime burn read failed:', error.message)
      return null
    }
    return exactDecimal(data as number | string | null)
  } catch (err) {
    console.warn('[AgentUsage] Lifetime burn unavailable:', err)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    // Keep the process-local IP check as a cheap unauthenticated prefilter.
    // The authoritative per-key limit below is atomic and cross-instance.
    const ipLimit = checkRateLimit(request, ipRateLimit)
    if (!ipLimit.success) return rateLimited(ipLimit)

    const presentedKey = bearerKey(request)
    if (!presentedKey) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error: keyLookupError } = await supabase
      .from('agent_api_keys')
      .select(
        'id, user_id, revoked_at, expires_at, users!agent_api_keys_user_id_fkey(status)'
      )
      .eq('key_hash', hashAgentApiKey(presentedKey))
      .maybeSingle()

    if (keyLookupError) {
      console.error('[AgentUsage] Key lookup failed:', keyLookupError)
      return NextResponse.json(
        { success: false, error: 'Authentication unavailable' },
        { status: 503 }
      )
    }

    const key = data as unknown as AgentKeyOwnerRow | null
    if (
      !key ||
      key.revoked_at ||
      (key.expires_at !== null && Date.parse(key.expires_at) <= Date.now()) ||
      !key.users ||
      key.users.status === 'banned'
    ) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const keyId = Number(key.id)
    const userId = Number(key.user_id)
    const perKeyLimit = await checkDistributedRateLimit(
      request,
      keyRateLimit,
      `agent-usage:key:${keyId}`
    )
    if (!perKeyLimit.success) return rateLimited(perKeyLimit)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = ingestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const generatedTime = Date.parse(parsed.data.generatedAt)
    const now = Date.now()
    if (generatedTime > now + MAX_FUTURE_SKEW_MS) {
      return NextResponse.json(
        { success: false, error: 'generatedAt is too far in the future' },
        { status: 400 }
      )
    }
    if (generatedTime < now - MAX_SNAPSHOT_AGE_MS) {
      return NextResponse.json(
        { success: false, error: 'generatedAt is too old; generate a fresh snapshot' },
        { status: 400 }
      )
    }

    const canonicalTimezone = parsed.data.timezone
      ? normalizeIanaTimeZone(parsed.data.timezone)
      : null
    if (parsed.data.timezone && !canonicalTimezone) {
      return NextResponse.json(
        { success: false, error: 'timezone must be a valid IANA timezone' },
        { status: 400 }
      )
    }

    let records: Array<Record<string, unknown>>
    if (parsed.data.schemaVersion === 1) {
      const generatedDate = calendarDateInTimeZone(
        generatedTime,
        canonicalTimezone ?? 'UTC'
      )
      const distantDate = parsed.data.daily.find((row) => {
        const age = calendarDaysBetween(row.date, generatedDate)
        return age < 0 || age >= MAX_BACKFILL_DAYS
      })
      if (distantDate) {
        return NextResponse.json(
          { success: false, error: 'Daily dates must be within the 365-day snapshot window' },
          { status: 400 }
        )
      }

      records = parsed.data.daily.map((row) => ({
        date: row.date,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        cache_creation_tokens: row.cacheCreationTokens,
        cache_read_tokens: row.cacheReadTokens,
        total_tokens: totalTokens(row),
        cost_usd: row.costUsd,
        agents: row.agents,
        models: row.models
      }))
    } else {
      const distantEvent = parsed.data.events.find((row) => {
        const occurredAt = Date.parse(row.occurredAt)
        return (
          occurredAt > generatedTime + MAX_FUTURE_SKEW_MS ||
          occurredAt < generatedTime - MAX_BACKFILL_DAYS * 86_400_000
        )
      })
      if (distantEvent) {
        return NextResponse.json(
          { success: false, error: 'Events must be within the 365-day snapshot window' },
          { status: 400 }
        )
      }

      records = parsed.data.events.map((row) => ({
        event_id: row.eventId,
        request_id: row.requestId ?? row.eventId,
        occurred_at: row.occurredAt,
        agent: row.agent,
        provider: row.provider ?? null,
        runtime: row.runtime ?? null,
        model: row.model,
        provenance: row.provenance ?? [parsed.data.provenance.source],
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        cache_creation_tokens: row.cacheCreationTokens ?? null,
        cache_read_tokens: row.cacheReadTokens ?? null,
        reasoning_tokens: row.reasoningTokens ?? null,
        total_tokens: row.inputTokens + row.outputTokens + (row.cacheCreationTokens ?? 0) + (row.cacheReadTokens ?? 0),
        cost_usd: row.billedCostUsd ?? row.costUsd ?? 0
      }))
    }

    // Burn Board pass, part 1: the burn-club story needs the lifetime
    // total on BOTH sides of the ingest, so the baseline reads here —
    // opted-in users only. A null baseline (RPC missing/failing) skips
    // club derivation below without touching the ingest itself.
    const burnOptedIn = await readBurnOptIn(userId)
    const burnBaseline = burnOptedIn ? await readLifetimeBurn(userId) : null

    const { data: ingestData, error: ingestError } = await supabase.rpc(
      'ingest_agent_usage',
      {
        p_user_id: userId,
        p_key_id: keyId,
        p_client_id: parsed.data.clientId,
        p_machine_name: parsed.data.machineName ?? null,
        p_timezone: canonicalTimezone,
        p_source: parsed.data.provenance.source,
        p_cli_version: parsed.data.provenance.cliVersion,
        p_generated_at: parsed.data.generatedAt,
        p_schema_version: parsed.data.schemaVersion,
        p_records: records
      }
    )

    if (ingestError) {
      const message = ingestError.message ?? ''
      if (message.includes('agent_client_limit')) {
        return NextResponse.json(
          { success: false, error: 'Maximum of 10 agent clients reached' },
          { status: 409 }
        )
      }
      if (message.includes('agent_key_invalid')) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
      if (message.includes('agent_invalid_')) {
        return NextResponse.json(
          { success: false, error: 'Invalid usage snapshot' },
          { status: 400 }
        )
      }

      console.error('[AgentUsage] Atomic ingest failed:', ingestError)
      return NextResponse.json(
        { success: false, error: 'Failed to store token usage' },
        { status: 500 }
      )
    }

    const result = (Array.isArray(ingestData) ? ingestData[0] : ingestData) as
      | IngestResultRow
      | null
    if (!result) {
      console.error('[AgentUsage] Atomic ingest returned no result')
      return NextResponse.json(
        { success: false, error: 'Failed to store token usage' },
        { status: 500 }
      )
    }

    // Burn Board pass, part 2, off the response path: burn-club
    // crossings (thresholds crossed between the pre/post lifetime
    // totals) and the rank snapshot diff — the moves this ingest just
    // caused — ride after(), the same deferral the extension sync
    // gives its snapshot. Every step swallows its own failures: hype
    // must never fail, or delay-fail, the sync that produced it.
    if (burnOptedIn) {
      after(async () => {
        try {
          if (burnBaseline !== null) {
            const lifetimeBurn = await readLifetimeBurn(userId)
            if (lifetimeBurn !== null) {
              await recordHypeEvents(
                supabase,
                burnClubCrossings(burnBaseline, lifetimeBurn).map((threshold) =>
                  buildBurnClubHypeEvent(userId, threshold)
                )
              )
            }
          }
          await refreshBurnBoardSnapshot(supabase)
        } catch (err) {
          console.warn('[AgentUsage] Burn hype pass failed:', err)
        }
      })
    }

    return NextResponse.json({
      success: true,
      inserted: Number(result.inserted),
      replaced: Number(result.replaced),
      stale: Number(result.stale),
      clientId: parsed.data.clientId
    })
  } catch (error) {
    console.error('[AgentUsage] POST error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
