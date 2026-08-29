// Shared wire types + builder for the CURSOR source of THE BURN board.
// The /api/leaderboard/cursor-agents route assembles CursorBoardApiResponse
// from these; the board UI imports the row/totals/window types from here.
// Window semantics are the token board's, reused verbatim.

import {
  addExactIntegers,
  compareExactIntegers,
  exactInteger,
  type TokenBoardTeam,
  type TokenBoardWindow,
  type TokenBoardWindowId
} from '@/lib/tokenLeaderboard'

export type CursorBoardWindowId = TokenBoardWindowId
export type CursorBoardWindow = TokenBoardWindow
export type CursorBoardTeam = TokenBoardTeam

/** Raw cursor_profile_leaderboard(p_start, p_end) row (migration 062). */
export interface CursorLeaderboardRpcRow {
  user_id: number | string
  username: string | null
  profile_image: string | null
  cursor_username: string | null
  display_name: string | null
  avatar_url: string | null
  joined_date: string | null
  current_streak: number | string | null
  longest_streak: number | string | null
  longest_agent_seconds: number | string | null
  top_models: unknown
  tokens: number | string | null
  agents_local: number | string | null
  agents_cloud: number | string | null
  active_days: number | string | null
  last_synced_at: string | null
}

export interface CursorBoardRow {
  rank: number
  userId: number
  /** Cribble account identity (twitter_username, falling back to User{id}). */
  username: string
  /** The claimed cursor.com handle, lowercase, without the leading @. */
  cursorUsername: string
  /** cursor.com display name, falling back to the Cribble username. */
  displayName: string
  /** cursor.com avatar, falling back to the Cribble profile image. */
  avatarUrl: string | null
  /** Window token sum as an exact integer string (token-board convention). */
  tokens: string
  /** Window agent-run sums from the daily series. */
  agentsLocal: number
  agentsCloud: number
  /** Latest-scrape profile stats (not window-scoped). */
  currentStreak: number
  longestStreak: number
  longestAgentSeconds: number
  /** Ranked model names, most used first. */
  topModels: string[]
  /** Raw subscription tier for the Pro check; route-hydrated. */
  tier: string | null
  /** Active affiliation to an approved team, or null. Route-hydrated. */
  team: CursorBoardTeam | null
}

export interface CursorBoardTotals {
  pilots: number
  totalTokens: string
  agentsLocal: number
  agentsCloud: number
  topTokens: string
}

export interface CursorBoard {
  rows: CursorBoardRow[]
  totals: CursorBoardTotals
}

/** The exact JSON /api/leaderboard/cursor-agents returns on success. */
export interface CursorBoardApiResponse {
  success: true
  rows: CursorBoardRow[]
  totals: CursorBoardTotals
  window: CursorBoardWindow
  /** False while migration 062 has not reached the database yet. */
  schemaReady: boolean
  generatedAt: string
}

function finiteCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

const TOP_MODELS_LIMIT = 10

/** top_models arrives as jsonb — trust nothing about its shape. Shared
 *  with the settings status route, which reads the same column. */
export function cleanCursorTopModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    const name =
      typeof item === 'string'
        ? item.trim()
        : typeof (item as { name?: unknown })?.name === 'string'
          ? ((item as { name: string }).name).trim()
          : ''
    if (name && !names.includes(name)) names.push(name)
    if (names.length >= TOP_MODELS_LIMIT) break
  }
  return names
}

/**
 * Ranks RPC rows into board rows: window tokens descending, agent runs
 * breaking ties. Rows with no window activity at all are dropped —
 * a profile synced but idle for the window has nothing to rank.
 * tier/team stay null here; the route hydrates them afterwards
 * (identical contract to buildTokenBoard).
 */
export function buildCursorBoard(source: CursorLeaderboardRpcRow[]): CursorBoard {
  const unranked = source.map((item) => {
    const userId = finiteCount(item.user_id)
    const username = item.username?.trim() || `User${userId}`
    const tokens = exactInteger(item.tokens)
    return {
      userId,
      username,
      cursorUsername: item.cursor_username?.trim().toLowerCase() ?? '',
      displayName: item.display_name?.trim() || username,
      avatarUrl: item.avatar_url ?? item.profile_image ?? null,
      tokens,
      agentsLocal: finiteCount(item.agents_local),
      agentsCloud: finiteCount(item.agents_cloud),
      currentStreak: finiteCount(item.current_streak),
      longestStreak: finiteCount(item.longest_streak),
      longestAgentSeconds: finiteCount(item.longest_agent_seconds),
      topModels: cleanCursorTopModels(item.top_models),
      tier: null as string | null,
      team: null as CursorBoardTeam | null
    }
  })

  const rows: CursorBoardRow[] = unranked
    .filter(
      (row) =>
        row.userId > 0 &&
        row.cursorUsername !== '' &&
        (compareExactIntegers(row.tokens, '0') > 0 ||
          row.agentsLocal + row.agentsCloud > 0)
    )
    .sort(
      (a, b) =>
        compareExactIntegers(b.tokens, a.tokens) ||
        b.agentsLocal + b.agentsCloud - (a.agentsLocal + a.agentsCloud) ||
        a.userId - b.userId
    )
    .map((row, index) => ({ ...row, rank: index + 1 }))

  return {
    rows,
    totals: {
      pilots: rows.length,
      totalTokens: rows.reduce((sum, row) => addExactIntegers(sum, row.tokens), '0'),
      agentsLocal: rows.reduce((sum, row) => sum + row.agentsLocal, 0),
      agentsCloud: rows.reduce((sum, row) => sum + row.agentsCloud, 0),
      topTokens: rows[0]?.tokens ?? '0'
    }
  }
}
