'use client'

// The spec sheet — the board's key/value dialect, lifted from the
// drinks-menu box (base / key / model / ctx / rig). Two shapes of the
// same <dl>: AiSpecBox stacks label|value rows inside the amber-framed
// box for the featured machine; AiSpecSheet lays the full breakdown out
// as a hairline grid under an expanded row. Labels lowercase mono in
// ink-2, values the data face; amber only where the photo puts it (the
// box's values) — no green anywhere on this board.

import type { ReactNode } from 'react'
import {
  formatDuration,
  formatNumber
} from '@/components/dashboard-v2/format'
import type { AiToolRow } from '@/lib/aiLeaderboard'
import type { AiToolMeta } from '@/lib/aiToolOrgs'
import { AI_CATEGORY_LABEL } from '@/lib/aiToolOrgs'
import { SCORE_POLICY } from '@/lib/scoring'
import { usdDisplayParts } from '@/lib/tokenLeaderboard'

export type SpecEntry = {
  k: string
  v: ReactNode
  /** Hover explanation, where the label alone is too terse. */
  title?: string
  /** Drops this row from the compact (< md) featured variant. */
  compactHide?: boolean
}

/* ================= framed box (featured) ================= */

export function AiSpecBox({ entries }: { entries: SpecEntry[] }) {
  return (
    <dl className="aib-spec">
      {entries.map((entry) => (
        <div
          key={entry.k}
          className="aib-spec-row"
          data-compact-hide={entry.compactHide || undefined}
          title={entry.title}
        >
          <dt>{entry.k}</dt>
          <dd>{entry.v}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ================= burn read-out ================= */

/** Same USD markup the Burn Board uses: optional "<" for sub-cent
 *  values, then the dollar mark, then exact-decimal display parts. */
export function BurnValue({ value }: { value: string }) {
  if (value === '0') return <>—</>
  const display = usdDisplayParts(value)
  return (
    <>
      {display.tiny ? '<' : null}${display.number}
    </>
  )
}

/* ================= expanded-row grid ================= */

export function AiSpecSheet({
  tool,
  meta,
  above,
  below
}: {
  tool: AiToolRow
  meta: AiToolMeta
  /** Official-rank neighbors from the full list (not the filtered view). */
  above: AiToolRow | null
  below: AiToolRow | null
}) {
  const timePts = Math.round(tool.active_ms / SCORE_POLICY.activeMsPerPoint)
  const visitPts = tool.visits * SCORE_POLICY.visitPoints
  const perPlayer = tool.pilots > 0 ? tool.active_ms / tool.pilots : 0

  const cells: SpecEntry[] = [
    { k: 'org', v: meta.org },
    { k: 'category', v: AI_CATEGORY_LABEL[meta.category] },
    { k: 'score', v: formatNumber(tool.score) },
    {
      k: 'breakdown',
      v: `= ${formatNumber(timePts)} time + ${formatNumber(visitPts)} visits`,
      title: `1 pt per verified active second, ${SCORE_POLICY.visitPoints} per visit`
    },
    {
      k: '7-day gain',
      v: tool.weekScore > 0 ? `+${formatNumber(tool.weekScore)}` : '—'
    },
    { k: 'players', v: formatNumber(tool.pilots) },
    { k: 'time', v: tool.active_ms > 0 ? formatDuration(tool.active_ms) : '—' },
    { k: 'time/player', v: perPlayer > 0 ? formatDuration(perPlayer) : '—' },
    { k: 'visits', v: formatNumber(tool.visits) },
    { k: 'share', v: `${tool.percent}%` },
    {
      k: 'agent burn†',
      v: <BurnValue value={tool.burnUsd} />,
      title:
        'Opt-in USD estimate from this tool\u2019s coding harnesses (see AGENTS below) — display only, never ranks'
    },
    // One cell, two lines: twelve cells tile every column count the grid
    // uses (2 / 3 / 4) without an orphan.
    {
      k: 'gaps',
      v: (
        <>
          <span className="aib-sheet-line">
            {above ? (
              <>
                <span className="aib-amber">+{formatNumber(above.score - tool.score)}</span>
                {' to catch '}
                {above.name}
              </>
            ) : (
              'leads the board'
            )}
          </span>
          <span className="aib-sheet-line">
            {below ? (
              <>
                <span className="aib-amber">{formatNumber(tool.score - below.score)}</span>
                {' ahead of '}
                {below.name}
              </>
            ) : (
              'last seat'
            )}
          </span>
        </>
      )
    }
  ]

  return (
    <dl className="aib-sheet-grid">
      {cells.map((cell) => (
        <div key={cell.k} className="aib-sheet-cell" title={cell.title}>
          <dt>{cell.k}</dt>
          <dd>{cell.v}</dd>
        </div>
      ))}
    </dl>
  )
}
