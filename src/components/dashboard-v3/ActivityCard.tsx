'use client'

import { useMemo } from 'react'
import type { ActivityDay } from '@/lib/activity'
import { formatNumber } from '@/components/dashboard-v2/format'
import { animDelay } from './anim'
import { IconGrid } from './DashIcons'
import { Panel, PanelHeader } from './Panel'

type HeatCell = {
  col: number
  row: number
  date: Date
  score: number
  isFuture: boolean
  isToday: boolean
}

function MiniStat({
  label,
  value,
  hint,
  delayMs
}: {
  label: string
  value: string
  hint?: string
  delayMs: number
}) {
  return (
    <div className="anim-rise rounded-lg liquid-glass-inset px-3 py-2.5" style={animDelay(delayMs)}>
      <div className="font-data text-[9px] tracking-[0.3em] text-zinc-500">{label}</div>
      <div className="mt-1 font-display text-base font-semibold tracking-tight text-zinc-100 tabular-nums">
        {value}
      </div>
      {hint && <div className="text-[10px] text-zinc-500 mt-0.5">{hint}</div>}
    </div>
  )
}

export function ActivityCard({ activity }: { activity: ActivityDay[] }) {
  const WEEKS = 12
  const CELL_PX = 14
  const CELL_GAP = 4
  const MONTH_GAP = 12

  const { monthChunks, activeDays, maxScore, longestStreak, bestDay, avgPerDay } = useMemo(() => {
    const scoreByDate = new Map<string, number>()
    for (const d of activity) scoreByDate.set(d.date, d.score)

    // Day cells are UTC days: the activity API buckets scores by UTC date
    // key, so the grid must be built from UTC midnights too. Local-midnight
    // math shifted every key back a day for users east of UTC — the "today"
    // cell showed yesterday and today's activity hid in a "future" cell.
    const now = new Date()
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
    const todayKey = today.toISOString().split('T')[0]

    const dow = today.getUTCDay()
    const currentSunday = new Date(today)
    currentSunday.setUTCDate(today.getUTCDate() - dow)

    const allColumns: HeatCell[][] = []
    for (let col = 0; col < WEEKS; col++) {
      const weekStart = new Date(currentSunday)
      weekStart.setUTCDate(currentSunday.getUTCDate() - (WEEKS - 1 - col) * 7)
      const colCells: HeatCell[] = []
      for (let row = 0; row < 7; row++) {
        const day = new Date(weekStart)
        day.setUTCDate(weekStart.getUTCDate() + row)
        const key = day.toISOString().split('T')[0]
        const isFuture = day > today
        colCells.push({
          col,
          row,
          date: day,
          score: isFuture ? -1 : scoreByDate.get(key) || 0,
          isFuture,
          isToday: key === todayKey
        })
      }
      allColumns.push(colCells)
    }

    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    type Chunk = { month: number; label: string; columns: HeatCell[][] }
    const chunks: Chunk[] = []
    for (const col of allColumns) {
      const m = col[0].date.getUTCMonth()
      const last = chunks[chunks.length - 1]
      if (last && last.month === m) {
        last.columns.push(col)
      } else {
        chunks.push({ month: m, label: monthNames[m], columns: [col] })
      }
    }

    const flatByDate = allColumns
      .flat()
      .filter((c) => !c.isFuture)
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const active = flatByDate.filter((c) => c.score > 0).length
    const positives = flatByDate.filter((c) => c.score > 0).map((c) => c.score)
    const max = positives.length ? Math.max(...positives) : 1
    const best = positives.length ? Math.max(...positives) : 0
    const avg = active > 0 ? Math.round(positives.reduce((a, b) => a + b, 0) / active) : 0

    let longest = 0
    let run = 0
    for (const c of flatByDate) {
      if (c.score > 0) {
        run += 1
        if (run > longest) longest = run
      } else {
        run = 0
      }
    }

    return {
      monthChunks: chunks,
      activeDays: active,
      maxScore: max,
      longestStreak: longest,
      bestDay: best,
      avgPerDay: avg
    }
  }, [activity])

  const cellClass = (cell: HeatCell) => {
    if (cell.isFuture) return 'border border-zinc-800 bg-transparent'
    if (cell.score <= 0) return 'bg-zinc-900'
    const r = cell.score / maxScore
    if (r < 0.25) return 'bg-ember/25'
    if (r < 0.5) return 'bg-ember/50'
    if (r < 0.75) return 'bg-ember/75'
    return 'bg-ember shadow-[0_0_6px_rgb(var(--ember-rgb)/0.45)]'
  }

  return (
    <Panel className="dash-frame col-span-12 lg:col-span-8 p-6">
      <PanelHeader
        title="ACTIVITY"
        icon={<IconGrid size={12} />}
        subtitle={`Last 12 weeks · ${activeDays} active ${activeDays === 1 ? 'day' : 'days'}`}
        action={
          <div className="hidden sm:flex items-center gap-1.5 font-data text-[9px] tracking-[0.3em] text-zinc-500">
            <span>LESS</span>
            <span className="h-[11px] w-[11px] rounded-[3px] bg-zinc-900" />
            <span className="h-[11px] w-[11px] rounded-[3px] bg-ember/25" />
            <span className="h-[11px] w-[11px] rounded-[3px] bg-ember/50" />
            <span className="h-[11px] w-[11px] rounded-[3px] bg-ember/75" />
            <span className="h-[11px] w-[11px] rounded-[3px] bg-ember" />
            <span>MORE</span>
          </div>
        }
      />

      <div className="mt-5 overflow-x-auto pb-1">
        <div className="flex items-start gap-3 w-max mx-auto">
          <div
            className="grid text-[10px] leading-none text-zinc-500 pt-[22px]"
            style={{
              gridTemplateRows: `repeat(7, ${CELL_PX}px)`,
              rowGap: `${CELL_GAP}px`
            }}
          >
            <div />
            <div className="flex items-center">Mon</div>
            <div />
            <div className="flex items-center">Wed</div>
            <div />
            <div className="flex items-center">Fri</div>
            <div />
          </div>

          <div className="flex items-start" style={{ gap: `${MONTH_GAP}px` }}>
            {monthChunks.map((chunk, idx) => (
              <div key={idx} className="flex flex-col">
                <div className="text-[10px] tracking-[0.2em] text-zinc-400 leading-none mb-[10px] uppercase">
                  {chunk.label}
                </div>
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${chunk.columns.length}, ${CELL_PX}px)`,
                    gridTemplateRows: `repeat(7, ${CELL_PX}px)`,
                    columnGap: `${CELL_GAP}px`,
                    rowGap: `${CELL_GAP}px`
                  }}
                >
                  {chunk.columns.flatMap((col, ci) =>
                    col.map((cell, ri) => (
                      <div
                        key={`${ci}-${ri}`}
                        style={{
                          gridColumn: ci + 1,
                          gridRow: ri + 1,
                          // Diagonal wave sweeping left → right across the weeks
                          ...animDelay(160 + cell.col * 26 + cell.row * 12)
                        }}
                        className={`anim-cell relative rounded-[3px] transition-transform duration-150 hover:scale-[1.5] hover:z-10 hover:ring-1 hover:ring-ember/70 ${cellClass(cell)} ${
                          cell.isToday ? 'ring-1 ring-ice/80' : ''
                        }`}
                        title={
                          cell.isFuture
                            ? ''
                            : `${cell.date.toISOString().split('T')[0]} · ${formatNumber(Math.round(cell.score))} pts`
                        }
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="LONGEST" value={`${longestStreak}d`} hint="streak" delayMs={520} />
        <MiniStat label="ACTIVE" value={`${activeDays}d`} hint="this window" delayMs={600} />
        <MiniStat label="BEST" value={formatNumber(Math.round(bestDay))} hint="single day" delayMs={680} />
        <MiniStat label="AVG" value={formatNumber(avgPerDay)} hint="per active day" delayMs={760} />
      </div>
    </Panel>
  )
}
