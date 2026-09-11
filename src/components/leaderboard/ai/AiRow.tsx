'use client'

// One machine on the list. The whole row is a <button> that opens the
// inline spec sheet beneath it. Five cells through the shared .aib-grid
// template (see AiBoard's style block): the `[01]` index in amber (the
// top three in orange), the mark with name over org, the score with its
// 7-day gain beneath, players, and share with a hairline bar. PLAYERS
// and SHARE fold away on phones. Keyed and flip-id'd by tool name so
// Flip can follow a re-sort.

import { useGSAP } from '@gsap/react'
import { useEffect, useRef, useState } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'
import { padRank, sheetId } from '@/components/leaderboard/ai/aiBoardState'
import { collapseSheet, expandSheet } from '@/components/leaderboard/ai/aiMotion'
import { AiSpecSheet } from '@/components/leaderboard/ai/AiSpecSheet'
import { ToolMark } from '@/components/leaderboard/ai/ToolMark'
import type { AiToolRow } from '@/lib/aiLeaderboard'
import type { AiToolMeta } from '@/lib/aiToolOrgs'

export type AiRowProps = {
  tool: AiToolRow
  meta: AiToolMeta
  /** Largest share on the board — the bar scale, so rank 1 runs full. */
  topPercent: number
  isYours: boolean
  open: boolean
  onToggle: (name: string) => void
  setRef: (name: string, el: HTMLLIElement | null) => void
  /** Official-rank neighbors for the sheet's gap lines. */
  above: AiToolRow | null
  below: AiToolRow | null
}

export function AiRow({
  tool,
  meta,
  topPercent,
  isYours,
  open,
  onToggle,
  setRef,
  above,
  below
}: AiRowProps) {
  const id = sheetId(tool.name)
  const barPct = topPercent > 0 ? Math.max(2, (tool.percent / topPercent) * 100) : 0

  // The sheet stays mounted through its collapse tween, then unmounts.
  // useGSAP runs as a layout effect, so the expand starts from height 0
  // before the open sheet ever paints at full size.
  const rowRef = useRef<HTMLLIElement | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [sheetMounted, setSheetMounted] = useState(open)
  useEffect(() => {
    if (open) setSheetMounted(true)
  }, [open])
  useGSAP(
    () => {
      const el = sheetRef.current
      if (!el) return
      if (open) expandSheet(el)
      else collapseSheet(el, () => setSheetMounted(false))
    },
    { dependencies: [open, sheetMounted], scope: rowRef }
  )

  return (
    <li
      ref={(el) => {
        rowRef.current = el
        setRef(tool.name, el)
      }}
      className="aib-row"
      data-flip-id={tool.name}
      data-rank={tool.rank}
      data-yours={isYours || undefined}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="aib-rowbtn aib-grid"
        aria-expanded={open}
        aria-controls={sheetMounted ? id : undefined}
        onClick={() => onToggle(tool.name)}
      >
        <span className="aib-cell">
          <span className="aib-idx" data-top={tool.rank <= 3 || undefined}>
            [{padRank(tool.rank)}]
          </span>
        </span>

        <span className="aib-cell aib-tool">
          <ToolMark name={tool.name} size={24} className="aib-tool-mark" />
          <span className="aib-tool-text">
            <span className="aib-tool-line">
              <span className="aib-name">{tool.name}</span>
              {isYours && <span className="aib-tag aib-tag-you">YOU</span>}
            </span>
            <span className="aib-sub">{meta.org}</span>
          </span>
        </span>

        <span className="aib-cell aib-num aib-score">
          <span className="aib-score-main">{formatNumber(tool.score)}</span>
          <span className="aib-sub aib-delta">
            {tool.weekScore > 0 ? `+${formatNumber(tool.weekScore)}` : '—'}
          </span>
        </span>

        <span className="aib-cell aib-col-players aib-num">
          {formatNumber(tool.pilots)}
        </span>

        <span className="aib-cell aib-col-share aib-share">
          <span className="aib-num">{tool.percent}%</span>
          <span className="aib-sharebar" aria-hidden>
            <span className="aib-sharebar-fill" style={{ width: `${barPct}%` }} />
          </span>
        </span>
      </button>

      {sheetMounted && (
        <div id={id} ref={sheetRef} className="aib-sheet" role="region" aria-label={`${tool.name} spec sheet`}>
          <AiSpecSheet tool={tool} meta={meta} above={above} below={below} />
        </div>
      )}
    </li>
  )
}
