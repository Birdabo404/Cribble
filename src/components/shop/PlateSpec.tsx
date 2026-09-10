'use client'

// Plate spec — the shared body the Featured Stage's right column and the
// Spec drawer both print. The same five facts in the same order for every
// plate (index + kicker, name, tagline, the dl: RARITY / SEASON / SCENE /
// OWNERSHIP / PRICE, then the action), so the storefront scans as one
// ledger. `variant` only changes density: the drawer gets the long-form
// SCENE notes, the 24px price, a full-width BUY and the footer stamp; the
// stage keeps the SCENE kicker, a 20px price, an auto-width BUY beside the
// SPEC door that opens the drawer.
//
// Animation hooks for the stage: every text line carries `shop-spec-line`
// (staggered out / in on a swap) and the price is split into per-glyph
// `shop-glyph` spans for rollGlyphs(). Presentational otherwise — loading,
// Pro and ownership arrive resolved from the page.
//
// Styled-jsx under `shps-`.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { PLATE_RARITY_META, type PlateDef } from '@/lib/cosmetics/plates'
import { JP, RESERVE_NOTES, plateIndex, plateKicker, proPrice, rarityJp, usd } from './catalog'
import {
  COPY,
  DATA,
  DISPLAY,
  FOCUS,
  FOCUS_ON_SIGNAL,
  GOLD_TEXT,
  INK,
  JP_KICKER,
  LABEL,
  LINE,
  MICRO,
  MUTE,
  OWNED_TEXT,
  PIXEL,
  SIGNAL_FILL,
  SIGNAL_TEXT,
  TAP,
  WELL_BG,
  rarityColor
} from './shopChrome'
import { CSS_EASE } from './shopMotion'

export type PlateSpecVariant = 'stage' | 'drawer'

export interface PlateSpecProps {
  /** Any catalog plate; priceUsd may be null (not for sale). */
  plate: PlateDef
  variant: PlateSpecVariant
  /** Cosmetics still in flight: OWNERSHIP reads SYNCING, the action is a skeleton. */
  loading: boolean
  isPro: boolean
  owned: boolean
  /** Stage only: the secondary `SPEC 仕様 →` door that opens the drawer. */
  onInspect?: (plateId: string) => void
}

/* ================= variant chrome ================= */

interface VariantChrome {
  /** Price stop — styled-jsx class (20px stage / 24px drawer, pre-divided at md). */
  price: string
  /** BUY width: full in the drawer, auto beside SPEC on the stage from md. */
  buy: string
  /** Skeleton block width while cosmetics load. */
  skeleton: string
  /** SCENE row: the full `alive` list (drawer) or just the kicker (stage). */
  sceneNotes: boolean
  /** The `ONE-TIME · YOURS FOREVER · POLAR` stamp closes the drawer only. */
  footer: boolean
}

function variantChrome(variant: PlateSpecVariant): VariantChrome {
  switch (variant) {
    case 'stage':
      return {
        price: 'shps-price-stage',
        buy: 'w-full md:w-auto md:px-6',
        skeleton: 'w-full md:w-44',
        sceneNotes: false,
        footer: false
      }
    case 'drawer':
      return {
        price: 'shps-price-drawer',
        buy: 'w-full',
        skeleton: 'w-full',
        sceneNotes: true,
        footer: true
      }
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}

/* ================= ownership ================= */

type Ownership = 'syncing' | 'owned' | 'with-pro' | 'earned' | 'beta-gift' | 'not-owned'

function ownershipOf(plate: PlateDef, loading: boolean, owned: boolean): Ownership {
  if (loading) return 'syncing'
  if (owned) return 'owned'
  if (plate.proExclusive) return 'with-pro'
  if (plate.championExclusive) return 'earned'
  if (plate.betaExclusive) return 'beta-gift'
  return 'not-owned'
}

function OwnershipValue({ ownership }: { ownership: Ownership }) {
  switch (ownership) {
    case 'syncing':
      return <span className={`shop-cursor ${LABEL} ${MUTE}`}>SYNCING</span>
    case 'owned':
      return (
        <span className={`${LABEL} ${OWNED_TEXT}`}>
          OWNED <span className={JP_KICKER}>{JP.owned}</span>
        </span>
      )
    case 'with-pro':
      // gold = the Pro tier, the one place it may read outside the Pro compartment
      return (
        <span className={`${LABEL} ${GOLD_TEXT}`}>
          WITH PRO <span className={JP_KICKER}>{JP.pro}</span>
        </span>
      )
    case 'earned':
      return (
        <span className={`${LABEL} ${INK}`}>
          EARNED AT #1 <span className={JP_KICKER}>{JP.champion}</span>
        </span>
      )
    case 'beta-gift':
      return <span className={`${LABEL} ${INK}`}>BETA GIFT</span>
    case 'not-owned':
      return <span className={`${LABEL} ${MUTE}`}>NOT OWNED</span>
    default: {
      const exhaustive: never = ownership
      return exhaustive
    }
  }
}

/** How an unpriced plate is obtained — the mute line that stands where BUY would. */
function obtainLine(plate: PlateDef): string {
  if (plate.proExclusive) return 'NOT SOLD · UNLOCKS WHILE PRO IS ACTIVE'
  if (plate.championExclusive) return 'NOT SOLD · AWARDED TO #1 ON THE BOARD'
  if (plate.betaExclusive) return 'NOT SOLD · BETA-TESTER GIFT'
  return 'NOT FOR SALE'
}

/* ================= atoms ================= */

/** One `<dl>` row: term · dotted leader · value. `block` drops the value
 * to its own full-width line under the leader (the SCENE notes). */
function SpecRow({
  term,
  children,
  block = false
}: {
  term: string
  children: ReactNode
  block?: boolean
}) {
  return (
    <div className="shop-leaders shop-spec-line">
      <dt className={`${MICRO} ${MUTE}`}>{term}</dt>
      <span aria-hidden className={block ? 'shop-leader col-span-2' : 'shop-leader'} />
      <dd className={block ? 'col-span-3 min-w-0 pt-2' : 'min-w-0 text-right'}>{children}</dd>
    </div>
  )
}

/** Price split into per-character spans so the stage can roll them in.
 * Readers get the whole string once; the glyph run is aria-hidden. */
function Glyphs({ text, className }: { text: string; className: string }) {
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {Array.from(text).map((glyph, at) => (
          <span key={at} className="shop-glyph inline-block">
            {glyph}
          </span>
        ))}
      </span>
    </span>
  )
}

function PriceValue({
  plate,
  isPro,
  priceClass
}: {
  plate: PlateDef
  isPro: boolean
  priceClass: string
}) {
  if (plate.priceUsd === null) return <span className={`${LABEL} ${MUTE}`}>—</span>
  const shown = isPro ? proPrice(plate.priceUsd) : plate.priceUsd
  return (
    <span className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1">
      {isPro && (
        <s className={`${PIXEL} text-[10px] leading-none ${MUTE}`}>{usd(plate.priceUsd)}</s>
      )}
      <Glyphs text={usd(shown)} className={`${PIXEL} ${priceClass} leading-none ${INK}`} />
      {isPro && <span className={`${MICRO} ${GOLD_TEXT}`}>−25%</span>}
    </span>
  )
}

/* ================= action ================= */

/** Every action shares the tap-floor mono bar; only fill and width differ. */
const ACTION = `shps-press inline-flex ${TAP} items-center justify-center gap-2 px-4 ${LABEL}`
const ACTION_OUTLINE = `${ACTION} shps-outline border ${LINE} ${INK} ${FOCUS}`

function InspectDoor({ plateId, onInspect }: { plateId: string; onInspect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onInspect(plateId)}
      className={`${ACTION_OUTLINE} w-full md:w-auto`}
    >
      SPEC <span className={JP_KICKER}>{JP.spec}</span>
      <span aria-hidden>→</span>
    </button>
  )
}

function PlateAction({
  plate,
  chrome,
  loading,
  isPro,
  owned,
  inspect
}: {
  plate: PlateDef
  chrome: VariantChrome
  loading: boolean
  isPro: boolean
  owned: boolean
  inspect: ReactNode
}) {
  if (loading) {
    return (
      <div
        aria-busy="true"
        className={`shps-skeleton ${TAP} ${chrome.skeleton} animate-pulse ${WELL_BG}`}
      />
    )
  }

  if (owned) {
    return (
      <>
        <span className={`${LABEL} ${OWNED_TEXT} md:mr-1`}>
          OWNED <span aria-hidden>✓</span>
        </span>
        <Link href="/bag" className={`${ACTION_OUTLINE} w-full md:w-auto`}>
          EQUIP <span aria-hidden>→</span>
          <span className={JP_KICKER}>{JP.equip}</span>
        </Link>
        {inspect}
      </>
    )
  }

  if (plate.priceUsd !== null) {
    const price = usd(isPro ? proPrice(plate.priceUsd) : plate.priceUsd)
    return (
      <>
        <a
          href={`/api/checkout?type=plate&plateId=${plate.id}`}
          aria-label={`Buy ${plate.name} — ${price}`}
          className={`${ACTION} shps-buy ${chrome.buy} ${SIGNAL_FILL} ${FOCUS_ON_SIGNAL}`}
        >
          <span>BUY · {price}</span>
          <span className={JP_KICKER}>{JP.buy}</span>
        </a>
        {inspect}
      </>
    )
  }

  return (
    <>
      <p className={`${MICRO} ${MUTE} m-0 leading-[1.6]`}>{obtainLine(plate)}</p>
      {inspect}
    </>
  )
}

/* ================= the spec ================= */

export function PlateSpec({ plate, variant, loading, isPro, owned, onInspect }: PlateSpecProps) {
  const chrome = variantChrome(variant)
  const kicker = plateKicker(plate)
  const rarity = PLATE_RARITY_META[plate.rarity]
  const note = RESERVE_NOTES[plate.id]
  const inspect =
    variant === 'stage' && onInspect ? (
      <InspectDoor plateId={plate.id} onInspect={onInspect} />
    ) : null

  return (
    <div className="shps-spec flex flex-col gap-5" data-plate-spec={plate.id}>
      {/* identity */}
      <div className="flex flex-col gap-2">
        <p className={`shop-spec-line m-0 flex flex-wrap items-baseline gap-x-2 ${MICRO} ${MUTE}`}>
          <span className={INK}>/{plateIndex(plate.id)}</span>
          <span>{kicker.en}</span>
          <span className={JP_KICKER}>{kicker.jp}</span>
        </p>
        <h3
          className={`shps-name shop-spec-line m-0 ${DISPLAY} font-semibold leading-tight tracking-[-0.01em] ${INK}`}
        >
          {plate.name}
        </h3>
        <p className={`shop-spec-line m-0 ${COPY} ${MUTE}`}>{plate.tagline}</p>
      </div>

      {/* the ledger */}
      <dl className="m-0 grid gap-y-2">
        <SpecRow term="RARITY">
          <span className={LABEL} style={{ color: rarityColor(plate.rarity) }}>
            {rarity.label} <span className={JP_KICKER}>{rarityJp(plate.rarity)}</span>
          </span>
        </SpecRow>
        {plate.seasonal && (
          <SpecRow term="SEASON">
            <span className={`${LABEL} ${INK}`}>
              {plate.seasonal.label} <span className={JP_KICKER}>{JP.limited}</span>
            </span>
          </SpecRow>
        )}
        {note &&
          (chrome.sceneNotes ? (
            <SpecRow term="SCENE" block>
              <ul className="m-0 grid gap-2 p-0">
                {note.alive.map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={`${DATA} shrink-0 text-[length:var(--shop-fs-micro)] leading-[1.55] ${SIGNAL_TEXT}`}
                    >
                      +
                    </span>
                    <span className={`${COPY} ${INK}`}>{line}</span>
                  </li>
                ))}
              </ul>
            </SpecRow>
          ) : (
            <SpecRow term="SCENE">
              <span className={`${LABEL} ${INK}`}>{note.kicker}</span>
            </SpecRow>
          ))}
        <SpecRow term="OWNERSHIP">
          <OwnershipValue ownership={ownershipOf(plate, loading, owned)} />
        </SpecRow>
        <SpecRow term="PRICE">
          <PriceValue plate={plate} isPro={isPro} priceClass={chrome.price} />
        </SpecRow>
      </dl>

      {/* action */}
      <div className="shps-actions shop-spec-line grid gap-2 md:flex md:flex-wrap md:items-center">
        <PlateAction
          plate={plate}
          chrome={chrome}
          loading={loading}
          isPro={isPro}
          owned={owned}
          inspect={inspect}
        />
      </div>

      {chrome.footer && (
        <p className={`shop-spec-line m-0 border-t ${LINE} pt-3 ${MICRO} ${MUTE}`}>
          ONE-TIME · YOURS FOREVER · POLAR
        </p>
      )}

      <style jsx global>{`
        /* type stops not covered by the --shop-fs-* tokens, pre-divided at
           md like the tokens are (.page-zoom-out scales the floor by 0.9) */
        .shps-name {
          font-size: 17px;
        }
        .shps-price-stage {
          font-size: 20px;
        }
        .shps-price-drawer {
          font-size: 24px;
        }
        @media (min-width: 768px) {
          .shps-name {
            font-size: calc(17px / 0.9);
          }
          .shps-price-stage {
            font-size: calc(20px / 0.9);
          }
          .shps-price-drawer {
            font-size: calc(24px / 0.9);
          }
        }

        /* press: scale only, the shop curve, 120ms */
        .shps-press {
          transition: transform 120ms ${CSS_EASE.out};
        }
        .shps-press:active {
          transform: scale(0.98);
        }
        /* outlined doors sharpen to ink on hover (fine pointer only) */
        .shps-outline {
          transition:
            transform 120ms ${CSS_EASE.out},
            border-color 160ms ${CSS_EASE.out};
        }
        @media (hover: hover) and (pointer: fine) {
          .shps-outline:hover {
            border-color: var(--shop-ink);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shps-press,
          .shps-outline {
            transition: none;
          }
          .shps-press:active {
            transform: none;
          }
          .shps-skeleton {
            animation: none;
          }
        }
        html[data-motion='reduced'] .shps-press,
        html[data-motion='reduced'] .shps-outline {
          transition: none;
        }
        html[data-motion='reduced'] .shps-press:active {
          transform: none;
        }
        html[data-motion='reduced'] .shps-skeleton {
          animation: none;
        }
      `}</style>
    </div>
  )
}
