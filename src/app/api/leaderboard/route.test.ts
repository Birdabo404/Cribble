import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock, movementMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  movementMock: vi.fn()
}))

vi.mock('next/cache', () => ({
  unstable_cache:
    (loader: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      loader(...args)
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({ rpc: rpcMock })
}))

vi.mock('@/lib/seasonServer', () => ({
  fetchSeasonState: vi.fn(async () => ({
    phase: 'active',
    current: {
      id: 1,
      number: 1,
      name: 'SEASON 01',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-09-01T00:00:00.000Z',
      status: 'active'
    },
    next: null
  }))
}))

vi.mock('@/lib/leaderboardSnapshot', () => ({
  readRankMovements: movementMock
}))

vi.mock('@/lib/entitlements', () => ({
  getOwnedPlateIdsBatch: vi.fn(async () => new Map()),
  isProTier: vi.fn(() => false),
  resolveEquippedPlate: vi.fn(() => null)
}))

vi.mock('@/lib/teams', () => ({
  getAffiliatedTeamsBatch: vi.fn(async () => new Map())
}))

vi.mock('@/lib/publicProfile', () => ({
  isMissingFollowsTable: vi.fn(() => false),
  readAccountIsPrivate: vi.fn(() => false)
}))

vi.mock('@/lib/sessionAuth', () => ({
  getSessionUserId: vi.fn(async () => ({
    ok: false,
    status: 401,
    error: 'Unauthorized'
  }))
}))

vi.mock('@/lib/userStats', () => ({
  parseStoredTopTools: vi.fn(() => [])
}))

import { BOARD_LIMIT } from '@/lib/leaderboardEngine'
import { GET } from './route'

function scoreRow(userId: number, score: number) {
  return {
    user_id: userId,
    rank: 0,
    score,
    total_score: score,
    today_score: score,
    week_score: score,
    season_score: score,
    last_calculated_at: '2026-08-26T12:00:00.000Z',
    top_tools: [],
    twitter_username: `pilot${userId}`,
    twitter_name: `Pilot ${userId}`,
    twitter_profile_image: null,
    created_at: '2026-01-01T00:00:00.000Z',
    last_extension_sync: null,
    subscription_tier: 'FREE',
    user_type: null,
    metadata: {},
    device_last_sync_at: null
  }
}

beforeEach(() => {
  rpcMock.mockReset()
  movementMock.mockReset()
  movementMock.mockResolvedValue(new Map())
})

describe('GET /api/leaderboard', () => {
  it('serves every ranked player when the population exceeds 100 users', async () => {
    // The real leader is deliberately the 101st source row. The historical
    // users-first query limited this source to 100 parents before ordering
    // the embedded scores, which dropped this player entirely — and until
    // migration 060 the board itself truncated at 100, hiding everyone
    // ranked below.
    const source = Array.from({ length: 101 }, (_, index) => {
      const userId = index + 1
      return scoreRow(userId, userId === 101 ? 1_000_000 : 10_000 - userId)
    })

    rpcMock.mockImplementation(
      async (name: string, args: { p_board: string; p_limit: number }) => {
        if (name !== 'leaderboard_standings') {
          return { data: null, error: { message: `Unexpected RPC: ${name}` } }
        }
        const data = [...source]
          .sort((a, b) => b.score - a.score || a.user_id - b.user_id)
          .slice(0, args.p_limit)
          .map((row, index) => ({ ...row, rank: index + 1 }))
        return { data, error: null }
      }
    )

    const response = await GET(
      new NextRequest('https://cribble.dev/api/leaderboard?board=season')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('leaderboard_standings', {
      p_board: 'season',
      p_limit: BOARD_LIMIT
    })
    expect(body.data).toHaveLength(101)
    expect(body.data[0]).toMatchObject({
      userId: 101,
      username: 'pilot101',
      score: 1_000_000,
      rank: 1
    })
    // The weakest player is no longer pushed off the board by the 101st.
    expect(body.data.at(-1)).toMatchObject({ userId: 100, rank: 101 })
  })
})
