'use client'

// The Rack shelf card — the compact vertical tile form of the old 2-column
// PlateTile, sized for the horizontal Shelf (snap-start + explicit width,
// per the Shelf child contract). Interaction contract is PlateTile's,
// unchanged: whole-card checkout overlay link carrying the accessible
// price, OWNED overlay badge + price-row chip, and the equip-from-profile
// line on owned cards. Self-contained styled-jsx under the `shpk-` prefix;
// no reliance on the `shp-` classes still defined by shop/page.tsx.

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
        className={`shpk-card shpk-reveal group shpc-hoverable relative flex w-[270px] shrink-0 snap-start scroll-mt-24 flex-col rounded-2xl p-3 sm:w-[290px] ${
          canBuy ? 'shpk-buyable' : ''
        }`}
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

        {/* fixed two-line box (1.625 leading x 2) so every card's bottom
            row sits on the same line across the shelf */}
        <p className="mt-3 min-h-[3.25em] px-1 text-[11px] leading-relaxed text-zinc-400 line-clamp-2">
          {plate.tagline}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 px-1 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <RarityChip rarity={plate.rarity} />
            {plate.seasonal && <SeasonalChip label={plate.seasonal.label} />}
          </div>

          {loading ? (
            <span className="h-[30px] w-24 animate-pulse rounded-lg bg-white/[0.05]" />
          ) : owned ? (
            <OwnedChip />
          ) : (
            <BuyChip>
              <PriceTag priceUsd={plate.priceUsd} isPro={isPro} size="md" />
            </BuyChip>
          )}
        </div>

        {!loading && owned && (
          <p className="mt-2 px-1 text-[9px] tracking-[0.15em] text-zinc-600">
            in your hangar —{' '}
            <Link
              href="/profile"
              className="text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
            >
              equip it from your profile editor
            </Link>
          </p>
        )}

        {canBuy && (
          <a
            href={`/api/checkout?type=plate&plateId=${plate.id}`}
            aria-label={`Buy ${plate.name} — ${checkoutPrice}`}
            className="shpk-link absolute inset-0 z-20 rounded-2xl"
          />
        )}
      </article>

      <style jsx global>{`
        /* card chrome — hover lifts and glows in the plate's own accent
           (each card sets --tile-accent from the catalog) */
        .shpk-card {
          background: linear-gradient(180deg, rgb(255 255 255 / 0.03), transparent 40%),
            rgb(var(--lb-panel-bg));
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          /* layout+style (NOT paint — paint containment would clip the
             hover glow pseudo exactly like overflow: hidden) */
          contain: layout style;
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms ease;
        }
        /* hover glow — pre-painted on a pseudo whose opacity transitions.
           The old transitioned box-shadow re-painted the 60px blur on the
           main thread every frame of the 320ms ramp; this is compositor-
           only. z-index -1 tucks it under the card content, and the outer
           shadow never paints inside its own box, so nothing shows over
           the card face. */
        .shpk-card::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow:
            0 22px 60px -28px rgb(var(--tile-accent) / 0.4),
            0 16px 40px -22px rgb(0 0 0 / 0.8);
          opacity: 0;
          transition: opacity 320ms ease;
          pointer-events: none;
          z-index: -1;
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
            transform: translateY(-3px);
            border-color: rgb(var(--tile-accent) / 0.45);
          }
          .shpk-card:hover::after {
            opacity: 1;
          }
        }
        .shpk-card:focus-within {
          transform: translateY(-3px);
          border-color: rgb(var(--tile-accent) / 0.6);
        }
        .shpk-card:focus-within::after {
          opacity: 1;
        }

        /* first-paint cascade — same curve as the page's shp-reveal; each
           card staggers itself via the --rv delay it sets inline */
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
      `}</style>
    </>
  )
}
