import { ACCENT, SEASON, accentA } from './format'

export function SeasonCard({ pct, daysLeft }: { pct: number; daysLeft: number }) {
  return (
    <section className="col-span-12 md:col-span-4">
      <div className="relative h-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm p-6 flex flex-col justify-between">
        <div
          aria-hidden
          className="absolute -top-20 -right-16 h-44 w-44 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgb(var(--accent-rgb)/0.4), transparent 70%)' }}
        />
        <div className="relative">
          <div className="text-[10px] tracking-[0.4em] text-zinc-300">{SEASON.name}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
            {daysLeft}
            <span className="text-zinc-500 text-base font-normal tracking-[0.2em]"> D LEFT</span>
          </div>
        </div>
        <div className="relative mt-4">
          <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
            <div
              className="h-full"
              style={{
                width: `${pct}%`,
                background: ACCENT,
                boxShadow: `0 0 8px ${accentA(0.6)}`
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] tracking-[0.3em] text-zinc-500">
            <span>PROGRESS</span>
            <span style={{ color: ACCENT }}>{pct}%</span>
          </div>
        </div>
      </div>
    </section>
  )
}
