'use client'

// LOADOUT pane — TOP TOOLS by share of score, then the opt-in AGENTIC
// mix by share of tokens, on paper. Rows run the full column width:
// 36px framed icon tile, name, share bar, percent, and (md+) the visits
// / focus-time column the payload already carries. Bars are a paper-2
// track with an ink fill (the first row in full ink, the rest in ink-2;
// the leading agent row in the alert red at 70% — tokens are a different
// currency than the score bars above). Fills are `.pf-fill` so the
// motion hook can grow them from the left; the inline width is the
// resting state, so no-motion users see the finished bar. The pane title
// and its aside live in the content column's PanelHeader (paneAside).

import { formatDuration, formatNumber } from '@/components/dashboard-v2/format'
import { ToolIcon } from '@/components/leaderboard/icons'
import { TokenAgentIcon } from '@/components/leaderboard/TokenAgentIcon'
import { tokenAgentLabel } from '@/lib/tokenLeaderboard'
import type { PublicProfileData } from '@/types/profile'
import { LockedPanel } from '../parts'

const TILE = 'pf-frame flex h-9 w-9 shrink-0 items-center justify-center'
const NAME = 'truncate font-display text-[14px] font-medium sm:text-[13px]'
const PERCENT = 'font-data shrink-0 text-[12px] tabular-nums text-[color:var(--pf-ink-2)] sm:text-[10px]'
const TRACK = 'mt-2 h-1 overflow-hidden bg-[color:var(--pf-paper-2)]'
const DETAIL = 'font-data hidden text-[10px] tabular-nums tracking-[0.1em] text-[color:var(--pf-ink-3)] md:inline'

/** Ink for a share bar: the leading row prints darker. */
const barInk = (first: boolean) => (first ? 'var(--pf-ink)' : 'var(--pf-ink-2)')

export function LoadoutPane({
  profile,
  isYou,
  onPublishAgents
}: {
  profile: PublicProfileData
  isYou: boolean
  onPublishAgents: () => void
}) {
  const { topTools, topAgents } = profile

  return (
    <div className="px-[var(--pf-gutter)] py-5">
      {profile.restricted ? (
        <LockedPanel hint={`Follow @${profile.username} to see their loadout.`} />
      ) : (
        <>
          <div className="space-y-4">
            {topTools.length === 0 && topAgents.length === 0 && (
              <div className="pf-micro py-4 text-center">NO FIELD DATA YET</div>
            )}
            {topTools.map((tool, i) => (
              <div key={tool.name} className="pf-row flex items-center gap-3 sm:gap-4">
                <span className={TILE} style={{ color: barInk(i === 0) }}>
                  <ToolIcon name={tool.name} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={NAME}>{tool.name}</span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className={DETAIL}>
                        {formatNumber(tool.visits)} VISITS · {formatDuration(tool.active_ms)}
                      </span>
                      <span className={PERCENT}>{tool.percent}%</span>
                    </span>
                  </div>
                  <div className={TRACK}>
                    <div
                      className="pf-fill h-full"
                      style={{ width: `${Math.max(3, tool.percent)}%`, background: barInk(i === 0) }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {topAgents.length > 0 && (
            <>
              <div className="pf-rule mt-5" />
              <div className="mt-4 flex items-baseline justify-between">
                <span className="pf-label">AGENTIC</span>
                <span className="pf-micro">SHARE OF TOKENS</span>
              </div>
              <div className="mt-3 space-y-4">
                {topAgents.map((agent, i) => (
                  <div key={agent.name} className="pf-row flex items-center gap-3 sm:gap-4">
                    <span className={TILE} style={{ color: i === 0 ? 'var(--pf-alert)' : 'var(--pf-ink-2)' }}>
                      <TokenAgentIcon agent={agent.name} bare size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={NAME}>{tokenAgentLabel(agent.name)}</span>
                        <span className={PERCENT}>{agent.percent}%</span>
                      </div>
                      <div className={TRACK}>
                        <div
                          className="pf-fill h-full"
                          style={{
                            width: `${Math.max(3, agent.percent)}%`,
                            background: i === 0 ? 'var(--pf-alert)' : 'var(--pf-ink-2)',
                            opacity: i === 0 ? 0.7 : 1
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {isYou && topAgents.length === 0 && (
            <button
              type="button"
              onClick={onPublishAgents}
              className="pf-micro mt-4 flex min-h-11 w-full items-center justify-center transition-colors hover:text-[color:var(--pf-ink)]"
            >
              PUBLISH YOUR AGENTS →
            </button>
          )}
        </>
      )}
    </div>
  )
}
