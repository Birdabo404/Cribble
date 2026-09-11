'use client'

// The framed list card both burn sources render into — one clean ember
// frame around a title bar (`● BURN BOARD :: 01–25 / 74 players`, the
// window label stamped right), a column header, the rows, and a footer
// bar with the pager and the footnote. The rules under the title bar
// and the header are real elements so burnMotion's mountChrome can draw
// them like a fuse.
//
// Layout is the consumer's: `gridClassName` names a grid template (tracks
// + gap, nothing else — the slab supplies the horizontal padding through
// --bb-pad so the header, rows, title bar and footer share one edge) and
// is applied to the thead, the skeleton rows and, by the consumer, to
// each row's .bb-rowbtn. Rows arrive as children, already sliced to a
// page, inside an <ol className="bb-rows">.

import type { ReactNode } from 'react'
import { BurnSkeleton } from '@/components/leaderboard/burn/BurnSkeleton'

export type BurnColumnAlign = 'left' | 'right' | 'center'

export type BurnColumn = {
  label: string
  /** Default right — ledger figures stack their ones digits on the
   *  track's right edge; compact unit figures (9.2B, 20, 4) centre
   *  under their header instead. */
  align?: BurnColumnAlign
  /** The board's sort key: a static ember `▾` prints before the label. */
  sortKey?: boolean
  /** Breakpoint helper (bb-md-only / bb-mobile-only) or any extra class;
   *  applied to the header cell and the matching skeleton cell. */
  className?: string
  title?: string
  /** The `░` run for this column's skeleton cell; default `░░░░`. */
  skeleton?: string
}

export type BurnSlabState = 'loading' | 'error' | 'empty' | 'ready'

export type BurnSlabProps = {
  title?: string
  /** `01–25 / 74 players`; null hides the `::` segment. */
  rangeLabel?: string | null
  /** Window label pinned right, e.g. `SEASON 04`. */
  stamp?: string | null
  columns: readonly BurnColumn[]
  gridClassName: string
  state: BurnSlabState
  /** The rows — `<ol className="bb-rows">…</ol>` — shown when ready. */
  children?: ReactNode
  emptyNode?: ReactNode
  errorNode?: ReactNode
  /** Pager (or anything else) on the footer's left. */
  footer?: ReactNode
  /** Uppercase small print on the footer's right. */
  footnote?: string
  ariaLabel?: string
}

const DEFAULT_SKELETON = '░░░░'

const TH_ALIGN: Record<BurnColumnAlign, string> = {
  left: 'bb-th-left',
  right: '',
  center: 'bb-th-center'
}

export function BurnSlab({
  title = 'BURN BOARD',
  rangeLabel = null,
  stamp = null,
  columns,
  gridClassName,
  state,
  children,
  emptyNode,
  errorNode,
  footer,
  footnote,
  ariaLabel = 'Burn board'
}: BurnSlabProps) {
  return (
    <section className="bb bb-slab bb-list" aria-label={ariaLabel}>
      <header className="bb-titlebar">
        <span className="bb-titlebar-dot" aria-hidden>
          ●
        </span>
        <p className="bb-titlebar-text">
          <span className="bb-titlebar-name">{title}</span>
          {rangeLabel && (
            <>
              <span className="bb-titlebar-sep" aria-hidden>
                ::
              </span>
              <span className="bb-titlebar-num">{rangeLabel}</span>
            </>
          )}
        </p>
        {stamp && <span className="bb-titlebar-stamp">{stamp}</span>}
      </header>
      <span className="bb-rule-x" aria-hidden />

      <div className={`bb-thead ${gridClassName}`} role="row">
        {columns.map((column) => (
          <span
            key={column.label}
            className={`bb-th ${TH_ALIGN[column.align ?? 'right']} ${column.className ?? ''}`}
            role="columnheader"
            title={column.title}
            aria-sort={column.sortKey ? 'descending' : undefined}
          >
            {column.sortKey && (
              <span className="bb-th-glyph" aria-hidden>
                ▾
              </span>
            )}
            {column.label}
          </span>
        ))}
      </div>
      <span className="bb-rule-x" aria-hidden />

      {state === 'loading' && (
        <BurnSkeleton
          gridClassName={gridClassName}
          cells={columns.map((column) => ({
            blocks: column.skeleton ?? DEFAULT_SKELETON,
            className: column.className,
            align: column.align
          }))}
        />
      )}

      {state === 'error' &&
        (errorNode ?? (
          <p className="bb-line bb-error" role="alert">
            error: standings unavailable
          </p>
        ))}

      {state === 'empty' && (emptyNode ?? <p className="bb-line">nothing on the board yet</p>)}

      {state === 'ready' && children}

      {(footer || footnote) && (
        <div className="bb-foot">
          {footer}
          {footnote && <p className="bb-footnote">{footnote}</p>}
        </div>
      )}
    </section>
  )
}
