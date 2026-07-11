import { formatDuration, formatNumber } from '@/components/dashboard-v2/format'
import { animDelay } from './anim'
import type { MeStats } from '@/types/dashboard'

type Kpi = {
  label: string
  value: string
  today?: string
  bar?: number // 0-100, renders a mini progress bar instead of a today line
}

export function KpiStrip({ stats }: { stats: MeStats }) {
  const focusPct =
    stats.today_time > 0
      ? Math.min(100, Math.round((stats.today_active_time / stats.today_time) * 100))
      : 0

  const cells: Kpi[] = [
    {
      label: 'VISITS',
      value: formatNumber(stats.total_visits),
      today: `+${formatNumber(stats.today_visits)} today`
    },
    {
      label: 'ACTIVE TIME',
      value: formatDuration(stats.active_time),
      today: `+${formatDuration(stats.today_active_time)} today`
    },
    {
      label: 'EFFICIENCY',
      value: `${stats.efficiency}%`,
      bar: stats.efficiency
    },
    {
      label: 'FOCUS TODAY',
      value: `${focusPct}%`,
      bar: focusPct
    }
  ]

  // `white` maps to --c-white, which flips per theme, so these hairlines
  // stay subtle on both the dark and light glass surfaces.
  const divCls = (i: number) => {
    if (i === 0) return ''
    if (i === 1) return 'border-l border-white/[0.08]'
    if (i === 2) return 'border-t border-white/[0.08] md:border-t-0 md:border-l'
    return 'border-t border-l border-white/[0.08] md:border-t-0'
  }

  return (
    <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 rounded-xl liquid-glass overflow-hidden">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`relative px-4 py-3.5 transition-colors hover:bg-white/[0.04] ${divCls(i)}`}
        >
          <div className="anim-rise" style={animDelay(120 + i * 90)}>
            <div className="text-[9px] tracking-[0.35em] text-zinc-500">{c.label}</div>
            <div className="mt-1.5 text-lg font-semibold tracking-tight text-zinc-50 tabular-nums">
              {c.value}
            </div>
            {c.bar !== undefined ? (
              <div className="mt-2 h-1 rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="anim-grow-x h-full bg-gradient-to-r from-accent/60 to-accent"
                  style={{ width: `${Math.max(2, c.bar)}%`, ...animDelay(320 + i * 90) }}
                />
              </div>
            ) : (
              <div className="mt-1 text-[10px] text-accent/80 truncate tabular-nums">
                {c.today}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
