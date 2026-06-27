import AnimatedCounter from '@/components/AnimatedCounter'
import { formatNumber, tierAccent } from './format'
import type { RankInfo, Tier } from '@/types/dashboard'

export function HeroCard({
  score,
  todayDelta,
  rank,
  tier
}: {
  score: number
  todayDelta: number
  rank: RankInfo | null
  tier?: Tier
}) {
  return (
    <section className="col-span-12 md:col-span-8">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-950 via-[#0b0e0c] to-black p-7">
        <div
          aria-hidden
          className="absolute -top-32 -right-24 h-64 w-64 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(2,254,1,0.4), transparent 70%)' }}
        />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] tracking-[0.4em] text-zinc-300">TOTAL SCORE</div>
            <div className="mt-3 flex items-baseline gap-3">
              <AnimatedCounter
                value={Math.round(score)}
                formatter={(v) => formatNumber(Math.round(v))}
                className="text-5xl md:text-6xl font-semibold tracking-tight text-zinc-50"
              />
              <span className="text-xs text-zinc-500 tracking-[0.3em]">PTS</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#02fe01] shadow-[0_0_8px_rgba(2,254,1,0.7)]" />
                <span>+{formatNumber(Math.round(todayDelta))} today</span>
              </span>
              {rank && <span className="text-zinc-700">·</span>}
              {rank && (
                <span className="text-zinc-400">
                  RANK <span className="text-zinc-100 font-semibold">#{rank.position}</span>
                  <span className="text-zinc-600"> / {rank.total}</span>
                </span>
              )}
            </div>
          </div>

          <span
            className={`text-[10px] tracking-[0.4em] px-2.5 py-1 rounded border ${tierAccent(tier)}`}
          >
            {(tier || 'FREE').toUpperCase()}
          </span>
        </div>
      </div>
    </section>
  )
}
