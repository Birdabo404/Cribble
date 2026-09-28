'use client'

// Shop masthead — the storefront sibling of the Bag's ManifestHeader: `SHOP`
// as macro display type with its katakana kicker set on the same baseline,
// a right-aligned mono telemetry block (surface, season, catalog count, tier
// readout), then a full-width rule. Below md the telemetry collapses to one
// wrapped line. Registration crosses sit on the block's corners. No ASCII
// here — the page keeps the old block letters as a mute footer stamp.
//
// The tier readout is the only live cell: null means cosmetics are still
// syncing (blinking cursor), otherwise FREE / PRO / TEAM — PRO and TEAM
// print in gold, the premium hue, the one place gold appears above the
// fold. The page owns the entrance reveal; nothing animates in here.

import { JP as GLOSSARY } from './catalog'
import { DISPLAY, GOLD_TEXT, INK, JP, LINE, MICRO, MUTE } from './shopChrome'

export type MastheadTier = 'FREE' | 'PRO' | 'TEAM'

export interface MastheadProps {
  /** null = cosmetics still syncing; the readout blinks SYNCING. */
  tier: MastheadTier | null
  plateCount: number
}

const MACRO = `${DISPLAY} ${INK} font-bold uppercase leading-[0.85] tracking-[-0.05em] text-[length:clamp(3.5rem,18vw,6rem)] md:text-[length:clamp(3.5rem,12vw,9rem)]`
/** 14px in the masthead (the glossary's one large setting), pre-divided at
 * md like the token stops so it lands at 14px under the page zoom. */
const KICKER = `${JP} ${MUTE} text-[14px] tracking-[0.2em] leading-none md:text-[length:calc(14px/0.9)]`

const SURFACE = '[ STOREFRONT ]'
const SURFACE_LINE = `${SURFACE}\u00a0\u00a0// PLATES FOR THE BOARD`
const SEASON = 'SEASON 01 · IGNITION'
const SEASON_SHORT = 'SEASON 01'
const RAIL = 'USD · POLAR'

export function Masthead({ tier, plateCount }: MastheadProps) {
  const count = `${plateCount} PLATES`

  return (
    <header className="shpm-masthead shop-regmarks relative">
      <div className="px-[var(--shop-pad)] pb-4 pt-[var(--shop-pad)] md:grid md:grid-cols-[1fr_auto] md:items-end md:gap-x-6">
        <div className="shpm-lockup flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className={MACRO}>SHOP</h1>
          <span lang="ja" className={`shpm-kicker ${KICKER}`}>
            {GLOSSARY.shop}
          </span>
        </div>

        {/* md+: the telemetry block, right-aligned, one datum per line */}
        <div className={`shpm-telemetry hidden flex-col items-end gap-y-2 text-right md:flex ${MICRO} ${MUTE}`}>
          <div>{SURFACE_LINE}</div>
          <div>{SEASON}</div>
          <div>{`${count} · ${RAIL}`}</div>
          <TierReadout tier={tier} />
        </div>

        {/* <md: one wrapped line, `·` between data */}
        <div
          className={`shpm-telemetry-line mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden ${MICRO} ${MUTE}`}
        >
          <span>{SURFACE}</span>
          <span aria-hidden>·</span>
          <span>{SEASON_SHORT}</span>
          <span aria-hidden>·</span>
          <span>{count}</span>
          <span aria-hidden>·</span>
          <span>{RAIL}</span>
          <span aria-hidden>·</span>
          <TierReadout tier={tier} />
        </div>
      </div>

      {/* the page's entrance draws this (shopMotion.drawRule) */}
      <div aria-hidden className={`shpm-rule border-t ${LINE}`} />
    </header>
  )
}

/** `TIER · FREE|PRO|TEAM`, or `TIER · SYNCING▮` while cosmetics hydrate.
 * A live region: the flip from SYNCING to the tier is announced once. */
function TierReadout({ tier }: { tier: MastheadTier | null }) {
  if (tier === null) {
    return (
      <span role="status" className={`shpm-tier shop-cursor ${MUTE}`}>
        TIER · SYNCING
      </span>
    )
  }
  return (
    <span role="status" className={`shpm-tier ${tierPaint(tier)}`}>
      TIER · {tier}
    </span>
  )
}

/** FREE is a fact in ink; PRO and TEAM are the premium tiers, in gold. */
function tierPaint(tier: MastheadTier): string {
  switch (tier) {
    case 'FREE':
      return INK
    case 'PRO':
      return GOLD_TEXT
    case 'TEAM':
      return GOLD_TEXT
    default: {
      const exhaustive: never = tier
      return exhaustive
    }
  }
}
