import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashAgentApiKey } from '@/lib/agentKey'

interface KeyRow {
  id: number
  user_id: number
  key_hash: string
  revoked_at: string | null
  users: { status: string | null } | null
}

interface UsageRow {
  user_id: number
  client_id: string
  date: string
  generated_at: string
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  total_tokens: number
  cost_usd: number
  agents: string[]
  models: string[]
  timezone: string | null
  source: string
  cli_version: string | null
  ingested_at: string
}

const { state, rateLimitMock, supabaseMock } = vi.hoisted(() => {
  const state = {
    keys: [] as KeyRow[],
    usageRows: [] as UsageRow[],
    keyTouches: [] as Array<{
      values: Record<string, unknown>
      filters: Array<[string, unknown]>
    }>,
    upsertBatches: [] as UsageRow[][],
    touchError: null as { message: string } | null
  }

  interface QueryContext {
    table: string
    op: 'select' | 'update' | 'upsert'
    columns?: string
    filters: Array<[string, unknown]>
    inFilters: Array<[string, unknown[]]>
    values?: Record<string, unknown> | UsageRow[]
  }

  const matches = (
    row: Record<string, unknown>,
    filters: Array<[string, unknown]>
  ) => filters.every(([column, value]) => row[column] === value)

  function resolveQuery(ctx: QueryContext) {
    if (ctx.table === 'agent_api_keys') {
      if (ctx.op === 'update') {
        state.keyTouches.push({
          values: { ...(ctx.values as Record<string, unknown>) },
          filters: [...ctx.filters]
        })
        return { data: null, error: state.touchError }
      }

      const rows = state.keys.filter((row) =>
        matches(row as unknown as Record<string, unknown>, ctx.filters)
      )
      return { data: rows, error: null }
    }

    if (ctx.table === 'agent_usage_daily') {
      if (ctx.op === 'upsert') {
        const batch = (ctx.values as UsageRow[]).map((row) => ({ ...row }))
        state.upsertBatches.push(batch)
        for (const incoming of batch) {
          const existing = state.usageRows.find(
            (row) =>
              row.user_id === incoming.user_id &&
              row.client_id === incoming.client_id &&
              row.date === incoming.date
          )
          if (existing) Object.assign(existing, incoming)
          else state.usageRows.push({ ...incoming })
        }
        return { data: null, error: null }
      }

      let rows = state.usageRows.filter((row) =>
        matches(row as unknown as Record<string, unknown>, ctx.filters)
      )
      for (const [column, values] of ctx.inFilters) {
        rows = rows.filter((row) => values.includes(row[column as keyof UsageRow]))
      }
      if (ctx.columns === 'client_id') {
        return { data: rows.map((row) => ({ client_id: row.client_id })), error: null }
      }
      return {
        data: rows.map((row) => ({ date: row.date, generated_at: row.generated_at })),
        error: null
      }
    }

    return { data: null, error: { message: `Unexpected table: ${ctx.table}` } }
  }

  function from(table: string) {
    const ctx: QueryContext = {
      table,
      op: 'select',
      filters: [],
      inFilters: []
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      select: (columns: string) => {
        ctx.columns = columns
        return builder
      },
      update: (values: Record<string, unknown>) => {
        ctx.op = 'update'
        ctx.values = values
        return builder
      },
      upsert: (values: UsageRow[]) => {
        ctx.op = 'upsert'
        ctx.values = values
        return builder
      },
      eq: (column: string, value: unknown) => {
        ctx.filters.push([column, value])
        return builder
      },
      in: (column: string, values: unknown[]) => {
        ctx.inFilters.push([column, values])
        return builder
      },
      maybeSingle: async () => {
        const result = resolveQuery(ctx)
        const rows = result.data as unknown[] | null
        return { ...result, data: rows?.[0] ?? null }
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(resolveQuery(ctx)).then(resolve, reject)
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder
  }

  const rateLimitMock = vi.fn()
  return { state, rateLimitMock, supabaseMock: { from } }
})

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => supabaseMock
}))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  createRateLimitResponse: () => new Headers()
}))

import { POST } from './route'

const USER_A = 42
const USER_B = 99
const CLIENT_A = '5b0d4a52-7f6e-4c2a-9a1c-3f9e8d7c6b5a'
const CLIENT_B = '6c1e5b63-8a7f-4d3b-8b2d-4a0f9e8d7c6b'
const GENERATED_AT = '2026-08-22T00:00:00.000Z'
const KEY_A = `crib_ag_${'a'.repeat(64)}`

function successLimit() {
  return {
    success: true,
    limit: 60,
    remaining: 59,
    resetTime: Date.now() + 60_000
  }
}

function addKey(
  plaintext = KEY_A,
  options: {
    id?: number
    userId?: number
    revokedAt?: string | null
    status?: string | null
  } = {}
) {
  state.keys.push({
    id: options.id ?? 7,
    user_id: options.userId ?? USER_A,
    key_hash: hashAgentApiKey(plaintext),
    revoked_at: options.revokedAt ?? null,
    users: { status: options.status ?? 'active' }
  })
}

function addUsage(options: {
  userId?: number
  clientId?: string
  date?: string
  generatedAt?: string
  inputTokens?: number
}) {
  state.usageRows.push({
    user_id: options.userId ?? USER_A,
    client_id: options.clientId ?? CLIENT_A,
    date: options.date ?? '2026-08-21',
    generated_at: options.generatedAt ?? GENERATED_AT,
    input_tokens: options.inputTokens ?? 1,
    output_tokens: 2,
    cache_creation_tokens: 3,
    cache_read_tokens: 4,
    total_tokens: (options.inputTokens ?? 1) + 9,
    cost_usd: 0.25,
    agents: ['codex'],
    models: ['gpt-5'],
    timezone: 'Asia/Manila',
    source: 'ccusage',
    cli_version: '1.0.0',
    ingested_at: GENERATED_AT
  })
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    clientId: CLIENT_A,
    timezone: 'Asia/Manila',
    provenance: { source: 'ccusage', cliVersion: '1.0.0' },
    daily: [
      {
        date: '2026-08-21',
        agents: ['codex'],
        models: ['gpt-5'],
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 30,
        cacheReadTokens: 40,
        totalTokens: 999,
        costUsd: 0.123456
      }
    ],
    ...overrides
  }
}

function request(body: unknown, key: string | null = KEY_A) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (key !== null) headers.authorization = `Bearer ${key}`
  return new NextRequest('https://cribble.dev/api/agent/usage', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
}

beforeEach(() => {
  state.keys = []
  state.usageRows = []
  state.keyTouches = []
  state.upsertBatches = []
  state.touchError = null
  rateLimitMock.mockReset()
  rateLimitMock.mockReturnValue(successLimit())
})

describe('POST /api/agent/usage — storage and staleness', () => {
  it('inserts a valid daily row for the key owner and recomputes its total', async () => {
    addKey()

    const response = await POST(request(payload()))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      inserted: 1,
      replaced: 0,
      stale: 0,
      clientId: CLIENT_A
    })
    expect(state.usageRows).toHaveLength(1)
    expect(state.usageRows[0]).toMatchObject({
      user_id: USER_A,
      client_id: CLIENT_A,
      date: '2026-08-21',
      total_tokens: 100,
      source: 'ccusage',
      cli_version: '1.0.0'
    })
    expect(state.usageRows[0].total_tokens).not.toBe(999)
    expect(state.keyTouches[0].filters).toEqual([
      ['id', 7],
      ['user_id', USER_A]
    ])
    expect(rateLimitMock).toHaveBeenNthCalledWith(
      2,
      expect.any(NextRequest),
      expect.objectContaining({ maxRequests: 20 }),
      'agent-usage:key:7'
    )
  })

  it('treats an identical retry as stale and performs no usage write', async () => {
    addKey()

    const first = await POST(request(payload()))
    const second = await POST(request(payload()))
    const firstBody = await first.json()
    const secondBody = await second.json()

    expect(firstBody).toMatchObject({ inserted: 1, replaced: 0, stale: 0 })
    expect(secondBody).toMatchObject({ inserted: 0, replaced: 0, stale: 1 })
    expect(state.upsertBatches).toHaveLength(1)
    expect(state.usageRows).toHaveLength(1)
    expect(state.usageRows[0].input_tokens).toBe(10)
  })

  it('replaces an older row from the same client', async () => {
    addKey()
    addUsage({ generatedAt: '2026-08-21T23:00:00.000Z', inputTokens: 1 })

    const response = await POST(request(payload()))
    const body = await response.json()

    expect(body).toMatchObject({ inserted: 0, replaced: 1, stale: 0 })
    expect(state.usageRows[0].input_tokens).toBe(10)
    expect(state.usageRows[0].generated_at).toBe(GENERATED_AT)
  })

  it('skips an older snapshot without changing the existing row', async () => {
    addKey()
    addUsage({ generatedAt: GENERATED_AT, inputTokens: 77 })
    const older = payload({ generatedAt: '2026-08-21T23:00:00.000Z' })

    const response = await POST(request(older))
    const body = await response.json()

    expect(body).toMatchObject({ inserted: 0, replaced: 0, stale: 1 })
    expect(state.upsertBatches).toHaveLength(0)
    expect(state.usageRows[0].input_tokens).toBe(77)
  })
})

describe('POST /api/agent/usage — authentication and tenant isolation', () => {
  it('rejects revoked keys and keys owned by banned accounts', async () => {
    addKey(KEY_A, { revokedAt: '2026-08-21T00:00:00.000Z' })
    const revoked = await POST(request(payload()))

    state.keys = []
    addKey(KEY_A, { status: 'banned' })
    const banned = await POST(request(payload()))

    expect(revoked.status).toBe(401)
    expect(banned.status).toBe(401)
    expect(state.usageRows).toHaveLength(0)
  })

  it('rejects missing and unknown bearer credentials', async () => {
    addKey()

    const missing = await POST(request(payload(), null))
    const wrong = await POST(request(payload(), `crib_ag_${'b'.repeat(64)}`))

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(state.keyTouches).toHaveLength(0)
  })

  it('uses the key owner for every write and cannot overwrite another user', async () => {
    addKey(KEY_A, { userId: USER_A })
    addUsage({ userId: USER_B, clientId: CLIENT_A, inputTokens: 500 })

    const response = await POST(request(payload()))

    expect(response.status).toBe(200)
    expect(state.usageRows).toHaveLength(2)
    expect(state.usageRows.find((row) => row.user_id === USER_B)?.input_tokens).toBe(500)
    expect(state.usageRows.find((row) => row.user_id === USER_A)?.input_tokens).toBe(10)
    expect(state.upsertBatches[0][0].user_id).toBe(USER_A)
  })

  it('applies the second rate limit using the resolved key id', async () => {
    addKey(KEY_A, { id: 123 })
    rateLimitMock.mockImplementation(
      (_request: unknown, _config: unknown, identifier?: string) =>
        identifier
          ? {
              success: false,
              limit: 20,
              remaining: 0,
              resetTime: Date.now() + 60_000,
              retryAfter: 60
            }
          : successLimit()
    )

    const response = await POST(request(payload()))

    expect(response.status).toBe(429)
    expect(rateLimitMock).toHaveBeenNthCalledWith(
      2,
      expect.any(NextRequest),
      expect.objectContaining({ maxRequests: 20 }),
      'agent-usage:key:123'
    )
    expect(state.keyTouches).toHaveLength(0)
  })
})

describe('POST /api/agent/usage — client limits', () => {
  it('keeps two clients as two rows on the same date', async () => {
    addKey()
    addUsage({ clientId: CLIENT_A })

    const response = await POST(request(payload({ clientId: CLIENT_B })))

    expect(response.status).toBe(200)
    expect(state.usageRows).toHaveLength(2)
    expect(new Set(state.usageRows.map((row) => row.client_id))).toEqual(
      new Set([CLIENT_A, CLIENT_B])
    )
  })

  it('rejects an eleventh distinct client', async () => {
    addKey()
    for (let index = 0; index < 10; index += 1) {
      addUsage({
        clientId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })
    }

    const response = await POST(request(payload()))

    expect(response.status).toBe(409)
    expect(state.upsertBatches).toHaveLength(0)
  })
})

describe('POST /api/agent/usage — strict validation', () => {
  it('rejects the legacy display snapshot shape', async () => {
    addKey()
    const legacy = {
      ...payload(),
      range: { startDate: '2026-08-21', endDate: '2026-08-21', dayCount: 1 },
      totals: { totalTokens: 100 }
    }

    const response = await POST(request(legacy))

    expect(response.status).toBe(400)
    expect(state.upsertBatches).toHaveLength(0)
  })

  it('rejects an unknown daily date', async () => {
    addKey()
    const invalid = payload()
    ;(invalid.daily as Array<Record<string, unknown>>)[0].date = 'unknown'

    const response = await POST(request(invalid))

    expect(response.status).toBe(400)
    expect(state.upsertBatches).toHaveLength(0)
  })

  it('rejects impossible calendar dates before they reach Postgres', async () => {
    addKey()
    const invalid = payload()
    ;(invalid.daily as Array<Record<string, unknown>>)[0].date = '2026-02-30'

    const response = await POST(request(invalid))

    expect(response.status).toBe(400)
    expect(state.upsertBatches).toHaveLength(0)
  })

  it('bounds token integers and agent/model labels for unattended clients', async () => {
    addKey()
    const unsafeTokens = payload()
    ;(unsafeTokens.daily as Array<Record<string, unknown>>)[0].inputTokens =
      Number.MAX_SAFE_INTEGER + 1
    const tooLongModel = payload()
    ;(tooLongModel.daily as Array<Record<string, unknown>>)[0].models = [
      'm'.repeat(129)
    ]
    const unsafeSum = payload()
    const unsafeDay = (unsafeSum.daily as Array<Record<string, unknown>>)[0]
    unsafeDay.inputTokens = Number.MAX_SAFE_INTEGER
    unsafeDay.outputTokens = 1

    const tokenResponse = await POST(request(unsafeTokens))
    const modelResponse = await POST(request(tooLongModel))
    const sumResponse = await POST(request(unsafeSum))

    expect(tokenResponse.status).toBe(400)
    expect(modelResponse.status).toBe(400)
    expect(sumResponse.status).toBe(400)
    expect(state.upsertBatches).toHaveLength(0)
  })

  it('rejects a generatedAt more than one hour in the future', async () => {
    addKey()
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    const response = await POST(request(payload({ generatedAt: future })))

    expect(response.status).toBe(400)
    expect(state.upsertBatches).toHaveLength(0)
  })

  it('continues when the best-effort last-used update fails', async () => {
    addKey()
    state.touchError = { message: 'temporary failure' }

    const response = await POST(request(payload()))

    expect(response.status).toBe(200)
    expect(state.usageRows).toHaveLength(1)
  })
})
