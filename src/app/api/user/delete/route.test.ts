import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, sessionMock, supabaseMock } = vi.hoisted(() => {
  const state = {
    operations: [] as Array<{
      table: string
      op: 'delete' | 'update'
      filters: Array<[string, unknown]>
      values?: Record<string, unknown>
    }>
  }

  function from(table: string) {
    const operation: {
      table: string
      op: 'delete' | 'update'
      filters: Array<[string, unknown]>
      values?: Record<string, unknown>
    } = { table, op: 'delete', filters: [] }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      delete: () => {
        operation.op = 'delete'
        return builder
      },
      update: (values: Record<string, unknown>) => {
        operation.op = 'update'
        operation.values = values
        return builder
      },
      eq: (column: string, value: unknown) => {
        operation.filters.push([column, value])
        return builder
      },
      or: (value: string) => {
        operation.filters.push(['or', value])
        return builder
      },
      ilike: (column: string, value: string) => {
        operation.filters.push([column, value])
        return builder
      },
      then: (resolve: any, reject: any) => {
        state.operations.push({ ...operation, filters: [...operation.filters] })
        return Promise.resolve({ data: null, error: null, count: 0 }).then(resolve, reject)
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder
  }

  const sessionMock = vi.fn()
  return { state, sessionMock, supabaseMock: { from } }
})

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => supabaseMock
}))

vi.mock('@/lib/sessionAuth', () => ({
  getSessionUserId: sessionMock
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { auth: { windowMs: 900_000, maxRequests: 5 } },
  checkRateLimit: () => ({
    success: true,
    limit: 5,
    remaining: 4,
    resetTime: Date.now() + 900_000
  }),
  createRateLimitResponse: () => new Headers()
}))

vi.mock('@/lib/eventsIdentity', () => ({
  applyEventsUserEq: vi.fn(
    async (_supabase: unknown, query: { eq: (column: string, value: unknown) => unknown }, userId: number) => ({
      query: query.eq('user_id', userId),
      column: 'user_id'
    })
  ),
  toCompatUserUuid: (userId: number) => `compat-${userId}`
}))

import { DELETE } from './route'

const USER_ID = 42

beforeEach(() => {
  state.operations = []
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: USER_ID })
})

describe('DELETE /api/user/delete — agent data', () => {
  it('deletes agent keys, daily usage, and sharing with an explicit current-user filter', async () => {
    const request = new NextRequest('https://cribble.dev/api/user/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' })
    })

    const response = await DELETE(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)

    for (const table of ['agent_api_keys', 'agent_usage_daily', 'agent_usage_sharing']) {
      const operations = state.operations.filter((operation) => operation.table === table)
      expect(operations).toEqual([
        expect.objectContaining({
          table,
          op: 'delete',
          filters: [['user_id', USER_ID]]
        })
      ])
    }
  })
})
