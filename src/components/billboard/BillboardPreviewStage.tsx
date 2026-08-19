'use client'

// The sponsorship page's live ad preview stage: instead of floating the
// card in a bare black box, stage it inside a fake product viewport so
// the buyer sees WHERE the card runs — a mock dashboard (nav bar +
// flipper strip + countdown hairline) for flipper ads, a mock profile
// page (rail card + profile silhouette + one vacant opposite slot) for
// rail ads. The dark well is always dark in both themes because the
// surfaces it mocks (ticker, rails) are always dark — the one
// sanctioned exception to the page's --st-* token rule; the caption,
// fine print and note render outside it in page tokens. Weekly prices
// derive from the @/lib/billboard constants here — parents never pass
// prices.
//
// Densities: 'full' is the composer's hero preview (product chrome,
// caption, fine print); 'compact' is the tracker rows' and embedded
// edit form's version (card + caption only).

import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  RAIL_SLOT_PRICE_CENTS,
  type BillboardPlacement,
  type RailSlot
} from '@/lib/billboard'
import { BillboardCard } from '@/components/billboard/BillboardCard'

export interface BillboardPreviewStageProps {
  title: string
  text: string
  logoUrl: string | null
  accentColor: string | null
  placement: BillboardPlacement
  /** Rail: the selected/assigned slot; null = any open slot. Ignored for flipper. */
  slot: RailSlot | null
  /** 'full' = fake product chrome + caption + fine print; 'compact' = card + one caption line. Default 'full'. */
  density?: 'full' | 'compact'
  /** Optional note under the caption, e.g. 'Previewing with your avatar'. */
  note?: string | null
  className?: string
}

/** The card's identity props, forwarded to BillboardCard untouched. */
type StageCard = Pick<BillboardPreviewStageProps, 'title' | 'text' | 'logoUrl' | 'accentColor'>

// The always-dark ticker ground both densities stage the card on.
const WELL = 'overflow-hidden rounded-xl border border-white/10 bg-[#09090b] p-3 sm:p-4'

const FINE_PRINT = 'mt-1 text-[12px] leading-5 text-[color:var(--st-text-faint)]'

// Gold is reserved for weekly price numbers — nothing else on the page
// carries it. --lb-gold flips with the theme on its own.
const GOLD = { color: 'rgb(var(--lb-gold))' } as const

export function BillboardPreviewStage({
  title,
  text,
  logoUrl,
  accentColor,
  placement,
  slot,
  density = 'full',
  note = null,
  className = ''
}: BillboardPreviewStageProps): JSX.Element {
  const card: StageCard = { title, text, logoUrl, accentColor }

  if (density === 'compact') {
    return (
      <div className={className}>
        <div className={WELL}>
          <div className="flex min-h-[240px] items-center justify-center">
            <BillboardCard {...card} size={cardSizeFor(placement)} className="max-w-full" />
          </div>
        </div>
        <Caption placement={placement} slot={slot} />
        {note && <p className={FINE_PRINT}>{note}</p>}
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
          Live preview
        </span>
        <span className="text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
          Exactly as it airs
        </span>
      </div>
      <div className={`mt-1.5 ${WELL}`}>
        <StageViewport placement={placement} slot={slot} card={card} />
      </div>
      <Caption placement={placement} slot={slot} />
      <p className={FINE_PRINT}>
        Final accent is sampled from your logo server-side — this preview approximates it.
      </p>
      {note && <p className={FINE_PRINT}>{note}</p>}
    </div>
  )
}

/** Which BillboardCard shape a placement airs in. */
function cardSizeFor(placement: BillboardPlacement): 'lg' | 'rail' {
  switch (placement) {
    case 'flipper':
      return 'lg'
    case 'rail':
      return 'rail'
    default: {
      const exhaustive: never = placement
      throw new Error(`Unhandled placement: ${String(exhaustive)}`)
    }
  }
}

/** Full density's fake product surface — one viewport per placement. */
function StageViewport({
  placement,
  slot,
  card
}: {
  placement: BillboardPlacement
  slot: RailSlot | null
  card: StageCard
}) {
  switch (placement) {
    case 'flipper':
      return <FlipperViewport card={card} />
    case 'rail':
      return <RailViewport card={card} slot={slot} />
    default: {
      const exhaustive: never = placement
      throw new Error(`Unhandled placement: ${String(exhaustive)}`)
    }
  }
}

/** A fake dashboard viewport: inert nav chrome up top, the real flipper
 *  strip right under it — exactly where the ticker mounts — a countdown
 *  hairline, and ghost content panels below for context and scale. */
function FlipperViewport({ card }: { card: StageCard }) {
  return (
    <div className="flex min-h-[240px] flex-col sm:min-h-[280px]">
      {/* Fake top bar — divs only, nothing navigates. "Dashboard" reads
          as the current page since that's the viewport being mocked. */}
      <div
        aria-hidden
        className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06]"
      >
        <div className="font-display text-[13px] font-semibold leading-none tracking-tight text-zinc-100">
          Cribble<span className="text-accent">.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[10px] leading-none text-zinc-400">
            Dashboard
          </div>
          <div className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[10px] leading-none text-zinc-600">
            Leaderboard
          </div>
        </div>
      </div>

      {/* The flipper strip exactly as it airs. */}
      <div className="mt-3">
        <BillboardCard {...card} size="lg" />
      </div>

      {/* The ticker's per-item countdown, looping (see globals.css). */}
      <div aria-hidden className="mt-2 h-[2px] overflow-hidden rounded-full bg-white/[0.12]">
        <div className="billboard-stage-sweep h-full w-full bg-zinc-200" />
      </div>

      {/* Ghost content panels — unmistakably stubs. They fill the rest
          of the viewport so the strip reads as "first thing under the
          nav, above your content", not a banner floating in the dark. */}
      <div aria-hidden className="mt-3 grid min-h-[40px] flex-1 grid-cols-[3fr_2fr] gap-3">
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.015]" />
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.015]" />
      </div>
    </div>
  )
}

/** A fake profile viewport: the rail card on its real side, a quiet
 *  profile silhouette in the middle for context and scale, and one
 *  vacant plate on the opposite side — a rail system with exactly one
 *  slot sold. Narrow viewports drop to card + silhouette stacked. */
function RailViewport({ card, slot }: { card: StageCard; slot: RailSlot | null }) {
  // L-slots (and the "any open slot" default) mount in the profile's
  // left column, R-slots in the right — mirror that so the buyer's pick
  // reads as geometry, not just a code.
  const onRight = slot !== null && slot.startsWith('R')

  return (
    <div className="flex min-h-[240px] flex-col gap-3 sm:min-h-[280px] sm:flex-row sm:gap-4">
      <div className={`mx-auto w-52 shrink-0 sm:mx-0 ${onRight ? 'sm:order-3' : 'sm:order-1'}`}>
        <BillboardCard {...card} size="rail" />
      </div>

      {/* Profile silhouette — avatar circle, two name bars, an empty
          content well. Low-contrast on purpose: clearly a stub. */}
      <div aria-hidden className="flex min-w-0 flex-1 flex-col sm:order-2">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="h-9 w-9 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.05]" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="h-2 w-28 max-w-full rounded-full bg-white/[0.08]" />
            <div className="h-2 w-16 max-w-full rounded-full bg-white/[0.05]" />
          </div>
        </div>
        <div className="mt-3 min-h-[56px] flex-1 rounded-lg border border-white/[0.05]" />
      </div>

      <div
        aria-hidden
        className={`hidden w-52 shrink-0 sm:block ${onRight ? 'sm:order-1' : 'sm:order-3'}`}
      >
        <GhostPlate />
      </div>
    </div>
  )
}

/** One vacant slot in the open-slot language — corner brackets over a
 *  faint hatch, echoing .billboard-rail-vacant but built locally so the
 *  fixed-position rails CSS never leaks in. 160px sits inside the real
 *  rail cell's height clamp. */
function GhostPlate() {
  return (
    <div
      className="relative flex h-40 items-center justify-center overflow-hidden rounded-lg"
      style={{
        backgroundImage:
          'repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 8px)'
      }}
    >
      <div className="absolute left-1.5 top-1.5 h-2.5 w-2.5 border-l border-t border-white/15" />
      <div className="absolute right-1.5 top-1.5 h-2.5 w-2.5 border-r border-t border-white/15" />
      <div className="absolute bottom-1.5 left-1.5 h-2.5 w-2.5 border-b border-l border-white/15" />
      <div className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b border-r border-white/15" />
      <div className="font-data text-[9px] font-medium uppercase tracking-[0.3em] text-zinc-600">
        Open slot
      </div>
    </div>
  )
}

/** The one-line placement + duration + weekly price readout under the
 *  well — page tokens, mono for the numbers, gold for the price. */
function Caption({ placement, slot }: { placement: BillboardPlacement; slot: RailSlot | null }) {
  switch (placement) {
    case 'flipper':
      return (
        <p className="mt-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          Dashboard + leaderboard{' · '}
          <span className="font-data">{BILLBOARD_DURATION_DAYS} days</span>
          {' · '}
          <span className="font-data" style={GOLD}>
            ${BILLBOARD_PRICE_CENTS / 100}/wk
          </span>
        </p>
      )
    case 'rail':
      return (
        <p className="mt-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          Profile rail{' · '}
          {slot ? <span className="font-data">{slot}</span> : 'any open slot'}
          {' · '}
          <span className="font-data">{BILLBOARD_DURATION_DAYS} days</span>
          {' · '}
          {slot ? (
            <span className="font-data" style={GOLD}>
              ${RAIL_SLOT_PRICE_CENTS[slot] / 100}/wk
            </span>
          ) : (
            <>
              from{' '}
              <span className="font-data" style={GOLD}>
                ${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk
              </span>
            </>
          )}
        </p>
      )
    default: {
      const exhaustive: never = placement
      throw new Error(`Unhandled placement: ${String(exhaustive)}`)
    }
  }
}
