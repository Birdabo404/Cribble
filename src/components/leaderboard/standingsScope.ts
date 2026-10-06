// The GLOBAL board's scope menu: a time window (season / all-time) and
// a camp cut of the same player race. A camp is the pilots whose #1
// tool is that machine. Private rows arrive with an empty topTools
// list, so they stay on Everyone and never join a camp.

export const STANDINGS_CAMPS = ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Cursor'] as const

export type CampId = (typeof STANDINGS_CAMPS)[number]
export type CampFilter = 'everyone' | CampId
export type StandingsWindowId = 'season' | 'alltime'

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

type CampRow = {
  rank: number
  rankDelta?: number
  isNew?: boolean
  topTools?: readonly { name: string }[] | null
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
export function campsOnBoard(rows: readonly CampRow[]): CampOption[] {
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

export function campLabel(camp: CampFilter): string {
  if (camp === 'everyone') return 'EVERYONE'
  return CAMP_LABEL[camp]
}

/** Closed-button text. Season + everyone stays SEASON. A camp replaces
 *  that word. All-time stays visible, because it is the other axis. */
export function scopeButtonLabel(window: StandingsWindowId, camp: CampFilter): string {
  const campText = camp === 'everyone' ? null : CAMP_LABEL[camp]
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

/** The rows the table ranks. Everyone keeps official ranks. A camp keeps
 *  score order, renumbers from 1, and clears global movement — that
 *  delta belongs to the full board, not to this cut. */
export function rowsInCamp<T extends CampRow>(rows: readonly T[], camp: CampFilter): T[] {
  if (camp === 'everyone') return [...rows]
  return rows
    .filter((row) => primaryToolName(row) === camp)
    .sort((a, b) => a.rank - b.rank)
    .map((row, index) => ({ ...row, rank: index + 1, rankDelta: 0, isNew: false }))
}
