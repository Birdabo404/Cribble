'use client'

// Shop chip primitives — rarity/seasonal labels, the owned check, the
// price lockup and the buy-chip shell shared by storefront cards.
// Self-contained styled-jsx under the `shpc-` prefix.
//
// Hover contract: BuyChip tints toward the card's accent while a card root
// carrying `shpc-hoverable` is hovered / focus-within. The card root must
// also set `--tile-accent` (an `R G B` triplet).

import type { ReactNode } from 'react'
import { PLATE_RARITY_META, type PlateRarity } from '@/lib/cosmetics/plates'
import { proPrice, usd } from './catalog'

function titleCaseLabel(label: string) {
  return label.charAt(0) + label.slice(1).toLowerCase()
}

export function rarityLabel(rarity: PlateRarity) {
  return titleCaseLabel(PLATE_RARITY_META[rarity].label)
}

function CheckMark({ size = 10 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-6.5" />
    </svg>
  )
}

export function RarityChip({ rarity }: { rarity: PlateRarity }) {
  const meta = PLATE_RARITY_META[rarity]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: meta.color }}
      />
      {rarityLabel(rarity)}
    </span>
  )
}

export function SeasonalChip({ label }: { label: string }) {
  return <span className="text-[11px] text-zinc-500">{titleCaseLabel(label)}</span>
}

/** Owned marker. `overlay` is the 10px check pinned over plate art —
 * positioning is left to the consumer. The default form is a quiet
 * inline check + label for price-row replacement. */
export function OwnedChip({ overlay = false }: { overlay?: boolean }) {
  if (overlay) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[rgb(var(--lb-up))]"
        style={{ background: 'rgb(0 0 0 / 0.55)' }}
        aria-label="Owned"
      >
        <CheckMark size={10} />
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[rgb(var(--lb-up))]">
      <CheckMark size={10} />
      Owned
    </span>
  )
}

type PriceTagSize = 'md' | 'lg'

const PRICE_SIZE_CLASS: Record<PriceTagSize, string> = {
  md: 'text-[12px]',
  lg: 'text-[14px]'
}

/** Price lockup. Consumers pass the base catalog price; the -25% Pro
 * strike math happens here via proPrice/usd. */
export function PriceTag({
  priceUsd,
  isPro,
  size = 'md'
}: {
  priceUsd: number
  isPro: boolean
  size?: PriceTagSize
}) {
  const sizeClass = PRICE_SIZE_CLASS[size]
  if (isPro) {
    return (
      <>
        <span className="text-[10px] tabular-nums text-zinc-600 line-through">{usd(priceUsd)}</span>
        <span
          className={`${sizeClass} leading-none tabular-nums text-amber-300 [font-family:var(--font-pixel)]`}
        >
          {usd(proPrice(priceUsd))}
        </span>
        <span className="text-[10px] text-amber-300/80">−25%</span>
      </>
    )
  }
  return (
    <span
      className={`${sizeClass} leading-none tabular-nums text-zinc-100 [font-family:var(--font-pixel)]`}
    >
      {usd(priceUsd)}
    </span>
  )
}

/** Bordered buy-chip shell that tints toward `--tile-accent` while the
 * card root (`shpc-hoverable`) is hovered / focus-within. aria-hidden:
 * the accessible price lives on the checkout overlay link's aria-label.
 * `className` REPLACES the default padding, so include padding when
 * overriding. */
export function BuyChip({
  children,
  className = 'px-3 py-1.5'
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <>
      <span aria-hidden className={`shpc-buy flex items-center gap-2 rounded-[10px] ${className}`}>
        {children}
      </span>
      <ChipStyles />
    </>
  )
}

function ChipStyles() {
  return (
    <style jsx global>{`
      .shpc-buy {
        border: 1px solid rgb(var(--lb-panel-edge) / 0.14);
        background: transparent;
        transition:
          border-color 220ms ease,
          background-color 220ms ease;
      }
      .shpc-hoverable:hover .shpc-buy,
      .shpc-hoverable:focus-within .shpc-buy {
        border-color: rgb(var(--tile-accent) / 0.35);
        background: rgb(var(--tile-accent) / 0.06);
      }

      @media (prefers-reduced-motion: reduce) {
        .shpc-buy {
          transition: none;
        }
      }
      html[data-motion='reduced'] .shpc-buy {
        transition: none;
      }
    `}</style>
  )
}
