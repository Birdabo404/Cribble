import { describe, expect, it } from 'vitest'
import type { SeasonState } from '@/lib/season'
import {
  buildTokenBoard,
  parseTokenBoardWindow,
  resolveTokenBoardWindow,
  tokenPersona,
  tokenAgentLabel,
  tokenModelLabel,
  type TokenLeaderboardRpcRow
} from './tokenLeaderboard'

const ACTIVE_SEASON: SeasonState = {
  phase: 'active',
  current: {
    id: 4,
    number: 4,
    name: 'Season 4',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-09-01T00:00:00.000Z',
    status: 'active'
  },
  next: null
}

function usage(overrides: Partial<TokenLeaderboardRpcRow> = {}): TokenLeaderboardRpcRow {
  return {
    user_id: 1,
    username: 'birdabo',
    display_name: 'Birdabo',
    profile_image: null,
    input_tokens: 8_000_000,
    output_tokens: 1_000_000,
    cache_creation_tokens: 500_000,
    cache_read_tokens: 500_000,
    total_tokens: 10_000_000,
    cost_usd: 18.25,
    active_days: 4,
    client_count: 1,
    agents: ['claude-code'],
    models: ['opus'],
    last_synced_at: '2026-08-22T01:00:00.000Z',
    top_agent: 'claude-code',
    top_agent_days: 4,
    top_model: 'claude-opus-4-1',
    top_model_days: 3,
    ...overrides
  }
}

describe('token leaderboard windows', () => {
  it('defaults to season and rejects unknown values', () => {
    expect(parseTokenBoardWindow(null)).toBe('season')
    expect(parseTokenBoardWindow('')).toBe('season')
    expect(parseTokenBoardWindow('season')).toBe('season')
    expect(parseTokenBoardWindow('7d')).toBe('7d')
    expect(parseTokenBoardWindow('all')).toBe('all')
    expect(parseTokenBoardWindow('30d')).toBeNull()
  })

  it('uses inclusive UTC dates without leaking across the season boundary', () => {
    expect(resolveTokenBoardWindow('season', ACTIVE_SEASON)).toEqual({
      id: 'season',
      label: 'SEASON 4',
      since: '2026-08-01',
      until: '2026-08-31'
    })
    expect(resolveTokenBoardWindow('7d', ACTIVE_SEASON, Date.parse('2026-08-22T23:59:59Z'))).toEqual({
      id: '7d',
      label: 'LAST 7 DAYS',
      since: '2026-08-16',
      until: '2026-08-22'
    })
    expect(resolveTokenBoardWindow('all', ACTIVE_SEASON)).toEqual({
      id: 'all',
      label: 'ALL TIME',
      since: null,
      until: null
    })
  })

  it('returns an intentionally empty season window before a calendar exists', () => {
    expect(
      resolveTokenBoardWindow('season', { phase: 'intermission', current: null, next: null })
    ).toEqual({
      id: 'season',
      label: 'NO SEASON YET',
      since: '9999-12-31',
      until: '9999-12-31'
    })
  })
})

describe('token personas', () => {
  it('prioritizes dramatic spend over efficiency personas', () => {
    expect(
      tokenPersona({
        burnUsd: 600,
        totalTokens: 100_000_000,
        outputTokens: 20_000_000,
        cachePercent: 95,
        modelCount: 8
      }).id
    ).toBe('financial-incident')
  })

  it('recognizes efficient caching and output-heavy usage', () => {
    expect(
      tokenPersona({
        burnUsd: 10,
        totalTokens: 20_000_000,
        outputTokens: 500_000,
        cachePercent: 94,
        modelCount: 1
      }).id
    ).toBe('cache-goblin')
    expect(
      tokenPersona({
        burnUsd: 10,
        totalTokens: 2_000_000,
        outputTokens: 300_000,
        cachePercent: 40,
        modelCount: 1
      }).id
    ).toBe('output-demon')
  })
})

describe('token agent labels', () => {
  it('turns collector IDs into human-facing agent names', () => {
    expect(tokenAgentLabel('claude-code')).toBe('Claude Code')
    expect(tokenAgentLabel('openai_codex')).toBe('Codex')
    expect(tokenAgentLabel('gemini-cli')).toBe('Gemini CLI')
    expect(tokenAgentLabel('my-new-agent')).toBe('My New Agent')
    expect(tokenAgentLabel(null)).toBeNull()
  })
})

describe('token model labels', () => {
  it('keeps model IDs recognizable without pretending they are prose', () => {
    expect(tokenModelLabel('gpt_5.4')).toBe('GPT-5.4')
    expect(tokenModelLabel('gpt-5.6-sol')).toBe('GPT-5.6 Sol')
    expect(tokenModelLabel('claude-opus-4-1')).toBe('Claude Opus 4.1')
    expect(tokenModelLabel('gemini_2.5_pro')).toBe('Gemini 2.5 Pro')
    expect(tokenModelLabel(null)).toBeNull()
  })
})

describe('buildTokenBoard', () => {
  it('normalizes database numerics, ranks by burn, and computes honest totals', () => {
    const board = buildTokenBoard([
      usage({
        user_id: '2',
        username: 'cachelord',
        display_name: null,
        input_tokens: '500000',
        output_tokens: '500000',
        cache_creation_tokens: '0',
        cache_read_tokens: '9000000',
        total_tokens: '10000000',
        cost_usd: '9.5',
        active_days: '2',
        client_count: '2',
        agents: ['cursor', 'cursor', ' claude-code '],
        models: ['sonnet', 'sonnet'],
        top_agent: 'cursor',
        top_agent_days: '2',
        top_model: 'sonnet',
        top_model_days: '2'
      }),
      usage({
        user_id: 1,
        cost_usd: '42.75',
        total_tokens: '10000000',
        cache_read_tokens: '500000',
        cache_creation_tokens: '500000',
        active_days: 8,
        models: ['opus', 'sonnet']
      }),
      usage({ user_id: 3, total_tokens: 0, cost_usd: 999 })
    ])

    expect(board.rows).toHaveLength(2)
    expect(board.rows[0]).toMatchObject({
      rank: 1,
      username: 'birdabo',
      burnUsd: 42.75,
      cachePercent: 10,
      provisional: false,
      persona: { id: 'output-demon' },
      topAgent: 'claude-code',
      topAgentDays: 4,
      topModel: 'claude-opus-4-1',
      topModelDays: 3
    })
    expect(board.rows[1]).toMatchObject({
      rank: 2,
      username: 'cachelord',
      displayName: 'cachelord',
      burnUsd: 9.5,
      cachePercent: 90,
      provisional: true,
      agents: ['claude-code', 'cursor'],
      models: ['sonnet'],
      persona: { id: 'cache-goblin' },
      topAgent: 'cursor',
      topAgentDays: 2,
      topModel: 'sonnet',
      topModelDays: 2
    })
    expect(board.totals).toEqual({
      pilots: 2,
      totalTokens: 20_000_000,
      burnUsd: 52.25,
      cachePercent: 50,
      topBurnUsd: 42.75
    })
  })

  it('does not invent a top agent when the RPC omitted it and several agents remain', () => {
    const board = buildTokenBoard([
      usage({
        agents: ['claude-code', 'cursor'],
        top_agent: null,
        top_agent_days: null,
        top_model: null,
        top_model_days: null,
        models: ['opus', 'sonnet']
      })
    ])

    expect(board.rows[0]).toMatchObject({
      topAgent: null,
      topAgentDays: 0,
      agents: ['claude-code', 'cursor'],
      topModel: null,
      topModelDays: 0,
      models: ['opus', 'sonnet']
    })
  })

  it('uses tokens and output as deterministic tie-breakers', () => {
    const board = buildTokenBoard([
      usage({ user_id: 3, username: 'third', cost_usd: 5, total_tokens: 10, output_tokens: 2 }),
      usage({ user_id: 2, username: 'second', cost_usd: 5, total_tokens: 20, output_tokens: 1 }),
      usage({ user_id: 1, username: 'first', cost_usd: 5, total_tokens: 20, output_tokens: 2 })
    ])

    expect(board.rows.map((row) => row.userId)).toEqual([1, 2, 3])
  })
})
