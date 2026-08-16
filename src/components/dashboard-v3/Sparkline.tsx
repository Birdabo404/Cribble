'use client'

import { useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { formatCompact } from '@/components/dashboard-v2/format'
import { Area } from '@/components/dither-kit/area'
import { AreaChart } from '@/components/dither-kit/area-chart'
import type { ChartConfig, Margins } from '@/components/dither-kit/chart-context'
import { setDitherTheme } from '@/components/dither-kit/palette'
import { Tooltip } from '@/components/dither-kit/tooltip'
import {
  TREND_RANGES,
  buildTrendRange,
  formatUtcDayLabel,
  type TrendRangeDays
} from '@/lib/dashboardTrend'
import { animDelay } from './anim'
import type { ActivityDay } from '@/types/dashboard'

const isTrendRange = (value: number): value is TrendRangeDays =>
  (TREND_RANGES as readonly number[]).includes(value)

// Module-level so the tooltip prop keeps a stable identity across renders.
const formatScore = (value: number) => formatCompact(Math.round(value))

// Single ember series — the palette entry is theme-switched via setDitherTheme.
const CHART_CONFIG: ChartConfig = { score: { label: 'SCORE', color: 'ember' } }

// Full-bleed plot; the top margin reproduces the old canvas' 16% headroom so
// the curve peak clears the PEAK / Δ corner readouts.
const CHART_MARGINS: Partial<Margins> = { top: 18, right: 0, bottom: 0, left: 0 }

/**
 * Score trend instrument: a compact 7/14/28/84-day range rail above
 * dither-kit's ember AreaChart (gradient dither fill, aura bloom) on Cribble's
 * blueprint grid, with PEAK / Δ readouts recomputed per range and the window's
 * real start/end dates in the bottom corners. Scrubbing and the date/score
 * tooltip come from the kit's crosshair + restyled <Tooltip>. Caller handles
 * the empty state.
 */
export function Sparkline({
  activity,
  days = 28,
  height = 112
}: {
  activity: ActivityDay[]
  /** Initial range — one of TREND_RANGES, anything else falls back to 28. */
  days?: number
  /** Plot height in px; the range rail sits above it. */
  height?: number
}) {
  const { resolvedTheme } = useTheme()
  // Client-only mount (dashboard is behind auth) — resolvedTheme is only
  // undefined for the first frames; default dark, the app's base theme.
  const theme = resolvedTheme === 'light' ? 'light' : 'dark'
  // Swap the kit's ember/ice palette seeds before the chart subtree renders
  // (idempotent module switch — canvas paint can't resolve CSS variables);
  // key={theme} below remounts the chart so its paint loop re-reads them.
  setDitherTheme(theme)

  const [range, setRange] = useState<TrendRangeDays>(() =>
    isTrendRange(days) ? days : 28
  )

  const trend = useMemo(() => buildTrendRange(activity, range), [activity, range])

  // Rows for the kit chart — memoized so the entrance revision only bumps
  // when the trend actually changes, not on unrelated re-renders.
  const chartData = useMemo(
    () =>
      trend.points.map((point) => ({
        label: formatUtcDayLabel(point.date),
        score: point.score
      })),
    [trend]
  )

  return (
    <div className="w-full">
      {/* Range rail — same instrument chrome idiom as the hero's
          RefreshButton chip; px-7 lines it up with the card padding that
          the caller strips via -mx-7. */}
      <div
        role="group"
        aria-label="Trend range"
        className="anim-fade mb-2 flex items-center justify-end gap-1 px-7"
        style={animDelay(700)}
      >
        {TREND_RANGES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setRange(option)}
            aria-pressed={range === option}
            className={`rounded border px-2 py-0.5 font-data text-[9px] tracking-wide transition-colors ${
              range === option
                ? 'border-ember/40 bg-ember/5 text-ember'
                : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
            }`}
          >
            {option}D
          </button>
        ))}
      </div>

      <div className="relative w-full" style={{ height }}>
        {/* Blueprint grid behind the graph — faded toward the top and sides */}
        <div
          aria-hidden
          className="anim-fade pointer-events-none absolute inset-0"
          style={{
            ...animDelay(120),
            backgroundImage:
              'linear-gradient(rgb(var(--star-rgb) / 0.09) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--star-rgb) / 0.09) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            backgroundPosition: 'center bottom',
            WebkitMaskImage:
              'radial-gradient(130% 105% at 50% 100%, black 30%, transparent 98%)',
            maskImage:
              'radial-gradient(130% 105% at 50% 100%, black 30%, transparent 98%)'
          }}
        />

        {/* Interactive dither area — must NOT be pointer-events-none; the
            kit's scrub crosshair and tooltip live inside it. key={theme}
            remounts the chart when the palette seeds swap; replayToken
            replays the entrance sweep on range change. */}
        <div
          role="img"
          aria-label={`Score trend, last ${range} days, peak ${formatScore(trend.peak)}`}
          className="absolute inset-0"
        >
          <AreaChart
            key={theme}
            data={chartData}
            config={CHART_CONFIG}
            replayToken={range}
            bloom="aura"
            margins={CHART_MARGINS}
            className="cursor-crosshair touch-pan-y"
          >
            <Area dataKey="score" variant="gradient" />
            <Tooltip labelKey="label" valueFormatter={formatScore} />
          </AreaChart>
        </div>

        {/* corner readouts — pointer-events-none so scrubbing never snags */}
        <span
          className="anim-fade pointer-events-none absolute left-4 top-1.5 font-data text-[9px] tracking-[0.3em] text-zinc-500"
          style={animDelay(800)}
        >
          PEAK{' '}
          <span className="text-zinc-300 tabular-nums">
            {formatCompact(Math.round(trend.peak))}
          </span>
        </span>
        <span
          className="anim-fade pointer-events-none absolute right-4 top-1.5 text-right font-data text-[9px] tracking-[0.3em] text-zinc-500"
          style={animDelay(850)}
        >
          Δ {range}D{' '}
          {trend.deltaPct === null ? (
            <span className="text-ember tabular-nums">NEW</span>
          ) : trend.deltaPct >= 0 ? (
            <span className="text-ember tabular-nums">+{trend.deltaPct}%</span>
          ) : (
            <span className="text-zinc-400 tabular-nums">{trend.deltaPct}%</span>
          )}
        </span>
        {/* bottom labels sit inboard of the panel's corner brackets */}
        <span
          className="anim-fade pointer-events-none absolute left-7 bottom-2 font-data text-[9px] tracking-[0.3em] text-zinc-600"
          style={animDelay(900)}
        >
          {trend.startLabel}
        </span>
        <span
          className="anim-fade pointer-events-none absolute right-7 bottom-2 font-data text-[9px] tracking-[0.3em] text-zinc-600"
          style={animDelay(900)}
        >
          {trend.endLabel}
        </span>
      </div>
    </div>
  )
}
