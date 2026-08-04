'use client'

// The Reserve shelf card — the wide-card form of the old full-width
// ReserveRow, sized for the horizontal Shelf inside the obsidian Reserve
// band. The band owns the light-mode dark-token re-pins (and should re-pin
// --background for the Shelf edge fades); this card assumes a dark-pinned
// context and never re-pins tokens itself. Interaction contract is
// ReserveRow's, unchanged: checkout overlay link with the accessible
// price, OWNED states, equip-from-profile link. Self-contained styled-jsx
// under the `shpv-` prefix; no reliance on page.tsx `shp-` classes.

import { useRef } from 'react'
import Link from 'next/link'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { RESERVE_NOTES, plateAnchorId, proPrice, usd, type ShopPlate } from './catalog'
import { BuyChip, MythicChip, OwnedChip, PriceTag } from './chips'
import { useOnStage } from './stage'

export function ReserveCard({
  plate,
  loading,
  isPro,
  owned
}: {
  plate: ShopPlate
  loading: boolean
  isPro: boolean
  owned: boolean
}) {
  const rootRef = useRef<HTMLElement>(null)
  useOnStage(rootRef)

  const accent = plate.render.kind === 'css' ? plate.render.accent : 'var(--lb-panel-edge)'
  const notes = RESERVE_NOTES[plate.id]
  const checkoutPrice = usd(isPro ? proPrice(plate.priceUsd) : plate.priceUsd)
  const canBuy = !loading && !owned

  return (
    <>
      {/* `group` is load-bearing: the mythic hover flourishes in PlateLayer
          (koi light bloom, anomaly tear-hold) key off `.group:hover`. */}
      <article
        ref={rootRef}
        id={plateAnchorId(plate.id)}
        data-offstage=""
        className={`shpv-card group shpc-hoverable relative flex w-[400px] max-w-[85vw] shrink-0 snap-start scroll-mt-24 flex-col rounded-xl p-3 sm:w-[440px] ${
          canBuy ? 'shpv-buyable' : ''
        }`}
        style={{ ['--tile-accent' as string]: accent }}
      >
        <div className="relative">
          <PlatePreview plateId={plate.id} />
          {owned && (
            <span className="absolute right-2 top-2 z-10">
              <OwnedChip overlay />
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
          <MythicChip />
          {notes && (
            <span className="text-[9px] tracking-[0.3em] text-zinc-500">{notes.kicker}</span>
          )}
        </div>

        {/* fixed two-line box (1.625 leading x 2) so the notes and price
            rows line up across the shelf */}
        <p className="mt-2 min-h-[3.25em] px-1 text-[11px] leading-relaxed text-zinc-400 line-clamp-2">
          {plate.tagline}
        </p>

        {/* condensed "alive" notes: first two lines only, each clamped to
            two; min-height = 2 items x 2 lines of 10px/1.625 + the 6px gap */}
        {notes && (
          <ul className="mt-2.5 min-h-[71px] space-y-1.5 px-1">
            {notes.alive.slice(0, 2).map((line) => (
              <li
                key={line}
                className="flex items-start gap-2 text-[10px] leading-relaxed text-zinc-500"
              >
                <span
                  aria-hidden
                  className="mt-px shrink-0 text-[9px] leading-4 [font-family:var(--font-pixel)]"
                  style={{ color: `rgb(${accent} / 0.85)` }}
                >
                  +
                </span>
                <span className="line-clamp-2">{line}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-end gap-2 px-1 pt-3">
          {loading ? (
            <span className="h-[34px] w-28 animate-pulse rounded-lg bg-white/[0.05]" />
          ) : owned ? (
            <div className="flex flex-col items-end gap-2">
              <OwnedChip />
              <Link
                href="/profile"
                className="relative z-30 text-[9px] tracking-[0.15em] text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
              >
                equip it from your profile editor
              </Link>
            </div>
          ) : (
            <BuyChip className="px-3.5 py-2">
              <PriceTag priceUsd={plate.priceUsd} isPro={isPro} size="lg" />
            </BuyChip>
          )}
        </div>

        {canBuy && (
          <a
            href={`/api/checkout?type=plate&plateId=${plate.id}`}
            aria-label={`Buy ${plate.name} — ${checkoutPrice}`}
            className="shpv-link absolute inset-0 z-20 rounded-xl"
          />
        )}
      </article>

      <style jsx global>{`
        /* card chrome — same lift/glow contract as the rack tiles, over
           the Reserve band's darker ground */
        .shpv-card {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          background: linear-gradient(180deg, rgb(255 255 255 / 0.02), transparent 45%),
            rgb(0 0 0 / 0.35);
          /* layout+style (NOT paint — paint containment would clip the
             hover glow pseudo exactly like overflow: hidden) */
          contain: layout style;
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms ease;
        }
        /* hover glow — pre-painted pseudo, opacity-only transition
           (compositor-only; was a per-frame box-shadow repaint) */
        .shpv-card::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow:
            0 22px 60px -28px rgb(var(--tile-accent) / 0.42),
            0 16px 40px -22px rgb(0 0 0 / 0.8);
          opacity: 0;
          transition: opacity 320ms ease;
          pointer-events: none;
          z-index: -1;
        }
        .shpv-buyable {
          cursor: pointer;
        }
        .shpv-link {
          outline: none;
        }
        .shpv-link:focus-visible {
          outline: 2px solid rgb(var(--tile-accent) / 0.85);
          outline-offset: 3px;
        }
        @media (hover: hover) and (pointer: fine) {
          .shpv-card:hover {
            transform: translateY(-3px);
            border-color: rgb(var(--tile-accent) / 0.5);
          }
          .shpv-card:hover::after {
            opacity: 1;
          }
        }
        .shpv-card:focus-within {
          transform: translateY(-3px);
          border-color: rgb(var(--tile-accent) / 0.6);
        }
        .shpv-card:focus-within::after {
          opacity: 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .shpv-card,
          .shpv-card::after {
            transition: none;
          }
        }
      `}</style>
    </>
  )
}
