'use client'

// Mythic specimen compartment. Same anatomy and contracts as PlateCard
// (index row, live art, name, tagline, SPEC + chip; body click inspects)
// but the mythic grid is gapped, so the cell carries its own 1px hairline.
// The kicker line above the name is the scene's RESERVE_NOTES kicker with
// the Japanese class beside it.
//
// The flagship (`featured`) fills the tall left cell of the mythic grid and
// earns the long form: a 17px name and the three "what's alive" lines as a
// `+` list — the notes are what justify a $30 plate. The other two stay
// compact. `group` is load-bearing: PlateLayer mythic hover flourishes key
// off it. Styled-jsx under `shpv-`.

import { useRef, type MouseEvent } from 'react'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import {
  RESERVE_NOTES,
  plateAnchorId,
  plateIndex,
  plateKicker,
  proPrice,
  usd,
  type ShopPlate
} from './catalog'
import { EquipLink, OwnedMark, PriceChip, PriceLockup, RarityTick, SeasonTag, SpecButton } from './chips'
import {
  COPY,
  DISPLAY,
  INK,
  JP_KICKER,
  LINE,
  LINE_SOFT,
  MICRO,
  MUTE,
  PAPER_BG,
  PIXEL
} from './shopChrome'
import { useOnStage } from './stage'

export interface ReserveCardProps {
  plate: ShopPlate
  featured?: boolean
  loading: boolean
  isPro: boolean
  owned: boolean
  onInspect: (plateId: string) => void
}

const NAME = `${DISPLAY} ${INK} font-semibold leading-tight tracking-[-0.01em]`
const NAME_SIZE = 'text-[15px] md:text-[length:calc(15px/0.9)]'
const NAME_SIZE_FEATURED = 'text-[17px] md:text-[length:calc(17px/0.9)]'

export function ReserveCard({
  plate,
  featured = false,
  loading,
  isPro,
  owned,
  onInspect
}: ReserveCardProps) {
  const rootRef = useRef<HTMLElement>(null)
  useOnStage(rootRef)

  const checkoutPrice = usd(isPro ? proPrice(plate.priceUsd) : plate.priceUsd)
  const kicker = plateKicker(plate)
  const alive = featured ? (RESERVE_NOTES[plate.id]?.alive ?? []).slice(0, 3) : []

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
        className={`shpv-card shpc-hoverable shop-brackets group relative flex h-full cursor-pointer scroll-mt-32 flex-col border p-[var(--shop-pad)] ${LINE} ${PAPER_BG}${
          featured ? ' shpv-featured' : ''
        }`}
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
          <p className={`flex flex-wrap items-baseline gap-x-2 ${MICRO} ${MUTE}`}>
            <span>{kicker.en}</span>
            <span className={JP_KICKER}>{kicker.jp}</span>
          </p>
          <h3 className={`mt-1.5 ${NAME} ${featured ? NAME_SIZE_FEATURED : NAME_SIZE}`}>
            {plate.name}
          </h3>
          <p className={`mt-1 line-clamp-1 ${COPY} ${MUTE}`}>{plate.tagline}</p>
        </div>

        {/* flagship long form: the scene notes are the product copy */}
        {alive.length > 0 && (
          <ul className={`mt-4 space-y-2 border-t pt-3 ${LINE_SOFT}`}>
            {alive.map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-[3px] shrink-0 text-[9px] leading-none ${PIXEL} ${MUTE}`}
                >
                  +
                </span>
                <span className={`${COPY} ${MUTE}`}>{line}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
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
        .shpv-card {
          contain: layout style;
          transition: border-color 160ms ease;
        }
        .shpv-card:focus-within {
          border-color: var(--shop-ink);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpv-card:hover {
            border-color: var(--shop-ink);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shpv-card {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpv-card {
          transition: none;
        }
      `}</style>
    </>
  )
}
