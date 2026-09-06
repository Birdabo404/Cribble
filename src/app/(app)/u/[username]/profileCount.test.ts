import { describe, expect, it } from 'vitest'
import {
  formatProfileCount,
  isProfileCountFormat,
  type ProfileCountFormat
} from './profileCount'

// The boot count-up writes this string on every frame and once more at the
// end; the markup renders the final value on its own. These tables pin the
// two to the same formatter so a tween can never land on a different
// numeral than the one SSR painted.

describe('isProfileCountFormat', () => {
  it.each<[string | undefined, boolean]>([
    ['score', true],
    ['duration', true],
    ['int', true],
    ['', false],
    ['SCORE', false],
    ['number', false],
    [undefined, false]
  ])('%j -> %s', (raw, expected) => {
    expect(isProfileCountFormat(raw)).toBe(expected)
  })
})

describe('formatProfileCount', () => {
  const cases: {
    name: string
    value: number
    format: ProfileCountFormat
    prefix: string
    expected: string
  }[] = [
    { name: 'int groups thousands', value: 53027, format: 'int', prefix: '', expected: '53,027' },
    { name: 'int rounds tween fractions', value: 1499.6, format: 'int', prefix: '', expected: '1,500' },
    { name: 'int zero (first frame)', value: 0, format: 'int', prefix: '', expected: '0' },
    { name: 'rank keeps its # prefix', value: 2, format: 'int', prefix: '#', expected: '#2' },
    { name: 'score stays exact under 100k', value: 53027, format: 'score', prefix: '', expected: '53,027' },
    { name: 'score compacts past 100k', value: 142500, format: 'score', prefix: '', expected: '143K' },
    { name: 'score rounds before compacting', value: 99999.4, format: 'score', prefix: '', expected: '99,999' },
    { name: 'duration under a second is 0s', value: 400, format: 'duration', prefix: '', expected: '0s' },
    { name: 'duration hours and minutes', value: 5 * 3_600_000 + 12 * 60_000, format: 'duration', prefix: '', expected: '5h 12m' },
    { name: 'duration minutes only', value: 42 * 60_000 + 30_000, format: 'duration', prefix: '', expected: '42m' },
    { name: 'duration past 100h drops minutes', value: 130 * 3_600_000 + 59 * 60_000, format: 'duration', prefix: '', expected: '130h' },
    { name: 'duration takes fractional ms', value: 2_999.9, format: 'duration', prefix: '', expected: '2s' }
  ]

  it.each(cases)('$name', ({ value, format, prefix, expected }) => {
    expect(formatProfileCount(value, format, prefix)).toBe(expected)
  })

  it('agrees with the markup at the final value for every format', () => {
    // What the panes render (see RecordPane) vs what onComplete writes.
    expect(formatProfileCount(53027, 'score', '')).toBe('53,027')
    expect(formatProfileCount(2, 'int', '#')).toBe('#2')
    expect(formatProfileCount(3_600_000 * 7, 'duration', '')).toBe('7h 0m')
  })
})
