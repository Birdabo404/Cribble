import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hashAgentApiKey } from '@/lib/agentKey'
import {
  checkRateLimit,
  createRateLimitResponse,
  type RateLimitConfig
} from '@/lib/rateLimit'
import { createServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const MAX_CLIENTS_PER_USER = 10
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000

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
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ]
  return day <= daysInMonth[month - 1]
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
  .max(Number.MAX_SAFE_INTEGER)

const dailyUsageSchema = z
  .object({
    date: dailyDateSchema,
    agents: z.array(usageNameSchema).max(32),
    models: z.array(usageNameSchema).max(32),
    inputTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    cacheCreationTokens: tokenCountSchema,
    cacheReadTokens: tokenCountSchema,
    totalTokens: tokenCountSchema,
    costUsd: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .superRefine((row, context) => {
    const serverTotal =
      row.inputTokens +
      row.outputTokens +
      row.cacheCreationTokens +
      row.cacheReadTokens
    if (!Number.isSafeInteger(serverTotal)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Token total exceeds the safe integer range',
        path: ['totalTokens']
      })
    }
  })

const ingestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime({ offset: true }),
    clientId: z.string().uuid(),
    timezone: z.string().min(1).max(64).regex(/^[A-Za-z0-9_+/-]+$/).optional(),
    provenance: z
      .object({
        source: z.literal('ccusage'),
        cliVersion: z.string().min(1).max(64)
      })
      .strict(),
    daily: z
      .array(dailyUsageSchema)
      .min(1)
      .max(365)
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
  })
  .strict()

type AgentKeyOwnerRow = {
  id: number | string
  user_id: number | string
  revoked_at: string | null
  users: { status: string | null } | null
}

function bearerKey(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer (crib_ag_[0-9a-f]{64})$/)
  return match?.[1] ?? null
}

function rateLimited(result: ReturnType<typeof checkRateLimit>) {
  return NextResponse.json(
    {
      success: false,
      error: 'Rate limit exceeded. Please try again later.'
    },
    { status: 429, headers: createRateLimitResponse(result) }
  )
}

export async function POST(request: NextRequest) {
  try {
    // Cheap IP gate first, before hashing or touching the database.
    const ipLimit = checkRateLimit(request, ipRateLimit)
    if (!ipLimit.success) return rateLimited(ipLimit)

    const presentedKey = bearerKey(request)
    if (!presentedKey) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data, error: keyLookupError } = await supabase
      .from('agent_api_keys')
      .select('id, user_id, revoked_at, users!agent_api_keys_user_id_fkey(status)')
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
    if (!key || key.revoked_at || !key.users || key.users.status === 'banned') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const keyId = Number(key.id)
    const userId = Number(key.user_id)
    const perKeyLimit = checkRateLimit(
      request,
      keyRateLimit,
      `agent-usage:key:${keyId}`
    )
    if (!perKeyLimit.success) return rateLimited(perKeyLimit)

    // Best effort only: a telemetry field must not block valid ingestion.
    const { error: touchError } = await supabase
      .from('agent_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('user_id', userId)
    if (touchError) {
      console.warn('[AgentUsage] Failed to update key last_used_at:', touchError.message)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const parsed = ingestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const generatedTime = Date.parse(parsed.data.generatedAt)
    if (generatedTime > Date.now() + MAX_FUTURE_SKEW_MS) {
      return NextResponse.json(
        { success: false, error: 'generatedAt is too far in the future' },
        { status: 400 }
      )
    }

    // Count distinct clients from this user's daily facts. Keys are not
    // machine-bound, so one key can safely serve a laptop and desktop.
    const { data: clientRows, error: clientsError } = await supabase
      .from('agent_usage_daily')
      .select('client_id')
      .eq('user_id', userId)

    if (clientsError) {
      console.error('[AgentUsage] Client lookup failed:', clientsError)
      return NextResponse.json(
        { success: false, error: 'Failed to store token usage' },
        { status: 500 }
      )
    }

    const clientIds = new Set((clientRows ?? []).map((row) => String(row.client_id)))
    if (!clientIds.has(parsed.data.clientId) && clientIds.size >= MAX_CLIENTS_PER_USER) {
      return NextResponse.json(
        { success: false, error: 'Maximum of 10 agent clients reached' },
        { status: 409 }
      )
    }

    const dates = parsed.data.daily.map((row) => row.date)
    const { data: existingRows, error: existingError } = await supabase
      .from('agent_usage_daily')
      .select('date, generated_at')
      .eq('user_id', userId)
      .eq('client_id', parsed.data.clientId)
      .in('date', dates)

    if (existingError) {
      console.error('[AgentUsage] Existing-row lookup failed:', existingError)
      return NextResponse.json(
        { success: false, error: 'Failed to store token usage' },
        { status: 500 }
      )
    }

    const existingByDate = new Map(
      (existingRows ?? []).map((row) => [String(row.date), String(row.generated_at)])
    )
    const ingestedAt = new Date().toISOString()
    let inserted = 0
    let replaced = 0
    let stale = 0
    const rowsToWrite = []

    for (const row of parsed.data.daily) {
      const existingGeneratedAt = existingByDate.get(row.date)
      if (existingGeneratedAt && Date.parse(existingGeneratedAt) >= generatedTime) {
        stale += 1
        continue
      }

      if (existingGeneratedAt) replaced += 1
      else inserted += 1

      // total_tokens is deliberately recomputed instead of trusting the
      // client-provided totalTokens field.
      const totalTokens =
        row.inputTokens +
        row.outputTokens +
        row.cacheCreationTokens +
        row.cacheReadTokens

      rowsToWrite.push({
        user_id: userId,
        client_id: parsed.data.clientId,
        date: row.date,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        cache_creation_tokens: row.cacheCreationTokens,
        cache_read_tokens: row.cacheReadTokens,
        total_tokens: totalTokens,
        cost_usd: row.costUsd,
        agents: row.agents,
        models: row.models,
        timezone: parsed.data.timezone ?? null,
        source: parsed.data.provenance.source,
        cli_version: parsed.data.provenance.cliVersion,
        generated_at: parsed.data.generatedAt,
        ingested_at: ingestedAt
      })
    }

    if (rowsToWrite.length > 0) {
      const { error: upsertError } = await supabase
        .from('agent_usage_daily')
        .upsert(rowsToWrite, { onConflict: 'user_id,client_id,date' })

      if (upsertError) {
        console.error('[AgentUsage] Upsert failed:', upsertError)
        return NextResponse.json(
          { success: false, error: 'Failed to store token usage' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      inserted,
      replaced,
      stale,
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
