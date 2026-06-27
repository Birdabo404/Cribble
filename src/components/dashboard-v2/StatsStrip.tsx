import { formatDuration, formatNumber } from './format'
import type { MeStats } from '@/types/dashboard'

export function StatsStrip({
  streak,
  stats
}: {
  streak: number
  stats: MeStats
}) {
  const cells: { label: string; value: string; hint: string }[] = [
    { label: 'STREAK', value: `${streak}d`, hint: 'consecutive' },
    {
      label: 'VISITS',
      value: formatNumber(stats.total_visits),
      hint: `${formatNumber(stats.today_visits)} today`
    },
    {
      label: 'ACTIVE',
      value: formatDuration(stats.active_time),
      hint: `${formatDuration(stats.today_active_time)} today`
    },
    {
      label: 'EFFICIENCY',
      value: `${stats.efficiency}%`,
      hint: 'active / total'
    }
  ]

  // Hairline dividers: 2x2 on mobile (border-l on cells 1,3 + border-t on cells 2,3),
  // 1x4 on desktop (border-l on cells 1,2,3).
  const divCls = (i: number) => {
    if (i === 0) return ''
    if (i === 1) return 'border-l border-zinc-900/80'
    if (i === 2) return 'border-t border-zinc-900/80 md:border-t-0 md:border-l'
    return 'border-t border-l border-zinc-900/80 md:border-t-0'
  }

  return (
    <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 rounded-xl border border-zinc-800/80 bg-zinc-950/70 backdrop-blur-sm overflow-hidden">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`relative px-4 py-3 transition-colors hover:bg-zinc-900/30 ${divCls(i)}`}
        >
          <div className="text-[9px] tracking-[0.35em] text-zinc-500">
            {c.label}
          </div>
          <div className="mt-1 text-base font-semibold tracking-tight text-zinc-50 tabular-nums">
            {c.value}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500 truncate">
            {c.hint}
          </div>
        </div>
      ))}
    </div>
  )
}
