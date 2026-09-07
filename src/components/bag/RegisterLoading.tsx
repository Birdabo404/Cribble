'use client'

// Register loading state: ghost rows / ghost slots in --bag-well blocks,
// no pulse, under a `LOADING MANIFEST_` line with the blinking block
// cursor. Counts default to the catalog sizes and the ghosts reuse the
// live templates, so the sheet does not jump when the data lands.

import { useRef } from 'react'
import { ACHIEVEMENTS } from '@/lib/achievements'
import { PLATES } from '@/lib/cosmetics/plates'
import {
  BADGE_CELL,
  BADGE_GRID,
  BADGE_INDEX,
  BADGE_NAME,
  BADGE_SPRITE,
  BADGE_SPRITE_SIZE,
  LISTBOX_BASE,
  MICRO,
  PLATE_COLS,
  PLATE_ROW,
  fillerCount,
  plateRowBox,
  useGridColumns
} from './registerChrome'

export type RegisterLoadingVariant = 'rows' | 'slots'

export interface RegisterLoadingProps {
  variant: RegisterLoadingVariant
  /** Row ghosts only: tap-floor rows with the tighter padding. */
  compact?: boolean
  /** Defaults to the catalog size of the variant (15 plates / 32 badges). */
  count?: number
}

const WELL = 'bg-[color:var(--bag-well)]'

/** Ghost name widths cycle so the column reads as text, not as a bar. */
const GHOST_NAME_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-[70%]']

function LoadingLine() {
  return (
    <p
      role="status"
      className={`${MICRO} flex h-7 shrink-0 items-center px-3 text-[color:var(--bag-mute)]`}
    >
      <span aria-hidden className="bag-cursor">
        LOADING MANIFEST
      </span>
      <span className="sr-only">Loading manifest</span>
    </p>
  )
}

function GhostRows({ count, compact }: { count: number; compact: boolean }) {
  return (
    <div aria-hidden className="grid gap-px bg-[color:var(--bag-line-soft)]">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`${PLATE_ROW} ${PLATE_COLS} ${plateRowBox(compact)} bg-[color:var(--bag-paper)]`}
        >
          <span className={`${WELL} h-[10px] w-4`} />
          <span className={`${WELL} h-[10px] w-[2ch]`} />
          <span className={`${WELL} block w-full`} style={{ aspectRatio: '4 / 1' }} />
          <span className={`${WELL} h-[11px] ${GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length]}`} />
          <span className={`${WELL} hidden h-4 w-full md:block`} />
          <span className={`${WELL} hidden h-[10px] w-full xl:block`} />
        </div>
      ))}
    </div>
  )
}

function GhostSlots({ count }: { count: number }) {
  const gridRef = useRef<HTMLDivElement>(null)
  const cols = useGridColumns(gridRef, true)
  const fillers = fillerCount(count, cols)
  return (
    <div ref={gridRef} aria-hidden className={`${LISTBOX_BASE} ${BADGE_GRID}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${BADGE_CELL} relative bg-[color:var(--bag-paper)]`}>
          <span className={BADGE_INDEX}>
            <span className={`${WELL} inline-block h-[10px] w-[2ch]`} />
          </span>
          <span className={BADGE_SPRITE}>
            <span className={`${WELL} ${BADGE_SPRITE_SIZE}`} />
          </span>
          <span className={BADGE_NAME}>
            <span className={`${WELL} mx-auto block h-[10px] w-3/4`} />
          </span>
        </div>
      ))}
      {Array.from({ length: fillers }, (_, i) => (
        <div key={`filler-${i}`} className="bg-[color:var(--bag-paper)]" />
      ))}
    </div>
  )
}

export function RegisterLoading({ variant, compact = false, count }: RegisterLoadingProps) {
  switch (variant) {
    case 'rows':
      return (
        <div className="flex flex-col" aria-busy>
          <LoadingLine />
          <GhostRows count={count ?? PLATES.length} compact={compact} />
        </div>
      )
    case 'slots':
      return (
        <div className="flex flex-col" aria-busy>
          <LoadingLine />
          <GhostSlots count={count ?? ACHIEVEMENTS.length} />
        </div>
      )
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}
