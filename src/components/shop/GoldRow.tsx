'use client'

// Founder (one run) and Champion (awarded at #1) as a two-column pair.
// Art first, one sentence, one action. Founder keeps the marquee-fan
// scroll target. Styled-jsx under `shpg-`.

import { useRef } from 'react'
import Link from 'next/link'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { CHAMPION_PLATE, FOUNDER_PLATE, plateAnchorId, proPrice, usd } from './catalog'
import { BuyChip, OwnedChip, PriceTag } from './chips'
import { useOnStage } from './stage'

export function GoldRow({
  loading,
  isPro,
  owned
}: {
  loading: boolean
  isPro: boolean
  owned: ReadonlySet<string>
}) {
  const vaultRef = useRef<HTMLElement>(null)
  const trophyRef = useRef<HTMLElement>(null)
  useOnStage(vaultRef)
  useOnStage(trophyRef)

  if (!FOUNDER_PLATE && !CHAMPION_PLATE) return null

  const founderOwned = FOUNDER_PLATE ? owned.has(FOUNDER_PLATE.id) : false
  const founderBuyable = Boolean(FOUNDER_PLATE && !loading && !founderOwned)
  const championOwned = CHAMPION_PLATE ? owned.has(CHAMPION_PLATE.id) : false

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {FOUNDER_PLATE && (
          <article
            ref={vaultRef}
            id={plateAnchorId(FOUNDER_PLATE.id)}
            data-offstage=""
            className={`shpg-card group shpc-hoverable relative flex scroll-mt-24 flex-col rounded-2xl p-3 ${
              founderBuyable ? 'shpg-buyable' : ''
            }${founderOwned ? ' shpg-owned' : ''}`}
            style={{ ['--tile-accent' as string]: '255 214 68' }}
          >
            <div className="relative">
              <PlatePreview plateId={FOUNDER_PLATE.id} />
              {founderOwned && (
                <span className="absolute right-2 top-2 z-10">
                  <OwnedChip overlay />
                </span>
              )}
            </div>
            <div className="mt-3 flex items-start justify-between gap-3 px-1">
              <div className="min-w-0">
                <h3 className="shpg-name font-display text-[13px] font-semibold">Founder</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">One run.</p>
              </div>
              {loading ? (
                <span className="h-8 w-[4.5rem] shrink-0 animate-pulse rounded-[10px] bg-zinc-500/10" />
              ) : founderOwned ? (
                <Link
                  href="/profile"
                  className="relative z-30 text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  Equip
                </Link>
              ) : (
                <BuyChip>
                  <PriceTag priceUsd={FOUNDER_PLATE.priceUsd} isPro={isPro} size="md" />
                </BuyChip>
              )}
            </div>
            {founderBuyable && (
              <a
                href={`/api/checkout?type=plate&plateId=${FOUNDER_PLATE.id}`}
                aria-label={`Buy ${FOUNDER_PLATE.name} — ${usd(
                  isPro ? proPrice(FOUNDER_PLATE.priceUsd) : FOUNDER_PLATE.priceUsd
                )}`}
                className="shpg-link absolute inset-0 z-20 rounded-2xl"
              />
            )}
          </article>
        )}

        {CHAMPION_PLATE && (
          <article
            ref={trophyRef}
            data-offstage=""
            className={`shpg-card group shpc-hoverable relative flex flex-col rounded-2xl p-3${
              championOwned ? ' shpg-owned' : ''
            }`}
          >
            <div className="relative">
              <PlatePreview plateId={CHAMPION_PLATE.id} />
              {championOwned && (
                <span className="absolute right-2 top-2 z-10">
                  <OwnedChip overlay />
                </span>
              )}
            </div>
            <div className="mt-3 flex items-start justify-between gap-3 px-1">
              <div className="min-w-0">
                <h3 className="shpg-name font-display text-[13px] font-semibold">Champion</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">Awarded at #1.</p>
              </div>
              {championOwned ? (
                <Link
                  href="/profile"
                  className="relative z-30 text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  Equip
                </Link>
              ) : (
                <Link
                  href="/leaderboard"
                  className="text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  Leaderboard
                </Link>
              )}
            </div>
          </article>
        )}
      </div>

      <style jsx global>{`
        /* gold is the premium ink: Pro, Team, and these two */
        .shpg-name {
          color: rgb(var(--lb-gold));
        }
        .shpg-card {
          background: rgb(var(--lb-panel-bg));
          border: 1px solid rgb(var(--lb-gold) / 0.2);
          contain: layout style;
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms ease;
        }
        .shpg-card::after {
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
        .shpg-owned .plx-preview {
          opacity: 0.72;
        }
        .shpg-buyable {
          cursor: pointer;
        }
        .shpg-link {
          outline: none;
        }
        .shpg-link:focus-visible {
          outline: 2px solid rgb(var(--tile-accent) / 0.85);
          outline-offset: 3px;
        }
        @media (hover: hover) and (pointer: fine) {
          .shpg-card:hover {
            transform: translateY(-2px);
            border-color: rgb(var(--lb-gold) / 0.45);
          }
          .shpg-card:hover::after {
            opacity: 1;
          }
        }
        .shpg-card:focus-within {
          transform: translateY(-2px);
          border-color: rgb(var(--lb-gold) / 0.45);
        }
        .shpg-card:focus-within::after {
          opacity: 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .shpg-card,
          .shpg-card::after {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpg-card,
        html[data-motion='reduced'] .shpg-card::after {
          transition: none;
        }
      `}</style>
    </>
  )
}
