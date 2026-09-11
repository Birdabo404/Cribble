'use client'

// The docked strip under the slabs: the viewer's own machine as one flat
// line — `▸ YOUR MACHINE  [02] Claude · Anthropic  ···  121,004  +9,312` —
// or the recruit line when they have no most-used AI yet. A machine
// ranked past the top 25 still gets its line (rank, score, gain) but the
// strip reads as a readout, not a jump — there is no row to land on.
// data-lb-dock keeps the LeaderboardScrollRuntime docking contract
// (per-frame translate while the smoother is live; CSS sticky is the
// native fallback). Near-opaque bg, no blur: the strip re-samples nothing.

import { formatNumber } from '@/components/dashboard-v2/format'
import { padRank, TOP_N } from '@/components/leaderboard/ai/aiBoardState'
import type { AiToolRow } from '@/lib/aiLeaderboard'

export type AiDockProps = {
  /** The viewer's machine in the active window; null = recruit line. */
  tool: AiToolRow | null
  org: string
  /** Scroll to the row and open its spec sheet. */
  onJump: () => void
}

export function AiDock({ tool, org, onJump }: AiDockProps) {
  const listed = tool !== null && tool.rank <= TOP_N

  const line = tool && (
    <>
      <span className="aib-dock-k">▸ YOUR MACHINE</span>
      <span className="aib-idx" data-top={tool.rank <= 3 || undefined}>
        [{padRank(tool.rank)}]
      </span>
      <span className="aib-dock-name">
        {tool.name}
        <span className="aib-dock-org"> · {org}</span>
      </span>
      <span className="aib-dock-dots" aria-hidden>
        ···
      </span>
      {!listed && <span className="aib-dock-note">OUTSIDE THE TOP {TOP_N}</span>}
      <span className="aib-dock-score">{formatNumber(tool.score)}</span>
      <span className="aib-dock-delta">
        {tool.weekScore > 0 ? `+${formatNumber(tool.weekScore)}` : '—'}
      </span>
    </>
  )

  return (
    <div
      data-lb-dock
      className="aib-dock sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20"
    >
      {tool && listed ? (
        <button
          type="button"
          className="aib-dock-btn"
          onClick={onJump}
          aria-label={`Your machine — ${tool.name}, rank ${tool.rank}. Jump to its row.`}
        >
          {line}
        </button>
      ) : tool ? (
        <p
          className="aib-dock-btn aib-dock-static"
          aria-label={`Your machine — ${tool.name}, rank ${tool.rank}, outside the top ${TOP_N}.`}
        >
          {line}
        </p>
      ) : (
        <p className="aib-dock-btn aib-dock-static aib-dock-recruit">
          <span className="aib-dock-k">▸ NO MACHINE YET</span>
          <span className="aib-dock-name">— your most-used AI takes this seat</span>
        </p>
      )}
    </div>
  )
}
