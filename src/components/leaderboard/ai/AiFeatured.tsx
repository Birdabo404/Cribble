'use client'

// The featured machine — rank 1 of the active window, given the left
// panel the drinks menu gives its house pour, and laid out the way that
// panel is: everything on one centre axis with real air between the
// blocks. An outline tag, the mark large in orange, the name in the
// pixel face with an orange block cursor, org · category, a small-caps
// line, the cream spec box (score / share / players / time / lead), and
// the three-step breadcrumb. Under md the same DOM reads as a compact
// band — CSS drops the tag, caps and breadcrumb and tiles the box.

import { useEffect, useRef } from 'react'
import {
  formatDuration,
  formatNumber
} from '@/components/dashboard-v2/format'
import { padRank } from '@/components/leaderboard/ai/aiBoardState'
import {
  blinkCursor,
  runLoop,
  useCounter
} from '@/components/leaderboard/ai/aiMotion'
import { AiSpecBox } from '@/components/leaderboard/ai/AiSpecSheet'
import { ToolMark } from '@/components/leaderboard/ai/ToolMark'
import type { AiToolRow } from '@/lib/aiLeaderboard'
import { AI_CATEGORY_LABEL, type AiToolMeta } from '@/lib/aiToolOrgs'

export type AiFeaturedProps = {
  tool: AiToolRow
  meta: AiToolMeta
  /** Rank 2 of the same window, for the lead figure. */
  runnerUp: AiToolRow | null
  /** `SEASON 04` | `ALL-TIME` — names the window on the tag and caps line. */
  windowLabel: string
  /** Machines in the window, for the caps line. */
  machines: number
}

/** The pixel face is wide: 8 glyphs of "ChatGPT" fill the column at the
 *  headline size, so longer names step down rather than wrap mid-word. */
function nameScale(name: string): 'lg' | 'md' | 'sm' {
  if (name.length <= 9) return 'lg'
  if (name.length <= 14) return 'md'
  return 'sm'
}

export function AiFeatured({ tool, meta, runnerUp, windowLabel, machines }: AiFeaturedProps) {
  const scoreRef = useCounter<HTMLSpanElement>(tool.score, formatNumber)

  const cursorRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = cursorRef.current
    if (!el) return
    return runLoop(blinkCursor(el))
  }, [])

  const lead = runnerUp ? `+${formatNumber(tool.score - runnerUp.score)}` : 'unchallenged'

  return (
    <section
      className="aib-featured"
      aria-label={`Rank 1 — ${tool.name}, ${formatNumber(tool.score)} points`}
    >
      <span className="aib-tag aib-featured-tag">
        ★ RANK {padRank(tool.rank)} · {windowLabel} ★
      </span>

      {/* Two sizes, CSS picks one: 120px in the panel, 56px in the band. */}
      <div className="aib-featured-mark" aria-hidden>
        <span className="aib-featured-mark-lg">
          <ToolMark name={tool.name} size={120} />
        </span>
        <span className="aib-featured-mark-sm">
          <ToolMark name={tool.name} size={40} />
        </span>
      </div>

      <h2 className="aib-featured-name" data-scale={nameScale(tool.name)}>
        {tool.name}
        <span ref={cursorRef} className="aib-cursor" aria-hidden />
      </h2>

      <p className="aib-featured-meta">
        {meta.org} · {AI_CATEGORY_LABEL[meta.category]}
      </p>

      <p className="aib-featured-caps">
        MOST USED OF {formatNumber(machines)} MACHINES · {windowLabel}
      </p>

      <AiSpecBox
        entries={[
          {
            k: 'score',
            v: (
              <span ref={scoreRef}>{formatNumber(tool.score)}</span>
            )
          },
          {
            k: 'share',
            v: `${tool.percent}%`,
            title: 'Share of every machine\u2019s combined score'
          },
          { k: 'players', v: formatNumber(tool.pilots) },
          {
            k: 'time',
            v: tool.active_ms > 0 ? formatDuration(tool.active_ms) : '—',
            compactHide: true
          },
          {
            k: 'lead',
            v: lead,
            title: runnerUp ? `Points clear of ${runnerUp.name}` : undefined,
            compactHide: true
          }
        ]}
      />

      <p className="aib-featured-foot" aria-hidden>
        INSTALL » TRACK » CLIMB
      </p>
    </section>
  )
}

/** Same geometry as the live panel — tag, mark, two title lines, the
 *  five-row box — printed in `░` so nothing shifts when rank 1 lands. */
export function AiFeaturedSkeleton() {
  return (
    <section className="aib-featured aib-featured-skel" aria-hidden>
      <span className="aib-tag aib-featured-tag aib-skel">★ RANK ── · ────── ★</span>
      <div className="aib-featured-mark aib-skel">
        <span className="aib-featured-mark-lg aib-skel-block" />
        <span className="aib-featured-mark-sm aib-skel-block" />
      </div>
      <h2 className="aib-featured-name aib-skel" data-scale="lg">
        ░░░░░░░
      </h2>
      <p className="aib-featured-meta aib-skel">░░░░░░ · ░░░░</p>
      <p className="aib-featured-caps aib-skel">MOST USED OF ── MACHINES</p>
      <dl className="aib-spec">
        {['score', 'share', 'players', 'time', 'lead'].map((k, i) => (
          <div key={k} className="aib-spec-row" data-compact-hide={i > 2 || undefined}>
            <dt>{k}</dt>
            <dd className="aib-skel">░░░░░░</dd>
          </div>
        ))}
      </dl>
      <p className="aib-featured-foot aib-skel">INSTALL » TRACK » CLIMB</p>
    </section>
  )
}
