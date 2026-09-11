'use client'

// THE AGENTS CARD — the coding harnesses (Codex, Claude Code, Cursor,
// OpenCode, Hermes, Pi…) that the machine board cannot see. The browser
// extension never meets an agent, so agents have no verified-seconds
// score; what they do have is the USD their opted-in cribble-agent
// collectors report, and that is the currency here. Same chrome as the
// machine card: title bar, a header row, up to ten rows —
// `[01] ◎ Codex · OpenAI · $167,816 · 42 · 51%` — and a footnote that
// says exactly what the number is. On lg+ the card sits under the house
// machine in the side column and folds to three tracks (pilots and share
// tuck under the burn); below that it runs full width with five.
// Rows are not buttons: there is no breakdown to open, so nothing
// pretends to.

import { formatNumber } from '@/components/dashboard-v2/format'
import { AGENTS_TOP_N, padRank } from '@/components/leaderboard/ai/aiBoardState'
import { BurnValue } from '@/components/leaderboard/ai/AiSpecSheet'
import { AiAgentsTitleBar } from '@/components/leaderboard/ai/AiTitleBar'
import { ToolMark } from '@/components/leaderboard/ai/ToolMark'
import type { AiAgentRow } from '@/lib/aiLeaderboard'
import { aiToolMeta } from '@/lib/aiToolOrgs'
import { addExactDecimals, usdDisplayParts } from '@/lib/tokenLeaderboard'

export type AiAgentsProps = {
  agents: AiAgentRow[]
  /** `SEASON 04` | `ALL-TIME` — printed in the footnote. */
  windowLabel: string
}

export function AiAgents({ agents, windowLabel }: AiAgentsProps) {
  const rows = agents.slice(0, AGENTS_TOP_N)
  const total = agents.reduce((sum, agent) => addExactDecimals(sum, agent.burnUsd), '0')
  const totalParts = usdDisplayParts(total)
  const topPercent = agents[0]?.percent ?? 0

  return (
    <section className="aib-slab aib-agents" aria-label="Agentic harnesses ranked by opt-in burn">
      <AiAgentsTitleBar
        harnesses={agents.length}
        burnLabel={`${totalParts.tiny ? '<' : ''}$${totalParts.number}`}
      />
      <span className="aib-rule-x" aria-hidden />

      <div className="aib-table">
        <div className="aib-thead aib-grid" role="row">
          <span className="aib-th aib-th-left" role="columnheader">
            RANK
          </span>
          <span className="aib-th aib-th-left" role="columnheader">
            HARNESS
          </span>
          <span
            className="aib-th"
            role="columnheader"
            title="Estimated USD spend reported by opted-in cribble-agent collectors"
          >
            BURN†
          </span>
          <span className="aib-th aib-col-players" role="columnheader">
            PILOTS
          </span>
          <span
            className="aib-th aib-col-share"
            role="columnheader"
            title="Share of every harness\u2019s combined burn"
          >
            SHARE
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="aib-line">no harness burn reported in this window yet</p>
        ) : (
          <ol className="aib-rows">
            {rows.map((agent) => {
              const barPct =
                topPercent > 0 ? Math.max(2, (agent.percent / topPercent) * 100) : 0
              return (
                <li key={agent.name} className="aib-row" data-rank={agent.rank}>
                  <div className="aib-rowbtn aib-grid aib-rowflat">
                    <span className="aib-cell">
                      <span className="aib-idx" data-top={agent.rank <= 3 || undefined}>
                        [{padRank(agent.rank)}]
                      </span>
                    </span>

                    <span className="aib-cell aib-tool">
                      <ToolMark name={agent.name} size={24} className="aib-tool-mark" />
                      <span className="aib-tool-text">
                        <span className="aib-tool-line">
                          <span className="aib-name">{agent.name}</span>
                        </span>
                        <span className="aib-sub">{aiToolMeta(agent.name).org}</span>
                      </span>
                    </span>

                    <span className="aib-cell aib-num aib-score">
                      <span className="aib-score-main">
                        <BurnValue value={agent.burnUsd} />
                      </span>
                      <span className="aib-sub aib-asub">
                        {formatNumber(agent.pilots)} {agent.pilots === 1 ? 'pilot' : 'pilots'} ·{' '}
                        {agent.percent}%
                      </span>
                    </span>

                    <span className="aib-cell aib-col-players aib-num">
                      {formatNumber(agent.pilots)}
                    </span>

                    <span className="aib-cell aib-col-share aib-share">
                      <span className="aib-num">{agent.percent}%</span>
                      <span className="aib-sharebar" aria-hidden>
                        <span className="aib-sharebar-fill" style={{ width: `${barPct}%` }} />
                      </span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <p className="aib-foot">
        † BURN = ESTIMATED API SPEND REPORTED BY OPTED-IN CRIBBLE-AGENT COLLECTORS · SEPARATE
        FROM THE MACHINE SCORE · {windowLabel} · TOP {AGENTS_TOP_N}
      </p>
    </section>
  )
}
