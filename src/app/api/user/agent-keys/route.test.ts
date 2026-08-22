import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashAgentApiKey } from '@/lib/agentKey'

interface AgentKeyRow {
  id: number
  user_id: number
  key_hash: string
  key_prefix: string
  label: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

const { state, rateLimitMock, sessionMock, supabaseMock } = vi.hoisted(() => {
  const state = {
    rows: [] as AgentKeyRow[],
    nextId: 1,
    insertedValues: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{
      values: Record<string, unknown>
      filters: Array<[string, unknown]>
    }>
  }

  interface QueryContext {
    table: string
    op: 'select' | 'insert' | 'update'
    filters: Array<[string, unknown]>
    nullFilters: string[]
    columns?: string
    head?: boolean
    values?: Record<string, unknown>
    descending?: boolean
  }

  const matches = (row: AgentKeyRow, ctx: QueryContext) =>
    ctx.filters.every(([column, value]) => {
      const actual = row[column as keyof AgentKeyRow]
      return typeof actual === 'number' ? actual === Number(value) : actual === value
    }) && ctx.nullFilters.every((column) => row[column as keyof AgentKeyRow] === null)

  const project = (row: AgentKeyRow, columns?: string) => {
    if (!columns || columns === '*') return { ...row }
    return Object.fromEntries(
      columns.split(',').map((column) => {
        const key = column.trim() as keyof AgentKeyRow
        return [key, row[key]]
      })
    )
  }

  function resolveQuery(ctx: QueryContext) {
    if (ctx.table !== 'agent_api_keys') {
      return { data: null, error: { message: `Unexpected table: ${ctx.table}` } }
    }

    if (ctx.op === 'insert') {
      const values = ctx.values ?? {}
      state.insertedValues.push({ ...values })
      const row: AgentKeyRow = {
        id: state.nextId++,
        user_id: Number(values.user_id),
        key_hash: String(values.key_hash),
        key_prefix: String(values.key_prefix),
        label: String(values.label),
        created_at: '2026-08-22T01:00:00.000Z',
        last_used_at: null,
        revoked_at: null
      }
      state.rows.push(row)
      return { data: project(row, ctx.columns), error: null }
    }

    const filtered = state.rows.filter((row) => matches(row, ctx))

    if (ctx.op === 'update') {
      state.updates.push({ values: { ...(ctx.values ?? {}) }, filters: [...ctx.filters] })
      filtered.forEach((row) => Object.assign(row, ctx.values))
      return { data: null, error: null }
    }

    if (ctx.head) {
      return { data: null, error: null, count: filtered.length }
    }

    const ordered = ctx.descending
      ? [...filtered].sort((left, right) => right.created_at.localeCompare(left.created_at))
      : filtered
    return { data: ordered.map((row) => project(row, ctx.columns)), error: null }
  }

  function from(table: string) {
    const ctx: QueryContext = {
      table,
      op: 'select',
      filters: [],
      nullFilters: []
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      select: (columns: string, options?: { head?: boolean }) => {
        ctx.columns = columns
        ctx.head = options?.head === true
        return builder
      },
      insert: (values: Record<string, unknown>) => {
        ctx.op = 'insert'
        ctx.values = values
        return builder
      },
      update: (values: Record<string, unknown>) => {
        ctx.op = 'update'
        ctx.values = values
        return builder
      },
      eq: (column: string, value: unknown) => {
        ctx.filters.push([column, value])
        return builder
      },
      is: (column: string, value: unknown) => {
        if (value === null) ctx.nullFilters.push(column)
        return builder
      },
      order: (_column: string, options?: { ascending?: boolean }) => {
        ctx.descending = options?.ascending === false
        return builder
      },
      maybeSingle: async () => {
        const result = resolveQuery(ctx)
        const rows = result.data as unknown[] | null
        return { ...result, data: rows?.[0] ?? null }
      },
      single: async () => resolveQuery(ctx),
      then: (resolve: any, reject: any) =>
        Promise.resolve(resolveQuery(ctx)).then(resolve, reject)
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder
  }

  const sessionMock = vi.fn()
  const rateLimitMock = vi.fn()
  const supabaseMock = { from }
  return { state, rateLimitMock, sessionMock, supabaseMock }
})

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => supabaseMock
}))

vi.mock('@/lib/sessionAuth', () => ({
  getSessionUserId: sessionMock
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { auth: { windowMs: 900_000, maxRequests: 5 } },
  checkRateLimit: rateLimitMock,
  createRateLimitResponse: () => new Headers()
}))

import { DELETE, GET, POST } from './route'

const USER_ID = 42
const OTHER_USER_ID = 99

function addKey(
  userId = USER_ID,
  overrides: Partial<AgentKeyRow> = {}
): AgentKeyRow {
  const id = overrides.id ?? state.nextId++
  const plaintext = `crib_ag_${id.toString(16).padStart(64, '0')}`
  const row: AgentKeyRow = {
    id,
    user_id: userId,
    key_hash: hashAgentApiKey(plaintext),
    key_prefix: plaintext.slice(0, 12),
    label: `Key ${id}`,
    created_at: `2026-08-22T00:00:${String(id).padStart(2, '0')}.000Z`,
    last_used_at: null,
    revoked_at: null,
    ...overrides
  }
  state.rows.push(row)
  return row
}

function request(method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
  return new NextRequest('https://cribble.dev/api/user/agent-keys', {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
  })
}

beforeEach(() => {
  state.rows = []
  state.nextId = 1
  state.insertedValues = []
  state.updates = []
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: USER_ID })
  rateLimitMock.mockReset()
  rateLimitMock.mockReturnValue({
    success: true,
    limit: 5,
    remaining: 4,
    resetTime: Date.now() + 900_000
  })
})

describe('POST /api/user/agent-keys', () => {
  it('returns plaintext once and stores only its hash', async () => {
    const response = await POST(request('POST', { label: '\u0000 Studio\n Mac \u007f' }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual({
      success: true,
      key: expect.stringMatching(/^crib_ag_[0-9a-f]{64}$/),
      prefix: expect.stringMatching(/^crib_ag_[0-9a-f]{4}$/),
      label: 'Studio Mac',
      id: 1,
      createdAt: '2026-08-22T01:00:00.000Z'
    })
    expect(state.insertedValues).toHaveLength(1)
    expect(state.insertedValues[0]).toEqual({
      user_id: USER_ID,
      key_hash: hashAgentApiKey(body.key),
      key_prefix: body.prefix,
      label: 'Studio Mac'
    })
    expect(state.insertedValues[0]).not.toHaveProperty('key')
  })

  it('rejects creation when five active keys already exist', async () => {
    for (let index = 0; index < 5; index += 1) addKey()
    addKey(USER_ID, { revoked_at: '2026-08-20T00:00:00.000Z' })

    const response = await POST(request('POST', { label: 'Sixth active key' }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.success).toBe(false)
    expect(state.insertedValues).toHaveLength(0)
  })

  it('strictly rejects unknown fields and labels empty after cleaning', async () => {
    const unknownField = await POST(
      request('POST', { label: 'Studio Mac', extra: 'not allowed' })
    )
    const emptyLabel = await POST(request('POST', { label: '\u0000\n\t' }))

    expect(unknownField.status).toBe(400)
    expect(emptyLabel.status).toBe(400)
    expect(state.insertedValues).toHaveLength(0)
  })
})

describe('GET /api/user/agent-keys', () => {
  it('lists only the current user and never leaks a hash or plaintext', async () => {
    const own = addKey(USER_ID, {
      label: 'Studio Mac',
      last_used_at: '2026-08-22T02:00:00.000Z'
    })
    addKey(OTHER_USER_ID, { label: 'Someone else' })

    const response = await GET(request('GET'))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      keys: [
        {
          id: own.id,
          prefix: own.key_prefix,
          label: 'Studio Mac',
          createdAt: own.created_at,
          lastUsedAt: '2026-08-22T02:00:00.000Z',
          revokedAt: null
        }
      ]
    })
    expect(serialized).not.toContain('key_hash')
    expect(serialized).not.toContain(own.key_hash)
    expect(serialized).not.toContain('crib_ag_0000000000000000000000000000000000000000000000000000000000000001')
  })
})

describe('DELETE /api/user/agent-keys', () => {
  it('revokes an owned key and treats a repeated revoke as a successful no-op', async () => {
    const key = addKey()

    const first = await DELETE(request('DELETE', { id: key.id }))
    const firstRevokedAt = state.rows[0].revoked_at
    const second = await DELETE(request('DELETE', { id: key.id }))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ success: true })
    expect(firstRevokedAt).toMatch(/^2026-|^2027-/)
    expect(state.rows[0].revoked_at).toBe(firstRevokedAt)
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].filters).toEqual([
      ['id', key.id],
      ['user_id', USER_ID]
    ])
  })

  it('returns 403 for another user’s key without updating it', async () => {
    const foreign = addKey(OTHER_USER_ID)

    const response = await DELETE(request('DELETE', { id: foreign.id }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ success: false, error: 'Forbidden' })
    expect(state.updates).toHaveLength(0)
  })

  it('returns 404 for a missing key', async () => {
    const response = await DELETE(request('DELETE', { id: 404 }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Agent key not found'
    })
  })

  it('strictly rejects unknown fields', async () => {
    const key = addKey()
    const response = await DELETE(
      request('DELETE', { id: key.id, userId: OTHER_USER_ID })
    )

    expect(response.status).toBe(400)
    expect(state.updates).toHaveLength(0)
  })
})

describe('/api/user/agent-keys session handling', () => {
  it('preserves a session lookup failure as 503', async () => {
    sessionMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: 'Session lookup failed'
    })

    const response = await GET(request('GET'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Session lookup failed'
    })
  })
})
