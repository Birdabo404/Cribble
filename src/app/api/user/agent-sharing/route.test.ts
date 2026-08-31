import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SharingRow {
  user_id: number
  leaderboard_enabled: boolean
  enabled_at: string | null
  updated_at: string
}

const { state, rateLimitMock, sessionMock, supabaseMock } = vi.hoisted(() => {
  const state = {
    row: null as SharingRow | null,
    error: null as { message: string } | null,
    upserts: [] as Array<Record<string, unknown>>
  }

  function from(table: string) {
    if (table !== 'agent_usage_sharing') throw new Error(`Unexpected table: ${table}`)
    let userId: number | null = null
    let upserted: Record<string, unknown> | null = null

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (column === 'user_id') userId = Number(value)
        return builder
      },
      upsert: (values: Record<string, unknown>) => {
        upserted = { ...values }
        state.upserts.push({ ...values })
        return builder
      },
      maybeSingle: async () => ({
        data: state.row && state.row.user_id === userId ? { ...state.row } : null,
        error: state.error
      }),
      single: async () => {
        if (state.error) return { data: null, error: state.error }
        if (!upserted) return { data: null, error: { message: 'Missing upsert' } }
        const row: SharingRow = {
          user_id: Number(upserted.user_id),
          leaderboard_enabled: upserted.leaderboard_enabled === true,
          enabled_at: typeof upserted.enabled_at === 'string' ? upserted.enabled_at : null,
          updated_at: String(upserted.updated_at)
        }
        state.row = row
        return { data: { ...row }, error: null }
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder
  }

  return {
    state,
    rateLimitMock: vi.fn(),
    sessionMock: vi.fn(),
    supabaseMock: { from }
  }
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
  createRateLimitResponse: () => new Headers({ 'Retry-After': '60' })
}))

// The route defers the burn-board snapshot refresh via after(), which
// requires a Next request scope vitest doesn't provide (the real one
// throws without it). Run the task immediately instead, same shim as
// the extension sync test; NextRequest/NextResponse stay real.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (task: Promise<unknown> | (() => unknown)) => {
      if (typeof task === 'function') void task()
    }
  }
})

vi.mock('@/lib/burnBoardSnapshot', () => ({
  refreshBurnBoardSnapshot: vi.fn(async () => undefined)
}))

import { GET, PUT } from './route'

const USER_ID = 42

function request(method: 'GET' | 'PUT', body?: unknown) {
  return new NextRequest('https://cribble.dev/api/user/agent-sharing', {
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
  state.row = null
  state.error = null
  state.upserts = []
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: USER_ID })
  rateLimitMock.mockReset()
  rateLimitMock.mockReturnValue({ success: true, limit: 5, remaining: 4, resetTime: Date.now() })
})

describe('GET /api/user/agent-sharing', () => {
  it('is private to the signed-in user', async () => {
    sessionMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await GET(request('GET'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('defaults to disabled when the user has never made a choice', async () => {
    const response = await GET(request('GET'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      enabled: false,
      enabledAt: null,
      updatedAt: null
    })
  })

  it('returns the persisted opt-in state', async () => {
    state.row = {
      user_id: USER_ID,
      leaderboard_enabled: true,
      enabled_at: '2026-08-22T01:00:00.000Z',
      updated_at: '2026-08-22T01:00:00.000Z'
    }

    const response = await GET(request('GET'))

    expect(await response.json()).toMatchObject({ success: true, enabled: true })
  })
})

describe('PUT /api/user/agent-sharing', () => {
  it('strictly rejects malformed choices', async () => {
    expect((await PUT(request('PUT', { enabled: 'yes' }))).status).toBe(400)
    expect((await PUT(request('PUT', { enabled: true, userId: 99 }))).status).toBe(400)
    expect(state.upserts).toHaveLength(0)
  })

  it('records explicit opt-in for only the session owner', async () => {
    const response = await PUT(request('PUT', { enabled: true }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, enabled: true })
    expect(body.enabledAt).toEqual(expect.any(String))
    expect(state.upserts).toHaveLength(1)
    expect(state.upserts[0]).toMatchObject({
      user_id: USER_ID,
      leaderboard_enabled: true,
      consent_version: 2
    })
    expect(state.upserts[0]).not.toHaveProperty('userId')
  })

  it('removes the public opt-in immediately when disabled', async () => {
    state.row = {
      user_id: USER_ID,
      leaderboard_enabled: true,
      enabled_at: '2026-08-22T01:00:00.000Z',
      updated_at: '2026-08-22T01:00:00.000Z'
    }

    const response = await PUT(request('PUT', { enabled: false }))
    const body = await response.json()

    expect(body).toMatchObject({ success: true, enabled: false, enabledAt: null })
    expect(state.upserts[0]).toMatchObject({
      user_id: USER_ID,
      leaderboard_enabled: false,
      enabled_at: null
    })
  })

  it('rate limits repeated sharing mutations', async () => {
    rateLimitMock.mockReturnValue({ success: false, limit: 5, remaining: 0, resetTime: Date.now() })

    const response = await PUT(request('PUT', { enabled: true }))

    expect(response.status).toBe(429)
    expect(sessionMock).not.toHaveBeenCalled()
    expect(state.upserts).toHaveLength(0)
  })

  it('does not claim success when persistence fails', async () => {
    state.error = { message: 'database down' }

    const response = await PUT(request('PUT', { enabled: true }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Failed to update token sharing'
    })
  })
})
