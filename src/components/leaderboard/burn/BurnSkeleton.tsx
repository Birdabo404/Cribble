'use client'

// Ten hairline rows of `░` blocks — a feed still printing — behind the
// same grid the live rows use, so the slab does not jump when data
// lands. The flicker is the AI board's anime loop (flickerSkeleton under
// runLoop: parked on a hidden tab, reverted on unmount). Each cell
// carries its column's breakpoint class so a column that folds away on
// phones takes its placeholder with it.

import { useEffect, useRef } from 'react'
import { flickerSkeleton, runLoop } from '@/components/leaderboard/ai/aiMotion'
import type { BurnColumnAlign } from '@/components/leaderboard/burn/BurnSlab'

export type BurnSkeletonCell = {
  /** The `░` run; width it to the column's typical value. */
  blocks: string
  /** The column's breakpoint helper (bb-md-only / bb-mobile-only) etc. */
  className?: string
  align?: BurnColumnAlign
}

const CELL_ALIGN: Record<BurnColumnAlign, string> = {
  left: '',
  right: 'bb-num',
  center: 'bb-num bb-num-center'
}

export type BurnSkeletonProps = {
  rows?: number
  /** The consumer's grid template class — the same one its rows use. */
  gridClassName: string
  /** One entry per column, in column order. */
  cells: BurnSkeletonCell[]
}

export function BurnSkeleton({ rows = 10, gridClassName, cells }: BurnSkeletonProps) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return runLoop(flickerSkeleton(el.querySelectorAll<HTMLElement>('.bb-skel')))
  }, [])

  return (
    <ol ref={ref} className="bb-rows" aria-busy="true" aria-label="Loading standings">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="bb-row">
          <span className={`bb-skelrow ${gridClassName}`} aria-hidden>
            {cells.map((cell, j) => (
              <span
                key={j}
                className={`bb-cell bb-skel ${CELL_ALIGN[cell.align ?? 'right']} ${cell.className ?? ''}`}
              >
                {cell.blocks}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  )
}
