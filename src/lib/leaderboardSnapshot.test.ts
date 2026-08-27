import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recordHypeMock, demotionMock } = vi.hoisted(() => ({
  recordHypeMock: vi.fn(),
  demotionMock: vi.fn()
}))

vi.mock('./hypeEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hypeEvents')>()
  return {
    ...actual,
    recordHypeEvents: recordHypeMock
  }
})

vi.mock('./notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notifications')>()
  return {
    ...actual,
    evaluateDemotionNotifications: demotionMock
  }
})

import { refreshLeaderboardSnapshot } from './leaderboardSnapshot'

const rpcMock = vi.fn()
const supabase = { rpc: rpcMock } as unknown as SupabaseClient

beforeEach(() => {
  rpcMock.mockReset()
  recordHypeMock.mockReset()
  recordHypeMock.mockResolvedValue(undefined)
  demotionMock.mockReset()
  demotionMock.mockResolvedValue(undefined)
})

describe('refreshLeaderboardSnapshot', () => {
  it('uses one transactional RPC and emits side effects from its committed movement rows', async () => {
    const refreshedAt = '2026-08-26T12:34:56.789+00:00'
    rpcMock.mockResolvedValue({
      data: [
        {
          user_id: 8,
          rank: 1,
          score: 5000,
          prev_rank: 2,
          rank_moved_at: refreshedAt,
          first_seen_at: '2026-07-01T00:00:00.000+00:00',
          updated_at: refreshedAt,
          refreshed_at: refreshedAt
        },
        {
          user_id: 9,
          rank: 2,
          score: 4900,
          prev_rank: 1,
          rank_moved_at: refreshedAt,
          first_seen_at: '2026-07-01T00:00:00.000+00:00',
          updated_at: refreshedAt,
          refreshed_at: refreshedAt
        }
      ],
      error: null
    })

    await refreshLeaderboardSnapshot(supabase)

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('refresh_leaderboard_snapshot')
    expect(demotionMock).toHaveBeenCalledWith(
      supabase,
      [{ userId: 9, fromRank: 1, toRank: 2 }],
      new Date(refreshedAt)
    )
    expect(recordHypeMock).toHaveBeenCalledWith(
      supabase,
      [
        expect.objectContaining({
          kind: 'throne',
          user_id: 8,
          rank: 1,
          prev_rank: 2,
          victim_user_id: 9
        })
      ]
    )
  })

  it('keeps sync successful when the snapshot RPC is unavailable', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'function is not deployed' }
    })

    await expect(refreshLeaderboardSnapshot(supabase)).resolves.toBeUndefined()
    expect(demotionMock).not.toHaveBeenCalled()
    expect(recordHypeMock).not.toHaveBeenCalled()
  })
})
