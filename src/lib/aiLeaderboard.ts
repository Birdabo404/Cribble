// THE AI LEADERBOARD — ranks the AI tools themselves by everyone's
// combined usage. The heavy lifting happens in the ai_tool_totals RPC
// (migration 019): one site-wide GROUP BY instead of fetching every
// user's events. This module owns the two sides of that contract:
// the domain→tool map the RPC merges/allowlists with, and the pricing
// of its totals into the score currency players already know —
// verified active seconds + flat visit points (SCORE_POLICY). The
// per-session multipliers are intentionally absent: they need
// per-user sessionization, which a site-wide aggregate cannot do.

import { listTrackedAiDomains } from '@/lib/aiDomains'
import { SCORE_POLICY } from '@/lib/scoring'
import type { SeasonState } from '@/lib/season'
import {
  AGENT_AI_TOOL_NAMES,
  addExactDecimals,
  exactDecimal,
  normalizeAgentId
} from '@/lib/tokenLeaderboard'
import { resolveToolName } from '@/lib/toolNames'

/** Row shape returned by the ai_tool_totals RPC. The `tool: null` row
 *  is the GROUPING SETS grand total (its pilot count is the site-wide
 *  DISTINCT count, which per-tool rows cannot be summed into). */
export interface AiToolTotalsRow {
  tool: string | null
  active_ms: number | string | null
  visits: number | string | null
  pilots: number | string | null
}

/** Row shape returned by the agent_burn_by_agent RPC (migration 048).
 *  Numerics arrive as strings — cost_usd must stay exact-decimal. */
export interface AgentBurnRpcRow {
  agent: string | null
  cost_usd: number | string | null
  pilots: number | string | null
}

/** One ranked tool, as served by /api/leaderboard/ai. */
export interface AiToolRow {
  rank: number
  name: string
  score: number
  /** Score earned in the trailing window (7d) — display-only. */
  weekScore: number
  active_ms: number
  visits: number
  /** Distinct users who produced events on this tool. */
  pilots: number
  /** Share of the summed tool scores (0–100). */
  percent: number
  /** Opt-in estimated USD attributed to this tool's agents — exact
   *  decimal, '0' when none. Display-only: the sort never reads it. */
  burnUsd: string
}

export interface AiBoardTotals {
  score: number
  active_ms: number
  visits: number
  /** Site-wide distinct pilots (not the sum of per-tool counts). */
  pilots: number
}

export interface AiBoard {
  tools: AiToolRow[]
  totals: AiBoardTotals
}

/**
 * Domain→tool map handed to the RPC. Doubles as the ingestion-side
 * allowlist there, so it must cover every tracked domain — except
 * cribble.dev, which is tracked for user scores but has no business
 * ranking itself on the AI board.
 */
export function buildAiToolDomainMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const domain of listTrackedAiDomains()) {
    if (domain === 'cribble.dev') continue
    map[domain] = resolveToolName(domain)
  }
  return map
}

const toCount = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

/** Same price list as the player score, minus session multipliers. */
export function scoreAiTotals(activeMs: number, visits: number): number {
  return Math.round(
    activeMs / SCORE_POLICY.activeMsPerPoint + visits * SCORE_POLICY.visitPoints
  )
}

/**
 * Fold agent_burn_by_agent rows into tool-name → exact-decimal USD.
 * Only agents in AGENT_AI_TOOL_NAMES survive; everything else (codex,
 * opencode, unknown strings) is dropped — agent spend must never mint
 * a tool row the usage aggregate didn't earn. Sibling agents of one
 * tool (claude + claude-code) sum with addExactDecimals.
 */
export function burnByToolName(rows: AgentBurnRpcRow[]): Map<string, string> {
  const burn = new Map<string, string>()
  for (const row of rows) {
    if (!row.agent) continue
    const tool = AGENT_AI_TOOL_NAMES[normalizeAgentId(row.agent)]
    if (!tool) continue
    burn.set(tool, addExactDecimals(burn.get(tool) ?? '0', exactDecimal(row.cost_usd)))
  }
  return burn
}

/**
 * Fold one window's RPC rows into a ranked board. Week rows only
 * decorate (weekScore); ranking is that window's score, tiebroken by
 * pilots then name so equal scores never flip-flop between reads.
 * burnByTool only attaches to tools already on the board — burn is a
 * column, never a sort key, and never invents a row.
 */
export function buildAiBoard(
  windowRows: AiToolTotalsRow[],
  weekRows: AiToolTotalsRow[] = [],
  burnByTool: ReadonlyMap<string, string> = new Map()
): AiBoard {
  const weekScoreByTool = new Map<string, number>()
  for (const row of weekRows) {
    if (row.tool === null) continue
    weekScoreByTool.set(
      row.tool,
      scoreAiTotals(toCount(row.active_ms), toCount(row.visits))
    )
  }

  let totals: AiBoardTotals = { score: 0, active_ms: 0, visits: 0, pilots: 0 }

  const scored: Omit<AiToolRow, 'rank' | 'percent'>[] = []
  for (const row of windowRows) {
    const active_ms = toCount(row.active_ms)
    const visits = toCount(row.visits)
    const score = scoreAiTotals(active_ms, visits)
    if (row.tool === null) {
      totals = { score, active_ms, visits, pilots: toCount(row.pilots) }
      continue
    }
    scored.push({
      name: row.tool,
      score,
      weekScore: weekScoreByTool.get(row.tool) ?? 0,
      active_ms,
      visits,
      pilots: toCount(row.pilots),
      burnUsd: burnByTool.get(row.tool) ?? '0'
    })
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || b.pilots - a.pilots || a.name.localeCompare(b.name)
  )

  const scoreSum = scored.reduce((sum, tool) => sum + tool.score, 0)

  return {
    tools: scored.map((tool, idx) => ({
      ...tool,
      rank: idx + 1,
      // Percent is recomputed per window over THIS window's score sum.
      percent: scoreSum > 0 ? Math.round((tool.score / scoreSum) * 100) : 0
    })),
    totals
  }
}

/** Both windows of the AI board, as embedded in the /api/leaderboard/ai
 *  payload. `season` is null during intermission or with no calendar —
 *  ai_tool_totals has no upper bound, so a closed season window cannot
 *  be computed and ALL-TIME becomes the default view. */
export interface AiBoards {
  alltime: AiBoard
  season: AiBoard | null
}

/**
 * Assemble both windows from raw RPC rows. The season board exists only
 * while the season is genuinely rankable (phase active + a current
 * season); each window prices, ranks and percents its own rows, and
 * each carries its own burn map so season burn never leaks into the
 * lifetime column.
 */
export function assembleAiBoards(input: {
  seasonState: SeasonState
  allTimeRows: AiToolTotalsRow[]
  seasonRows?: AiToolTotalsRow[] | null
  weekRows?: AiToolTotalsRow[]
  allTimeBurnRows?: AgentBurnRpcRow[]
  seasonBurnRows?: AgentBurnRpcRow[]
}): AiBoards {
  const weekRows = input.weekRows ?? []
  const seasonRankable =
    input.seasonState.phase === 'active' &&
    input.seasonState.current !== null &&
    Array.isArray(input.seasonRows)

  return {
    alltime: buildAiBoard(
      input.allTimeRows,
      weekRows,
      burnByToolName(input.allTimeBurnRows ?? [])
    ),
    season: seasonRankable
      ? buildAiBoard(
          input.seasonRows!,
          weekRows,
          burnByToolName(input.seasonBurnRows ?? [])
        )
      : null
  }
}
