import { describe, expect, it } from 'vitest'
import type { ActivityDay } from '@/lib/userStats'
import {
  buildActivityGrid,
  flattenChronological,
  GRID_DAYS,
  GRID_WEEKS,
  monthTicks,
  type GridLevel
} from './activityMatrix'

// Pinned now = Thu 2026-09-03 10:00Z. The week containing it runs Sun
// 2026-08-30 .. Sat 2026-09-05, so the grid spans Sun 2026-06-07 .. Sat
// 2026-09-05 (91 cells) and the last two cells are in the future.

const NOW = new Date('2026-09-03T10:00:00.000Z')
const DAY_MS = 86_400_000

const day = (date: string, activeMs: number): ActivityDay => ({ date, activeMs })

const keyDaysAgo = (n: number) =>
  new Date(Date.UTC(2026, 8, 3) - n * DAY_MS).toISOString().split('T')[0]

describe('buildActivityGrid shape', () => {
  it('is 13 weeks x 7 days ending on the week containing now', () => {
    const grid = buildActivityGrid([], NOW)
    expect(grid.weeks).toHaveLength(GRID_WEEKS)
    for (const week of grid.weeks) expect(week).toHaveLength(GRID_DAYS)
    expect(grid.weeks[0][0].date).toBe('2026-06-07')
    expect(grid.weeks[12][0].date).toBe('2026-08-30')
    expect(grid.weeks[12][6].date).toBe('2026-09-05')
  })

  it('places today at [last week][UTC weekday]', () => {
    const grid = buildActivityGrid([day('2026-09-03', 1_000)], NOW)
    const today = grid.weeks[12][4]
    expect(today.date).toBe('2026-09-03')
    expect(today.activeMs).toBe(1_000)
    expect(today.future).toBe(false)
  })

  it('rows are Sun..Sat and consecutive across columns', () => {
    const cells = flattenChronological(buildActivityGrid([], NOW))
    expect(cells).toHaveLength(GRID_WEEKS * GRID_DAYS)
    for (let i = 1; i < cells.length; i++) {
      const prev = Date.parse(`${cells[i - 1].date}T00:00:00.000Z`)
      const next = Date.parse(`${cells[i].date}T00:00:00.000Z`)
      expect(next - prev).toBe(DAY_MS)
    }
    expect(new Date(`${cells[0].date}T00:00:00.000Z`).getUTCDay()).toBe(0)
  })

  it('uses the UTC date of now, not local midnight', () => {
    // 23:30Z on the 3rd is still the 3rd; 00:30Z on the 4th is the 4th.
    expect(buildActivityGrid([], new Date('2026-09-03T23:30:00.000Z')).weeks[12][4].future).toBe(false)
    expect(buildActivityGrid([], new Date('2026-09-04T00:30:00.000Z')).weeks[12][5].future).toBe(false)
  })

  it('flattenChronological is oldest -> newest, column-major', () => {
    const grid = buildActivityGrid([], NOW)
    const cells = flattenChronological(grid)
    expect(cells[0]).toBe(grid.weeks[0][0])
    expect(cells[7]).toBe(grid.weeks[1][0])
    expect(cells[cells.length - 1]).toBe(grid.weeks[12][6])
  })
})

describe('future cells', () => {
  it('flags every cell after today and zeroes their activity', () => {
    const grid = buildActivityGrid([day('2026-09-04', 9_999), day('2026-09-05', 9_999)], NOW)
    const [, , , , today, fri, sat] = grid.weeks[12]
    expect(today.future).toBe(false)
    expect(fri).toEqual({ date: '2026-09-04', activeMs: 0, level: 0, future: true })
    expect(sat).toEqual({ date: '2026-09-05', activeMs: 0, level: 0, future: true })
    expect(grid.activeDays).toBe(0)
    expect(grid.maxMs).toBe(0)
  })

  it('has no future cells when now is a Saturday', () => {
    const grid = buildActivityGrid([], new Date('2026-09-05T12:00:00.000Z'))
    expect(flattenChronological(grid).some((c) => c.future)).toBe(false)
  })
})

describe('window', () => {
  it('ignores days before the first column and counts only in-window days', () => {
    const grid = buildActivityGrid(
      [day('2026-06-06', 5_000), day('2026-06-07', 5_000), day('2026-09-03', 5_000)],
      NOW
    )
    expect(grid.activeDays).toBe(2)
    expect(grid.weeks[0][0].activeMs).toBe(5_000)
    expect(flattenChronological(grid).find((c) => c.date === '2026-06-06')).toBeUndefined()
  })

  it('reports maxMs over the window', () => {
    const grid = buildActivityGrid(
      [day('2026-06-01', 99_999), day('2026-07-01', 4_000), day('2026-08-01', 7_000)],
      NOW
    )
    expect(grid.maxMs).toBe(7_000)
  })

  it('merges duplicate dates', () => {
    const grid = buildActivityGrid([day('2026-09-01', 1_000), day('2026-09-01', 2_000)], NOW)
    expect(grid.weeks[12][2].activeMs).toBe(3_000)
    expect(grid.activeDays).toBe(1)
  })
})

describe('levels', () => {
  const levelOf = (grid: ReturnType<typeof buildActivityGrid>, date: string): GridLevel =>
    flattenChronological(grid).find((c) => c.date === date)!.level

  it('level 0 for idle days', () => {
    const grid = buildActivityGrid([day('2026-09-01', 1)], NOW)
    expect(levelOf(grid, '2026-08-31')).toBe(0)
  })

  it('quartiles by rank with 4+ distinct values', () => {
    const grid = buildActivityGrid(
      [
        day('2026-08-24', 10),
        day('2026-08-25', 20),
        day('2026-08-26', 30),
        day('2026-08-27', 40)
      ],
      NOW
    )
    expect(levelOf(grid, '2026-08-24')).toBe(1)
    expect(levelOf(grid, '2026-08-25')).toBe(2)
    expect(levelOf(grid, '2026-08-26')).toBe(3)
    expect(levelOf(grid, '2026-08-27')).toBe(4)
  })

  it('ties share a level and the max is always 4', () => {
    const grid = buildActivityGrid(
      [
        day('2026-08-20', 5),
        day('2026-08-21', 5),
        day('2026-08-22', 5),
        day('2026-08-23', 5),
        day('2026-08-24', 6),
        day('2026-08-25', 7),
        day('2026-08-26', 8),
        day('2026-08-27', 1_000)
      ],
      NOW
    )
    expect(levelOf(grid, '2026-08-20')).toBe(1)
    expect(levelOf(grid, '2026-08-23')).toBe(1)
    expect(levelOf(grid, '2026-08-27')).toBe(4)
    for (const cell of flattenChronological(grid)) {
      if (cell.activeMs > 0) expect(cell.level).toBeGreaterThanOrEqual(1)
      else expect(cell.level).toBe(0)
    }
  })

  it('degrades to a max-relative scale below 4 distinct values', () => {
    const one = buildActivityGrid([day('2026-09-01', 500)], NOW)
    expect(levelOf(one, '2026-09-01')).toBe(4)

    const two = buildActivityGrid([day('2026-09-01', 25), day('2026-09-02', 100)], NOW)
    expect(levelOf(two, '2026-09-01')).toBe(1)
    expect(levelOf(two, '2026-09-02')).toBe(4)

    const three = buildActivityGrid(
      [day('2026-08-30', 30), day('2026-08-31', 60), day('2026-09-01', 100), day('2026-09-02', 100)],
      NOW
    )
    expect(levelOf(three, '2026-08-30')).toBe(2)
    expect(levelOf(three, '2026-08-31')).toBe(3)
    expect(levelOf(three, '2026-09-01')).toBe(4)
  })

  it('never emits a level outside 0..4', () => {
    const days: ActivityDay[] = []
    for (let i = 0; i < 91; i++) days.push(day(keyDaysAgo(i), (i * 7919) % 5_000 + 1))
    for (const cell of flattenChronological(buildActivityGrid(days, NOW))) {
      expect([0, 1, 2, 3, 4]).toContain(cell.level)
    }
  })
})

describe('currentStreak', () => {
  it('is 0 with no activity', () => {
    expect(buildActivityGrid([], NOW).currentStreak).toBe(0)
  })

  it('counts consecutive days ending today', () => {
    const grid = buildActivityGrid(
      [day(keyDaysAgo(2), 1), day(keyDaysAgo(1), 1), day(keyDaysAgo(0), 1)],
      NOW
    )
    expect(grid.currentStreak).toBe(3)
  })

  it('a streak ending yesterday still counts (today not over yet)', () => {
    const grid = buildActivityGrid([day(keyDaysAgo(2), 1), day(keyDaysAgo(1), 1)], NOW)
    expect(grid.currentStreak).toBe(2)
  })

  it('a streak ending two days ago is broken', () => {
    const grid = buildActivityGrid([day(keyDaysAgo(3), 1), day(keyDaysAgo(2), 1)], NOW)
    expect(grid.currentStreak).toBe(0)
  })

  it('a gap stops the count', () => {
    const grid = buildActivityGrid(
      [day(keyDaysAgo(5), 1), day(keyDaysAgo(4), 1), day(keyDaysAgo(2), 1), day(keyDaysAgo(0), 1)],
      NOW
    )
    expect(grid.currentStreak).toBe(1)
  })

  it('today alone is a streak of 1', () => {
    expect(buildActivityGrid([day(keyDaysAgo(0), 1)], NOW).currentStreak).toBe(1)
  })

  it('zero-ms days do not extend a streak', () => {
    const grid = buildActivityGrid([day(keyDaysAgo(1), 0), day(keyDaysAgo(2), 1)], NOW)
    expect(grid.currentStreak).toBe(0)
  })

  it('can run past the grid window', () => {
    const days: ActivityDay[] = []
    for (let i = 0; i < 120; i++) days.push(day(keyDaysAgo(i), 1))
    expect(buildActivityGrid(days, NOW).currentStreak).toBe(120)
  })
})

describe('monthTicks', () => {
  it('labels the first column and each month boundary by Sunday', () => {
    expect(monthTicks(buildActivityGrid([], NOW))).toEqual([
      { column: 0, label: 'JUN' },
      { column: 4, label: 'JUL' },
      { column: 8, label: 'AUG' }
    ])
  })

  it('drops the leading tick when the next boundary is adjacent', () => {
    // Sun 2026-06-28 is column 0 when now is Thu 2026-09-24; column 1 is
    // Sun 2026-07-05, so a JUN label would sit under JUL.
    const ticks = monthTicks(buildActivityGrid([], new Date('2026-09-24T10:00:00.000Z')))
    expect(ticks[0]).toEqual({ column: 1, label: 'JUL' })
    expect(ticks.map((t) => t.label)).toEqual(['JUL', 'AUG', 'SEP'])
  })
})
