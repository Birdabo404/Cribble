import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentUsageDailyRow } from '@/lib/userTokenUsage'

interface KeyRow {
  user_id: number
  revoked_at: string | null
  expires_at?: string | null
}

const { state, sessionMock, supabaseMock } = vi.hoisted(() => {
  const state = {
    keys: [] as KeyRow[],
    usage: [] as Array<AgentUsageDailyRow & { user_id: number }>,
    calls: [] as Array<{
      table: string
      columns: string
      filters: Array<[string, string, unknown]>
    }>,
    failTable: null as string | null
  }

  interface Context {
    table: string
    columns: string
    filters: Array<[string, string, unknown]>
    orders: Array<{ column: string; ascending: boolean }>
    limit: number | null
    range: [number, number] | null
  }

  function project(row: Record<string, unknown>, columns: string) {
    return Object.fromEntries(
      columns.split(',').map((column) => {
        const key = column.trim()
        return [key, row[key]]
      })
    )
  }

  function resolve(ctx: Context) {
    state.calls.push({
      table: ctx.table,
      columns: ctx.columns,
      filters: [...ctx.filters]
    })
    if (state.failTable === ctx.table) {
      return { data: null, error: { message: `${ctx.table} unavailable` } }
    }

    const source: Array<Record<string, unknown>> =
      ctx.table === 'agent_api_keys'
        ? (state.keys as unknown as Array<Record<string, unknown>>)
        : ctx.table === 'agent_usage_daily'
          ? (state.usage as unknown as Array<Record<string, unknown>>)
          : []
    let rows = source.filter((row) =>
      ctx.filters.every(([operator, column, value]) => {
        if (operator === 'eq') return row[column] === value
        if (operator === 'gte') return String(row[column]) >= String(value)
        if (operator === 'lte') return String(row[column]) <= String(value)
        return false
      })
    )
    rows = [...rows].sort((left, right) => {
      for (const order of ctx.orders) {
        const comparison = String(left[order.column]).localeCompare(String(right[order.column]))
        if (comparison !== 0) return order.ascending ? comparison : -comparison
      }
      return 0
    })
    if (ctx.range) rows = rows.slice(ctx.range[0], ctx.range[1] + 1)
    else if (ctx.limit !== null) rows = rows.slice(0, ctx.limit)
    return { data: rows.map((row) => project(row, ctx.columns)), error: null }
  }

  function from(table: string) {
    const ctx: Context = {
      table,
      columns: '',
      filters: [],
      orders: [],
      limit: null,
      range: null
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      select: (columns: string) => {
        ctx.columns = columns
        return builder
      },
      eq: (column: string, value: unknown) => {
        ctx.filters.push(['eq', column, value])
        return builder
      },
      gte: (column: string, value: unknown) => {
        ctx.filters.push(['gte', column, value])
        return builder
      },
      lte: (column: string, value: unknown) => {
        ctx.filters.push(['lte', column, value])
        return builder
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        ctx.orders.push({ column, ascending: options?.ascending !== false })
        return builder
      },
      limit: (value: number) => {
        ctx.limit = value
        return builder
      },
      range: (fromIndex: number, toIndex: number) => {
        ctx.range = [fromIndex, toIndex]
        return builder
      },
      maybeSingle: async () => {
        const result = resolve(ctx)
        return { ...result, data: result.data?.[0] ?? null }
      },
      then: (resolvePromise: any, rejectPromise: any) =>
        Promise.resolve(resolve(ctx)).then(resolvePromise, rejectPromise)
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder
  }

  return {
    state,
    sessionMock: vi.fn(),
    supabaseMock: { from }
  }
})

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: sessionMock }))
vi.mock('@/lib/supabaseServer', () => ({ createServiceClient: () => supabaseMock }))

import { GET } from './route'

const USER_ID = 42
const OTHER_USER_ID = 99
const CLIENT_ID = '5b0d4a52-7f6e-4c2a-9a1c-3f9e8d7c6b5a'

function row(userId: number, overrides: Partial<AgentUsageDailyRow> = {}) {
  return {
    user_id: userId,
    date: '2026-08-22',
    client_id: CLIENT_ID,
    input_tokens: '90071992547409931234567890',
    output_tokens: '10',
    cache_creation_tokens: '20',
    cache_read_tokens: '30',
    total_tokens: '90071992547409931234567950',
    cost_usd: '123456789012345678.123456',
    agents: ['codex'],
    models: ['gpt-5'],
    cli_version: '1.2.0',
    ingested_at: '2026-08-22T12:00:00.000Z',
    ...overrides
  }
}

function request(query = 'from=2026-08-20&to=2026-08-23&timezone=Asia%2FManila') {
  return new NextRequest(`https://cribble.dev/api/user/token-usage?${query}`)
}

beforeEach(() => {
  state.keys = []
  state.usage = []
  state.calls = []
  state.failTable = null
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: USER_ID })
})

describe('GET /api/user/token-usage', () => {
  it('uses only the session owner, selected columns, exact strings, and private no-store', async () => {
    state.keys = [
      { user_id: USER_ID, revoked_at: null },
      { user_id: OTHER_USER_ID, revoked_at: null }
    ]
    state.usage = [
      row(USER_ID),
      row(OTHER_USER_ID, {
        client_id: '7b0d4a52-7f6e-4c2a-9a1c-3f9e8d7c6b00',
        total_tokens: '999999999999999999999999999999'
      })
    ]

    const response = await GET(
      request(
        'from=2026-08-20&to=2026-08-23&timezone=Asia%2FManila&userId=99'
      )
    )
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body.totals.totalTokens).toBe('90071992547409931234567950')
    expect(body.totals.storedCostUsd).toBe('123456789012345678.123456')
    expect(body.dailyTrend).toHaveLength(4)
    expect(body.keys).toMatchObject({ status: 'active', total: 1, active: 1 })
    expect(serialized).not.toContain(CLIENT_ID)
    expect(serialized).not.toContain('999999999999999999999999999999')

    const keySelect = state.calls.find((call) => call.table === 'agent_api_keys')
    expect(keySelect?.columns).toBe('revoked_at, expires_at')

    for (const call of state.calls) {
      expect(call.columns).not.toBe('*')
      expect(call.columns).not.toContain('key_hash')
      expect(call.columns).not.toContain('last_used_at')
      expect(call.filters).toContainEqual(['eq', 'user_id', USER_ID])
    }
  })

  it('rejects invalid timezone and oversized source-day ranges without data reads', async () => {
    const badZone = await GET(request('timezone=Mars%2FOlympus_Mons'))
    const tooWide = await GET(
      request('from=2024-01-01&to=2025-01-01&timezone=UTC')
    )

    expect(badZone.status).toBe(400)
    expect(tooWide.status).toBe(400)
    expect(badZone.headers.get('cache-control')).toBe('private, no-store')
    expect(state.calls).toHaveLength(0)
  })

  it('passes through session auth failures with no-store headers', async () => {
    sessionMock.mockResolvedValueOnce({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(state.calls).toHaveLength(0)
  })

  it('returns a shaped no-key/no-data state', async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      availableBounds: null,
      keys: { status: 'none', total: 0 },
      activeDays: 0,
      hasData: false,
      sync: { lastSyncedAt: null, freshness: 'never' }
    })
    expect(body.dailyTrend).toHaveLength(4)
  })

  it('returns a retryable endpoint failure without leaking backend details', async () => {
    state.failTable = 'agent_usage_daily'
    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Failed to load token usage'
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
