import { describe, expect, it } from 'vitest'
import { last12hRange, readVisitorCount } from './datafast'

describe('readVisitorCount', () => {
  it('reads the documented realtime envelope', () => {
    expect(readVisitorCount({ status: 'success', data: [{ visitors: 42 }] })).toBe(42)
  })

  it('reads an object-shaped data payload and a count alias', () => {
    expect(readVisitorCount({ data: { visitors: 7 } })).toBe(7)
    expect(readVisitorCount({ data: { count: 3 } })).toBe(3)
  })

  it('reads a top-level visitors field', () => {
    expect(readVisitorCount({ visitors: 12 })).toBe(12)
  })

  it('rejects missing, negative, or non-numeric counts', () => {
    expect(readVisitorCount(null)).toBeNull()
    expect(readVisitorCount({ data: [] })).toBeNull()
    expect(readVisitorCount({ data: [{ visitors: -1 }] })).toBeNull()
    expect(readVisitorCount({ data: [{ visitors: '12' }] })).toBeNull()
  })
})

describe('last12hRange', () => {
  it('spans exactly twelve hours ending at now', () => {
    const now = new Date('2026-08-21T15:10:00.000Z')
    expect(last12hRange(now)).toEqual({
      startAt: '2026-08-21T03:10:00.000Z',
      endAt: '2026-08-21T15:10:00.000Z'
    })
  })
})
