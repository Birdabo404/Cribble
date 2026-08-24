import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchSeasonMock, rpcMock, affiliatedTeamsMock, hydration } = vi.hoisted(() => ({
  fetchSeasonMock: vi.fn(),
  rpcMock: vi.fn(),
  affiliatedTeamsMock: vi.fn(),
  hydration: {
    tierRows: [] as { id: number; subscription_tier: string | null }[],
    tierError: null as { message: string } | null
  }
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    rpc: rpcMock,
    // Identity hydration PostgREST chain: from('users').select(...).in(...)
    from: (table: string) => {
      if (table !== 'users') throw new Error(`Unexpected table: ${table}`)
      const builder = {
        select: () => builder,
        in: () =>
          Promise.resolve({ data: hydration.tierRows, error: hydration.tierError })
      }
      return builder
    }
  })
}))

vi.mock('@/lib/seasonServer', () => ({
  fetchSeasonState: fetchSeasonMock
}))

vi.mock('@/lib/teams', () => ({
  getAffiliatedTeamsBatch: affiliatedTeamsMock
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

function request(window?: string, timezone?: string) {
  const params = new URLSearchParams()
  if (window !== undefined) params.set('window', window)
  if (timezone !== undefined) params.set('timezone', timezone)
  const suffix = params.size === 0 ? '' : `?${params}`
  return new NextRequest(`https://cribble.dev/api/leaderboard/tokens${suffix}`)
}

beforeEach(() => {
  fetchSeasonMock.mockReset()
  fetchSeasonMock.mockResolvedValue(season)
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [], error: null })
  affiliatedTeamsMock.mockReset()
  affiliatedTeamsMock.mockResolvedValue(new Map())
  hydration.tierRows = []
  hydration.tierError = null
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
          last_synced_at: '2026-08-22T01:00:00.000Z',
          top_agent: 'claude-code',
          top_agent_days: '5',
          top_model: 'claude-opus-4-1',
          top_model_days: '4'
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
      p_until: '2026-08-31',
      p_timezone: 'UTC',
      p_since_at: '2026-08-01T00:00:00.000Z',
      p_until_at: '2026-09-01T00:00:00.000Z'
    })
    expect(body).toMatchObject({
      success: true,
      schemaReady: true,
      window: { id: 'season', label: 'SEASON 4' },
      totals: { pilots: 1, totalTokens: '10000000', burnUsd: '123.45' },
      rows: [
        {
          rank: 1,
          username: 'spender',
          topAgent: 'claude-code',
          topAgentDays: 5,
          topModel: 'claude-opus-4-1',
          topModelDays: 4,
          persona: { id: 'whale' }
        }
      ]
    })
    expect(body.generatedAt).toEqual(expect.any(String))
  })

  it('rejects unknown windows before touching the database', async () => {
    const response = await GET(request('30d'))

    expect(response.status).toBe(400)
    expect(fetchSeasonMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('passes a validated viewer timezone and rejects unknown zones', async () => {
    const valid = await GET(request('all', 'Asia/Manila'))
    expect(valid.status).toBe(200)
    expect(rpcMock).toHaveBeenLastCalledWith(
      'agent_token_leaderboard',
      expect.objectContaining({ p_timezone: 'Asia/Manila' })
    )

    rpcMock.mockClear()
    const invalid = await GET(request('all', 'Mars/Olympus_Mons'))
    expect(invalid.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('falls back to the deployed two-argument RPC while migration 047 is pending', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function with these arguments' }
      })
      .mockResolvedValueOnce({
        data: [
          {
            user_id: 8,
            username: 'birdabo',
            display_name: 'Birdabo',
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
            last_synced_at: '2026-08-22T01:00:00.000Z',
            top_agent: 'claude-code',
            top_agent_days: '5',
            top_model: 'claude-opus-4-1',
            top_model_days: '4'
          }
        ],
        error: null
      })

    const response = await GET(request('all', 'Asia/Manila'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenNthCalledWith(1, 'agent_token_leaderboard', {
      p_since: null,
      p_until: null,
      p_timezone: 'Asia/Manila',
      p_since_at: null,
      p_until_at: null
    })
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'agent_token_leaderboard', {
      p_since: null,
      p_until: null
    })
    expect(body).toMatchObject({
      success: true,
      schemaReady: true,
      totals: { pilots: 1, totalTokens: '10000000', burnUsd: '123.45' },
      rows: [{ username: 'birdabo' }]
    })
  })

  it('returns a marked empty preview when neither RPC schema exists', async () => {
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
      totals: { pilots: 0, totalTokens: '0', burnUsd: '0' }
    })
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })

  it('does not disguise ordinary database failures as an empty board', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'database down' } })

    const response = await GET(request('all'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ success: false, error: 'Failed to load the token leaderboard' })
  })

  const burnRow = (userId: number, username: string, costUsd: string) => ({
    user_id: userId,
    username,
    display_name: username,
    profile_image: null,
    input_tokens: '1000000',
    output_tokens: '1000000',
    cache_creation_tokens: '0',
    cache_read_tokens: '0',
    total_tokens: '2000000',
    cost_usd: costUsd,
    active_days: '3',
    client_count: '1',
    agents: ['claude-code'],
    models: ['opus'],
    last_synced_at: '2026-08-22T01:00:00.000Z'
  })

  it('hydrates Pro tier and team affiliation without disturbing rank order', async () => {
    // The Pro affiliate burns LESS — hydration must decorate, never re-rank.
    rpcMock.mockResolvedValue({
      data: [burnRow(9, 'freeloader', '200'), burnRow(8, 'proaffiliate', '100')],
      error: null
    })
    hydration.tierRows = [{ id: 8, subscription_tier: 'PRO' }]
    affiliatedTeamsMock.mockResolvedValue(
      new Map([
        [
          8,
          { teamUserId: 3, username: 'acme', name: 'ACME Corp', avatar: 'https://cdn/acme.png' }
        ]
      ])
    )

    const response = await GET(request('all'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(affiliatedTeamsMock).toHaveBeenCalledWith(expect.anything(), [9, 8])
    expect(body.rows).toHaveLength(2)
    expect(body.rows[0]).toMatchObject({
      rank: 1,
      userId: 9,
      username: 'freeloader',
      tier: null,
      team: null
    })
    expect(body.rows[1]).toMatchObject({
      rank: 2,
      userId: 8,
      username: 'proaffiliate',
      tier: 'PRO',
      team: { username: 'acme', name: 'ACME Corp', logo: 'https://cdn/acme.png' }
    })
  })

  it('degrades identity hydration failures to nulls instead of sinking the board', async () => {
    rpcMock.mockResolvedValue({ data: [burnRow(8, 'spender', '100')], error: null })
    hydration.tierError = { message: 'users table unavailable' }
    affiliatedTeamsMock.mockRejectedValue(new Error('affiliations unavailable'))

    const response = await GET(request('all'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.rows[0]).toMatchObject({ username: 'spender', tier: null, team: null })
  })
})
