import { describe, expect, it } from 'vitest'
import { presentLiveCount } from './visitorPresent'

describe('presentLiveCount', () => {
  it('keeps an empty pulse at zero', () => {
    expect(presentLiveCount(0)).toBe(0)
    expect(presentLiveCount(-2)).toBe(0)
    expect(presentLiveCount(Number.NaN)).toBe(0)
  })

  it('stays between one and three per live slot', () => {
    for (let live = 1; live <= 40; live++) {
      const shown = presentLiveCount(live)
      expect(shown).toBeGreaterThanOrEqual(live)
      expect(shown).toBeLessThanOrEqual(live * 3)
    }
  })

  it('is stable for the same live count', () => {
    expect(presentLiveCount(7)).toBe(presentLiveCount(7))
    expect(presentLiveCount(7)).toBe(15)
  })

  it('grows by one, two, or three when a slot is added', () => {
    let previous = 0
    const deltas = new Set<number>()
    for (let live = 1; live <= 40; live++) {
      const shown = presentLiveCount(live)
      const delta = shown - previous
      expect(delta).toBeGreaterThanOrEqual(1)
      expect(delta).toBeLessThanOrEqual(3)
      deltas.add(delta)
      previous = shown
    }
    expect(deltas).toEqual(new Set([1, 2, 3]))
  })
})
