import { describe, expect, it } from 'vitest'
import {
  buildAiBoard,
  buildAiToolDomainMap,
  scoreAiTotals,
  type AiToolTotalsRow
} from './aiLeaderboard'
import { listTrackedAiDomains } from './aiDomains'

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
