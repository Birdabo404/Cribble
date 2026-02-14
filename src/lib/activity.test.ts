import { describe, it, expect } from 'vitest'
import { calculateStreak } from './activity'

describe('calculateStreak', () => {
  it('returns 0 when there is no activity', () => {
    expect(calculateStreak([], '2025-01-05')).toBe(0)
  })

  it('counts consecutive days ending today', () => {
    const activity = [
      { date: '2025-01-03', score: 10 },
      { date: '2025-01-04', score: 5 },
      { date: '2025-01-05', score: 2 }
    ]

    expect(calculateStreak(activity, '2025-01-05')).toBe(3)
  })

  it('stops at the first gap', () => {
    const activity = [
      { date: '2025-01-02', score: 10 },
      { date: '2025-01-04', score: 5 },
      { date: '2025-01-05', score: 2 }
    ]

    expect(calculateStreak(activity, '2025-01-05')).toBe(2)
  })

  it('ignores zero-score days', () => {
    const activity = [
      { date: '2025-01-03', score: 0 },
      { date: '2025-01-04', score: 1 },
      { date: '2025-01-05', score: 2 }
    ]

    expect(calculateStreak(activity, '2025-01-05')).toBe(2)
  })
})
