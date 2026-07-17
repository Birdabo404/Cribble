// Canonical top-tools ranking, shared by the dashboard tools API, the
// leaderboard and the public profile builder so every surface crowns the
// same #1 tool. Tools are ranked by score contribution — the same session
// scoring that produces the leaderboard score — not raw visit counts:
// visits pay a flat 40 pts while real usage lives in verified active time,
// so a tool you ping often but barely use must not out-rank the one you
// actually work in.

import {
  normalizeLegacyEventValues,
  scoreFromEvents,
  type ScoreEventWithTimestamp
} from '@/lib/scoring'
import { resolveToolName } from '@/lib/toolNames'

export interface RankedTool {
  name: string
  visits: number
  active_ms: number
  score: number
  /** Share of the summed tool scores (0–100). */
  percent: number
  /** Share of total visits (0–100); the tools API still exposes it. */
  visitsPercent: number
}

/**
 * Aggregate raw events into ranked tools. Counting goes through the scoring
 * normalizer (heartbeat rows are not visits; visit rows carry no verified
 * active time), events with a blank domain are dropped, and each tool's
 * events are scored as sessions (per-event scoring is what broke the
 * multipliers in the first place).
 */
export function rankToolsFromEvents(
  events: ScoreEventWithTimestamp[]
): RankedTool[] {
  type ToolGroup = {
    name: string
    visits: number
    active_ms: number
    events: ScoreEventWithTimestamp[]
  }
  const grouped: Record<string, ToolGroup> = {}

  for (const ev of events) {
    const domain = String(ev.domain || '').toLowerCase()
    if (!domain) continue
    const name = resolveToolName(domain)
    if (!grouped[name]) {
      grouped[name] = { name, visits: 0, active_ms: 0, events: [] }
    }
    const normalized = normalizeLegacyEventValues(ev)
    grouped[name].visits += normalized.visits
    grouped[name].active_ms += normalized.activeMs
    grouped[name].events.push(ev)
  }

  const scored = Object.values(grouped)
    .map(({ events: toolEvents, ...tool }) => ({
      ...tool,
      score: scoreFromEvents(toolEvents)
    }))
    .sort((a, b) => b.score - a.score || b.visits - a.visits)

  const totalScore = scored.reduce((sum, tool) => sum + tool.score, 0)
  const totalVisits = scored.reduce((sum, tool) => sum + tool.visits, 0)

  return scored.map((tool) => ({
    ...tool,
    percent: totalScore > 0 ? Math.round((tool.score / totalScore) * 100) : 0,
    visitsPercent:
      totalVisits > 0 ? Math.round((tool.visits / totalVisits) * 100) : 0
  }))
}
