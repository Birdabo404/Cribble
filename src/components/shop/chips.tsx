'use client'

// Shop chip primitives — the five facts every card prints (index is the
// card's own), plus the two doors (price chip, EQUIP) and the inspect
// button. All mono, all square, all on --shop-* tokens; the only color
// that is not a token is rarity, which rides --r-* via rarityColor().
//
// Hover contract: a card root carrying `shpc-hoverable` inverts its price
// chip (ink slab, paper type) while hovered — the chip is the card's one
// action, so the whole compartment "arms" it. The chip and the SPEC
// button also invert on their own hover / keyboard focus, which is how
// touch and keyboard users see the same state. Press is a 0.98 scale;
// nothing lifts, nothing glows. Self-contained styled-jsx under `shpc-`.

import type { MouseEvent, ReactNode } from 'react'
import Link from 'next/link'
import { PLATE_RARITY_META, type PlateRarity } from '@/lib/cosmetics/plates'
import { JP as JP_COPY, proPrice, rarityJp, usd } from './catalog'
import {
  FOCUS,
  FOCUS_ON_SIGNAL,
  GOLD_FILL,
  INK,
  JP_KICKER,
  LABEL,
  LINE,
  MICRO,
  MUTE,
  OWNED_TEXT,
  PAPER_BG,
  PIXEL,
  SIGNAL_FILL,
  rarityColor
} from './shopChrome'

/** 'RARE' → 'Rare'. The CSS uppercases it back on the floor; the DOM keeps
 * the readable form for screen readers. */
export function rarityLabel(rarity: PlateRarity) {
  const label = PLATE_RARITY_META[rarity].label
  return label.charAt(0) + label.slice(1).toLowerCase()
}

function CheckMark({ size = 9 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="m3.5 8.5 3 3 6-6.5" />
    </svg>
  )
}

/** Rarity as a fact: the 10px label and a 6px tick in the --r-* hue,
 * optionally followed by the Japanese class name in mute. Never a fill. */
export function RarityTick({ rarity, jp = false }: { rarity: PlateRarity; jp?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${MICRO}`}
      style={{ color: rarityColor(rarity) }}
    >
      <span>{rarityLabel(rarity)}</span>
      <span aria-hidden className="inline-block h-1.5 w-1.5 bg-current" />
      {jp && <span className={`${JP_KICKER} ${MUTE}`}>{rarityJp(rarity)}</span>}
    </span>
  )
}

/** Seasonal drop tag — the catalog's own label, 10px mute mono. */
export function SeasonTag({ label }: { label: string }) {
  return <span className={`${MICRO} ${MUTE} whitespace-nowrap`}>{label}</span>
}

/** Ownership mark. `overlay` is the paper slab pinned over the art (the
 * consumer positions it); the default form is the inline OWNED ✓ + 所持済
 * for spec rows. */
export function OwnedMark({ overlay = false }: { overlay?: boolean }) {
  if (overlay) {
    return (
      <span
        className={`inline-flex h-5 items-center gap-1 border px-1.5 ${LINE} ${PAPER_BG} ${MICRO} ${OWNED_TEXT}`}
      >
        <CheckMark />
        OWNED
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${MICRO} ${OWNED_TEXT}`}>
      <CheckMark />
      OWNED
      <span className={`${JP_KICKER} ${MUTE}`}>{JP_COPY.owned}</span>
    </span>
  )
}

type PriceSize = 'md' | 'lg'

/** Pixel stops, pre-divided at md like the --shop-fs-* tokens so the price
 * lands at its nominal size under .page-zoom-out. */
function priceSizeClass(size: PriceSize): string {
  switch (size) {
    case 'md':
      return 'text-[12px] md:text-[length:calc(12px/0.9)]'
    case 'lg':
      return 'text-[20px] md:text-[length:calc(20px/0.9)]'
    default: {
      const exhaustive: never = size
      return exhaustive
    }
  }
}

/** Price lockup. Consumers pass the base catalog price; the -25% Pro strike
 * math happens here via proPrice/usd. The main figure inherits color so
 * the chip's inversion carries it; the strike rides opacity and the deal
 * tag is gold at rest (the Pro tier speaking), inheriting once inverted. */
export function PriceLockup({
  priceUsd,
  isPro,
  size
}: {
  priceUsd: number
  isPro: boolean
  size: PriceSize
}) {
  const figure = `${PIXEL} ${priceSizeClass(size)} leading-none`
  if (isPro) {
    return (
      <>
        <span className="inline-flex items-baseline gap-2">
          <s className={`shpc-strike ${MICRO}`}>{usd(priceUsd)}</s>
          <span className={figure}>{usd(proPrice(priceUsd))}</span>
          <span className={`shpc-deal ${MICRO}`}>−25%</span>
        </span>
        <ChipStyles />
      </>
    )
  }
  return <span className={figure}>{usd(priceUsd)}</span>
}

type ChipTone = 'ink' | 'signal' | 'gold'

/** Rest paint per tone. Ink is the outlined default (every card price
 * chip); signal and gold are the two filled hues — plate action, Pro tier.
 * All three invert to the ink slab on hover / focus. */
function chipToneClass(tone: ChipTone): string {
  switch (tone) {
    case 'ink':
      return `border ${LINE} ${INK} ${FOCUS}`
    case 'signal':
      return `shpc-chip-fill border border-transparent ${SIGNAL_FILL} ${FOCUS_ON_SIGNAL}`
    case 'gold':
      return `shpc-chip-fill border border-transparent ${GOLD_FILL} ${FOCUS_ON_SIGNAL}`
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}

const CHIP_SHELL = `shpc-chip relative inline-flex shrink-0 items-center gap-2 px-3 py-2 ${LABEL}`

/** The checkout door: an `<a>` styled as a bordered mono chip. Tap-floor
 * tall on coarse pointers (CSS), inverts on hover / focus, 0.98 on press.
 * `onClick` is for the card's stopPropagation. */
export function PriceChip({
  href,
  ariaLabel,
  children,
  tone = 'ink',
  onClick
}: {
  href: string
  ariaLabel: string
  children: ReactNode
  tone?: ChipTone
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <>
      <a href={href} aria-label={ariaLabel} onClick={onClick} className={`${CHIP_SHELL} ${chipToneClass(tone)}`}>
        {children}
        <span aria-hidden className="shpc-arrow">
          ▸
        </span>
      </a>
      <ChipStyles />
    </>
  )
}

/** In-app door in the same chip shell (client navigation): the vault's
 * LEADERBOARD →, and EquipLink below. */
export function DoorLink({
  href,
  children,
  ariaLabel,
  className = INK
}: {
  href: string
  children: ReactNode
  ariaLabel?: string
  /** Rest text color — defaults to ink; EquipLink passes the owned hue. */
  className?: string
}) {
  return (
    <>
      <Link href={href} aria-label={ariaLabel} className={`${CHIP_SHELL} border ${LINE} ${className} ${FOCUS}`}>
        {children}
      </Link>
      <ChipStyles />
    </>
  )
}

/** Owned plates trade the price chip for the door to the Bag. */
export function EquipLink() {
  return (
    <DoorLink href="/bag" className={OWNED_TEXT}>
      EQUIP
      <span aria-hidden>→</span>
      <span aria-hidden className={`shpc-sub ${JP_KICKER}`}>
        {JP_COPY.equip}
      </span>
    </DoorLink>
  )
}

/** `[ SPEC 仕様 ]` — the inspect step. Outlined mono button, mute at rest,
 * inverts on hover / focus; this is every card's keyboard path. */
export function SpecButton({ onClick, label = 'SPEC' }: { onClick: () => void; label?: string }) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`shpc-btn relative inline-flex shrink-0 items-center gap-1 border px-2.5 py-2 ${LINE} ${MUTE} ${LABEL} ${FOCUS}`}
      >
        <span aria-hidden>[</span>
        {label}
        <span aria-hidden className={`shpc-sub ${JP_KICKER}`}>
          {JP_COPY.spec}
        </span>
        <span aria-hidden>]</span>
      </button>
      <ChipStyles />
    </>
  )
}

function ChipStyles() {
  return (
    <style jsx global>{`
      .shpc-chip,
      .shpc-btn {
        transition:
          background-color 160ms ease,
          border-color 160ms ease,
          color 160ms ease,
          transform 120ms ease;
      }
      .shpc-chip:active,
      .shpc-btn:active {
        transform: scale(0.98);
      }
      /* the tap floor only where there is no fine pointer */
      @media (pointer: coarse) {
        .shpc-chip,
        .shpc-btn {
          min-height: var(--shop-tap);
        }
      }

      /* inversion — keyboard focus always; hover only on fine pointers */
      .shpc-chip:focus-visible,
      .shpc-btn:focus-visible {
        background: var(--shop-ink);
        border-color: var(--shop-ink);
        color: var(--shop-paper);
      }
      @media (hover: hover) and (pointer: fine) {
        .shpc-chip:hover,
        .shpc-btn:hover,
        .shpc-hoverable:hover .shpc-chip {
          background: var(--shop-ink);
          border-color: var(--shop-ink);
          color: var(--shop-paper);
        }
      }
      /* the dashed ring is ink by default; on the inverted slab it is paper */
      .shop-floor .shpc-chip:focus-visible,
      .shop-floor .shpc-btn:focus-visible {
        outline-color: var(--shop-paper);
      }

      /* lockup sub-parts: the strike rides opacity, the deal tag is gold
         at rest and inherits once it sits on a filled or inverted slab */
      .shpc-strike,
      .shpc-sub {
        opacity: 0.6;
      }
      .shpc-deal {
        color: var(--shop-gold-text);
      }
      .shpc-chip-fill .shpc-deal,
      .shpc-chip:focus-visible .shpc-deal {
        color: inherit;
      }
      @media (hover: hover) and (pointer: fine) {
        .shpc-chip:hover .shpc-deal,
        .shpc-hoverable:hover .shpc-chip .shpc-deal {
          color: inherit;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .shpc-chip,
        .shpc-btn {
          transition: none;
        }
        .shpc-chip:active,
        .shpc-btn:active {
          transform: none;
        }
      }
      html[data-motion='reduced'] .shpc-chip,
      html[data-motion='reduced'] .shpc-btn {
        transition: none;
      }
      html[data-motion='reduced'] .shpc-chip:active,
      html[data-motion='reduced'] .shpc-btn:active {
        transform: none;
      }
    `}</style>
  )
}
