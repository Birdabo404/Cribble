'use client'

// The sponsorship page's live ad preview stage: instead of floating the
// card in a bare black box, stage it inside a fake product viewport so
// the buyer sees WHERE the card runs — a mock dashboard (nav bar +
// flipper strip + countdown hairline) for flipper ads, a mock profile
// page (rail card + profile silhouette + one vacant opposite slot) for
// rail ads — a stand-in for the profile's TRANSMISSIONS panel, which
// lists the eight slots as compact rows from 1024px up — a mock
// leaderboard page (title lockup + the sponsor face on
// the stat panel's footprint + ghost board rows) for leaderboard ads.
// The dark well is always dark in both themes because the
// surfaces it mocks (ticker, rails, the arena) are always dark — the one
// sanctioned exception to the page's --st-* token rule; the caption,
// fine print and note render outside it in page tokens. Because the
// Tailwind zinc/white scales are theme-mapped (tailwind.config points
// them at CSS variables that MIRROR under html.light), every ink inside
// the well is written as a literal hex of its dark-theme value — a
// themed class here would flip the mock chrome light against the
// always-dark ground (washed-out gold, invisible stubs). Prices derive
// from the @/lib/billboard and @/lib/leaderboardSponsor constants here
// — parents never pass prices.
//
// Densities: 'full' is the composer's hero preview (product chrome,
// caption, fine print); 'compact' is the tracker rows' and embedded
// edit form's version (card + caption only).

import { useEffect, useState } from 'react'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  RAIL_SLOT_PRICE_CENTS,
  type BillboardPlacement,
  type RailSlot
} from '@/lib/billboard'
import {
  LEADERBOARD_FLIP_SPONSOR_HOLD_MS,
  LEADERBOARD_FLIP_STATS_HOLD_MS,
  LEADERBOARD_FLIP_TRANSITION_MS,
  LEADERBOARD_SPONSOR_OPENING_CENTS,
  formatSponsorUsd,
  leaderboardMinTargetCents
} from '@/lib/leaderboardSponsor'
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
  /** Live or prospective leaderboard money shown inside the sponsor
   *  face. Omit outside live-board-aware surfaces to keep the opening
   *  $6.66 example used by the submission composer. */
  leaderboardPreview?: {
    rank: number
    clicks: number
    activeCents: number
    minTargetCents: number
  }
  className?: string
}

/** The card's identity props, forwarded to BillboardCard untouched. */
type StageCard = Pick<BillboardPreviewStageProps, 'title' | 'text' | 'logoUrl' | 'accentColor'>

// The always-dark ticker ground both densities stage the card on.
const WELL = 'overflow-hidden rounded-xl border border-[#fff]/10 bg-[#09090b] p-3 sm:p-4'

const FINE_PRINT = 'mt-1 text-[12px] leading-5 text-[color:var(--st-text-faint)]'

// Gold is reserved for weekly price numbers — nothing else on the page
// carries it. --lb-gold flips with the theme on its own.
const GOLD = { color: 'rgb(var(--lb-gold))' } as const

/** Gold for price numbers INSIDE the always-dark well: --lb-gold flips
 *  to a dark ink on the light theme (right for page surfaces, illegible
 *  on the #09090b well), so the mock leaderboard chrome carries the
 *  dark-theme gold literally — same stance as the well's zinc inks. */
const WELL_GOLD = '#ffd644'

/** One full stats -> sponsor -> stats rotation of the leaderboard flip
 *  panel, in whole seconds, for the fine-print pitch — derived from the
 *  cadence constants so a retiming can't leave stale copy here. */
const LEADERBOARD_FLIP_CYCLE_SECONDS = Math.round(
  (LEADERBOARD_FLIP_STATS_HOLD_MS +
    LEADERBOARD_FLIP_SPONSOR_HOLD_MS +
    2 * LEADERBOARD_FLIP_TRANSITION_MS) /
    1000
)

export function BillboardPreviewStage({
  title,
  text,
  logoUrl,
  accentColor,
  placement,
  slot,
  density = 'full',
  note = null,
  leaderboardPreview,
  className = ''
}: BillboardPreviewStageProps): JSX.Element {
  const card: StageCard = { title, text, logoUrl, accentColor }

  if (density === 'compact') {
    return (
      <div className={className}>
        <div className={WELL}>
          <div className="flex min-h-[240px] items-center justify-center">
            {placement === 'leaderboard' ? (
              <LeaderboardSponsorFace card={card} preview={leaderboardPreview} />
            ) : (
              <BillboardCard {...card} size={cardSizeFor(placement)} className="max-w-full" />
            )}
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
        <StageViewport
          placement={placement}
          slot={slot}
          card={card}
          leaderboardPreview={leaderboardPreview}
        />
      </div>
      <Caption placement={placement} slot={slot} />
      <p className={FINE_PRINT}>
        Final accent is sampled from your logo server-side — this preview approximates it.
      </p>
      {placement === 'leaderboard' && (
        <p className={FINE_PRINT}>
          At #1 your card shares the leaderboard{`'`}s stat panel — it holds{' '}
          {LEADERBOARD_FLIP_SPONSOR_HOLD_MS / 1000}s of every ~{LEADERBOARD_FLIP_CYCLE_SECONDS}s
          flip cycle, and every rank stays listed on the sponsor board.
        </p>
      )}
      {note && <p className={FINE_PRINT}>{note}</p>}
    </div>
  )
}

/** Which BillboardCard shape a placement airs in. Leaderboard never
 *  lands here — its face is LeaderboardSponsorFace, not a card size. */
function cardSizeFor(placement: Exclude<BillboardPlacement, 'leaderboard'>): 'lg' | 'rail' {
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
  card,
  leaderboardPreview
}: {
  placement: BillboardPlacement
  slot: RailSlot | null
  card: StageCard
  leaderboardPreview?: BillboardPreviewStageProps['leaderboardPreview']
}) {
  switch (placement) {
    case 'flipper':
      return <FlipperViewport card={card} />
    case 'rail':
      return <RailViewport card={card} slot={slot} />
    case 'leaderboard':
      return <LeaderboardViewport card={card} preview={leaderboardPreview} />
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
        className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-[#fff]/[0.06]"
      >
        <div className="font-display text-[13px] font-semibold leading-none tracking-tight text-[#f4f4f5]">
          Cribble<span className="text-accent">.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="rounded-full border border-[#fff]/[0.08] bg-[#fff]/[0.05] px-2.5 py-1 text-[10px] leading-none text-[#a1a1aa]">
            Dashboard
          </div>
          <div className="rounded-full border border-[#fff]/[0.06] px-2.5 py-1 text-[10px] leading-none text-[#52525b]">
            Leaderboard
          </div>
        </div>
      </div>

      {/* The flipper strip exactly as it airs. */}
      <div className="mt-3">
        <BillboardCard {...card} size="lg" />
      </div>

      {/* The ticker's per-item countdown, looping (see globals.css). */}
      <div aria-hidden className="mt-2 h-[2px] overflow-hidden rounded-full bg-[#fff]/[0.12]">
        <div className="billboard-stage-sweep h-full w-full bg-[#e4e4e7]" />
      </div>

      {/* Ghost content panels — unmistakably stubs. They fill the rest
          of the viewport so the strip reads as "first thing under the
          nav, above your content", not a banner floating in the dark. */}
      <div aria-hidden className="mt-3 grid min-h-[40px] flex-1 grid-cols-[3fr_2fr] gap-3">
        <div className="rounded-lg border border-[#fff]/[0.05] bg-[#fff]/[0.015]" />
        <div className="rounded-lg border border-[#fff]/[0.05] bg-[#fff]/[0.015]" />
      </div>
    </div>
  )
}

/** A fake profile viewport: the rail card, a quiet profile silhouette
 *  in the middle for context and scale, and one vacant plate on the
 *  opposite side — a slot system with exactly one slot sold. The live
 *  placement is the profile's TRANSMISSIONS panel (eight compact rows
 *  in the page's left column, 1024px+); this stage keeps the L/R split
 *  of the pitch board's slot map so the pick reads as a position.
 *  Narrow viewports drop to card + silhouette stacked. */
function RailViewport({ card, slot }: { card: StageCard; slot: RailSlot | null }) {
  // L-slots (and the "any open slot" default) sit on the left, R-slots
  // on the right — the slot map's columns, so the buyer's pick reads as
  // geometry, not just a code.
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
          <div className="h-9 w-9 shrink-0 rounded-full border border-[#fff]/[0.08] bg-[#fff]/[0.05]" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="h-2 w-28 max-w-full rounded-full bg-[#fff]/[0.08]" />
            <div className="h-2 w-16 max-w-full rounded-full bg-[#fff]/[0.05]" />
          </div>
        </div>
        <div className="mt-3 min-h-[56px] flex-1 rounded-lg border border-[#fff]/[0.05]" />
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
 *  faint hatch (the profile panel's open rows wear the same hatch),
 *  built locally so no page CSS leaks in. */
function GhostPlate() {
  return (
    <div
      className="relative flex h-40 items-center justify-center overflow-hidden rounded-lg"
      style={{
        backgroundImage:
          'repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 8px)'
      }}
    >
      <div className="absolute left-1.5 top-1.5 h-2.5 w-2.5 border-l border-t border-[#fff]/15" />
      <div className="absolute right-1.5 top-1.5 h-2.5 w-2.5 border-r border-t border-[#fff]/15" />
      <div className="absolute bottom-1.5 left-1.5 h-2.5 w-2.5 border-b border-l border-[#fff]/15" />
      <div className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b border-r border-[#fff]/15" />
      <div className="font-data text-[9px] font-medium uppercase tracking-[0.3em] text-[#52525b]">
        Open slot
      </div>
    </div>
  )
}

/** A fake leaderboard-page viewport: the arena's title lockup up top,
 *  the sponsor face exactly where the stat panel sits (the flip mounts
 *  around StatBar — stats and the #1 sponsor alternate on one
 *  footprint), and ghost board rows below for context and scale. */
function LeaderboardViewport({
  card,
  preview
}: {
  card: StageCard
  preview?: BillboardPreviewStageProps['leaderboardPreview']
}) {
  return (
    <div className="flex min-h-[240px] flex-col sm:min-h-[280px]">
      {/* Title lockup stub — enough of the arena chrome (gold season
          line + pixel wordmark) to read as "the leaderboard page". */}
      <div aria-hidden className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
        <div className="flex items-center gap-2" style={{ color: WELL_GOLD }}>
          <span
            className="h-px w-6"
            style={{ background: `linear-gradient(to right, transparent, ${WELL_GOLD}80)` }}
          />
          <span className="text-[8px] font-semibold tracking-[0.42em]">SEASON</span>
          <span
            className="h-px w-6"
            style={{ background: `linear-gradient(to left, transparent, ${WELL_GOLD}80)` }}
          />
        </div>
        <div className="text-[13px] leading-none text-[#f4f4f5] [font-family:var(--font-pixel)]">
          LEADERBOARD
        </div>
      </div>

      {/* The sponsor face on the stat panel's footprint. */}
      <div className="mt-3">
        <LeaderboardSponsorFace card={card} preview={preview} />
      </div>

      {/* Ghost board rows — unmistakably stubs, filling the viewport so
          the face reads as "the panel above the standings". */}
      <div aria-hidden className="mt-3 flex min-h-[40px] flex-1 flex-col gap-2">
        <div className="min-h-[16px] flex-1 rounded-lg border border-[#fff]/[0.05] bg-[#fff]/[0.015]" />
        <div className="min-h-[16px] flex-1 rounded-lg border border-[#fff]/[0.05] bg-[#fff]/[0.015]" />
        <div className="min-h-[16px] flex-1 rounded-lg border border-[#fff]/[0.05] bg-[#fff]/[0.015]" />
      </div>
    </div>
  )
}

/** The leaderboard sponsor face. Live-board-aware parents pass the
 *  actual standing or the prospective standing a fresh minimum bid
 *  would buy; other preview surfaces fall back to the opening example.
 *  Inert by design — nothing here navigates. Same dead-logo stance as
 *  BillboardCard: a failed load drops the <img> instead of painting
 *  the broken glyph. */
function LeaderboardSponsorFace({
  card,
  preview
}: {
  card: StageCard
  preview?: BillboardPreviewStageProps['leaderboardPreview']
}) {
  const { title, text, logoUrl, accentColor } = card
  const [logoDead, setLogoDead] = useState(false)
  useEffect(() => setLogoDead(false), [logoUrl])
  const rank = preview?.rank ?? 1
  const clicks = preview?.clicks ?? 0
  const activeCents = preview?.activeCents ?? LEADERBOARD_SPONSOR_OPENING_CENTS
  const minTargetCents =
    preview?.minTargetCents ?? leaderboardMinTargetCents(LEADERBOARD_SPONSOR_OPENING_CENTS)

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-[#27272a] bg-[#09090b]/80 px-3 py-2.5 sm:px-4 sm:py-3">
      {/* Wash + stripe — the lg-card accent machinery, 0x1A ≈ 10% alpha. */}
      {accentColor && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `${accentColor}1a` }}
        />
      )}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[3px] ${accentColor ? '' : 'bg-[#3f3f46]'}`}
        style={accentColor ? { background: accentColor } : undefined}
      />

      <div className="relative flex items-center gap-2.5 sm:gap-3">
        <span
          className="shrink-0 text-[14px] leading-none [font-family:var(--font-pixel)]"
          style={{ color: WELL_GOLD }}
        >
          #{rank}
        </span>
        {logoUrl && !logoDead && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className="h-8 w-8 shrink-0 rounded object-cover sm:h-10 sm:w-10"
            style={{
              boxShadow: `0 0 0 1px ${accentColor ? `${accentColor}80` : 'rgb(255 255 255 / 0.14)'}`
            }}
            onError={() => setLogoDead(true)}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span className="truncate text-[11px] font-semibold uppercase leading-4 tracking-[0.2em] text-[#fafafa]">
            {title}
          </span>
          <span className="truncate text-sm leading-5 text-[#e4e4e7]">{text}</span>
        </span>
        <span className="shrink-0 self-start text-[9px] tracking-[0.3em] text-[#71717a]">
          SPONSOR
        </span>
      </div>

      {/* The money row: clicks, active total, and the board's fresh
          challenge target. */}
      <div className="relative mt-2.5 flex min-w-0 items-center gap-2 border-t border-[#fff]/[0.06] pt-2 text-[11px] leading-4">
        <span className="tabular-nums text-[#71717a]">
          {clicks.toLocaleString('en-US')} click{clicks === 1 ? '' : 's'}
        </span>
        <span aria-hidden className="text-[#3f3f46]">
          ·
        </span>
        <span className="font-data tabular-nums" style={{ color: WELL_GOLD }}>
          {formatSponsorUsd(activeCents)}
        </span>
        <span className="text-[#71717a]">active</span>
        {/* The real face's CTA chrome (gold-bordered, gold ink) — one
            of the product's own surfaces, so the page's gold rule
            defers to fidelity inside the well. Inert: a preview never
            navigates. */}
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium tracking-[0.2em]"
          style={{
            color: WELL_GOLD,
            border: `1px solid ${WELL_GOLD}80`,
            background: `${WELL_GOLD}12`
          }}
        >
          OUTBID ·{' '}
          <span className="font-data tabular-nums">
            {formatSponsorUsd(minTargetCents)}
          </span>
        </span>
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
          Profile transmissions{' · '}
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
    case 'leaderboard':
      return (
        <p className="mt-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          Leaderboard sponsor board{' · '}
          <span className="font-data">rolling 24h bids</span>
          {' · '}
          from{' '}
          <span className="font-data" style={GOLD}>
            {formatSponsorUsd(LEADERBOARD_SPONSOR_OPENING_CENTS)}
          </span>
        </p>
      )
    default: {
      const exhaustive: never = placement
      throw new Error(`Unhandled placement: ${String(exhaustive)}`)
    }
  }
}
