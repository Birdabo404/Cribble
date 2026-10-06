import { describe, expect, it } from 'vitest'
import {
  campsOnBoard,
  countriesOnBoard,
  countryButtonLabel,
  cutLabel,
  primaryToolName,
  rowsInCut,
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

const NONE = { camp: null, country: null }

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
  it('lists countries with pilots biggest first, then by name', () => {
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

  it('keeps official ranks with no filter on', () => {
    expect(rowsInCut(rows, NONE).map((r) => r.rank)).toEqual([1, 2, 4, 3])
  })

  it('re-ranks a camp in score order and drops hidden tools', () => {
    const claude = rowsInCut(rows, { camp: 'Claude', country: null })
    expect(claude.map((r) => r.rank)).toEqual([1, 2])
    expect(claude.every((r) => r.rankDelta === 0 && r.isNew === false)).toBe(true)
  })

  it('re-ranks a country from 1 and leaves rows without that country out', () => {
    const ph = rowsInCut(rows, { camp: null, country: 'PH' })
    expect(ph.map((r) => [r.topTools[0]?.name, r.rank])).toEqual([
      ['Cursor', 1],
      ['Claude', 2]
    ])
    expect(ph.every((r) => r.rankDelta === 0)).toBe(true)
  })

  it('stacks a camp and a country', () => {
    const claudePh = rowsInCut(rows, { camp: 'Claude', country: 'PH' })
    expect(claudePh.map((r) => [r.topTools[0]?.name, r.country, r.rank])).toEqual([
      ['Claude', 'PH', 1]
    ])
  })
})

describe('labels', () => {
  it('reads SEASON until a camp is on', () => {
    expect(scopeButtonLabel('season', null)).toBe('SEASON')
    expect(scopeButtonLabel('alltime', null)).toBe('ALL-TIME')
    expect(scopeButtonLabel('season', 'Claude')).toBe('CLAUDE')
    expect(scopeButtonLabel('alltime', 'ChatGPT')).toBe('CHATGPT · ALL-TIME')
  })

  it('names the country button and the combined heading', () => {
    expect(countryButtonLabel(null)).toBe('COUNTRY')
    expect(countryButtonLabel('US')).toBe('UNITED STATES')
    expect(cutLabel(NONE)).toBeNull()
    expect(cutLabel({ camp: 'Claude', country: null })).toBe('CLAUDE')
    expect(cutLabel({ camp: null, country: 'JP' })).toBe('JAPAN')
    expect(cutLabel({ camp: 'Claude', country: 'JP' })).toBe('CLAUDE · JAPAN')
  })
})
