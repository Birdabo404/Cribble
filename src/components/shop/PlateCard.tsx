'use client'

// Rack grid compartment. The page lays these in a `grid gap-px` over the
// --shop-line color, so the cell paints paper and carries NO border of its
// own — the hairlines are the gaps. Anatomy, top to bottom: micro row
// (index · rarity · season), the 4:1 live art well, name, one-line
// tagline, then SPEC on the left and the price chip (or EQUIP) on the
// right. Body click inspects; the chip is the checkout `<a>`; the SPEC
// button is the keyboard path. Hover is an ink outline + corner brackets +
// the inverted chip — no lift, no shadow. Styled-jsx under `shpk-`.
//
// `group` stays on the root: PlateLayer hover flourishes key off it.

import { useRef, type MouseEvent } from 'react'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { plateAnchorId, plateIndex, proPrice, usd, type ShopPlate } from './catalog'
import {
  EquipLink,
  OwnedMark,
  PriceChip,
  PriceLockup,
  RarityTick,
  SeasonTag,
  SpecButton
} from './chips'
import { COPY, DISPLAY, INK, MICRO, MUTE, PAPER_BG } from './shopChrome'
import { useOnStage } from './stage'

export interface PlateCardProps {
  plate: ShopPlate
  loading: boolean
  isPro: boolean
  owned: boolean
  onInspect: (plateId: string) => void
}

const NAME = `${DISPLAY} ${INK} text-[15px] font-semibold leading-tight tracking-[-0.01em] md:text-[length:calc(15px/0.9)]`

export function PlateCard({ plate, loading, isPro, owned, onInspect }: PlateCardProps) {
  const rootRef = useRef<HTMLElement>(null)
  useOnStage(rootRef)

  const checkoutPrice = usd(isPro ? proPrice(plate.priceUsd) : plate.priceUsd)

  // Anywhere on the compartment that is not a door or the SPEC button.
  const handleBodyClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest('a,button')) return
    onInspect(plate.id)
  }

  return (
    <>
      <article
        ref={rootRef}
        id={plateAnchorId(plate.id)}
        data-offstage=""
        onClick={handleBodyClick}
        className={`shpk-card shpc-hoverable shop-brackets group relative flex h-full cursor-pointer scroll-mt-32 flex-col p-[var(--shop-pad)] ${PAPER_BG}`}
      >
        {/* micro row: catalog index · rarity · season */}
        <div className={`flex items-center justify-between gap-3 ${MICRO}`}>
          <span className={MUTE}>/{plateIndex(plate.id)}</span>
          <span className="flex min-w-0 items-center gap-2">
            <RarityTick rarity={plate.rarity} />
            {plate.seasonal && (
              <>
                <span aria-hidden className={MUTE}>
                  ·
                </span>
                <SeasonTag label={plate.seasonal.label} />
              </>
            )}
          </span>
        </div>

        {/* art well — live, square; owned reads as ghosted print */}
        <div className="relative mt-3">
          <PlatePreview plateId={plate.id} />
          {owned && (
            <>
              <span aria-hidden className="shop-dither z-20" />
              <span className="absolute right-2 top-2 z-30">
                <OwnedMark overlay />
              </span>
            </>
          )}
        </div>

        <div className="mt-3 min-w-0">
          <h3 className={NAME}>{plate.name}</h3>
          <p className={`mt-1 line-clamp-1 ${COPY} ${MUTE}`}>{plate.tagline}</p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <SpecButton onClick={() => onInspect(plate.id)} />
          {loading ? (
            <span
              aria-hidden
              className="h-8 w-24 shrink-0 animate-pulse bg-[color:var(--shop-line-soft)]"
            />
          ) : owned ? (
            <EquipLink />
          ) : (
            <PriceChip
              href={`/api/checkout?type=plate&plateId=${plate.id}`}
              ariaLabel={`Buy ${plate.name} — ${checkoutPrice}`}
              onClick={(event) => event.stopPropagation()}
            >
              <PriceLockup priceUsd={plate.priceUsd} isPro={isPro} size="md" />
            </PriceChip>
          )}
        </div>
      </article>

      <style jsx global>{`
        /* the cell has no border of its own (the grid's 1px gaps are the
           hairlines), so "border → ink" is a 1px outline drawn inside */
        .shpk-card {
          contain: layout style;
          outline: 1px solid transparent;
          outline-offset: -1px;
          transition: outline-color 160ms ease;
        }
        .shpk-card:focus-within {
          outline-color: var(--shop-ink);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpk-card:hover {
            outline-color: var(--shop-ink);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shpk-card {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpk-card {
          transition: none;
        }
      `}</style>
    </>
  )
}
