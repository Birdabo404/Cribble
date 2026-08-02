'use client'

// Shared chrome for the /teams surface — the same gold panel recipe the
// /team console established (keyline, wash, heavy drop shadow), plus the
// section header lockup every band on the page opens with.

const GOLD = 'var(--lb-gold)'

export function GoldPanel({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{
        border: `1px solid rgb(${GOLD} / 0.24)`,
        background: `linear-gradient(180deg, rgb(${GOLD} / 0.05), transparent 55%), rgb(var(--lb-panel-bg))`,
        boxShadow: `0 24px 70px -30px rgb(${GOLD} / 0.22), 0 18px 50px -24px rgb(0 0 0 / 0.6)`
      }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 4%, rgb(${GOLD} / 0.85) 50%, transparent 96%)`,
          boxShadow: `0 0 12px rgb(${GOLD} / 0.45)`
        }}
      />
      {children}
    </div>
  )
}

export function SectionHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
        {label}
      </h2>
      {note && <span className="text-[9px] tracking-[0.25em] text-zinc-600">{note}</span>}
    </div>
  )
}

/** The gold pixel chip — CRIBBLE TEAM's nameplate, same recipe as the
 *  shop's FOR COMPANIES / THE VAULT chips. */
export function GoldChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]"
      style={{
        color: `rgb(${GOLD})`,
        border: `1px solid rgb(${GOLD} / 0.45)`,
        background: `rgb(${GOLD} / 0.07)`,
        textShadow: `0 0 10px rgb(${GOLD} / 0.5)`
      }}
    >
      {children}
    </span>
  )
}
