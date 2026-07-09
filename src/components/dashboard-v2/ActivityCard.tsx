'use client'

import { useMemo } from 'react'
import type { ActivityDay } from '@/lib/activity'
import { formatNumber } from './format'

type HeatCell = {
  col: number
  row: number
  date: Date
  score: number
  isFuture: boolean
  isToday: boolean
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-black/30 p-3">
      <div className="text-[9px] tracking-[0.3em] text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-zinc-100 tabular-nums">
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

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayKey = today.toISOString().split('T')[0]

    const dow = today.getDay()
    const currentSunday = new Date(today)
    currentSunday.setDate(today.getDate() - dow)

    const allColumns: HeatCell[][] = []
    for (let col = 0; col < WEEKS; col++) {
      const weekStart = new Date(currentSunday)
      weekStart.setDate(currentSunday.getDate() - (WEEKS - 1 - col) * 7)
      const colCells: HeatCell[] = []
      for (let row = 0; row < 7; row++) {
        const day = new Date(weekStart)
        day.setDate(weekStart.getDate() + row)
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

    const monthNames = [
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC'
    ]
    type Chunk = { month: number; label: string; columns: HeatCell[][] }
    const chunks: Chunk[] = []
    for (const col of allColumns) {
      const m = col[0].date.getMonth()
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
    if (r < 0.25) return 'bg-accent/25'
    if (r < 0.5) return 'bg-accent/50'
    if (r < 0.75) return 'bg-accent/75'
    return 'bg-accent shadow-[0_0_6px_rgb(var(--accent-rgb)/0.45)]'
  }

  return (
    <section className="col-span-12 lg:col-span-8 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-zinc-300">ACTIVITY</div>
          <div className="text-xs text-zinc-400 mt-1">
            Last 12 weeks · {activeDays} active {activeDays === 1 ? 'day' : 'days'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-500">
          <span>LESS</span>
          <span className="h-[12px] w-[12px] rounded-[3px] bg-zinc-900" />
          <span className="h-[12px] w-[12px] rounded-[3px] bg-accent/25" />
          <span className="h-[12px] w-[12px] rounded-[3px] bg-accent/50" />
          <span className="h-[12px] w-[12px] rounded-[3px] bg-accent/75" />
          <span className="h-[12px] w-[12px] rounded-[3px] bg-accent" />
          <span>MORE</span>
        </div>
      </div>

      <div className="mt-5 flex items-start gap-6">
        <div className="flex items-start gap-3">
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
                        style={{ gridColumn: ci + 1, gridRow: ri + 1 }}
                        className={`relative rounded-[3px] transition-transform duration-150 hover:scale-[1.5] hover:z-10 hover:ring-1 hover:ring-accent/70 ${cellClass(cell)} ${
                          cell.isToday ? 'ring-1 ring-accent/80' : ''
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

        <div className="flex-1 grid grid-cols-2 gap-3 pl-2 border-l border-zinc-900">
          <MiniStat label="LONGEST" value={`${longestStreak}d`} hint="streak" />
          <MiniStat label="ACTIVE" value={`${activeDays}d`} hint="this window" />
          <MiniStat label="BEST" value={formatNumber(Math.round(bestDay))} hint="single day" />
          <MiniStat label="AVG" value={formatNumber(avgPerDay)} hint="per active day" />
        </div>
      </div>
    </section>
  )
}
