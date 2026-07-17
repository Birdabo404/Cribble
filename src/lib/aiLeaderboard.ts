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
 * Fold the RPC's all-time and trailing-week rows into the ranked board.
 * Week rows only decorate (weekScore); ranking is all-time, tiebroken
 * by pilots then name so equal scores never flip-flop between reads.
 */
export function buildAiBoard(
  allTimeRows: AiToolTotalsRow[],
  weekRows: AiToolTotalsRow[] = []
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
  for (const row of allTimeRows) {
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
      pilots: toCount(row.pilots)
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
      percent: scoreSum > 0 ? Math.round((tool.score / scoreSum) * 100) : 0
    })),
    totals
  }
}
