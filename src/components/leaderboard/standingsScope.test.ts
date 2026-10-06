import { describe, expect, it } from 'vitest'
import {
  campsOnBoard,
  countriesOnBoard,
  cutIsAvailable,
  EVERYONE,
  primaryToolName,
  rowsInCut,
  sameCut,
  scopeButtonLabel
} from './standingsScope'

function row(rank: number, tool: string | null, country: string | null = null, rankDelta = 3) {
  return {
    rank,
    rankDelta,
    isNew: false,
    topTools: tool ? [{ name: tool }] : [],
    country
  }
}

describe('campsOnBoard', () => {
  it("lists only majors that are someone's #1 tool, in catalog order", () => {
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

describe('countriesOnBoard', () => {
  it('lists opted-in countries biggest first, then by name', () => {
    const countries = countriesOnBoard([
      row(1, null, 'JP'),
      row(2, null, 'PH'),
      row(3, null, 'PH'),
      row(4, null, 'DE'),
      row(5, null, null)
    ])
    expect(countries).toEqual([
      { code: 'PH', name: 'Philippines', count: 2 },
      { code: 'DE', name: 'Germany', count: 1 },
      { code: 'JP', name: 'Japan', count: 1 }
    ])
  })
})

describe('rowsInCut', () => {
  const rows = [
    row(1, 'Cursor', 'PH', 4),
    row(2, 'Claude', 'JP', -2),
    row(4, 'Claude', 'PH', 1),
    row(3, null, null, 0)
  ]

  it('keeps official ranks for everyone', () => {
    expect(rowsInCut(rows, EVERYONE).map((r) => r.rank)).toEqual([1, 2, 4, 3])
  })

  it('re-ranks a camp in score order and drops hidden tools', () => {
    const claude = rowsInCut(rows, { kind: 'camp', camp: 'Claude' })
    expect(claude.map((r) => r.rank)).toEqual([1, 2])
    expect(claude.every((r) => r.rankDelta === 0 && r.isNew === false)).toBe(true)
  })

  it('re-ranks a country from 1 and leaves non-opted rows out', () => {
    const ph = rowsInCut(rows, { kind: 'country', code: 'PH' })
    expect(ph.map((r) => [r.topTools[0]?.name, r.rank])).toEqual([
      ['Cursor', 1],
      ['Claude', 2]
    ])
    expect(ph.every((r) => r.rankDelta === 0)).toBe(true)
  })
})

describe('scopeButtonLabel', () => {
  it('reads SEASON until a cut is on', () => {
    expect(scopeButtonLabel('season', EVERYONE)).toBe('SEASON')
    expect(scopeButtonLabel('alltime', EVERYONE)).toBe('ALL-TIME')
    expect(scopeButtonLabel('season', { kind: 'camp', camp: 'Claude' })).toBe('CLAUDE')
    expect(scopeButtonLabel('alltime', { kind: 'camp', camp: 'ChatGPT' })).toBe(
      'CHATGPT · ALL-TIME'
    )
    expect(scopeButtonLabel('season', { kind: 'country', code: 'JP' })).toBe('JAPAN')
    expect(scopeButtonLabel('alltime', { kind: 'country', code: 'US' })).toBe(
      'UNITED STATES · ALL-TIME'
    )
  })
})

describe('cut identity', () => {
  it('compares cuts and checks they still have pilots', () => {
    const japan = { kind: 'country', code: 'JP' } as const
    expect(sameCut(japan, { kind: 'country', code: 'JP' })).toBe(true)
    expect(sameCut(japan, { kind: 'camp', camp: 'Claude' })).toBe(false)
    expect(cutIsAvailable(japan, [], [{ code: 'JP', name: 'Japan', count: 1 }])).toBe(true)
    expect(cutIsAvailable(japan, [], [])).toBe(false)
    expect(cutIsAvailable(EVERYONE, [], [])).toBe(true)
  })
})
