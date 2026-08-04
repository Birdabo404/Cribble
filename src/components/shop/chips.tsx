'use client'

// Supply Depot chip primitives — the rarity/seasonal/mythic labels, the
// OWNED marker, the price lockup and the buy-chip shell shared by every
// storefront card. Self-contained: every class these components use lives
// in this file's own styled-jsx block under a fresh `shpc-` prefix, so
// nothing here depends on (or collides with) the `shp-` classes still
// defined locally by shop/page.tsx while the old markup exists.
//
// Hover contract: BuyChip tints toward the card's accent while a card root
// carrying the `shpc-hoverable` class is hovered / focus-within. The card
// root must also set `--tile-accent` (an `R G B` triplet) — the same
// pattern the page's tiles use today. (The legacy page card classes
// `shp-tile-buyable` / `shp-reserve-row` are gone with the old markup.)

import type { ReactNode } from 'react'
import { PLATE_RARITY_META, type PlateRarity } from '@/lib/cosmetics/plates'
import { proPrice, usd } from './catalog'

export function RarityChip({ rarity }: { rarity: PlateRarity }) {
  const meta = PLATE_RARITY_META[rarity]
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
      style={{
        color: meta.color,
        border: `1px solid rgb(var(--r-${rarity}) / 0.35)`,
        background: `rgb(var(--r-${rarity}) / 0.07)`
      }}
    >
      {meta.label}
    </span>
  )
}

export function SeasonalChip({ label }: { label: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
      style={{
        color: 'rgb(var(--lb-gold))',
        border: '1px solid rgb(var(--lb-gold) / 0.4)',
        background: 'rgb(var(--lb-gold) / 0.07)'
      }}
    >
      {label}
    </span>
  )
}

/** Reserve-band upgrade of the MYTHIC chip: the label itself is iridescent
 * (a slowly panning spectrum clipped to the glyphs). Everywhere else the
 * flat --r-mythic token chip from RarityChip is the correct, quieter form. */
export function MythicChip() {
  return (
    <>
      <span className="shpc-mythic-chip rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]">
        MYTHIC
      </span>
      <ChipStyles />
    </>
  )
}

/** The OWNED marker in both of its established forms. `overlay` is the
 * small badge pinned over plate art — positioning (e.g. `absolute right-2
 * top-2 z-10`) is left to the consumer's wrapper; the chip only renders
 * the bordered label. The default form is the larger price-row chip that
 * replaces the buy chip on owned cards. */
export function OwnedChip({ overlay = false }: { overlay?: boolean }) {
  if (overlay) {
    return (
      <span
        className="rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
        style={{
          color: 'rgb(var(--lb-up))',
          borderColor: 'rgb(var(--lb-up) / 0.45)',
          background: 'rgb(0 0 0 / 0.55)'
        }}
      >
        OWNED
      </span>
    )
  }
  return (
    <span
      className="rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em]"
      style={{
        color: 'rgb(var(--lb-up))',
        border: '1px solid rgb(var(--lb-up) / 0.35)',
        background: 'rgb(var(--lb-up) / 0.06)'
      }}
    >
      OWNED
    </span>
  )
}

type PriceTagSize = 'md' | 'lg'

/** Pixel-font price size per lockup scale: 'md' is the rack-tile form,
 * 'lg' the reserve-row form. */
const PRICE_SIZE_CLASS: Record<PriceTagSize, string> = {
  md: 'text-[12px]',
  lg: 'text-[14px]'
}

/** The price lockup. Consumers pass only the base catalog price; the -25%
 * Pro strike math happens here via proPrice/usd. Renders bare spans — put
 * it inside a BuyChip (or any flex row with a small gap) for the full chip
 * treatment. */
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
        <span className="text-[9px] tabular-nums text-zinc-600 line-through">{usd(priceUsd)}</span>
        <span
          className={`${sizeClass} leading-none tabular-nums text-amber-300 [font-family:var(--font-pixel)]`}
        >
          {usd(proPrice(priceUsd))}
        </span>
        <span className="text-[7px] tracking-[0.2em] text-amber-300/80">-25% PRO</span>
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

/** The bordered buy-chip shell that tints toward `--tile-accent` while the
 * card root (`shpc-hoverable`) is hovered / focus-within. aria-hidden by
 * design: on every card the accessible price lives on the checkout overlay
 * link's aria-label, never on the decorative chip. `className` REPLACES
 * the default `px-3 py-1.5` padding (reserve-scale cards pass
 * `px-3.5 py-2`), so include padding when overriding. */
export function BuyChip({
  children,
  className = 'px-3 py-1.5'
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <>
      <span aria-hidden className={`shpc-buy flex items-center gap-2 rounded-lg ${className}`}>
        {children}
      </span>
      <ChipStyles />
    </>
  )
}

/** One shared global block. styled-jsx dedupes identical content, so any
 * number of chips rendering this still ship exactly one <style> tag. */
function ChipStyles() {
  return (
    <style jsx global>{`
      /* the iridescent MYTHIC chip — Reserve treatment. At rest it's a
         STATIC spectrum clipped to the glyphs (the 50% frame shows the
         violet→pink→gold sweep, so it still reads iridescent with zero
         idle paint); the pan only runs while the owning card is hovered. */
      .shpc-mythic-chip {
        border: 1px solid rgb(196 181 253 / 0.4);
        background: rgb(196 181 253 / 0.07);
        color: transparent;
        background-image: linear-gradient(
          100deg,
          rgb(125 232 255),
          rgb(178 166 255) 25%,
          rgb(255 154 222) 50%,
          rgb(255 233 166) 75%,
          rgb(125 232 255) 100%
        );
        background-size: 220% 100%;
        background-position: 50% 0;
        -webkit-background-clip: text;
        background-clip: text;
      }
      .shpc-hoverable:hover .shpc-mythic-chip {
        animation: shpc-iri-pan 6s linear infinite;
      }
      @keyframes shpc-iri-pan {
        to {
          background-position: -220% 0;
        }
      }

      /* buy chip — tints toward the card's own accent while the card root
         (shpc-hoverable) is hovered / focus-within. isolation scopes the
         glow pseudo's z-index: -1 to the chip. */
      .shpc-buy {
        position: relative;
        isolation: isolate;
        border: 1px solid rgb(var(--lb-panel-edge) / 0.14);
        background: rgb(var(--lb-panel-edge) / 0.05);
        transition:
          border-color 220ms ease,
          background-color 220ms ease;
      }
      /* hover glow — pre-painted pseudo, opacity-only transition
         (compositor-only; was a per-frame box-shadow repaint) */
      .shpc-buy::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: 0 0 24px -8px rgb(var(--tile-accent) / 0.5);
        opacity: 0;
        transition: opacity 220ms ease;
        pointer-events: none;
        z-index: -1;
      }
      .shpc-hoverable:hover .shpc-buy,
      .shpc-hoverable:focus-within .shpc-buy {
        border-color: rgb(var(--tile-accent) / 0.6);
        background: rgb(var(--tile-accent) / 0.09);
      }
      .shpc-hoverable:hover .shpc-buy::after,
      .shpc-hoverable:focus-within .shpc-buy::after {
        opacity: 1;
      }

      @media (prefers-reduced-motion: reduce) {
        .shpc-hoverable:hover .shpc-mythic-chip {
          animation: none;
        }
        .shpc-buy,
        .shpc-buy::after {
          transition: none;
        }
      }
    `}</style>
  )
}
