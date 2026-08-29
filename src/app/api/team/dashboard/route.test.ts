import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The command deck's gate semantics: GET and PATCH are tier-gated but
// NOT approval-gated — a team still under review sees its deck and may
// pre-set the OPEN ROSTER lamp. What's under test is the gate → HTTP
// mapping and PATCH's guarded write; the board assembly is mocked (its
// math lives in teamLeaderboard's own tests).

const { sessionMock, boardMock, seatUsageMock, state } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  boardMock: vi.fn(),
  seatUsageMock: vi.fn(),
  state: {
    caller: null as Record<string, unknown> | null,
    userUpdates: [] as Record<string, unknown>[],
    userUpdateFilters: {} as Record<string, unknown>
  }
}))

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: sessionMock }))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({
    success: true,
    limit: 60,
    remaining: 59,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers(),
  rateLimitConfigs: { api: { windowMs: 60_000, maxRequests: 60 } }
}))

vi.mock('@/lib/teams', () => ({
  TEAM_SEAT_LIMIT: 10,
  getTeamSeatUsage: seatUsageMock
}))

vi.mock('@/lib/teamBoardServer', () => ({ assembleTeamBoard: boardMock }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          // Caller lookup terminal (GET's direct read + PATCH's loadUserRow).
          maybeSingle: () => Promise.resolve({ data: state.caller, error: null }),
          update: (values: Record<string, unknown>) => {
            state.userUpdates.push(values)
            // Reference, not copy: the eq() that follows lands here.
            state.userUpdateFilters = filters
            return builder
          },
          // PATCH's update chain ends on a bare awaited eq().
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
        }
        return builder
      }
      if (table === 'team_affiliations') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => Promise.resolve({ data: [], error: null })
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { GET, PATCH } from './route'

const TEAM_CALLER = {
  id: 7,
  twitter_username: 'acme',
  twitter_name: 'ACME Corp',
  twitter_profile_image: null,
  subscription_tier: 'TEAM',
  team_review_status: 'pending',
  status: 'active',
  team_recruiting: true
}

const getRequest = () => new NextRequest('https://cribble.dev/api/team/dashboard')
const patchRequest = (body: unknown) =>
  new NextRequest('https://cribble.dev/api/team/dashboard', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })

beforeEach(() => {
  sessionMock.mockReset()
  sessionMock.mockResolvedValue({ ok: true, userId: 7 })
  boardMock.mockReset()
  boardMock.mockResolvedValue({
    rows: [],
    totals: { teams: 0, members: 0, topScore: 0, burnUsd: '0', burnPilots: 0 },
    season: { current: null }
  })
  seatUsageMock.mockReset()
  seatUsageMock.mockResolvedValue(3)
  state.caller = { ...TEAM_CALLER }
  state.userUpdates = []
  state.userUpdateFilters = {}
})

describe('GET /api/team/dashboard — tier gate', () => {
  it('401s a signed-out caller', async () => {
    sessionMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await GET(getRequest())

    expect(response.status).toBe(401)
  })

  it('403s a non-team caller — the hub falls through to the public board on this', async () => {
    state.caller = { ...TEAM_CALLER, subscription_tier: 'PRO' }

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Team accounts only' })
    expect(boardMock).not.toHaveBeenCalled()
  })

  it('answers for a TEAM caller still under review — the deck renders pre-approval', async () => {
    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reviewStatus: 'pending',
      approved: false,
      recruiting: true
    })
  })
})

describe('PATCH /api/team/dashboard — the OPEN ROSTER lamp', () => {
  it('flips the lamp for a TEAM caller (approval not required)', async () => {
    const response = await PATCH(patchRequest({ recruiting: false }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, recruiting: false })
    expect(state.userUpdates).toEqual([{ team_recruiting: false }])
    expect(state.userUpdateFilters).toEqual({ id: 7 })
  })

  it('403s a non-team caller without writing', async () => {
    state.caller = { ...TEAM_CALLER, subscription_tier: 'FREE' }

    const response = await PATCH(patchRequest({ recruiting: true }))

    expect(response.status).toBe(403)
    expect(state.userUpdates).toHaveLength(0)
  })

  it('400s a body outside the schema', async () => {
    const response = await PATCH(patchRequest({ recruiting: 'open' }))

    expect(response.status).toBe(400)
    expect(state.userUpdates).toHaveLength(0)
  })
})
