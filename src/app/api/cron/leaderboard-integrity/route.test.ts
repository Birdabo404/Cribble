import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  rpcMock,
  fetchMock,
  alertMock,
  snapshotState
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fetchMock: vi.fn(),
  alertMock: vi.fn(),
  snapshotState: {
    rows: [] as Array<{ user_id: number; rank: number; score: number }>
  }
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    rpc: rpcMock,
    from: (table: string) => {
      if (table === 'billboard_ads') {
        // The piggybacked sponsor sweep's eligibility read — served
        // empty so the sweep no-ops here; its real behavior is covered
        // in leaderboardSponsorServer.test.ts.
        const sweepBuilder = {
          select: () => sweepBuilder,
          eq: () => sweepBuilder,
          then: (
            onFulfilled: (value: { data: never[]; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
        }
        return sweepBuilder
      }
      if (table !== 'leaderboard_ranks') {
        throw new Error(`Unexpected table: ${table}`)
      }
      const builder = {
        select: () => builder,
        order: async () => ({ data: snapshotState.rows, error: null })
      }
      return builder
    }
  })
}))

vi.mock('@/lib/leaderboardIntegrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/leaderboardIntegrity')>()
  return {
    ...actual,
    alertLeaderboardIntegrity: alertMock
  }
})

import { GET } from './route'

function canonical(userId: number, rank: number, score: number) {
  return { user_id: userId, rank, score }
}

function api(userId: number, rank: number, score: number) {
  return { userId, rank, score }
}

function request(secret = 'test-cron-secret') {
  return new NextRequest(
    'https://cribble.dev/api/cron/leaderboard-integrity',
    { headers: { authorization: `Bearer ${secret}` } }
  )
}

function apiResponse(rows: Array<ReturnType<typeof api>>) {
  return new Response(JSON.stringify({ success: true, data: rows }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  rpcMock.mockReset()
  fetchMock.mockReset()
  alertMock.mockReset()
  alertMock.mockResolvedValue(undefined)
  snapshotState.rows = []
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('GET /api/cron/leaderboard-integrity', () => {
  it('returns healthy when the API leader and canonical ranker agree', async () => {
    rpcMock.mockResolvedValue({
      data: [canonical(8, 1, 5000), canonical(9, 2, 4000)],
      error: null
    })
    snapshotState.rows = [
      canonical(8, 1, 5000),
      canonical(9, 2, 4000)
    ]
    fetchMock.mockImplementation(async () =>
      apiResponse([api(8, 1, 5000), api(9, 2, 4000)])
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      healthy: true,
      playersChecked: 2
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/api/leaderboard',
        search: '?board=alltime&integrity=1'
      }),
      expect.objectContaining({
        headers: { 'x-cron-secret': 'test-cron-secret' },
        cache: 'no-store'
      })
    )
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('confirms and alerts on a persistent wrong leader or duplicate rank', async () => {
    rpcMock.mockResolvedValue({
      data: [canonical(8, 1, 5000), canonical(9, 2, 4000)],
      error: null
    })
    snapshotState.rows = [
      canonical(8, 1, 5000),
      canonical(9, 1, 4000)
    ]
    fetchMock.mockImplementation(async () =>
      apiResponse([api(9, 1, 4000), api(8, 2, 5000)])
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(body.issues.map((issue: { code: string }) => issue.code)).toEqual([
      'top_mismatch',
      'duplicate_snapshot_ranks'
    ])
    expect(alertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ healthy: false }),
      expect.any(Date)
    )
  })

  it('rejects requests without the cron secret', async () => {
    const response = await GET(request('wrong-secret'))

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
