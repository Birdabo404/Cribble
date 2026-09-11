import { describe, expect, it } from 'vitest'
import {
  clampPage,
  PAGE_SIZE,
  pageBounds,
  pageItems,
  pageOf,
  rangeLabel,
  totalPagesFor
} from './burnPaging'

// The pure half of burnPaging: the arithmetic the hook and the pager
// lean on. The hook itself is React state over these and is exercised
// in the browser pass.

describe('PAGE_SIZE', () => {
  it('matches the GLOBAL board', () => {
    expect(PAGE_SIZE).toBe(25)
  })
})

describe('pageOf', () => {
  it('maps a 0-based row index to its 1-based page', () => {
    expect(pageOf(0)).toBe(1)
    expect(pageOf(24)).toBe(1)
    expect(pageOf(25)).toBe(2)
    expect(pageOf(49)).toBe(2)
    expect(pageOf(50)).toBe(3)
  })

  it('honours a custom page size', () => {
    expect(pageOf(9, 10)).toBe(1)
    expect(pageOf(10, 10)).toBe(2)
  })

  it('treats a negative index as the first row', () => {
    expect(pageOf(-1)).toBe(1)
  })
})

describe('totalPagesFor', () => {
  it('rounds up and never drops below one page', () => {
    expect(totalPagesFor(0)).toBe(1)
    expect(totalPagesFor(1)).toBe(1)
    expect(totalPagesFor(25)).toBe(1)
    expect(totalPagesFor(26)).toBe(2)
    expect(totalPagesFor(74)).toBe(3)
    expect(totalPagesFor(-5)).toBe(1)
  })
})

describe('clampPage', () => {
  it('keeps an in-range page', () => {
    expect(clampPage(2, 3)).toBe(2)
  })

  it('pins to the last page when the board shrank under the viewer', () => {
    expect(clampPage(4, 3)).toBe(3)
    expect(clampPage(9, 1)).toBe(1)
  })

  it('never goes below page one', () => {
    expect(clampPage(0, 3)).toBe(1)
    expect(clampPage(-2, 3)).toBe(1)
    expect(clampPage(2, 0)).toBe(1)
  })

  it('floors fractional input and treats NaN as page one', () => {
    expect(clampPage(2.7, 3)).toBe(2)
    expect(clampPage(Number.NaN, 3)).toBe(1)
  })
})

describe('pageBounds', () => {
  it('spans a full middle page', () => {
    expect(pageBounds(2, 25, 74)).toEqual({ from: 26, to: 50 })
  })

  it('cuts the last page at the total', () => {
    expect(pageBounds(3, 25, 74)).toEqual({ from: 51, to: 74 })
  })

  it('is 0 / 0 on an empty board', () => {
    expect(pageBounds(1, 25, 0)).toEqual({ from: 0, to: 0 })
  })
})

describe('rangeLabel', () => {
  it('prints zero-padded bounds over the total', () => {
    expect(rangeLabel(1, 25, 74)).toBe('01–25 / 74')
    expect(rangeLabel(3, 25, 74)).toBe('51–74 / 74')
  })

  it('pads to two digits like the [01] indices, no further', () => {
    expect(rangeLabel(1, 25, 7)).toBe('01–07 / 7')
    expect(rangeLabel(5, 25, 120)).toBe('101–120 / 120')
  })

  it('reads 00–00 / 0 on an empty board', () => {
    expect(rangeLabel(1, 25, 0)).toBe('00–00 / 0')
  })
})

describe('pageItems', () => {
  it('lists every page up to seven', () => {
    expect(pageItems(1, 1)).toEqual([1])
    expect(pageItems(2, 3)).toEqual([1, 2, 3])
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('folds the tail while the viewer is near the start', () => {
    expect(pageItems(1, 12)).toEqual([1, 2, 3, 4, 5, '…', 12])
    expect(pageItems(4, 12)).toEqual([1, 2, 3, 4, 5, '…', 12])
  })

  it('folds the head while the viewer is near the end', () => {
    expect(pageItems(12, 12)).toEqual([1, '…', 8, 9, 10, 11, 12])
    expect(pageItems(9, 12)).toEqual([1, '…', 8, 9, 10, 11, 12])
  })

  it('folds both sides around a middle page', () => {
    expect(pageItems(6, 12)).toEqual([1, '…', 5, 6, 7, '…', 12])
  })

  it('always fills exactly seven slots past seven pages', () => {
    for (let n = 8; n <= 40; n++) {
      for (let p = 1; p <= n; p++) {
        const items = pageItems(p, n)
        expect(items, `${p} of ${n}`).toHaveLength(7)
        expect(items).toContain(p)
        expect(items[0]).toBe(1)
        expect(items[items.length - 1]).toBe(n)
      }
    }
  })

  it('clamps an out-of-range page before building the window', () => {
    expect(pageItems(40, 12)).toEqual([1, '…', 8, 9, 10, 11, 12])
  })
})
