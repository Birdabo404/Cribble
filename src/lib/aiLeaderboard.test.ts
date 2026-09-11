import { describe, expect, it } from 'vitest'
import {
  assembleAiBoards,
  buildAiAgents,
  buildAiBoard,
  buildAiToolDomainMap,
  burnByToolName,
  scoreAiTotals,
  type AgentBurnRpcRow,
  type AiToolTotalsRow
} from './aiLeaderboard'
import { listTrackedAiDomains } from './aiDomains'
import type { SeasonState } from './season'

const row = (
  tool: string | null,
  active_ms: number,
  visits: number,
  pilots: number
): AiToolTotalsRow => ({ tool, active_ms, visits, pilots })

describe('buildAiToolDomainMap', () => {
  it('covers every tracked domain except cribble.dev', () => {
    const map = buildAiToolDomainMap()

    expect(map['cribble.dev']).toBeUndefined()
    for (const domain of listTrackedAiDomains()) {
      if (domain === 'cribble.dev') continue
      expect(map[domain]).toBeTruthy()
    }
  })

  it('merges sibling domains into one canonical tool name', () => {
    const map = buildAiToolDomainMap()

    expect(map['claude.ai']).toBe('Claude')
    expect(map['chat.openai.com']).toBe('ChatGPT')
    expect(map['chatgpt.com']).toBe('ChatGPT')
    expect(map['sora.com']).toBe(map['sora.chatgpt.com'])
    expect(map['kimi.ai']).toBe('Kimi')
    expect(map['kimi.com']).toBe(map['kimi.ai'])
    expect(map['platform.claude.com']).toBe(map['console.anthropic.com'])
    expect(map['notebook.google.com']).toBe(map['notebooklm.google.com'])
    expect(map['copilot.com']).toBe(map['copilot.microsoft.com'])
    expect(map['app.lumalabs.ai']).toBe(map['lumalabs.ai'])
  })
})

describe('scoreAiTotals', () => {
  it('prices totals in the player-score currency: active seconds + 40/visit', () => {
    // 1800s of verified activity + 10 visits = 1800 + 400.
    expect(scoreAiTotals(1_800_000, 10)).toBe(2_200)
    expect(scoreAiTotals(0, 0)).toBe(0)
  })
})

describe('buildAiBoard', () => {
  it('ranks tools by all-time score with 1-based ranks', () => {
    const board = buildAiBoard([
      row(null, 2_500_000, 15, 2),
      row('Cursor', 500_000, 10, 1),
      row('Claude', 2_000_000, 5, 2)
    ])

    expect(board.tools.map((t) => t.name)).toEqual(['Claude', 'Cursor'])
    expect(board.tools.map((t) => t.rank)).toEqual([1, 2])
    expect(board.tools[0].score).toBe(2_200)
    expect(board.tools[1].score).toBe(900)
  })

  it('separates the grand-total row: site totals, not a board entry', () => {
    // 3 site-wide pilots ≠ 2 + 2 summed per-tool — users overlap tools.
    const board = buildAiBoard([
      row(null, 3_000_000, 20, 3),
      row('Claude', 2_000_000, 10, 2),
      row('Cursor', 1_000_000, 10, 2)
    ])

    expect(board.tools).toHaveLength(2)
    expect(board.totals.pilots).toBe(3)
    expect(board.totals.score).toBe(scoreAiTotals(3_000_000, 20))
  })

  it('decorates weekScore from the trailing-week rows without affecting rank', () => {
    const board = buildAiBoard(
      [
        row(null, 3_000_000, 0, 2),
        row('Claude', 2_000_000, 0, 1),
        row('Cursor', 1_000_000, 0, 1)
      ],
      [
        row(null, 900_000, 0, 2),
        // Cursor out-earned Claude this week — still ranked #2 all-time.
        row('Cursor', 800_000, 0, 1),
        row('Claude', 100_000, 0, 1)
      ]
    )

    expect(board.tools.map((t) => t.name)).toEqual(['Claude', 'Cursor'])
    expect(board.tools[0].weekScore).toBe(100)
    expect(board.tools[1].weekScore).toBe(800)
  })

  it('defaults weekScore to 0 for tools with no week activity', () => {
    const board = buildAiBoard(
      [row(null, 1_000_000, 0, 1), row('Claude', 1_000_000, 0, 1)],
      [row(null, 0, 0, 0)]
    )

    expect(board.tools[0].weekScore).toBe(0)
  })

  it('breaks score ties by pilots, then name', () => {
    const board = buildAiBoard([
      row(null, 3_000_000, 0, 3),
      row('Poe', 1_000_000, 0, 1),
      row('Perplexity', 1_000_000, 0, 2),
      row('Mistral', 1_000_000, 0, 1)
    ])

    expect(board.tools.map((t) => t.name)).toEqual([
      'Perplexity',
      'Mistral',
      'Poe'
    ])
  })

  it('computes percent as share of the summed tool scores', () => {
    const board = buildAiBoard([
      row(null, 4_000_000, 0, 2),
      row('Claude', 3_000_000, 0, 1),
      row('Cursor', 1_000_000, 0, 1)
    ])

    expect(board.tools.map((t) => t.percent)).toEqual([75, 25])
  })

  it('coerces stringly-typed RPC numerics (PostgREST bigint)', () => {
    const board = buildAiBoard([
      { tool: null, active_ms: '2000000', visits: '10', pilots: '2' },
      { tool: 'Claude', active_ms: '2000000', visits: '10', pilots: '2' }
    ])

    expect(board.tools[0].score).toBe(2_400)
    expect(board.tools[0].pilots).toBe(2)
    expect(board.totals.active_ms).toBe(2_000_000)
  })

  it('returns an empty board for no rows', () => {
    const board = buildAiBoard([])

    expect(board.tools).toEqual([])
    expect(board.totals).toEqual({ score: 0, active_ms: 0, visits: 0, pilots: 0 })
  })
})

const burnRow = (agent: string, cost: string, pilots = 1): AgentBurnRpcRow => ({
  agent,
  cost_usd: cost,
  pilots
})

describe('buildAiAgents', () => {
  it('ranks harnesses by exact burn with 1-based ranks and a burn share', () => {
    const agents = buildAiAgents([
      burnRow('claude', '74732.1086', 30),
      burnRow('codex', '167816.30', 42),
      burnRow('cursor', '20664.614584', 6)
    ])

    expect(agents.map((a) => a.name)).toEqual(['Codex', 'Claude Code', 'Cursor'])
    expect(agents.map((a) => a.rank)).toEqual([1, 2, 3])
    expect(agents[0].burnUsd).toBe('167816.3')
    expect(agents[0].pilots).toBe(42)
    expect(agents.map((a) => a.percent)).toEqual([64, 28, 8])
  })

  it('folds aliases of one harness: burn summed exactly, pilots kept as a floor', () => {
    const agents = buildAiAgents([
      burnRow('claude', '0.1', 3),
      burnRow('claude-code', '0.2', 2),
      burnRow('copilot', '1', 1),
      burnRow('github-copilot', '2', 4)
    ])

    const claude = agents.find((a) => a.name === 'Claude Code')!
    expect(claude.burnUsd).toBe('0.3')
    expect(claude.pilots).toBe(3)
    const copilot = agents.find((a) => a.name === 'GitHub Copilot')!
    expect(copilot.burnUsd).toBe('3')
    expect(copilot.pilots).toBe(4)
  })

  it('keeps harnesses the machine board drops (codex, opencode) and title-cases unknown ids', () => {
    const agents = buildAiAgents([
      burnRow('codex', '500'),
      burnRow('opencode', '400'),
      burnRow('some-new-agent', '300')
    ])

    expect(agents.map((a) => a.name)).toEqual(['Codex', 'OpenCode', 'Some New Agent'])
  })

  it('drops zero-burn and null ids and breaks ties by pilots then name', () => {
    const agents = buildAiAgents([
      burnRow('dsh', '0', 1),
      { agent: null, cost_usd: '9', pilots: 1 },
      burnRow('pi', '5', 2),
      burnRow('hermes', '5', 2),
      burnRow('opencode', '5', 9)
    ])

    expect(agents.map((a) => a.name)).toEqual(['OpenCode', 'Hermes', 'Pi'])
  })

  it('returns an empty list for no rows', () => {
    expect(buildAiAgents([])).toEqual([])
  })
})

describe('burnByToolName', () => {
  it('folds agent ids onto the AI board tool names', () => {
    const burn = burnByToolName([
      burnRow('cursor', '10'),
      burnRow('copilot', '1'),
      burnRow('github-copilot', '2'),
      burnRow('gemini-cli', '4')
    ])

    expect(burn.get('Cursor')).toBe('10')
    expect(burn.get('GitHub Copilot')).toBe('3')
    expect(burn.get('Gemini')).toBe('4')
  })

  it('sums sibling agents of one tool with exact decimals', () => {
    const burn = burnByToolName([
      burnRow('claude', '0.1'),
      burnRow('claude-code', '0.2')
    ])

    expect(burn.get('Claude')).toBe('0.3')
  })

  it('drops agents with no AI-board tool instead of inventing rows', () => {
    const burn = burnByToolName([
      burnRow('codex', '500'),
      burnRow('opencode', '500'),
      burnRow('some-unknown-agent', '500'),
      { agent: null, cost_usd: '500', pilots: 1 }
    ])

    expect(burn.size).toBe(0)
  })
})

describe('buildAiBoard burn column', () => {
  it('attaches burn as a column without letting it touch the sort', () => {
    const board = buildAiBoard(
      [
        row(null, 3_000_000, 0, 2),
        row('Claude', 2_000_000, 0, 1),
        row('Cursor', 1_000_000, 0, 1)
      ],
      [],
      // Cursor burned 1000x Claude — still ranked by score alone.
      new Map([
        ['Cursor', '5000'],
        ['Claude', '5']
      ])
    )

    expect(board.tools.map((t) => t.name)).toEqual(['Claude', 'Cursor'])
    expect(board.tools[0].burnUsd).toBe('5')
    expect(board.tools[1].burnUsd).toBe('5000')
  })

  it('never mints a tool row from burn and defaults absent burn to 0', () => {
    const board = buildAiBoard(
      [row(null, 2_000_000, 0, 1), row('Claude', 2_000_000, 0, 1)],
      [],
      new Map([
        ['Claude', '7.25'],
        // No 'GitHub Copilot' usage row on this board — its spend drops.
        ['GitHub Copilot', '900']
      ])
    )

    expect(board.tools.map((t) => t.name)).toEqual(['Claude'])
    expect(board.tools[0].burnUsd).toBe('7.25')
  })
})

describe('assembleAiBoards', () => {
  const calendar = (phase: 'active' | 'intermission'): SeasonState => ({
    phase,
    current: {
      id: 4,
      number: 4,
      name: 'Season 4',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-09-01T00:00:00.000Z',
      status: phase === 'active' ? 'active' : 'complete'
    },
    next: null
  })
  const noCalendar: SeasonState = { phase: 'intermission', current: null, next: null }

  // Claude dominates all-time; Cursor dominates the current season.
  const allTimeRows = [
    row(null, 10_000_000, 0, 3),
    row('Claude', 8_000_000, 0, 2),
    row('Cursor', 2_000_000, 0, 2)
  ]
  const seasonRows = [
    row(null, 4_000_000, 0, 3),
    row('Claude', 1_000_000, 0, 2),
    row('Cursor', 3_000_000, 0, 2)
  ]

  it('ranks the season board by season score while all-time stays put', () => {
    const boards = assembleAiBoards({
      seasonState: calendar('active'),
      allTimeRows,
      seasonRows
    })

    expect(boards.alltime.tools.map((t) => t.name)).toEqual(['Claude', 'Cursor'])
    expect(boards.season!.tools.map((t) => t.name)).toEqual(['Cursor', 'Claude'])
    expect(boards.season!.tools.map((t) => t.rank)).toEqual([1, 2])
  })

  it('recomputes percent per window over that window’s score sum', () => {
    const boards = assembleAiBoards({
      seasonState: calendar('active'),
      allTimeRows,
      seasonRows
    })

    const alltimeClaude = boards.alltime.tools.find((t) => t.name === 'Claude')!
    const seasonClaude = boards.season!.tools.find((t) => t.name === 'Claude')!
    expect(alltimeClaude.percent).toBe(80)
    expect(seasonClaude.percent).toBe(25)
  })

  it('keeps each window’s burn on its own board', () => {
    const boards = assembleAiBoards({
      seasonState: calendar('active'),
      allTimeRows,
      seasonRows,
      allTimeBurnRows: [burnRow('claude', '100'), burnRow('cursor', '40')],
      seasonBurnRows: [burnRow('claude', '2.5')]
    })

    expect(boards.alltime.tools.find((t) => t.name === 'Claude')!.burnUsd).toBe('100')
    expect(boards.alltime.tools.find((t) => t.name === 'Cursor')!.burnUsd).toBe('40')
    expect(boards.season!.tools.find((t) => t.name === 'Claude')!.burnUsd).toBe('2.5')
    expect(boards.season!.tools.find((t) => t.name === 'Cursor')!.burnUsd).toBe('0')
  })

  it('ranks each window’s agents from that window’s burn rows', () => {
    const boards = assembleAiBoards({
      seasonState: calendar('active'),
      allTimeRows,
      seasonRows,
      allTimeBurnRows: [burnRow('codex', '900'), burnRow('claude', '100')],
      seasonBurnRows: [burnRow('claude', '2.5')]
    })

    expect(boards.alltime.agents.map((a) => a.name)).toEqual(['Codex', 'Claude Code'])
    expect(boards.alltime.agents.map((a) => a.percent)).toEqual([90, 10])
    expect(boards.season!.agents.map((a) => a.name)).toEqual(['Claude Code'])
    expect(boards.season!.agents[0].percent).toBe(100)
  })

  it('serves an empty agents list when burn rows are absent', () => {
    const boards = assembleAiBoards({
      seasonState: calendar('active'),
      allTimeRows,
      seasonRows
    })
    expect(boards.alltime.agents).toEqual([])
    expect(boards.season!.agents).toEqual([])
  })

  it('serves no season board during intermission or without a calendar', () => {
    const intermission = assembleAiBoards({
      seasonState: calendar('intermission'),
      allTimeRows,
      seasonRows
    })
    expect(intermission.season).toBeNull()
    expect(intermission.alltime.tools).toHaveLength(2)

    const fresh = assembleAiBoards({
      seasonState: noCalendar,
      allTimeRows,
      seasonRows: null
    })
    expect(fresh.season).toBeNull()
  })
})
