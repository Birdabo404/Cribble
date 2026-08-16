import { describe, expect, it } from 'vitest'
import type { ActivityDay } from '@/lib/activity'
import { PUNCH_CARD_DAYS, buildActivityPunchCard } from './activityHeatmap'

// Pinned today 2026-08-16 (repo convention): the card spans SEP 2025 → AUG
// 2026, whose month lengths happen to sum to exactly 365 days — including
// the non-leap FEB 2026 (28 days) and the DEC '25 → JAN '26 year boundary.

const TODAY = new Date(Date.UTC(2026, 7, 16))

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const day = (date: string, score: number): ActivityDay => ({ date, score })

describe('buildActivityPunchCard', () => {
  it('builds the last 12 calendar months, oldest first, current month last', () => {
    const { months } = buildActivityPunchCard([], TODAY)

    expect(months.map((m) => [m.label, m.year, m.monthIndex])).toEqual([
      ['SEP', 2025, 8],
      ['OCT', 2025, 9],
      ['NOV', 2025, 10],
      ['DEC', 2025, 11],
      ['JAN', 2026, 0],
      ['FEB', 2026, 1],
      ['MAR', 2026, 2],
      ['APR', 2026, 3],
      ['MAY', 2026, 4],
      ['JUN', 2026, 5],
      ['JUL', 2026, 6],
      ['AUG', 2026, 7]
    ])
  })

  it('emits one cell per real day of each month — the ragged edge', () => {
    const { months } = buildActivityPunchCard([], TODAY)

    const lengths = months.map((m) => m.cells.length)
    expect(lengths).toEqual([30, 31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31])

    for (const month of months) {
      expect(month.cells.length).toBeLessThanOrEqual(PUNCH_CARD_DAYS)
      month.cells.forEach((cell, i) => expect(cell.day).toBe(i + 1))
      // The last cell is the month's real last day — nothing past it.
      const last = month.cells[month.cells.length - 1]
      expect(last.dateKey.endsWith(String(month.cells.length).padStart(2, '0'))).toBe(true)
    }
  })

  it('orders cells chronologically across the whole window', () => {
    const { months } = buildActivityPunchCard([], TODAY)
    const keys = months.flatMap((m) => m.cells.map((c) => c.dateKey))

    expect(keys).toHaveLength(365)
    expect(keys[0]).toBe('2025-09-01')
    expect(keys[keys.length - 1]).toBe('2026-08-31')
    // ISO date keys sort lexicographically in chronological order.
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('flags today and future days only in the current month row', () => {
    const { months } = buildActivityPunchCard([], TODAY)

    const aug = months[11]
    const todayCell = aug.cells[15]
    expect(todayCell).toMatchObject({
      dateKey: '2026-08-16',
      day: 16,
      isToday: true,
      isFuture: false
    })

    const future = aug.cells.filter((cell) => cell.isFuture)
    expect(future.map((cell) => cell.day)).toEqual(
      Array.from({ length: 15 }, (_, i) => 17 + i)
    )

    for (const month of months.slice(0, 11)) {
      expect(month.cells.some((cell) => cell.isFuture || cell.isToday)).toBe(false)
    }
  })

  it('maps scores by UTC date key and zero-fills missing days', () => {
    const { months } = buildActivityPunchCard(
      [day('2026-08-16', 5), day('2025-09-01', 3)],
      TODAY
    )

    const cells = months.flatMap((m) => m.cells)
    const byKey = new Map(cells.map((cell) => [cell.dateKey, cell]))
    expect(byKey.get('2026-08-16')?.score).toBe(5)
    expect(byKey.get('2025-09-01')?.score).toBe(3)
    expect(cells.filter((cell) => cell.score > 0)).toHaveLength(2)
  })

  it('zeroes scores on future days and excludes them from all stats', () => {
    const card = buildActivityPunchCard(
      [
        day('2026-08-20', 70), // future
        day('2026-08-16', 7) // today
      ],
      TODAY
    )

    const aug = card.months[11]
    expect(aug.cells[19]).toMatchObject({ dateKey: '2026-08-20', score: 0, isFuture: true })

    expect(card.activeDays).toBe(1)
    expect(aug.activeDays).toBe(1)
    expect(card.bestDay).toBe(7)
    expect(card.maxScore).toBe(7)
    expect(card.avgPerDay).toBe(7)
    expect(card.longestStreak).toBe(1)
  })

  it('carries streaks across month boundaries and averages over active days', () => {
    const card = buildActivityPunchCard(
      [
        day('2025-09-29', 2),
        day('2025-09-30', 4),
        day('2025-10-01', 6),
        day('2025-10-02', 8),
        day('2026-03-05', 1),
        day('2026-03-06', 1)
      ],
      TODAY
    )

    expect(card.longestStreak).toBe(4) // SEP 29–30 → OCT 1–2
    expect(card.activeDays).toBe(6)
    expect(card.bestDay).toBe(8)
    expect(card.maxScore).toBe(8)
    expect(card.avgPerDay).toBe(4) // round(22 / 6)
  })

  it('counts per-month active days', () => {
    const { months } = buildActivityPunchCard(
      [
        day('2025-09-10', 1),
        day('2025-09-20', 1),
        day('2026-02-14', 3)
      ],
      TODAY
    )

    expect(months[0].activeDays).toBe(2) // SEP '25
    expect(months[5].activeDays).toBe(1) // FEB '26
    expect(months[1].activeDays).toBe(0) // OCT '25
  })

  it('always fits inside the 365-day fetch, even in the Dec 31 worst case', () => {
    const decemberEnd = new Date(Date.UTC(2026, 11, 31))
    const { months } = buildActivityPunchCard([], decemberEnd)

    expect(months[0]).toMatchObject({ label: 'JAN', year: 2026, monthIndex: 0 })
    expect(months[11]).toMatchObject({ label: 'DEC', year: 2026, monthIndex: 11 })

    // Jan 1 is exactly 364 days before Dec 31 — the oldest fetched day.
    const firstKey = months[0].cells[0].dateKey
    expect(firstKey).toBe('2026-01-01')
    const firstMs = new Date(`${firstKey}T00:00:00.000Z`).getTime()
    expect((decemberEnd.getTime() - firstMs) / ONE_DAY_MS).toBe(364)
  })

  it('floors maxScore at 1 and zeroes the other stats with no activity', () => {
    const card = buildActivityPunchCard([], TODAY)
    expect(card.maxScore).toBe(1)
    expect(card.activeDays).toBe(0)
    expect(card.bestDay).toBe(0)
    expect(card.avgPerDay).toBe(0)
    expect(card.longestStreak).toBe(0)
    expect(card.months.every((month) => month.activeDays === 0)).toBe(true)
  })

  it('normalizes an injected mid-day date to its UTC day start', () => {
    const midDay = new Date(Date.UTC(2026, 7, 16, 17, 45, 12))
    const card = buildActivityPunchCard([day('2026-08-16', 5)], midDay)
    const todayCell = card.months[11].cells[15]
    expect(todayCell).toMatchObject({ dateKey: '2026-08-16', score: 5, isToday: true })
    expect(card.months[11].cells.filter((cell) => cell.isFuture)).toHaveLength(15)
  })
})
