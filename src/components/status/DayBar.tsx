'use client'

// Ninety days of reconstructed vendor history — one cell per UTC day,
// oldest on the left (OpenAI's information architecture in Cribble ink).
// Cells paint in left → right on first arrival via a per-cell --ci
// delay. The tooltip is a single shared glass chip positioned off the
// hovered cell's real offset (so it survives the responsive windowing),
// hugging whichever edge it would otherwise overflow. Below sm the bar
// shows only the newest 30 days — 6px cells on a phone read as noise —
// with a mono label saying so. Only incident cells join the tab order;
// 90 stops per row would make keyboard travel miserable.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { DayCell, Severity } from '@/lib/status/types'
import {
  dayCellTip,
  formatUtcDay,
  severityColor
} from '@/components/status/severity'

const MOBILE_WINDOW_DAYS = 30

type TipState = {
  text: string
  /** Center of the hovered cell, px from the bar's left edge. */
  left: number
  /** Bar width at hover time — anchors the tip away from the edges. */
  width: number
}

function cellStyle(severity: Severity): CSSProperties {
  switch (severity) {
    case 'operational':
      return { background: severityColor('operational', 0.62) }
    case 'degraded':
      return { background: severityColor('degraded', 0.85) }
    case 'outage':
      return { background: severityColor('outage', 0.92) }
    case 'unknown':
      // hollow treatment: no fill, a hairline inset ring
      return { boxShadow: 'inset 0 0 0 1px rgb(var(--z600) / 0.4)' }
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}

function tipTransform(tip: TipState): string {
  const ratio = tip.width > 0 ? tip.left / tip.width : 0.5
  if (ratio < 0.12) return 'translate(0, -100%)'
  if (ratio > 0.88) return 'translate(-100%, -100%)'
  return 'translate(-50%, -100%)'
}

export function DayBar({
  days,
  serviceName
}: {
  days: DayCell[]
  serviceName: string
}) {
  const [tip, setTip] = useState<TipState | null>(null)

  const mobileDays = days.slice(-MOBILE_WINDOW_DAYS)

  const showTip =
    (cell: DayCell) => (event: { currentTarget: HTMLSpanElement }) => {
      const el = event.currentTarget
      const bar = el.parentElement
      if (!bar) return
      setTip({
        text: dayCellTip(cell),
        left: el.offsetLeft + el.offsetWidth / 2,
        width: bar.offsetWidth
      })
    }

  const hideTip = () => setTip(null)

  const cells = (range: DayCell[]) =>
    range.map((cell, i) => {
      const hasIncident = Boolean(cell.incident)
      return (
        <span
          key={cell.date}
          className="status-cell status-cell-in h-7 min-w-0 flex-1 rounded-[1px]"
          style={{ ...cellStyle(cell.severity), ['--ci' as string]: String(i) }}
          title={dayCellTip(cell)}
          aria-label={hasIncident ? `${serviceName} — ${dayCellTip(cell)}` : undefined}
          tabIndex={hasIncident ? 0 : undefined}
          onMouseEnter={showTip(cell)}
          onFocus={hasIncident ? showTip(cell) : undefined}
          onBlur={hasIncident ? hideTip : undefined}
        />
      )
    })

  return (
    <div className="relative" onMouseLeave={hideTip}>
      {tip !== null && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: tip.left, top: -6, transform: tipTransform(tip) }}
        >
          <div className="glass-pop max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2.5 py-1.5 font-data text-[9px] uppercase tracking-[0.2em] text-zinc-200">
            {tip.text}
          </div>
        </div>
      )}

      <div
        role="group"
        aria-label={`${serviceName} — last ${days.length} days`}
        className="hidden gap-px sm:flex"
      >
        {cells(days)}
      </div>
      <div
        role="group"
        aria-label={`${serviceName} — last ${mobileDays.length} days`}
        className="flex gap-px sm:hidden"
      >
        {cells(mobileDays)}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600">
        <span className="hidden sm:inline">{formatUtcDay(days[0]?.date ?? '')}</span>
        <span className="sm:hidden">
          last {mobileDays.length} of {days.length} days
        </span>
        <span>today · utc</span>
      </div>
    </div>
  )
}
