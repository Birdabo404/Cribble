// Cursor-token burn estimates for the TEAMS board — the read-time
// conversion layer between cursor_profile_daily token sums and the
// board's exact-decimal USD strings. The database stores tokens only
// (migration 062's "no cost estimates" contract stays true): dollars
// are derived here at read time, so a future season's rate change
// re-prices history uniformly with zero migration.

import { calendarDateInTimeZone } from '@/lib/timeZone'
import { addExactIntegers, exactDecimal, exactInteger } from '@/lib/tokenLeaderboard'

/**
 * SEASON HOUSE RATE — dollars per million Cursor tokens, applied at
 * read time to cursor_profile_daily sums. Locked at season start and
 * published in the TEAMS board footer. Deliberately conservative
 * (the token board's personas treat a ≥$2/MTok blended rate as the
 * expensive tier) because scraped Cursor tokens carry no cache split.
 * Re-price between seasons only — never mid-season.
 */
export const CURSOR_HOUSE_RATE_USD_PER_MTOK = 1.0

/**
 * A Cursor token count at the season house rate, as an exact-decimal
 * USD string. At exactly $1.00/MTok, dollars = tokens × 1e-6 — a
 * six-place decimal shift, done in the repo's exact-string arithmetic
 * so token sums past 2^53 never round-trip through Number. The shift
 * IS the rate: cursorBurn.test.ts pins the constant to 1 so a season
 * re-price forces this implementation to change with it.
 */
export function cursorEstimateUsd(tokens: number | string | null | undefined): string {
  const digits = exactInteger(tokens).padStart(7, '0')
  return exactDecimal(`${digits.slice(0, -6)}.${digits.slice(-6)}`)
}

/**
 * The first UTC day a member's Cursor tokens may count toward a team:
 * the max of the day they proved ownership of their cursor.com handle
 * (cursor_profiles.verified_at), the day their affiliation on THIS
 * team went active, and the season start day (null when no season
 * calendar bounds the window). cursor.com backfills ~30 days of
 * history on claim, so without this floor a claim in the season's
 * final week would import a month of pre-claim, pre-roster tokens.
 * A member can sit on multiple teams with different activation dates,
 * so the floor is per (team, member). Inputs are ISO timestamps; the
 * result is a YYYY-MM-DD day compared lexicographically against
 * cursor_profile_daily.day.
 */
export function cursorBurnDayFloor(
  verifiedAt: string,
  affiliationActiveAt: string,
  seasonStartDay: string | null
): string {
  const days = [
    calendarDateInTimeZone(Date.parse(verifiedAt), 'UTC'),
    calendarDateInTimeZone(Date.parse(affiliationActiveAt), 'UTC')
  ]
  if (seasonStartDay !== null) days.push(seasonStartDay)
  return days.reduce((max, day) => (day > max ? day : max))
}

/**
 * Sum daily Cursor tokens on or after the floor day, in exact-integer
 * strings. Days before the floor are exactly the pre-claim/pre-roster
 * history the day floor exists to exclude; the window's UPPER bound is
 * the caller's query's job.
 */
export function sumCursorTokensFromDay(
  rows: readonly { day: string; tokens: number | string | null }[],
  floorDay: string
): string {
  let sum = '0'
  for (const row of rows) {
    if (row.day < floorDay) continue
    sum = addExactIntegers(sum, exactInteger(row.tokens))
  }
  return sum
}
