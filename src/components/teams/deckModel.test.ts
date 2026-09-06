import { describe, expect, it } from 'vitest'
import {
  clampShare,
  deckTitle,
  initialSector,
  isDeckOperator,
  kpiChars,
  kpiText,
  nextTabIndex,
  orderRoster,
  pad2,
  resolveSector,
  resolveSelection,
  seatMap,
  sectorLabel,
  sectorsFor,
  type DeckAuthority,
  type DeckSector,
  type RosterLike
} from './deckModel'

// The deck's JSX switches on these derivations — which sectors a viewer
// holds, where they land, which row is lit, how the KPI numerals are
// fitted — so they are pinned here rather than read off the markup.

const row = (
  affiliationId: number,
  status: RosterLike['status'],
  score: number,
  share = 0
): RosterLike => ({ affiliationId, status, score, share })

describe('viewer arms', () => {
  it.each<[DeckAuthority, boolean, string]>([
    ['team-account', true, 'COMMAND DECK'],
    ['owner', true, 'COMMAND DECK'],
    ['member', false, 'TEAM CONSOLE']
  ])('%s', (authority, operator, title) => {
    expect(isDeckOperator(authority)).toBe(operator)
    expect(deckTitle(authority)).toBe(title)
  })
})

describe('sectors', () => {
  it('operators hold all three, members only the roster', () => {
    expect(sectorsFor(true)).toEqual(['roster', 'transfers', 'bar'])
    expect(sectorsFor(false)).toEqual(['roster'])
  })

  it('labels every sector', () => {
    const labels = (['roster', 'transfers', 'bar'] as DeckSector[]).map(sectorLabel)
    expect(labels).toEqual(['ROSTER', 'TRANSFERS', 'HIRING BAR'])
  })

  it('operators land on the queue only when pilots are waiting', () => {
    expect(initialSector(true, 2)).toBe('transfers')
    expect(initialSector(true, 0)).toBe('roster')
    // a member payload never carries applications, but the gate is the
    // authority, not the count
    expect(initialSector(false, 2)).toBe('roster')
  })

  it('snaps a sector the viewer cannot hold back to the roster', () => {
    expect(resolveSector('bar', sectorsFor(true))).toBe('bar')
    expect(resolveSector('bar', sectorsFor(false))).toBe('roster')
    expect(resolveSector('roster', sectorsFor(false))).toBe('roster')
  })
})

describe('nextTabIndex (automatic activation, wrapping)', () => {
  it.each<[string, number, number | null]>([
    ['ArrowRight', 0, 1],
    ['ArrowDown', 2, 0],
    ['ArrowLeft', 0, 2],
    ['ArrowUp', 1, 0],
    ['Home', 2, 0],
    ['End', 0, 2],
    ['Enter', 1, null],
    ['Tab', 1, null]
  ])('%s from %i', (key, index, expected) => {
    expect(nextTabIndex(key, index, 3)).toBe(expected)
  })
})

describe('orderRoster', () => {
  it('ranks actives by score and trails pendings in server order', () => {
    const roster = [
      row(1, 'pending', 9_000),
      row(2, 'active', 100),
      row(3, 'active', 500),
      row(4, 'pending', 1)
    ]
    expect(orderRoster(roster).map((r) => r.affiliationId)).toEqual([3, 2, 1, 4])
  })

  it('does not mutate the payload array', () => {
    const roster = [row(1, 'active', 1), row(2, 'active', 2)]
    orderRoster(roster)
    expect(roster.map((r) => r.affiliationId)).toEqual([1, 2])
  })
})

describe('resolveSelection', () => {
  const ordered = orderRoster([row(1, 'active', 300), row(2, 'active', 200), row(3, 'pending', 0)])

  it('keeps a held selection that still exists', () => {
    expect(resolveSelection(ordered, 2)).toEqual({ entry: ordered[1], index: 1 })
  })

  it('falls back to the top pilot when nothing (or a gone row) is held', () => {
    expect(resolveSelection(ordered, null)).toEqual({ entry: ordered[0], index: 0 })
    expect(resolveSelection(ordered, 99)).toEqual({ entry: ordered[0], index: 0 })
  })

  it('reads nothing on an empty roster', () => {
    expect(resolveSelection([], 1)).toEqual({ entry: null, index: -1 })
  })
})

describe('clampShare', () => {
  it.each<[number, number]>([
    [49, 49],
    [0, 0],
    [100, 100],
    [340, 100],
    [-5, 0],
    [49.6, 50],
    [Number.NaN, 0]
  ])('%d → %d', (input, expected) => {
    expect(clampShare(input)).toBe(expected)
  })
})

describe('seatMap', () => {
  it('fills signed, then pending, then open seats to the cap', () => {
    const ordered = orderRoster([row(1, 'active', 10), row(2, 'pending', 0), row(3, 'active', 20)])
    const seats = seatMap(ordered, 5)
    expect(seats.map((s) => s.kind)).toEqual(['active', 'active', 'pending', 'open', 'open'])
    expect(seats.map((s) => s.entry?.affiliationId ?? null)).toEqual([3, 1, 2, null, null])
  })

  it('clips a roster past the cap instead of overflowing the grid', () => {
    const ordered = orderRoster([row(1, 'active', 1), row(2, 'active', 2), row(3, 'active', 3)])
    expect(seatMap(ordered, 2)).toHaveLength(2)
  })
})

describe('KPI numerals', () => {
  it('formats every cell and fits the row to the longest', () => {
    const text = kpiText({
      score: 81_533,
      rank: 2,
      activeCount: 3,
      seatLimit: 10,
      burnUsd: '6.39',
      burnPilots: 3
    })
    expect(text).toEqual({ score: '81,533', rank: '#2', pilots: '3/10', burn: '$6.39' })
    expect(kpiChars(text)).toBe(6)
  })

  it('reads dashes for an unranked team with no opted-in burn', () => {
    const text = kpiText({
      score: 0,
      rank: null,
      activeCount: 0,
      seatLimit: 10,
      burnUsd: '0',
      burnPilots: 0
    })
    expect(text.rank).toBe('—')
    expect(text.burn).toBe('—')
    // the floor keeps a row of short values from ballooning
    expect(kpiChars(text)).toBe(4)
  })

  it('marks sub-cent burn with a "<" and counts it in the fit', () => {
    const text = kpiText({
      score: 1_204_311,
      rank: 1,
      activeCount: 10,
      seatLimit: 10,
      burnUsd: '0.004',
      burnPilots: 1
    })
    expect(text.burn).toBe('<$0.01')
    expect(kpiChars(text)).toBe('1,204,311'.length)
  })
})

describe('pad2', () => {
  it('zero-pads single digits only', () => {
    expect(pad2(3)).toBe('03')
    expect(pad2(10)).toBe('10')
    expect(pad2(0)).toBe('00')
  })
})
