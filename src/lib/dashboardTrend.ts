import type { ActivityDay } from '@/types/dashboard'

// The activity API buckets scores by UTC date key (see
// src/app/api/user/activity/route.ts), so every window here is built from
// UTC midnights via Date.UTC arithmetic. Local-midnight math shifts keys by
// a day for users east or west of UTC — same rule as the ActivityCard grid.

export const TREND_RANGES = [7, 14, 28, 84] as const
export type TrendRangeDays = (typeof TREND_RANGES)[number]

export interface TrendPoint {
  /** UTC date key, 'YYYY-MM-DD'. */
  date: string
  score: number
}

export interface TrendRange {
  days: TrendRangeDays
  /** Exactly `days` entries, oldest → newest, missing days zero-filled. */
  points: TrendPoint[]
  /** Highest score in the window, floored at 1 so y-scales stay valid. */
  peak: number
  total: number
  /** Sum of the `days` days immediately before the window. */
  prevTotal: number
  /** Rounded percent change vs the prior window; null when prevTotal is 0 (renders as NEW). */
  deltaPct: number | null
  /** e.g. 'Jul 18' — UTC-stable. */
  startLabel: string
  /** e.g. 'Aug 16' — UTC-stable. */
  endLabel: string
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

function toDateKeyUtc(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * 'YYYY-MM-DD' → 'Aug 16'. Reads UTC parts of an explicit-Z timestamp and a
 * fixed month table (no locale APIs), so the output is identical regardless
 * of the machine's timezone.
 */
export function formatUtcDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

/**
 * Prepares the `days` most recent UTC days ending today (inclusive), plus
 * the total of the immediately preceding `days`-day window for the delta
 * readout. Activity entries outside the two windows are ignored.
 */
export function buildTrendRange(
  activity: ActivityDay[],
  days: TrendRangeDays,
  todayUtc: Date = new Date()
): TrendRange {
  // UTC days are always exactly 24h (no DST), so stepping in ONE_DAY_MS
  // increments from a UTC midnight always lands on another UTC midnight.
  const end = utcDayStart(todayUtc)
  const keyFor = (daysAgo: number): string =>
    toDateKeyUtc(new Date(end.getTime() - daysAgo * ONE_DAY_MS))

  const scoreByDate = new Map<string, number>()
  for (const day of activity) scoreByDate.set(day.date, day.score)

  const points: TrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = keyFor(i)
    points.push({ date, score: scoreByDate.get(date) ?? 0 })
  }

  let prevTotal = 0
  for (let i = days; i < days * 2; i++) {
    prevTotal += scoreByDate.get(keyFor(i)) ?? 0
  }

  const total = points.reduce((sum, point) => sum + point.score, 0)
  const peak = points.reduce((max, point) => Math.max(max, point.score), 1)
  const deltaPct =
    prevTotal === 0 ? null : Math.round(((total - prevTotal) / prevTotal) * 100)

  return {
    days,
    points,
    peak,
    total,
    prevTotal,
    deltaPct,
    startLabel: formatUtcDayLabel(points[0].date),
    endLabel: formatUtcDayLabel(points[points.length - 1].date)
  }
}
