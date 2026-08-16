import type { ActivityDay } from '@/lib/activity'

// Day cells are UTC days: the activity API buckets scores by UTC date key
// (see src/app/api/user/activity/route.ts), so the punch card must be built
// from UTC midnights too. Local-midnight math shifted every key back a day
// for users east of UTC — the "today" cell showed yesterday and today's
// activity hid in a "future" cell.

/** Day columns in the punch-card grid — the longest month. Months shorter
 * than 31 days simply emit fewer cells (the ragged punch-card edge). */
export const PUNCH_CARD_DAYS = 31

const MONTHS_SHOWN = 12

const MONTH_LABELS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
] as const

export interface PunchCardCell {
  /** UTC date key 'YYYY-MM-DD' — the activity API's bucket key. */
  dateKey: string
  /** Day of month, 1-based (= the grid column the cell renders in). */
  day: number
  /** 0 for future cells regardless of input. */
  score: number
  isFuture: boolean
  isToday: boolean
}

export interface PunchCardMonth {
  label: string
  year: number
  /** 0 = January … 11 = December. */
  monthIndex: number
  /** Days with score > 0 in this month (future days excluded). */
  activeDays: number
  /** One cell per real day of the month, day 1 first. */
  cells: PunchCardCell[]
}

export interface ActivityPunchCard {
  /** The last 12 calendar months, oldest first, current month last. */
  months: PunchCardMonth[]
  /** Days with score > 0 across the whole window (future days excluded). */
  activeDays: number
  /** Best score in the window, floored at 1 so intensity ratios stay valid. */
  maxScore: number
  longestStreak: number
  bestDay: number
  /** Rounded mean score across active days. */
  avgPerDay: number
}

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

function toDateKeyUtc(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Builds the punch card: the last 12 calendar months as rows (first-of-month
 * start, so the oldest row is usually partial-window-free), one cell per real
 * day, plus per-month active counts and the window stats. `todayUtc` is
 * injectable so tests can pin the window.
 *
 * Every non-future cell is backed by fetched data: the last 12 calendar
 * months always fit inside the 365-day `/api/user/activity` fetch — the
 * worst case is today = Dec 31, where Jan 1 of the same year is exactly
 * 364 days back. So unlike the old 53-week grid there is no out-of-window
 * state to handle.
 */
export function buildActivityPunchCard(
  activity: ActivityDay[],
  todayUtc: Date = new Date()
): ActivityPunchCard {
  const scoreByDate = new Map<string, number>()
  for (const day of activity) scoreByDate.set(day.date, day.score)

  const today = utcDayStart(todayUtc)
  const todayKey = toDateKeyUtc(today)
  const todayYear = today.getUTCFullYear()
  const todayMonth = today.getUTCMonth()

  const months: PunchCardMonth[] = []
  let activeDays = 0
  let bestDay = 0
  let totalScore = 0
  let longestStreak = 0
  let run = 0

  // Oldest month first and days ascending — one chronological pass, so the
  // streak counter naturally crosses month (and year) boundaries.
  for (let offset = MONTHS_SHOWN - 1; offset >= 0; offset--) {
    // Date.UTC normalizes out-of-range month values, rolling into the
    // previous year as needed.
    const monthStart = new Date(Date.UTC(todayYear, todayMonth - offset, 1))
    const year = monthStart.getUTCFullYear()
    const monthIndex = monthStart.getUTCMonth()
    // Day 0 of the next month = this month's last day.
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()

    const cells: PunchCardCell[] = []
    let monthActiveDays = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, monthIndex, day))
      const dateKey = toDateKeyUtc(date)
      const isFuture = date.getTime() > today.getTime()
      const score = isFuture ? 0 : scoreByDate.get(dateKey) ?? 0
      cells.push({
        dateKey,
        day,
        score,
        isFuture,
        isToday: dateKey === todayKey
      })

      if (isFuture) continue
      if (score > 0) {
        monthActiveDays += 1
        activeDays += 1
        totalScore += score
        if (score > bestDay) bestDay = score
        run += 1
        if (run > longestStreak) longestStreak = run
      } else {
        run = 0
      }
    }

    months.push({
      label: MONTH_LABELS[monthIndex],
      year,
      monthIndex,
      activeDays: monthActiveDays,
      cells
    })
  }

  return {
    months,
    activeDays,
    maxScore: bestDay > 0 ? bestDay : 1,
    longestStreak,
    bestDay,
    avgPerDay: activeDays > 0 ? Math.round(totalScore / activeDays) : 0
  }
}
