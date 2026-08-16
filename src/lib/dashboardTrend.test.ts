import { describe, expect, it } from 'vitest'
import type { ActivityDay } from '@/types/dashboard'
import {
  TREND_RANGES,
  buildTrendRange,
  formatUtcDayLabel,
  type TrendRangeDays
} from './dashboardTrend'

// Every fixture pins todayUtc to 2026-08-16 so window boundaries and labels
// are deterministic: 27 days back crosses into July and 83 days back into
// May, exercising month-boundary labels. For a 7-day range the current
// window is Aug 10–16 and the previous window Aug 3–9.

const TODAY = new Date(Date.UTC(2026, 7, 16))

const day = (date: string, score: number): ActivityDay => ({ date, score })

describe('buildTrendRange', () => {
  it('builds each supported range with exactly `days` unique points ending today', () => {
    expect(TREND_RANGES).toEqual([7, 14, 28, 84])

    const expectedStart: Record<TrendRangeDays, string> = {
      7: '2026-08-10',
      14: '2026-08-03',
      28: '2026-07-20',
      84: '2026-05-25'
    }

    for (const days of TREND_RANGES) {
      const range = buildTrendRange([], days, TODAY)
      expect(range.days).toBe(days)
      expect(range.points).toHaveLength(days)
      expect(range.points[0].date).toBe(expectedStart[days])
      expect(range.points[days - 1].date).toBe('2026-08-16')

      // ISO date keys sort lexicographically in chronological order, so a
      // sorted copy matching the original proves oldest → newest ordering.
      const dates = range.points.map((point) => point.date)
      expect([...dates].sort()).toEqual(dates)
      expect(new Set(dates).size).toBe(days)
      expect(range.points.every((point) => point.score === 0)).toBe(true)
    }
  })

  it('zero-fills missing days regardless of input order', () => {
    const range = buildTrendRange(
      [day('2026-08-16', 5), day('2026-08-12', 3)],
      7,
      TODAY
    )

    expect(range.points).toEqual([
      { date: '2026-08-10', score: 0 },
      { date: '2026-08-11', score: 0 },
      { date: '2026-08-12', score: 3 },
      { date: '2026-08-13', score: 0 },
      { date: '2026-08-14', score: 0 },
      { date: '2026-08-15', score: 0 },
      { date: '2026-08-16', score: 5 }
    ])
  })

  it('sums only the current window and the immediately preceding window', () => {
    const range = buildTrendRange(
      [
        day('2026-08-02', 999), // day before the previous window — ignored
        day('2026-08-03', 4), // previous window start
        day('2026-08-09', 6), // previous window end
        day('2026-08-10', 2), // current window start
        day('2026-08-16', 5), // current window end (today)
        day('2026-08-17', 999) // future day — ignored
      ],
      7,
      TODAY
    )

    expect(range.total).toBe(7)
    expect(range.prevTotal).toBe(10)
    expect(range.deltaPct).toBe(-30)
  })

  it('rounds deltaPct to the nearest percent in both directions', () => {
    const grew = buildTrendRange(
      [day('2026-08-16', 10), day('2026-08-05', 3)],
      7,
      TODAY
    )
    expect(grew.total).toBe(10)
    expect(grew.prevTotal).toBe(3)
    expect(grew.deltaPct).toBe(233) // 233.33…%

    const shrank = buildTrendRange(
      [day('2026-08-16', 3), day('2026-08-05', 9)],
      7,
      TODAY
    )
    expect(shrank.deltaPct).toBe(-67) // -66.66…%
  })

  it('returns a null deltaPct when the previous window total is 0', () => {
    const range = buildTrendRange([day('2026-08-14', 12)], 7, TODAY)
    expect(range.total).toBe(12)
    expect(range.prevTotal).toBe(0)
    expect(range.deltaPct).toBeNull()
  })

  it('floors peak at 1 on all-zero data so y-scales stay valid', () => {
    const empty = buildTrendRange([], 14, TODAY)
    expect(empty.peak).toBe(1)
    expect(empty.total).toBe(0)

    const zeroed = buildTrendRange(
      [day('2026-08-15', 0), day('2026-08-16', 0)],
      14,
      TODAY
    )
    expect(zeroed.peak).toBe(1)
  })

  it('reports the current-window max as peak', () => {
    const range = buildTrendRange(
      [day('2026-08-11', 4), day('2026-08-14', 9), day('2026-08-03', 50)],
      7,
      TODAY
    )
    expect(range.peak).toBe(9) // 50 sits in the previous window, not this one
  })

  it('labels the window ends across month boundaries for a fixed todayUtc', () => {
    const month = buildTrendRange([], 28, TODAY)
    expect(month.startLabel).toBe('Jul 20')
    expect(month.endLabel).toBe('Aug 16')

    const quarter = buildTrendRange([], 84, TODAY)
    expect(quarter.startLabel).toBe('May 25')
    expect(quarter.endLabel).toBe('Aug 16')

    const week = buildTrendRange([], 7, TODAY)
    expect(week.startLabel).toBe('Aug 10')
    expect(week.endLabel).toBe('Aug 16')
  })

  it('normalizes an injected mid-day date to its UTC day start', () => {
    const midDay = new Date(Date.UTC(2026, 7, 16, 17, 45, 12))
    const range = buildTrendRange([day('2026-08-16', 5)], 7, midDay)
    expect(range.points[6]).toEqual({ date: '2026-08-16', score: 5 })
    expect(range.points[0].date).toBe('2026-08-10')
  })
})

describe('formatUtcDayLabel', () => {
  it('formats date keys from UTC parts', () => {
    expect(formatUtcDayLabel('2026-08-16')).toBe('Aug 16')
    expect(formatUtcDayLabel('2026-01-05')).toBe('Jan 5')
    expect(formatUtcDayLabel('2025-12-31')).toBe('Dec 31')
  })

  it('is stable across process timezones', () => {
    // Kiritimati (UTC+14) catches local-midnight parsing bugs; Niue (UTC-11)
    // catches local-part reads, where UTC midnight is still the previous day.
    const originalTz = process.env.TZ
    try {
      for (const tz of ['UTC', 'Pacific/Kiritimati', 'America/New_York', 'Pacific/Niue']) {
        process.env.TZ = tz
        expect(formatUtcDayLabel('2026-08-16')).toBe('Aug 16')
        expect(formatUtcDayLabel('2026-01-01')).toBe('Jan 1')
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })
})
