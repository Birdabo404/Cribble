'use client'

import { useId, useMemo } from 'react'
import { formatCompact } from '@/components/dashboard-v2/format'
import { animDelay } from './anim'
import type { ActivityDay } from '@/types/dashboard'

/**
 * Area chart of the last `days` of scores, dressed as a flight instrument:
 * blueprint grid, fading level lines, a bottom ruler (day ticks, taller
 * week ticks), the daily series in ember with an ice 7-day-average
 * overlay, a peak readout, a delta vs the prior window, and a glowing
 * ember dot on today's point. Caller handles the empty state.
 */
export function Sparkline({
  activity,
  days = 28,
  height = 112
}: {
  activity: ActivityDay[]
  days?: number
  height?: number
}) {
  const uid = useId()

  const { points, avg7, max, deltaPct } = useMemo(() => {
    const byDate = new Map(activity.map((d) => [d.date, d.score]))
    // Pull twice the window so the delta can compare against the prior
    // `days` and the moving average has run-in for its first points.
    const wide: number[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = days * 2 - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      wide.push(byDate.get(d.toISOString().split('T')[0]) || 0)
    }
    const out = wide.slice(days)

    // 7-day trailing mean per visible point (windows reach into the
    // prior slice, so day one already has a real average).
    const ma: number[] = []
    for (let i = 0; i < days; i++) {
      const end = days + i
      const start = Math.max(0, end - 6)
      const win = wide.slice(start, end + 1)
      ma.push(win.reduce((a, b) => a + b, 0) / win.length)
    }

    const cur = out.reduce((a, b) => a + b, 0)
    const prev = wide.slice(0, days).reduce((a, b) => a + b, 0)
    const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null

    return {
      points: out,
      avg7: ma,
      max: Math.max(...out, 1),
      deltaPct: delta
    }
  }, [activity, days])

  const W = 100
  const H = 36
  const TOP_PAD = 4 // room so the peak never clips
  const step = W / (points.length - 1 || 1)
  const yFor = (v: number) => H - (v / max) * (H - TOP_PAD) - 0.5

  const toPath = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${yFor(v).toFixed(2)}`)
      .join(' ')

  const line = toPath(points)
  const area = `${line} L${W},${H} L0,${H} Z`
  const avgLine = toPath(avg7)

  const lastYPct = (yFor(points[points.length - 1]) / H) * 100

  // Weekly verticals (skip the outer edges — the panel border does that job).
  const weekXs: number[] = []
  for (let d = 7; d < days; d += 7) weekXs.push(((days - 1 - d) * step / W) * 100)

  return (
    <div className="relative w-full" style={{ height }}>
      {/* Blueprint grid behind the graph — faded toward the top and sides */}
      <div
        aria-hidden
        className="anim-fade absolute inset-0"
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

      {/* Level lines + weekly verticals + bottom ruler ticks */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="anim-fade absolute inset-0 h-full w-full"
        style={animDelay(200)}
        aria-hidden
      >
        <defs>
          {/* level lines fade out toward both sides */}
          <linearGradient id={`${uid}-grid-h`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(var(--star-rgb) / 0)" />
            <stop offset="18%" stopColor="rgb(var(--star-rgb) / 0.13)" />
            <stop offset="82%" stopColor="rgb(var(--star-rgb) / 0.13)" />
            <stop offset="100%" stopColor="rgb(var(--star-rgb) / 0)" />
          </linearGradient>
          {/* weekly verticals fade out toward the top */}
          <linearGradient id={`${uid}-grid-v`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--star-rgb) / 0)" />
            <stop offset="55%" stopColor="rgb(var(--star-rgb) / 0.09)" />
            <stop offset="100%" stopColor="rgb(var(--star-rgb) / 0.16)" />
          </linearGradient>
        </defs>

        {[0.28, 0.52, 0.76].map((f) => (
          <line
            key={f}
            x1="0"
            y1={H * f}
            x2={W}
            y2={H * f}
            stroke={`url(#${uid}-grid-h)`}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {weekXs.map((xPct) => (
          <line
            key={xPct}
            x1={(xPct / 100) * W}
            y1="0"
            x2={(xPct / 100) * W}
            y2={H}
            stroke={`url(#${uid}-grid-v)`}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* ruler: a fine ice tick per day, taller at week boundaries */}
        {points.map((_, i) => {
          const week = (days - 1 - i) % 7 === 0
          return (
            <line
              key={i}
              x1={i * step}
              y1={H - (week ? 2.2 : 1.1)}
              x2={i * step}
              y2={H}
              stroke={`rgb(var(--ice-rgb) / ${week ? 0.55 : 0.28})`}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>

      {/* Series — revealed left → right by a clip-path sweep. Ember daily
          area/line over the ice 7-day-average structure line. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="anim-sweep absolute inset-0 h-full w-full"
        style={animDelay(300)}
        aria-hidden
      >
        <defs>
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--ember-rgb) / 0.28)" />
            <stop offset="100%" stopColor="rgb(var(--ember-rgb) / 0)" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${uid}-area)`} />
        <path
          d={avgLine}
          fill="none"
          stroke="rgb(var(--ice-rgb) / 0.75)"
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={line}
          fill="none"
          stroke="rgb(var(--ember-rgb) / 0.9)"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* live dot on today's point — lands as the sweep reaches the right edge */}
      <span
        className="anim-cell absolute right-0 -mr-1"
        style={{ top: `calc(${lastYPct}% - 4px)`, ...animDelay(1450) }}
      >
        <span className="absolute h-2 w-2 rounded-full bg-ember/40 motion-safe:animate-ping" />
        <span className="absolute h-2 w-2 rounded-full bg-ember shadow-[0_0_8px_rgb(var(--ember-rgb)/0.8)]" />
      </span>

      {/* corner readouts */}
      <span
        className="anim-fade absolute left-4 top-1.5 font-data text-[9px] tracking-[0.3em] text-zinc-500"
        style={animDelay(800)}
      >
        PEAK <span className="text-zinc-300 tabular-nums">{formatCompact(Math.round(max))}</span>
      </span>
      <span
        className="anim-fade absolute right-4 top-1.5 text-right font-data text-[9px] tracking-[0.3em] text-zinc-500"
        style={animDelay(850)}
      >
        Δ {days}D{' '}
        {deltaPct === null ? (
          <span className="text-ember tabular-nums">NEW</span>
        ) : deltaPct >= 0 ? (
          <span className="text-ember tabular-nums">+{deltaPct}%</span>
        ) : (
          <span className="text-zinc-400 tabular-nums">{deltaPct}%</span>
        )}
        <span className="mt-0.5 block text-[8px] tracking-[0.25em] text-zinc-600">
          <span className="text-ice/80">—</span> 7D AVG
        </span>
      </span>
      {/* bottom labels sit inboard of the panel's corner brackets */}
      <span
        className="anim-fade absolute left-7 bottom-2 font-data text-[9px] tracking-[0.3em] text-zinc-600"
        style={animDelay(900)}
      >
        −{days}D
      </span>
      <span
        className="anim-fade absolute right-7 bottom-2 font-data text-[9px] tracking-[0.3em] text-zinc-600"
        style={animDelay(900)}
      >
        TODAY
      </span>
    </div>
  )
}
