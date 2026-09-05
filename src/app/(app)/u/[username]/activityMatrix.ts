// ACTIVITY GRID geometry for the RECORD pane: the last 13 weeks as a
// 13 x 7 dot matrix (columns = weeks oldest first, rows = Sun..Sat, UTC),
// ending on the week that contains `now`. Pure so the motion hook's grid
// stagger and the markup agree on cell order, and so the level buckets
// are pinned by tests rather than eyeballed. Rendered by ActivityGrid.tsx
// (this file is not activityGrid.ts because that name and the component's
// differ only in case — a collision on case-insensitive filesystems).
//
// Days are UTC because the rollup (lib/userStats computeUserStatsRollup)
// buckets by UTC date key — local-midnight math would shift every dot a
// day for anyone east of UTC.

import type { ActivityDay } from '@/lib/userStats'

export const GRID_WEEKS = 13
export const GRID_DAYS = 7

const DAY_MS = 86_400_000

/** 0 = no activity; 1..4 = quartile of the window's non-zero days. */
export type GridLevel = 0 | 1 | 2 | 3 | 4

export interface GridCell {
  /** UTC date key, 'YYYY-MM-DD'. */
  date: string
  /** 0 for future cells regardless of input. */
  activeMs: number
  level: GridLevel
  /** After today (UTC) — rendered as a vacant slot, never counted. */
  future: boolean
}

export interface ActivityGrid {
  /** GRID_WEEKS columns, oldest first; each GRID_DAYS cells Sun..Sat. */
  weeks: GridCell[][]
  /** Busiest non-future day in the window; 0 when idle. */
  maxMs: number
  /** Consecutive active UTC days ending today or yesterday. */
  currentStreak: number
  /** Non-future days in the window with activity. */
  activeDays: number
}

export interface MonthTick {
  /** Week column index (0 = oldest). */
  column: number
  /** 'JAN'..'DEC'. */
  label: string
}

const MONTH_LABELS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
] as const

const utcMidnight = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

const dateKey = (ms: number): string => new Date(ms).toISOString().split('T')[0]

/**
 * Level assignment. With four or more distinct non-zero values the buckets
 * are quartiles by rank (bottom quarter = 1, top quarter = 4; ties share a
 * level). Below that a quartile split is meaningless, so levels fall back
 * to a plain fraction of the max (one busy day reads as 4, a half-as-busy
 * day as 2) — small windows still get contrast instead of a flat row.
 */
function levelScale(values: number[]): (ms: number) => GridLevel {
  const sorted = [...values].sort((a, b) => a - b)
  const distinct = new Set(sorted).size
  if (sorted.length === 0) return () => 0
  if (distinct < 4) {
    const max = sorted[sorted.length - 1]
    return (ms) => {
      if (ms <= 0) return 0
      return Math.min(4, Math.max(1, Math.ceil((ms / max) * 4))) as GridLevel
    }
  }
  const n = sorted.length
  return (ms) => {
    if (ms <= 0) return 0
    // Rank = count of values strictly below ms (lower bound).
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < ms) lo = mid + 1
      else hi = mid
    }
    return Math.min(4, 1 + Math.floor((lo / n) * 4)) as GridLevel
  }
}

/** Consecutive active days ending today or, if today is still empty,
 *  yesterday — the same grace GitHub gives a streak before midnight. */
function streakEnding(active: Set<string>, todayMs: number): number {
  let cursor = todayMs
  if (!active.has(dateKey(cursor))) {
    cursor -= DAY_MS
    if (!active.has(dateKey(cursor))) return 0
  }
  let streak = 0
  while (active.has(dateKey(cursor))) {
    streak++
    cursor -= DAY_MS
  }
  return streak
}

export function buildActivityGrid(days: ActivityDay[], now: Date): ActivityGrid {
  const todayMs = utcMidnight(now)
  const todayKey = dateKey(todayMs)
  // Sunday of the current week is the last column's first cell.
  const lastWeekStart = todayMs - new Date(todayMs).getUTCDay() * DAY_MS
  const firstMs = lastWeekStart - (GRID_WEEKS - 1) * GRID_DAYS * DAY_MS

  const byDate = new Map<string, number>()
  for (const day of days) {
    if (!(day.activeMs > 0)) continue
    byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.activeMs)
  }

  // Window values feed the buckets; the streak sees every day handed in
  // (the rollup already caps the list, and a streak older than the grid
  // is still a streak).
  const windowValues: number[] = []
  for (let i = 0; i < GRID_WEEKS * GRID_DAYS; i++) {
    const key = dateKey(firstMs + i * DAY_MS)
    if (key > todayKey) break
    const ms = byDate.get(key)
    if (ms) windowValues.push(ms)
  }
  const level = levelScale(windowValues)

  const weeks: GridCell[][] = []
  for (let w = 0; w < GRID_WEEKS; w++) {
    const week: GridCell[] = []
    for (let d = 0; d < GRID_DAYS; d++) {
      const ms = firstMs + (w * GRID_DAYS + d) * DAY_MS
      const date = dateKey(ms)
      const future = date > todayKey
      const activeMs = future ? 0 : byDate.get(date) ?? 0
      week.push({ date, activeMs, level: level(activeMs), future })
    }
    weeks.push(week)
  }

  return {
    weeks,
    maxMs: windowValues.length ? Math.max(...windowValues) : 0,
    currentStreak: streakEnding(new Set(byDate.keys()), todayMs),
    activeDays: windowValues.length
  }
}

/** Cells oldest -> newest (column-major), the DOM order the grid renders
 *  in and the order the boot stagger walks. */
export function flattenChronological(grid: Pick<ActivityGrid, 'weeks'>): GridCell[] {
  return grid.weeks.flat()
}

/** One tick per month boundary: the first column, then every column
 *  whose Sunday falls in a different month than the previous column's.
 *  A three-letter label spans about two columns, so when the second
 *  boundary lands on column 1 the leading tick is dropped rather than
 *  drawn over. */
export function monthTicks(grid: Pick<ActivityGrid, 'weeks'>): MonthTick[] {
  const ticks: MonthTick[] = []
  let lastMonth = -1
  grid.weeks.forEach((week, column) => {
    const month = Number(week[0].date.slice(5, 7)) - 1
    if (month !== lastMonth) {
      ticks.push({ column, label: MONTH_LABELS[month] })
      lastMonth = month
    }
  })
  if (ticks.length > 1 && ticks[1].column === 1) ticks.shift()
  return ticks
}
