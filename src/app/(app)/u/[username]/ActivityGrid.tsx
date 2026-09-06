'use client'

// ACTIVITY GRID — 13 weeks x 7 days of dots on the RECORD pane, fed by
// PublicProfile.activity.days (the user_scores activity_days rollup).
// Geometry and levels come from activityMatrix.ts (named apart from this
// file on purpose: activityGrid.ts + ActivityGrid.tsx collide on a
// case-insensitive filesystem — tsc drops the .tsx from the include set
// and './ActivityGrid' resolves to the .ts). This file is only the
// markup. Dots are <data> elements in chronological DOM order (oldest
// first, column-major) because the boot stagger walks them as a
// [7, 13] grid from 'start'. Month ticks live in an eighth row of the
// same grid so they share the dot columns; every column gets a tick cell
// (empty where no month starts) so auto-placement keeps the dots in the
// seven rows above. Tick spans are zero-width and overflow to the right,
// so they never widen a column.

import { useMemo, type CSSProperties } from 'react'
import { formatDuration } from '@/components/dashboard-v2/format'
import type { ActivityDay } from '@/lib/userStats'
import {
  buildActivityGrid,
  flattenChronological,
  GRID_DAYS,
  GRID_WEEKS,
  monthTicks
} from './activityMatrix'
import { LockedPanel } from './parts'

export interface ActivityGridProps {
  days: ActivityDay[]
  restricted: boolean
  className?: string
  /** LockedPanel copy for a restricted viewer. */
  hint?: string
}

const GAP = 3

const gridStyle: CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gridTemplateRows: `repeat(${GRID_DAYS}, auto)`,
  gridTemplateColumns: `repeat(${GRID_WEEKS}, max-content)`,
  gap: GAP,
  justifyContent: 'start'
}

const tickStyle: CSSProperties = {
  display: 'block',
  width: 0,
  overflow: 'visible',
  whiteSpace: 'nowrap',
  gridRow: GRID_DAYS + 1
}

const hiddenStyle: CSSProperties = { visibility: 'hidden' }

const cellTitle = (date: string, activeMs: number, future: boolean): string => {
  if (future) return date
  return `${date} · ${activeMs > 0 ? formatDuration(activeMs) : 'NO ACTIVITY'}`
}

export function ActivityGrid({
  days,
  restricted,
  className = '',
  hint = 'Follow this pilot to see their activity.'
}: ActivityGridProps) {
  // `now` is read once per data change so the grid does not re-bucket
  // mid-session; the payload itself refreshes on navigation.
  const grid = useMemo(() => buildActivityGrid(days, new Date()), [days])
  const cells = useMemo(() => flattenChronological(grid), [grid])
  const ticks = useMemo(() => {
    const byColumn = new Map(monthTicks(grid).map((t) => [t.column, t.label]))
    return Array.from({ length: GRID_WEEKS }, (_, column) => byColumn.get(column) ?? '')
  }, [grid])

  return (
    <section className={className} aria-label={`Activity, last ${GRID_WEEKS} weeks`}>
      {/* both readouts stay on one line each; where the two don't fit
          side by side (the 326px pane body of a 390px phone) the streak
          drops to its own right-aligned line instead of breaking mid-label */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="pf-label whitespace-nowrap">ACTIVITY · LAST {GRID_WEEKS} WEEKS</span>
        {!restricted && (
          <span className="pf-micro ml-auto whitespace-nowrap">CURRENT STREAK {grid.currentStreak}</span>
        )}
      </header>

      {restricted ? (
        <LockedPanel className="mt-3" hint={hint} />
      ) : (
        <div
          className="mt-3"
          style={gridStyle}
          role="img"
          aria-label={`${grid.activeDays} active ${grid.activeDays === 1 ? 'day' : 'days'} in the last ${GRID_WEEKS} weeks; current streak ${grid.currentStreak}`}
        >
          {cells.map((cell) => (
            <data
              key={cell.date}
              value={cell.activeMs}
              className="pf-grid-dot"
              data-level={cell.level}
              data-future={cell.future || undefined}
              title={cellTitle(cell.date, cell.activeMs, cell.future)}
              style={cell.future ? hiddenStyle : undefined}
            />
          ))}
          {ticks.map((label, column) => (
            <span
              key={column}
              className="pf-micro"
              style={{ ...tickStyle, gridColumn: column + 1 }}
              aria-hidden
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
