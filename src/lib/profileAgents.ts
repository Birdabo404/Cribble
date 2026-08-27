// Pure assembly for the profile's AGENTIC block. Turns the single
// consent-gated row of agent_profile_agents (migration 058) into the
// display list both the profile page and the PlayerCard modal render.
// Shares cleanBreakdown/exactRatioPercent with the token leaderboard so
// the profile can never disagree with the Burn Board about a player's
// agent mix — token totals exceed 2^53, so the math stays in exact
// integer strings and only the final percent becomes a Number.

import { cleanBreakdown, exactInteger, exactRatioPercent } from '@/lib/tokenLeaderboard'

/** Shape of the one aggregate row agent_profile_agents returns. */
export interface AgentProfileRow {
  total_tokens: number | string | null
  cost_usd: number | string | null
  active_days: number | string | null
  agent_breakdown: Array<{ name?: unknown; totalTokens?: unknown }> | null
  agent_breakdown_complete: boolean | null
}

export interface PublicProfileAgent {
  /** Raw agent id as reported by the CLI ('claude-code'); display via tokenAgentLabel(). */
  name: string
  /** Exact integer string — token totals exceed 2^53. */
  totalTokens: string
  /** Share of this user's agent tokens, 0-100. */
  percent: number
}

export function buildProfileAgents(
  row: AgentProfileRow | null,
  limit = 3
): PublicProfileAgent[] {
  if (!row) return []
  const totalTokens = exactInteger(row.total_tokens)
  return cleanBreakdown(row.agent_breakdown)
    .slice(0, limit)
    .map((item) => ({
      name: item.name,
      totalTokens: item.totalTokens,
      // Same rounding TokenPlayerCard applies at display time, so both
      // surfaces show identical shares for the same player.
      percent: Math.round(exactRatioPercent(item.totalTokens, totalTokens))
    }))
}
