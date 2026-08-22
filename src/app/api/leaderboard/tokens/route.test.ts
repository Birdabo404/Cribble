import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchSeasonMock, rpcMock } = vi.hoisted(() => ({
  fetchSeasonMock: vi.fn(),
  rpcMock: vi.fn()
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({ rpc: rpcMock })
}))

vi.mock('@/lib/seasonServer', () => ({
  fetchSeasonState: fetchSeasonMock
}))

import { GET } from './route'

const season = {
  phase: 'active' as const,
  current: {
    id: 4,
    number: 4,
    name: 'Season 4',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-09-01T00:00:00.000Z',
    status: 'active' as const
  },
  next: null
}

function request(window?: string) {
  const suffix = window === undefined ? '' : `?window=${encodeURIComponent(window)}`
  return new NextRequest(`https://cribble.dev/api/leaderboard/tokens${suffix}`)
}

beforeEach(() => {
  fetchSeasonMock.mockReset()
  fetchSeasonMock.mockResolvedValue(season)
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [], error: null })
})

describe('GET /api/leaderboard/tokens', () => {
  it('uses the current season window and returns normalized rankings', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          user_id: 8,
          username: 'spender',
          display_name: 'Spender',
          profile_image: null,
          input_tokens: '8000000',
          output_tokens: '1000000',
          cache_creation_tokens: '0',
          cache_read_tokens: '1000000',
          total_tokens: '10000000',
          cost_usd: '123.45',
          active_days: '5',
          client_count: '1',
          agents: ['claude-code'],
          models: ['opus'],
          last_synced_at: '2026-08-22T01:00:00.000Z'
        }
      ],
      error: null
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0')
    expect(rpcMock).toHaveBeenCalledWith('agent_token_leaderboard', {
      p_since: '2026-08-01',
      p_until: '2026-08-31'
    })
    expect(body).toMatchObject({
      success: true,
      schemaReady: true,
      window: { id: 'season', label: 'SEASON 4' },
      totals: { pilots: 1, totalTokens: 10_000_000, burnUsd: 123.45 },
      rows: [{ rank: 1, username: 'spender', persona: { id: 'whale' } }]
    })
    expect(body.generatedAt).toEqual(expect.any(String))
  })

  it('rejects unknown windows before touching the database', async () => {
    const response = await GET(request('30d'))

    expect(response.status).toBe(400)
    expect(fetchSeasonMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns a marked empty preview before the migration exists', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find public.agent_token_leaderboard' }
    })

    const response = await GET(request('7d'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      schemaReady: false,
      rows: [],
      totals: { pilots: 0, totalTokens: 0, burnUsd: 0 }
    })
  })

  it('does not disguise ordinary database failures as an empty board', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'database down' } })

    const response = await GET(request('all'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ success: false, error: 'Failed to load the token leaderboard' })
  })
})
