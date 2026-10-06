// The GLOBAL board's two filters. The scope menu picks a time window
// (season / all-time) and a camp: the pilots whose #1 tool is that
// machine. The country menu beside it picks the pilots who opted into
// ranking under a country. The two stack — CLAUDE + JAPAN is Japan's
// Claude pilots. Private rows arrive with an empty topTools list, so
// they never join a camp.

import { countryName } from '@/lib/leaderboardCountry'

export const STANDINGS_CAMPS = ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Cursor'] as const

export type CampId = (typeof STANDINGS_CAMPS)[number]
export type StandingsWindowId = 'season' | 'alltime'

/** Null on either side means that filter is off. */
export interface StandingsCut {
  camp: CampId | null
  country: string | null
}

const CAMP_LABEL: Record<CampId, string> = {
  ChatGPT: 'CHATGPT',
  Claude: 'CLAUDE',
  Gemini: 'GEMINI',
  Grok: 'GROK',
  Cursor: 'CURSOR'
}

export interface CampOption {
  id: CampId
  count: number
}

export interface CountryOption {
  code: string
  name: string
  count: number
}

type CutRow = {
  rank: number
  rankDelta?: number
  isNew?: boolean
  topTools?: readonly { name: string }[] | null
  country?: string | null
}

/** The machine that owns the row: the first stored tool, already ranked
 *  by score contribution. Blank names count as no machine. */
export function primaryToolName(row: {
  topTools?: readonly { name: string }[] | null
}): string | null {
  const name = row.topTools?.[0]?.name?.trim()
  return name ? name : null
}

/** Majors that actually have a #1 pilot on this board, in catalog order.
 *  A tool that is only someone's second machine does not open a camp. */
export function campsOnBoard(rows: readonly CutRow[]): CampOption[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const name = primaryToolName(row)
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return STANDINGS_CAMPS.flatMap((id) => {
    const count = counts.get(id) ?? 0
    return count > 0 ? [{ id, count }] : []
  })
}

/** Countries with at least one opted-in pilot, biggest first. */
export function countriesOnBoard(rows: readonly CutRow[]): CountryOption[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.country) continue
    counts.set(row.country, (counts.get(row.country) ?? 0) + 1)
  }
  return [...counts]
    .flatMap(([code, count]) => {
      const name = countryName(code)
      return name ? [{ code, name, count }] : []
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function campLabel(camp: CampId): string {
  return CAMP_LABEL[camp]
}

export function countryLabel(code: string): string {
  return (countryName(code) ?? code).toUpperCase()
}

/** The table heading for the filters that are on, or null for none. */
export function cutLabel(cut: StandingsCut): string | null {
  const parts = [
    cut.camp ? campLabel(cut.camp) : null,
    cut.country ? countryLabel(cut.country) : null
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Closed scope-button text. Season + no camp stays SEASON. A camp
 *  replaces that word. All-time stays visible, because it is the other
 *  axis. */
export function scopeButtonLabel(window: StandingsWindowId, camp: CampId | null): string {
  const campText = camp ? campLabel(camp) : null
  switch (window) {
    case 'season':
      return campText ?? 'SEASON'
    case 'alltime':
      return campText ? `${campText} · ALL-TIME` : 'ALL-TIME'
    default: {
      const exhaustive: never = window
      return exhaustive
    }
  }
}

/** Closed country-button text: the picked country, or the filter's name. */
export function countryButtonLabel(country: string | null): string {
  return country ? countryLabel(country) : 'COUNTRY'
}

/** The rows the table ranks. No filter keeps official ranks. A cut keeps
 *  score order, renumbers from 1, and clears global movement — that
 *  delta belongs to the full board, not to this slice. */
export function rowsInCut<T extends CutRow>(rows: readonly T[], cut: StandingsCut): T[] {
  if (!cut.camp && !cut.country) return [...rows]
  return rows
    .filter(
      (row) =>
        (!cut.camp || primaryToolName(row) === cut.camp) &&
        (!cut.country || row.country === cut.country)
    )
    .sort((a, b) => a.rank - b.rank)
    .map((row, index) => ({ ...row, rank: index + 1, rankDelta: 0, isNew: false }))
}
