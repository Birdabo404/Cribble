'use client'

// The list proper: a sortable header and an <ol> of AiRows, plus the
// three non-data states (printing skeleton, error line, empty line).
// Five columns, always the same five — RANK · TOOL · SCORE (with Δ7D
// beneath) · PLAYERS · SHARE — so the board reads as a leaderboard, not
// a spreadsheet; the full breakdown lives in each row's spec sheet.
// Rows arrive already filtered, ordered and cut to the top 25; sorting
// here is a header click reporting a key, never a re-rank.

import { useEffect, useRef } from 'react'
import type { AiSortDir, AiSortKey } from '@/components/leaderboard/ai/aiBoardState'
import { flickerSkeleton, runLoop } from '@/components/leaderboard/ai/aiMotion'
import { AiRow } from '@/components/leaderboard/ai/AiRow'
import type { AiToolRow } from '@/lib/aiLeaderboard'
import type { AiToolMeta } from '@/lib/aiToolOrgs'

type Column = {
  label: string
  sort?: AiSortKey
  /** Breakpoint class from the .aib-grid template; undefined = always. */
  col?: string
  align?: 'left' | 'right'
  title?: string
}

const COLUMNS: Column[] = [
  { label: 'RANK', align: 'left' },
  { label: 'TOOL', align: 'left' },
  {
    label: 'SCORE · 7D',
    sort: 'score',
    title: 'Verified score, with the points earned in the last 7 days beneath'
  },
  { label: 'PLAYERS', sort: 'players', col: 'aib-col-players' },
  {
    label: 'SHARE',
    sort: 'share',
    col: 'aib-col-share',
    title: 'Share of every machine\u2019s combined score'
  }
]

const SKELETON_ROWS = 10

export type AiTableState = 'loading' | 'error' | 'empty' | 'ready'

export type AiTableProps = {
  state: AiTableState
  /** Filtered + sorted + cut rows for the screen. */
  rows: AiToolRow[]
  /** The full window, official order — neighbors for the spec sheet. */
  tools: AiToolRow[]
  metaFor: (name: string) => AiToolMeta
  sort: AiSortKey
  sortDir: AiSortDir
  onSort: (key: AiSortKey) => void
  openName: string | null
  onToggle: (name: string) => void
  viewerFaction: string | null
  setRowRef: (name: string, el: HTMLLIElement | null) => void
  emptyLabel: string
  onRetry: () => void
}

export function AiTable({
  state,
  rows,
  tools,
  metaFor,
  sort,
  sortDir,
  onSort,
  openName,
  onToggle,
  viewerFaction,
  setRowRef,
  emptyLabel,
  onRetry
}: AiTableProps) {
  const topPercent = tools[0]?.percent ?? 0

  return (
    <div className="aib-table">
      <div className="aib-thead aib-grid" role="row">
        {COLUMNS.map((column) => {
          const active = column.sort !== undefined && column.sort === sort
          const cls = `aib-th ${column.col ?? ''} ${column.align === 'left' ? 'aib-th-left' : ''}`
          if (!column.sort) {
            return (
              <span key={column.label} className={cls} role="columnheader" title={column.title}>
                {column.label}
              </span>
            )
          }
          const key = column.sort
          return (
            <span
              key={column.label}
              className={cls}
              role="columnheader"
              aria-sort={active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
            >
              <button
                type="button"
                className="aib-th-sort"
                data-active={active || undefined}
                onClick={() => onSort(key)}
                title={column.title}
                aria-label={`Sort by ${column.label}`}
              >
                <span className="aib-th-glyph" aria-hidden>
                  {active && sortDir === 'asc' ? '▴' : '▾'}
                </span>
                {column.label}
              </button>
            </span>
          )
        })}
      </div>

      {state === 'loading' && <Skeleton />}

      {state === 'error' && (
        <p className="aib-line aib-error" role="alert">
          error: standings unavailable{' '}
          <button type="button" className="aib-toggle" onClick={onRetry}>
            [ RETRY ]
          </button>
        </p>
      )}

      {state === 'empty' && <p className="aib-line">{emptyLabel}</p>}

      {state === 'ready' && (
        <ol className="aib-rows">
          {rows.map((tool) => (
            <AiRow
              key={tool.name}
              tool={tool}
              meta={metaFor(tool.name)}
              topPercent={topPercent}
              isYours={tool.name === viewerFaction}
              open={openName === tool.name}
              onToggle={onToggle}
              setRef={setRowRef}
              above={tools[tool.rank - 2] ?? null}
              below={tools[tool.rank] ?? null}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

/** Ten hairline rows of `░` blocks — a feed still printing. The block
 *  widths echo the live columns so the table doesn't jump on landing. */
function Skeleton() {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return runLoop(flickerSkeleton(el.querySelectorAll<HTMLElement>('.aib-skel')))
  }, [])
  return (
    <ol ref={ref} className="aib-rows" aria-busy="true" aria-label="Loading standings">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <li key={i} className="aib-row aib-row-skel">
          <span className="aib-grid aib-skelrow" aria-hidden>
            <span className="aib-cell aib-skel">░░░░</span>
            <span className="aib-cell aib-skel">░░░░░░░░░░</span>
            <span className="aib-cell aib-num aib-skel">░░░░░░░</span>
            <span className="aib-cell aib-col-players aib-num aib-skel">░░░</span>
            <span className="aib-cell aib-col-share aib-num aib-skel">░░░</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
