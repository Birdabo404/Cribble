import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The public recruitment board rides the SAME assembled pipeline as the
// TEAMS leaderboard (approved live teams only — that scoping lives in
// assembleTeamBoard, mocked here), so what's under test is the
// decoration: seat meters counted over pending + active rows scoped to
// the board's teams, the recruiting lamp defaulting to open, the hiring
// bar riding each row (null when the team sets no metric — the payload
// stays viewer-agnostic, stamps live on the authed apply GET), and the
// cache headers that make the anonymous read cheap.

const { boardMock, state } = vi.hoisted(() => ({
  boardMock: vi.fn(),
  state: {
    seatRows: [] as { team_user_id: number; status: string }[],
    seatFilters: {} as Record<string, unknown>,
    lampRows: [] as {
      id: number
      team_recruiting: boolean | null
      team_req_min_score?: number | null
      team_req_min_tokens?: number | null
      team_req_min_burn_usd?: number | null
    }[],
    lampFilters: {} as Record<string, unknown>
  }
}))

// unstable_cache needs the Next runtime; in tests the passthrough keeps
// the handler's behavior observable per call.
vi.mock('next/cache', () => ({
  unstable_cache: <T>(fn: T) => fn
}))

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

vi.mock('@/lib/teams', () => ({ TEAM_SEAT_LIMIT: 10 }))

vi.mock('@/lib/teamBoardServer', () => ({ assembleTeamBoard: boardMock }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'team_affiliations') {
        const builder = {
          select: () => builder,
          in: (column: string, values: unknown) => {
            state.seatFilters[column] = values
            return builder
          },
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve({ data: state.seatRows, error: null }).then(
              onFulfilled,
              onRejected
            )
        }
        return builder
      }
      if (table === 'users') {
        const builder = {
          select: () => builder,
          in: (column: string, values: unknown) => {
            state.lampFilters[column] = values
            return builder
          },
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve({ data: state.lampRows, error: null }).then(
              onFulfilled,
              onRejected
            )
        }
        return builder
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { GET } from './route'

const boardRow = (userId: number, rank: number, username: string) => ({
  userId,
  rank,
  username,
  display_name: username.toUpperCase(),
  profile_image: null,
  score: 1000 - rank,
  memberCount: 2,
  burnUsd: '0',
  burnPilots: 0,
  members: []
})

const getRequest = () => new NextRequest('https://cribble.dev/api/teams/directory')

beforeEach(() => {
  boardMock.mockReset()
  boardMock.mockResolvedValue({
    rows: [boardRow(7, 1, 'acme'), boardRow(8, 2, 'globex')],
    totals: { teams: 2, members: 4, topScore: 999, burnUsd: '0', burnPilots: 0 },
    season: { current: null }
  })
  state.seatRows = []
  state.seatFilters = {}
  state.lampRows = []
  state.lampFilters = {}
})

describe('GET /api/teams/directory', () => {
  it('returns exactly the board pipeline\'s teams, decorated with seats and the lamp', async () => {
    // Two pending/active rows for team 7; team 8 holds none. Team 8's
    // lamp is explicitly off; team 7 has no lamp row (defaults open).
    state.seatRows = [
      { team_user_id: 7, status: 'active' },
      { team_user_id: 7, status: 'pending' }
    ]
    state.lampRows = [{ id: 8, team_recruiting: false }]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.teams).toEqual([
      expect.objectContaining({
        userId: 7,
        rank: 1,
        username: 'acme',
        seatsUsed: 2,
        seatLimit: 10,
        openSeats: 8,
        recruiting: true
      }),
      expect.objectContaining({
        userId: 8,
        rank: 2,
        username: 'globex',
        seatsUsed: 0,
        openSeats: 10,
        recruiting: false
      })
    ])
    expect(body.totals).toEqual({ teams: 2, members: 4, topScore: 999 })
  })

  it('carries each team\'s hiring bar — null when no metric is set', async () => {
    // Team 7 publishes score + burn thresholds (tokens off); team 8's
    // lamp row holds no thresholds at all, and a team with no users row
    // whatsoever would read the same null.
    state.lampRows = [
      {
        id: 7,
        team_recruiting: true,
        team_req_min_score: 50_000,
        team_req_min_tokens: null,
        team_req_min_burn_usd: 1000
      },
      {
        id: 8,
        team_recruiting: true,
        team_req_min_score: null,
        team_req_min_tokens: null,
        team_req_min_burn_usd: null
      }
    ]

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.teams).toEqual([
      expect.objectContaining({
        userId: 7,
        bar: { minScore: 50_000, minTokens: null, minBurnUsd: 1000 }
      }),
      expect.objectContaining({ userId: 8, bar: null })
    ])
  })

  it('scopes the decoration queries to the board\'s (approved-only) team ids', async () => {
    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    // Seats count pending + active only — applications are seatless.
    expect(state.seatFilters).toEqual({
      team_user_id: [7, 8],
      status: ['pending', 'active']
    })
    expect(state.lampFilters).toEqual({ id: [7, 8] })
  })

  it('sends the 60s CDN caching header, mirroring the leaderboard twin', async () => {
    const response = await GET(getRequest())

    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=120'
    )
  })

  it('500s when the pipeline throws — never a board from guessed inputs', async () => {
    boardMock.mockRejectedValue(new Error('teams query failed'))

    const response = await GET(getRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
