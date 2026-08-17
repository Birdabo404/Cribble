'use client'

// Rack grid card. Whole-card checkout overlay carries the accessible
// price; owned cards dim slightly and offer Equip. Styled-jsx under
// `shpk-`. Grid children are `w-full` — no shelf snap contract.

import { useRef } from 'react'
import Link from 'next/link'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { plateAnchorId, proPrice, usd, type ShopPlate } from './catalog'
import { BuyChip, OwnedChip, PriceTag, RarityChip, SeasonalChip } from './chips'
import { useOnStage } from './stage'

export function PlateCard({
  plate,
  index,
  loading,
  isPro,
  owned
}: {
  plate: ShopPlate
  index: number
  loading: boolean
  isPro: boolean
  owned: boolean
}) {
  const rootRef = useRef<HTMLElement>(null)
  useOnStage(rootRef)

  const accent = plate.render.kind === 'css' ? plate.render.accent : 'var(--lb-panel-edge)'
  const checkoutPrice = usd(isPro ? proPrice(plate.priceUsd) : plate.priceUsd)
  const canBuy = !loading && !owned

  return (
    <>
      <article
        ref={rootRef}
        id={plateAnchorId(plate.id)}
        data-offstage=""
        className={`shpk-card shpk-reveal group shpc-hoverable relative flex h-full scroll-mt-24 flex-col rounded-2xl p-3 ${
          canBuy ? 'shpk-buyable' : ''
        }${owned ? ' shpk-owned' : ''}`}
        style={{
          ['--rv' as string]: `${240 + Math.min(index, 7) * 60}ms`,
          ['--tile-accent' as string]: accent
        }}
      >
        <div className="relative">
          <PlatePreview plateId={plate.id} />
          {owned && (
            <span className="absolute right-2 top-2 z-10">
              <OwnedChip overlay />
            </span>
          )}
        </div>

        <div className="mt-3 flex items-start justify-between gap-3 px-1">
          <h3 className="font-display text-[13px] font-semibold leading-snug text-zinc-200">
            {plate.name}
          </h3>
          {loading ? (
            <span className="h-8 w-[4.5rem] shrink-0 animate-pulse rounded-[10px] bg-zinc-500/10" />
          ) : owned ? null : (
            <BuyChip>
              <PriceTag priceUsd={plate.priceUsd} isPro={isPro} size="md" />
            </BuyChip>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 px-1 pt-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RarityChip rarity={plate.rarity} />
            {plate.seasonal && (
              <>
                <span aria-hidden className="text-[11px] text-zinc-700">
                  ·
                </span>
                <SeasonalChip label={plate.seasonal.label} />
              </>
            )}
          </div>

          {!loading && owned && (
            <Link
              href="/profile"
              className="relative z-30 text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Equip
            </Link>
          )}
        </div>

        {canBuy && (
          <a
            href={`/api/checkout?type=plate&plateId=${plate.id}`}
            aria-label={`Buy ${plate.name} — ${checkoutPrice}`}
            className="shpk-link absolute inset-0 z-20 rounded-2xl"
          />
        )}
      </article>

      <style jsx global>{`
        .shpk-card {
          background: rgb(var(--lb-panel-bg));
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          contain: layout style;
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms ease;
        }
        .shpk-card::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: 0 12px 28px -18px rgb(0 0 0 / 0.55);
          opacity: 0;
          transition: opacity 320ms ease;
          pointer-events: none;
          z-index: -1;
        }
        .shpk-owned .plx-preview {
          opacity: 0.72;
        }
        .shpk-buyable {
          cursor: pointer;
        }
        .shpk-link {
          outline: none;
        }
        .shpk-link:focus-visible {
          outline: 2px solid rgb(var(--tile-accent) / 0.85);
          outline-offset: 3px;
        }
        @media (hover: hover) and (pointer: fine) {
          .shpk-card:hover {
            transform: translateY(-2px);
            border-color: rgb(var(--tile-accent) / 0.35);
          }
          .shpk-card:hover::after {
            opacity: 1;
          }
        }
        .shpk-card:focus-within {
          transform: translateY(-2px);
          border-color: rgb(var(--tile-accent) / 0.35);
        }
        .shpk-card:focus-within::after {
          opacity: 1;
        }

        .shpk-reveal {
          animation: shpk-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes shpk-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shpk-reveal {
            animation: none;
          }
          .shpk-card,
          .shpk-card::after {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpk-reveal {
          animation: none;
        }
        html[data-motion='reduced'] .shpk-card,
        html[data-motion='reduced'] .shpk-card::after {
          transition: none;
        }
      `}</style>
    </>
  )
}
