import { describe, expect, it } from 'vitest'
import type { SeasonState } from '@/lib/season'
import {
  AGENT_AI_TOOL_NAMES,
  buildTokenBoard,
  exactInteger,
  normalizeAgentId,
  parseTokenBoardWindow,
  resolveTokenBoardWindow,
  tokenPersona,
  tokenAgentLabel,
  tokenModelLabel,
  type TokenLeaderboardRpcRow
} from './tokenLeaderboard'
import { resolveToolName } from './toolNames'

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
    top_agent_tokens: '7000000',
    top_model_tokens: '6000000',
    agent_breakdown: [{ name: 'claude-code', totalTokens: '7000000' }],
    model_breakdown: [{ name: 'claude-opus-4-1', totalTokens: '6000000' }],
    agent_breakdown_complete: false,
    model_breakdown_complete: false,
    timezone_complete: true,
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
      until: '2026-08-31',
      timezone: 'UTC'
    })
    expect(resolveTokenBoardWindow('7d', ACTIVE_SEASON, Date.parse('2026-08-22T23:59:59Z'))).toEqual({
      id: '7d',
      label: 'LAST 7 DAYS',
      since: '2026-08-16',
      until: '2026-08-22',
      timezone: 'UTC'
    })
    expect(resolveTokenBoardWindow('all', ACTIVE_SEASON)).toEqual({
      id: 'all',
      label: 'ALL TIME',
      since: null,
      until: null,
      timezone: 'UTC'
    })
  })

  it('returns an intentionally empty season window before a calendar exists', () => {
    expect(
      resolveTokenBoardWindow('season', { phase: 'intermission', current: null, next: null })
    ).toEqual({
      id: 'season',
      label: 'NO SEASON YET',
      since: '9999-12-31',
      until: '9999-12-31',
      timezone: 'UTC'
    })
  })
})

describe('token personas', () => {
  // Defaults deliberately land on SMALL FIRE so each case below only
  // overrides the fields its badge is about.
  const personaId = (overrides: Partial<Parameters<typeof tokenPersona>[0]>) =>
    tokenPersona({
      burnUsd: 10,
      totalTokens: 1_000_000,
      outputTokens: 50_000,
      cachePercent: 50,
      modelCount: 2,
      activeDays: 4,
      clientCount: 1,
      agentCount: 1,
      ...overrides
    }).id

  it('prioritizes dramatic spend over efficiency personas', () => {
    expect(
      tokenPersona({
        burnUsd: 600,
        totalTokens: 100_000_000,
        outputTokens: 20_000_000,
        cachePercent: 95,
        modelCount: 8,
        activeDays: 4,
        clientCount: 1,
        agentCount: 1
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
        modelCount: 1,
        activeDays: 4,
        clientCount: 1,
        agentCount: 1
      }).id
    ).toBe('cache-goblin')
    expect(
      tokenPersona({
        burnUsd: 10,
        totalTokens: 2_000_000,
        outputTokens: 300_000,
        cachePercent: 40,
        modelCount: 1,
        activeDays: 4,
        clientCount: 1,
        agentCount: 1
      }).id
    ).toBe('output-demon')
  })

  it('splits the spend ladder into strictly descending tiers', () => {
    // The $31k burner outranks FINANCIAL INCIDENT — that's the point.
    expect(personaId({ burnUsd: 31_000 })).toBe('compute-baron')
    expect(personaId({ burnUsd: 25_000 })).toBe('compute-baron')
    expect(personaId({ burnUsd: 10_000 })).toBe('audit-risk')
    expect(personaId({ burnUsd: 2_500 })).toBe('payroll-expense')
    expect(personaId({ burnUsd: 500 })).toBe('financial-incident')
    expect(personaId({ burnUsd: 100 })).toBe('whale')
  })

  it('flags fast-tier pricing as PRIORITY LANE at two dollars per MTok', () => {
    // $40 across 20M tokens is exactly $2/MTok — the boundary qualifies.
    expect(personaId({ burnUsd: 40, totalTokens: 20_000_000 })).toBe('priority-lane')
    expect(personaId({ burnUsd: 99, totalTokens: 20_000_000 })).toBe('priority-lane')
    // A hair under the rate is just an ordinary burning wallet.
    expect(personaId({ burnUsd: 39, totalTokens: 20_000_000 })).toBe('wallet-on-fire')
  })

  it('calls out industrial-scale freeloading as FREE TIER FREAK', () => {
    expect(personaId({ burnUsd: 49, totalTokens: 1_000_000_000 })).toBe('free-tier-freak')
    // Paying $50 forfeits the badge; sheer volume takes over instead.
    expect(personaId({ burnUsd: 50, totalTokens: 1_000_000_000 })).toBe('token-furnace')
  })

  it('prefers GROUNDHOG DAY over CACHE GOBLIN at 98 percent cache', () => {
    expect(personaId({ cachePercent: 98, totalTokens: 50_000_000 })).toBe('groundhog-day')
    // Below the 50M volume floor the goblin keeps the badge.
    expect(personaId({ cachePercent: 98, totalTokens: 20_000_000 })).toBe('cache-goblin')
  })

  it('escalates OUTPUT DEMON to YAPPER for extreme output', () => {
    expect(personaId({ outputTokens: 25_000_000, totalTokens: 100_000_000 })).toBe('yapper')
    expect(personaId({ outputTokens: 600_000, totalTokens: 2_000_000 })).toBe('yapper')
    // A 15% share stays a demon, not a yapper.
    expect(personaId({ outputTokens: 300_000, totalTokens: 2_000_000 })).toBe('output-demon')
  })

  it('recognizes TOKEN BLACK HOLE volume above the furnace', () => {
    expect(personaId({ burnUsd: 60, totalTokens: 5_000_000_000 })).toBe('token-black-hole')
    expect(personaId({ burnUsd: 60, totalTokens: 50_000_000 })).toBe('token-furnace')
  })

  it('grades model promiscuity from hopper to commitment issues', () => {
    expect(personaId({ modelCount: 10 })).toBe('commitment-issues')
    expect(personaId({ modelCount: 9 })).toBe('model-hopper')
    expect(personaId({ modelCount: 5 })).toBe('model-hopper')
  })

  it('badges multi-machine and multi-agent fleets', () => {
    expect(personaId({ clientCount: 3 })).toBe('botnet')
    expect(personaId({ agentCount: 4 })).toBe('zookeeper')
    // Three machines outrank four agents when both apply.
    expect(personaId({ clientCount: 3, agentCount: 4 })).toBe('botnet')
  })

  it('separates monogamous loyalty from simply never logging off', () => {
    expect(personaId({ modelCount: 1, activeDays: 14 })).toBe('ride-or-die')
    // Loyalty beats the calendar even after 28 straight days.
    expect(personaId({ modelCount: 1, activeDays: 30 })).toBe('ride-or-die')
    expect(personaId({ modelCount: 2, activeDays: 28 })).toBe('touch-grass')
  })
})

describe('token agent labels', () => {
  it('turns collector IDs into human-facing agent names', () => {
    expect(tokenAgentLabel('claude-code')).toBe('Claude Code')
    expect(tokenAgentLabel('openai_codex')).toBe('Codex')
    expect(tokenAgentLabel('gemini-cli')).toBe('Gemini CLI')
    expect(tokenAgentLabel('hermes')).toBe('Hermes')
    // Must collapse to 'Hermes' (not the title-cased 'Hermes Agent') so it
    // hits the brand mark + accent keyed by that label in TokenAgentIcon.
    expect(tokenAgentLabel('hermes-agent')).toBe('Hermes')
    expect(tokenAgentLabel('pi')).toBe('Pi')
    expect(tokenAgentLabel('pi-agent')).toBe('Pi')
    expect(tokenAgentLabel('pi-coding-agent')).toBe('Pi')
    expect(tokenAgentLabel('my-new-agent')).toBe('My New Agent')
    expect(tokenAgentLabel(null)).toBeNull()
  })
})

describe('agent → AI-board tool names', () => {
  it('maps each collector id to the AI board tool name resolveToolName produces', () => {
    // Values must equal resolveToolName() for each tool's canonical
    // domain — the AI board's rows are keyed by those exact strings.
    expect(AGENT_AI_TOOL_NAMES['cursor']).toBe(resolveToolName('cursor.com'))
    expect(AGENT_AI_TOOL_NAMES['copilot']).toBe(resolveToolName('github.com'))
    expect(AGENT_AI_TOOL_NAMES['github-copilot']).toBe(resolveToolName('github.com'))
    expect(AGENT_AI_TOOL_NAMES['claude']).toBe(resolveToolName('claude.ai'))
    expect(AGENT_AI_TOOL_NAMES['claude-code']).toBe(resolveToolName('claude.ai'))
    expect(AGENT_AI_TOOL_NAMES['gemini']).toBe(resolveToolName('gemini.google.com'))
    expect(AGENT_AI_TOOL_NAMES['gemini-cli']).toBe(resolveToolName('gemini.google.com'))
  })

  it('deliberately drops agents without an AI-board tool', () => {
    expect(AGENT_AI_TOOL_NAMES['codex']).toBeUndefined()
    expect(AGENT_AI_TOOL_NAMES['openai-codex']).toBeUndefined()
    expect(AGENT_AI_TOOL_NAMES['opencode']).toBeUndefined()
  })

  it('normalizes collector ids the same way tokenAgentLabel does', () => {
    expect(normalizeAgentId(' Claude_Code ')).toBe('claude-code')
    expect(normalizeAgentId('GEMINI CLI')).toBe('gemini-cli')
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
      burnUsd: '42.75',
      // Identity extras stay null here — hydration is the route's job.
      tier: null,
      team: null,
      cachePercent: 10,
      provisional: false,
      persona: { id: 'output-demon' },
      topAgent: 'claude-code',
      topAgentDays: 4,
      topModel: 'claude-opus-4-1',
      topModelDays: 3,
      topAgentTokens: '7000000',
      topModelTokens: '6000000',
      timezoneComplete: true
    })
    expect(board.rows[1]).toMatchObject({
      rank: 2,
      username: 'cachelord',
      displayName: 'cachelord',
      burnUsd: '9.5',
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
      totalTokens: '20000000',
      burnUsd: '52.25',
      cachePercent: 50,
      topBurnUsd: '42.75'
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

  it('keeps a reported primary model when the stored legacy mix has several models', () => {
    const board = buildTokenBoard([
      usage({
        agents: ['codex'],
        models: ['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra'],
        top_agent: 'codex',
        top_model: 'gpt-5.6-sol',
        top_model_days: 4,
        top_model_tokens: '0',
        model_breakdown: [],
        model_breakdown_complete: false
      })
    ])

    expect(board.rows[0]).toMatchObject({
      topAgent: 'codex',
      topModel: 'gpt-5.6-sol',
      topModelDays: 4,
      topModelTokens: '0',
      models: ['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra'],
      modelBreakdownComplete: false
    })
  })

  it('feeds behavior fields into the persona at the call site', () => {
    const behavior = (overrides: Partial<TokenLeaderboardRpcRow>) =>
      usage({
        cost_usd: '5',
        input_tokens: '950000',
        output_tokens: '50000',
        cache_creation_tokens: '0',
        cache_read_tokens: '0',
        total_tokens: '1000000',
        models: ['opus'],
        ...overrides
      })

    const board = buildTokenBoard([
      behavior({ user_id: 1, client_count: '3' }),
      behavior({
        user_id: 2,
        agents: ['claude-code', 'codex', 'cursor', 'gemini'],
        top_agent: 'cursor'
      }),
      behavior({ user_id: 3, active_days: '14' })
    ])

    const personaById = new Map(board.rows.map((row) => [row.userId, row.persona.id]))
    expect(personaById.get(1)).toBe('botnet')
    expect(personaById.get(2)).toBe('zookeeper')
    expect(personaById.get(3)).toBe('ride-or-die')
  })

  it('uses tokens and output as deterministic tie-breakers', () => {
    const board = buildTokenBoard([
      usage({ user_id: 3, username: 'third', cost_usd: 5, total_tokens: 10, output_tokens: 2 }),
      usage({ user_id: 2, username: 'second', cost_usd: 5, total_tokens: 20, output_tokens: 1 }),
      usage({ user_id: 1, username: 'first', cost_usd: 5, total_tokens: 20, output_tokens: 2 })
    ])

    expect(board.rows.map((row) => row.userId)).toEqual([1, 2, 3])
  })

  it('accepts whole numeric strings with trailing zeros from PostgREST', () => {
    expect(exactInteger('123.0')).toBe('123')
    expect(exactInteger('123.000000')).toBe('123')
    expect(exactInteger('0.0')).toBe('0')
    expect(exactInteger('12.5')).toBe('0')
    expect(exactInteger('123')).toBe('123')
  })

  it('sorts and totals bigint-sized token strings without Number precision loss', () => {
    const board = buildTokenBoard([
      usage({ user_id: 1, username: 'smaller', cost_usd: '1', total_tokens: '9007199254740992' }),
      usage({ user_id: 2, username: 'larger', cost_usd: '1', total_tokens: '9007199254740993' })
    ])

    expect(board.rows.map((row) => row.username)).toEqual(['larger', 'smaller'])
    expect(board.totals.totalTokens).toBe('18014398509481985')
  })
})
