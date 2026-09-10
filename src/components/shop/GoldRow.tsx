'use client'

// 05 VAULT — Founder (one run, buyable) and Champion (awarded at #1, never
// sold) as two compartments in a gapped pair, so each cell carries its own
// hairline. Same anatomy as the rack cards; gold is the premium ink here
// and nowhere else on the cards: the index numerals, the names and the
// Founder's filled chip. Body click and SPEC inspect both; the Champion's
// door is the leaderboard. Styled-jsx under `shpg-`.

import { useRef, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import type { PlateDef } from '@/lib/cosmetics/plates'
import {
  CHAMPION_PLATE,
  FOUNDER_PLATE,
  JP as JP_COPY,
  plateAnchorId,
  plateIndex,
  proPrice,
  usd
} from './catalog'
import {
  DoorLink,
  EquipLink,
  OwnedMark,
  PriceChip,
  PriceLockup,
  RarityTick,
  SpecButton
} from './chips'
import { COPY, DISPLAY, GOLD_TEXT, JP_KICKER, LINE, MICRO, MUTE, PAPER_BG } from './shopChrome'
import { useOnStage } from './stage'

export interface GoldRowProps {
  loading: boolean
  isPro: boolean
  owned: ReadonlySet<string>
  onInspect: (plateId: string) => void
}

const NAME = `${DISPLAY} ${GOLD_TEXT} text-[15px] font-semibold leading-tight tracking-[-0.01em] md:text-[length:calc(15px/0.9)]`

export function GoldRow({ loading, isPro, owned, onInspect }: GoldRowProps) {
  const vaultRef = useRef<HTMLElement>(null)
  const trophyRef = useRef<HTMLElement>(null)
  useOnStage(vaultRef)
  useOnStage(trophyRef)

  if (!FOUNDER_PLATE && !CHAMPION_PLATE) return null

  const founderOwned = FOUNDER_PLATE ? owned.has(FOUNDER_PLATE.id) : false
  const championOwned = CHAMPION_PLATE ? owned.has(CHAMPION_PLATE.id) : false

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {FOUNDER_PLATE && (
          <VaultCell
            rootRef={vaultRef}
            plate={FOUNDER_PLATE}
            kicker={{ en: 'FOUNDER', jp: JP_COPY.founder }}
            note="One run."
            owned={founderOwned}
            onInspect={onInspect}
            door={
              loading ? (
                <span
                  aria-hidden
                  className="h-8 w-24 shrink-0 animate-pulse bg-[color:var(--shop-line-soft)]"
                />
              ) : founderOwned ? (
                <EquipLink />
              ) : (
                <PriceChip
                  tone="gold"
                  href={`/api/checkout?type=plate&plateId=${FOUNDER_PLATE.id}`}
                  ariaLabel={`Buy ${FOUNDER_PLATE.name} — ${usd(
                    isPro ? proPrice(FOUNDER_PLATE.priceUsd) : FOUNDER_PLATE.priceUsd
                  )}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <PriceLockup priceUsd={FOUNDER_PLATE.priceUsd} isPro={isPro} size="md" />
                </PriceChip>
              )
            }
          />
        )}

        {CHAMPION_PLATE && (
          <VaultCell
            rootRef={trophyRef}
            plate={CHAMPION_PLATE}
            kicker={{ en: 'CHAMPION', jp: JP_COPY.champion }}
            note="Awarded at #1."
            owned={championOwned}
            onInspect={onInspect}
            door={
              championOwned ? (
                <EquipLink />
              ) : (
                <DoorLink href="/leaderboard">
                  LEADERBOARD
                  <span aria-hidden>→</span>
                </DoorLink>
              )
            }
          />
        )}
      </div>

      <style jsx global>{`
        .shpg-card {
          contain: layout style;
          transition: border-color 160ms ease;
        }
        .shpg-card:focus-within {
          border-color: var(--shop-ink);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpg-card:hover {
            border-color: var(--shop-ink);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shpg-card {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpg-card {
          transition: none;
        }
      `}</style>
    </>
  )
}

/** One vault compartment. `door` is the bottom-right slot: the Founder's
 * gold chip / skeleton, the Champion's leaderboard link, or EQUIP. */
function VaultCell({
  rootRef,
  plate,
  kicker,
  note,
  owned,
  onInspect,
  door
}: {
  rootRef: RefObject<HTMLElement>
  plate: PlateDef
  kicker: { en: string; jp: string }
  note: string
  owned: boolean
  onInspect: (plateId: string) => void
  door: ReactNode
}) {
  const handleBodyClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest('a,button')) return
    onInspect(plate.id)
  }

  return (
    <article
      ref={rootRef}
      id={plateAnchorId(plate.id)}
      data-offstage=""
      onClick={handleBodyClick}
      className={`shpg-card shpc-hoverable shop-brackets group relative flex h-full cursor-pointer scroll-mt-32 flex-col border p-[var(--shop-pad)] ${LINE} ${PAPER_BG}`}
    >
      {/* micro row: the vault's numerals are gold · rarity */}
      <div className={`flex items-center justify-between gap-3 ${MICRO}`}>
        <span className={GOLD_TEXT}>/{plateIndex(plate.id)}</span>
        <RarityTick rarity={plate.rarity} />
      </div>

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
        <h3 className={`mt-1.5 ${NAME}`}>{plate.name}</h3>
        <p className={`mt-1 line-clamp-1 ${COPY} ${MUTE}`}>{note}</p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-3">
        <SpecButton onClick={() => onInspect(plate.id)} />
        {door}
      </div>
    </article>
  )
}
