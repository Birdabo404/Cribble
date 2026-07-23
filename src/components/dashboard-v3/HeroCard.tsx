import { formatCompact, tierAccent } from '@/components/dashboard-v2/format'
import { animDelay } from './anim'
import { IconCrosshair } from './DashIcons'
import { ScoreOdometer } from './ScoreOdometer'
import { Sparkline } from './Sparkline'
import type { ActivityDay, MeScores, RankInfo, Tier } from '@/types/dashboard'

// BASIC's chip is accent-green in the shared map; on this page the one
// green survivor is the wordmark, so BASIC re-inks to ember locally.
const tierChipClass = (tier: Tier | undefined) =>
  tier === 'BASIC' ? 'text-ember border-ember/40 bg-ember/5' : tierAccent(tier)

function MomentumChip({
  label,
  value,
  delayMs
}: {
  label: string
  value: number
  delayMs: number
}) {
  const positive = value > 0
  return (
    <div
      className="anim-rise flex items-baseline gap-2 rounded-lg liquid-glass-inset px-3 py-2"
      style={animDelay(delayMs)}
    >
      <span className="font-data text-[9px] tracking-[0.3em] text-zinc-500">{label}</span>
      <span
        className={`font-display text-sm font-semibold tabular-nums ${
          positive ? 'text-ember' : 'text-zinc-500'
        }`}
      >
        {positive ? '+' : ''}
        {formatCompact(Math.round(value))}
      </span>
    </div>
  )
}

function RefreshButton({
  onRefresh,
  refreshing
}: {
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      title="Refresh score"
      aria-label="Refresh score"
      className="group inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-800 text-zinc-500 transition-colors hover:border-zinc-600 hover:text-ember disabled:opacity-60"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : 'transition-transform duration-500 group-hover:rotate-180'}`}
      >
        <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
        <path d="M13.5 2.5v2.6h-2.6" />
      </svg>
    </button>
  )
}

export function HeroCard({
  scores,
  rank,
  tier,
  activity,
  onRefresh,
  refreshing
}: {
  scores: MeScores
  rank: RankInfo | null
  tier?: Tier
  activity: ActivityDay[]
  onRefresh: () => void
  refreshing: boolean
}) {
  const hasTrend = activity.some((d) => d.score > 0)

  return (
    <section className="dash-frame relative col-span-12 lg:col-span-8 overflow-hidden rounded-2xl liquid-glass">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-24 h-64 w-64 rounded-full opacity-30 blur-3xl"
        style={{
          background: 'radial-gradient(circle, rgb(var(--ember-rgb)/0.38), transparent 70%)'
        }}
      />

      <div className="relative flex h-full flex-col p-7 pb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div
              className="anim-fade flex items-center gap-2.5"
              style={animDelay(80)}
            >
              <span className="font-data text-[10px] tracking-[0.4em] text-zinc-300">TOTAL SCORE</span>
              <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
            </div>
            <div className="mt-4 flex items-baseline gap-3">
              <ScoreOdometer value={scores.total_score} />
              <span
                className="anim-fade font-data text-xs text-zinc-500 tracking-[0.3em]"
                style={animDelay(600)}
              >
                PTS
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span
              className={`anim-rise font-data text-[10px] tracking-[0.4em] px-2.5 py-1 rounded border ${tierChipClass(tier)}`}
              style={animDelay(160)}
            >
              {(tier || 'FREE').toUpperCase()}
            </span>
            <a
              href="/leaderboard"
              className="group anim-rise mt-1 text-right"
              style={animDelay(260)}
              title="View global leaderboard"
            >
              <div className="flex items-center justify-end gap-1.5 font-data text-[9px] tracking-[0.35em] text-zinc-500">
                <IconCrosshair size={11} className="text-ice/80" />
                GLOBAL RANK
              </div>
              <div className="mt-0.5 font-display text-2xl font-semibold tracking-tight tabular-nums text-ice group-hover:text-ember transition-colors">
                {rank ? `#${rank.position}` : '—'}
                {rank && (
                  <span className="text-sm font-normal text-zinc-600"> / {rank.total}</span>
                )}
              </div>
              <div className="font-data text-[9px] tracking-[0.25em] text-zinc-600 group-hover:text-ember/70 transition-colors">
                LEADERBOARD →
              </div>
            </a>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <MomentumChip label="TODAY" value={scores.today_score} delayMs={340} />
          <MomentumChip label="7 DAYS" value={scores.week_score} delayMs={420} />
          <MomentumChip label="30 DAYS" value={scores.month_score} delayMs={500} />
        </div>

        <div className="mt-auto pt-6 -mx-7">
          {hasTrend ? (
            <Sparkline activity={activity} days={28} height={112} />
          ) : (
            <div className="h-[112px] flex items-center justify-center font-data text-[10px] tracking-[0.3em] text-zinc-700">
              NO SIGNAL · LAST 28 DAYS
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
