'use client'

// Shared chrome for the /teams surface — the same gold panel recipe the
// /team console established (keyline, wash, heavy drop shadow), plus the
// section header lockup every band on the page opens with. Styled via
// the theme-aware deck-* recipes in globals.css so html.light swaps the
// gold washes for solid amber-on-paper instead of collapsing to cream.

export function GoldPanel({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`deck-panel-gold relative overflow-hidden rounded-2xl ${className}`}>
      <span aria-hidden className="deck-keyline absolute inset-x-0 top-0 z-10 h-[2px]" />
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
 *  shop's FOR COMPANIES / THE VAULT chips. Inline letter-spacing keeps
 *  the wide nameplate tracking over .deck-chip's 0.18em, and the pinned
 *  weight stops html.light's chip weight bump from faux-bolding the
 *  single-weight pixel face. */
export function GoldChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="deck-chip deck-chip-gold deck-glow-text [font-family:var(--font-pixel)]"
      style={{ letterSpacing: '0.3em', fontWeight: 400 }}
    >
      {children}
    </span>
  )
}
