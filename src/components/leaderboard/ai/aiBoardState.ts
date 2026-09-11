// The AI board's control vocabulary — the handful of union types the
// prompt, the table and the root all speak, plus the pure helpers that
// turn them into text (the `rank --window=… --sort=…` tail, `[01]`
// indices, window labels) or into a row order. No React, no DOM: the
// components compose these, the root owns the state.

import type { AiToolRow } from '@/lib/aiLeaderboard'
import type { AiToolCategory } from '@/lib/aiToolOrgs'

/** The board prints the top 25 machines of whatever the controls leave
 *  in — a leaderboard, not a ledger. Filtering and sorting run over the
 *  whole window first, then the cut. */
export const TOP_N = 25

/** The AGENTS panel is a shorter list: every harness with any burn, up
 *  to ten seats. */
export const AGENTS_TOP_N = 10

/** The two embedded ranking windows. SEASON only exists while a season
 *  is live — the API sends boards.season: null otherwise. */
export type AiWindowId = 'season' | 'alltime'

/** Sortable columns — exactly the three numeric columns the table shows.
 *  Official `rank` is always the score rank; sorting only reorders the
 *  rows on screen. */
export type AiSortKey = 'score' | 'players' | 'share'
export type AiSortDir = 'desc' | 'asc'

export type AiCategoryFilter = AiToolCategory | 'all'

/** Title-bar freshness state. `stale` = the refetch failed but cached
 *  rows are still on screen; `offline` = nothing to show. */
export type AiStatus = 'sync' | 'live' | 'stale' | 'offline'

export const SORT_FIELD: Record<AiSortKey, (tool: AiToolRow) => number> = {
  score: (tool) => tool.score,
  players: (tool) => tool.pilots,
  share: (tool) => tool.percent
}

/** Reorder without mutating; ties fall back to the official rank so the
 *  order is deterministic between renders. */
export function sortTools(
  tools: readonly AiToolRow[],
  key: AiSortKey,
  dir: AiSortDir
): AiToolRow[] {
  const field = SORT_FIELD[key]
  const sign = dir === 'desc' ? -1 : 1
  return [...tools].sort(
    (a, b) => sign * (field(a) - field(b)) || a.rank - b.rank
  )
}

/** `[01]`-style zero-padded rank. Two digits until the board passes 99. */
export function padRank(rank: number): string {
  return String(rank).padStart(2, '0')
}

/** `SEASON 04` while a live season fronts the page, `ALL-TIME` otherwise. */
export function windowLabel(
  window: AiWindowId,
  seasonNumber: number | null
): string {
  if (window !== 'season') return 'ALL-TIME'
  return seasonNumber === null ? 'SEASON' : `SEASON ${padRank(seasonNumber)}`
}

/** Everything after `rank ` on the prompt line — the part that re-types
 *  when state changes. Flags in stable order so a keystroke in the filter
 *  only changes the quoted tail. Defaults stay implicit, the way a shell
 *  history would show them: `--sort` only appears once it is not score. */
export function commandTail(state: {
  window: AiWindowId
  sort: AiSortKey
  dir: AiSortDir
  category: AiCategoryFilter
  query: string
}): string {
  const parts = [`--window=${state.window}`, `--top=${TOP_N}`]
  if (state.sort !== 'score') parts.push(`--sort=${state.sort}`)
  if (state.dir === 'asc') parts.push('--asc')
  if (state.category !== 'all') parts.push(`--category=${state.category}`)
  const q = state.query.trim()
  if (q) parts.push(`"${q.replace(/"/g, '')}"`)
  return parts.join(' ')
}

/** Title-bar freshness stamp; the caller re-renders on a tick. */
export function updatedLabel(generatedAt: string | null, now: number): string {
  if (!generatedAt) return 'CONNECTING'
  const mins = Math.floor((now - new Date(generatedAt).getTime()) / 60_000)
  return mins <= 0 ? 'UPDATED JUST NOW' : `UPDATED ${mins}M AGO`
}

/** Stable DOM id for a row's expanded spec sheet (aria-controls). */
export function sheetId(name: string): string {
  return `aib-sheet-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}
