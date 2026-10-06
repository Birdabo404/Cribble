// The GLOBAL board's scope menu: a time window (season / all-time) and
// one cut of the same player race. A camp is the pilots whose #1 tool
// is that machine; a country is the pilots who opted into ranking there.
// Camp and country never stack — picking one clears the other. Private
// rows arrive with an empty topTools list, so they never join a camp.

import { countryName } from '@/lib/leaderboardCountry'

export const STANDINGS_CAMPS = ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Cursor'] as const

export type CampId = (typeof STANDINGS_CAMPS)[number]
export type StandingsWindowId = 'season' | 'alltime'

export type StandingsCut =
  | { kind: 'everyone' }
  | { kind: 'camp'; camp: CampId }
  | { kind: 'country'; code: string }

export const EVERYONE: StandingsCut = { kind: 'everyone' }

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

/** The cut's own name, or null for everyone. */
export function cutLabel(cut: StandingsCut): string | null {
  switch (cut.kind) {
    case 'everyone':
      return null
    case 'camp':
      return campLabel(cut.camp)
    case 'country':
      return countryLabel(cut.code)
    default: {
      const exhaustive: never = cut
      return exhaustive
    }
  }
}

export function sameCut(a: StandingsCut, b: StandingsCut): boolean {
  switch (a.kind) {
    case 'everyone':
      return b.kind === 'everyone'
    case 'camp':
      return b.kind === 'camp' && b.camp === a.camp
    case 'country':
      return b.kind === 'country' && b.code === a.code
    default: {
      const exhaustive: never = a
      return exhaustive
    }
  }
}

/** Closed-button text. Season + everyone stays SEASON. A cut replaces
 *  that word. All-time stays visible, because it is the other axis. */
export function scopeButtonLabel(window: StandingsWindowId, cut: StandingsCut): string {
  const cutText = cutLabel(cut)
  switch (window) {
    case 'season':
      return cutText ?? 'SEASON'
    case 'alltime':
      return cutText ? `${cutText} · ALL-TIME` : 'ALL-TIME'
    default: {
      const exhaustive: never = window
      return exhaustive
    }
  }
}

function inCut(row: CutRow, cut: StandingsCut): boolean {
  switch (cut.kind) {
    case 'everyone':
      return true
    case 'camp':
      return primaryToolName(row) === cut.camp
    case 'country':
      return row.country === cut.code
    default: {
      const exhaustive: never = cut
      return exhaustive
    }
  }
}

/** True while the cut still has pilots on this board. */
export function cutIsAvailable(
  cut: StandingsCut,
  camps: readonly CampOption[],
  countries: readonly CountryOption[]
): boolean {
  switch (cut.kind) {
    case 'everyone':
      return true
    case 'camp':
      return camps.some((item) => item.id === cut.camp)
    case 'country':
      return countries.some((item) => item.code === cut.code)
    default: {
      const exhaustive: never = cut
      return exhaustive
    }
  }
}

/** The rows the table ranks. Everyone keeps official ranks. A cut keeps
 *  score order, renumbers from 1, and clears global movement — that
 *  delta belongs to the full board, not to this slice. */
export function rowsInCut<T extends CutRow>(rows: readonly T[], cut: StandingsCut): T[] {
  if (cut.kind === 'everyone') return [...rows]
  return rows
    .filter((row) => inCut(row, cut))
    .sort((a, b) => a.rank - b.rank)
    .map((row, index) => ({ ...row, rank: index + 1, rankDelta: 0, isNew: false }))
}
