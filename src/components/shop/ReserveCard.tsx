'use client'

// Mythic specimen card. Same checkout / owned / stage contract as
// PlateCard. `group` is load-bearing: PlateLayer mythic hover flourishes
// key off it.
//
// The flagship (featured) fills the tall left cell of the mythic grid, so
// it earns the long form: a framed art stage, the scene's "what's alive"
// notes, and a spec row. The other two stay compact — the notes are what
// justify a $30 plate, not decoration for every card.
//
// Styled-jsx under `shpv-`.

import { useRef } from 'react'
import Link from 'next/link'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { PLATE_RARITY_META } from '@/lib/cosmetics/plates'
import { RESERVE_NOTES, plateAnchorId, proPrice, usd, type ShopPlate } from './catalog'
import { BuyChip, OwnedChip, PriceTag, RarityChip, rarityLabel } from './chips'
import { useOnStage } from './stage'

function prettyKicker(kicker: string) {
  return kicker.charAt(0) + kicker.slice(1).toLowerCase()
}

export function ReserveCard({
  plate,
  index,
  featured = false,
  loading,
  isPro,
  owned
}: {
  plate: ShopPlate
  index: number
  featured?: boolean
  loading: boolean
  isPro: boolean
  owned: boolean
}) {
  const rootRef = useRef<HTMLElement>(null)
  useOnStage(rootRef)

  const accent = plate.render.kind === 'css' ? plate.render.accent : 'var(--lb-panel-edge)'
  const checkoutPrice = usd(isPro ? proPrice(plate.priceUsd) : plate.priceUsd)
  const canBuy = !loading && !owned
  const notes = RESERVE_NOTES[plate.id]
  const kicker = notes ? prettyKicker(notes.kicker) : null
  const indexLabel = String(index + 1).padStart(2, '0')
  const alive = featured ? (notes?.alive ?? []).slice(0, 3) : []

  return (
    <>
      <article
        ref={rootRef}
        id={plateAnchorId(plate.id)}
        data-offstage=""
        className={`shpv-card group shpc-hoverable relative flex h-full scroll-mt-24 flex-col rounded-2xl p-3 ${
          featured ? 'shpv-featured' : ''
        } ${canBuy ? 'shpv-buyable' : ''}${owned ? ' shpv-owned' : ''}`}
        style={{ ['--tile-accent' as string]: accent }}
      >
        <div className={`shpv-well relative ${featured ? 'shpv-well-stage' : ''}`}>
          <PlatePreview plateId={plate.id} />
          {owned && (
            <span className="absolute right-2 top-2 z-10">
              <OwnedChip overlay />
            </span>
          )}
        </div>

        {/* flagship long form: the scene notes are the product copy */}
        {featured && alive.length > 0 && (
          <ul className="mt-4 space-y-2 px-1">
            {alive.map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="shpv-plus mt-px shrink-0 text-[9px] leading-4 [font-family:var(--font-pixel)]"
                >
                  +
                </span>
                <span className="text-[12px] leading-relaxed text-zinc-400">{line}</span>
              </li>
            ))}
          </ul>
        )}

        <div
          className={`flex items-end justify-between gap-3 px-1 ${featured ? 'mt-auto pt-4' : 'mt-3'}`}
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="shpv-index text-[10px] tabular-nums [font-family:var(--font-pixel)]">
                {indexLabel}
              </span>
              {kicker && <span>{kicker}</span>}
            </p>
            <h3 className="mt-1 font-display text-[15px] font-semibold leading-snug text-zinc-100">
              {plate.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-zinc-500">
              {plate.tagline}
            </p>
          </div>
          {loading ? (
            <span className="h-8 w-[4.5rem] shrink-0 animate-pulse rounded-[10px] bg-zinc-500/10" />
          ) : owned ? (
            <Link
              href="/profile"
              className="relative z-30 shrink-0 text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Equip
            </Link>
          ) : (
            <BuyChip>
              <PriceTag priceUsd={plate.priceUsd} isPro={isPro} size="md" />
            </BuyChip>
          )}
        </div>

        {featured ? (
          <p className="shpv-spec mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-3 text-[11px] text-zinc-600">
            <span style={{ color: PLATE_RARITY_META[plate.rarity].color }}>
              {rarityLabel(plate.rarity)}
            </span>
            <span aria-hidden>·</span>
            <span>One-time</span>
            <span aria-hidden>·</span>
            <span>Yours forever</span>
          </p>
        ) : (
          <div className="mt-3 px-1">
            <RarityChip rarity={plate.rarity} />
          </div>
        )}

        {canBuy && (
          <a
            href={`/api/checkout?type=plate&plateId=${plate.id}`}
            aria-label={`Buy ${plate.name} — ${checkoutPrice}`}
            className="shpv-link absolute inset-0 z-20 rounded-2xl"
          />
        )}
      </article>

      <style jsx global>{`
        .shpv-card {
          background: rgb(var(--lb-panel-bg));
          border: 1px solid rgb(var(--tile-accent) / 0.22);
          contain: layout style;
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms ease;
        }
        .shpv-card::after {
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
        .shpv-well {
          position: relative;
        }
        /* flagship art stage — the plate reads as mounted, not floating */
        .shpv-well-stage {
          display: flex;
          align-items: center;
          padding: 1.5rem 1rem;
          border-radius: 14px;
          border: 1px solid rgb(var(--tile-accent) / 0.18);
          background:
            radial-gradient(80% 70% at 50% 45%, rgb(var(--tile-accent) / 0.16), transparent 70%),
            rgb(0 0 0 / 0.4);
        }
        .shpv-index {
          color: rgb(var(--tile-accent) / 0.9);
        }
        .shpv-plus {
          color: rgb(var(--tile-accent) / 0.9);
        }
        .shpv-spec {
          border-top: 1px solid rgb(var(--lb-panel-edge) / 0.08);
        }
        .shpv-owned .plx-preview {
          opacity: 0.72;
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
            transform: translateY(-2px);
            border-color: rgb(var(--tile-accent) / 0.5);
          }
          .shpv-card:hover::after {
            opacity: 1;
          }
        }
        .shpv-card:focus-within {
          transform: translateY(-2px);
          border-color: rgb(var(--tile-accent) / 0.5);
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
        html[data-motion='reduced'] .shpv-card,
        html[data-motion='reduced'] .shpv-card::after {
          transition: none;
        }
      `}</style>
    </>
  )
}
