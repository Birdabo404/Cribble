import { describe, expect, it } from 'vitest'
import {
  campLabel,
  campsOnBoard,
  primaryToolName,
  rowsInCamp,
  scopeButtonLabel
} from './standingsScope'

function row(rank: number, tool: string | null, rankDelta = 3) {
  return {
    rank,
    rankDelta,
    isNew: false,
    topTools: tool ? [{ name: tool }] : []
  }
}

describe('campsOnBoard', () => {
  it('lists only majors that are someone\'s #1 tool, in catalog order', () => {
    const camps = campsOnBoard([
      row(1, 'Cursor'),
      row(2, 'Claude'),
      row(3, 'Claude'),
      row(4, 'Midjourney'),
      row(5, null)
    ])
    expect(camps).toEqual([
      { id: 'Claude', count: 2 },
      { id: 'Cursor', count: 1 }
    ])
  })

  it('ignores a major that is only a second tool', () => {
    const camps = campsOnBoard([
      {
        rank: 1,
        topTools: [{ name: 'Cursor' }, { name: 'Claude' }]
      }
    ])
    expect(camps).toEqual([{ id: 'Cursor', count: 1 }])
    expect(primaryToolName({ topTools: [{ name: '  ' }] })).toBeNull()
  })
})

describe('rowsInCamp', () => {
  const rows = [row(1, 'Cursor', 4), row(2, 'Claude', -2), row(4, 'Claude', 1), row(3, null, 0)]

  it('keeps official ranks for everyone', () => {
    expect(rowsInCamp(rows, 'everyone').map((r) => r.rank)).toEqual([1, 2, 4, 3])
  })

  it('re-ranks the camp in score order and drops hidden tools', () => {
    const claude = rowsInCamp(rows, 'Claude')
    expect(claude.map((r) => r.rank)).toEqual([1, 2])
    expect(claude.every((r) => r.rankDelta === 0 && r.isNew === false)).toBe(true)
  })
})

describe('scopeButtonLabel', () => {
  it('reads SEASON until a camp is on', () => {
    expect(scopeButtonLabel('season', 'everyone')).toBe('SEASON')
    expect(scopeButtonLabel('alltime', 'everyone')).toBe('ALL-TIME')
    expect(scopeButtonLabel('season', 'Claude')).toBe('CLAUDE')
    expect(scopeButtonLabel('alltime', 'ChatGPT')).toBe('CHATGPT · ALL-TIME')
    expect(campLabel('Grok')).toBe('GROK')
  })
})
