'use client'

// The Marquee — the depot's fan hero. Five portrait plate cards spread
// like a held card hand (prime-anomaly center, on top), each glowing in
// its own catalog accent. The fan is a showcase, not a buy surface: every
// card is an anchor link that scrolls to that plate's purchasable card
// (`plateAnchorId`) in the shelves below. Outer pair hides below `md`,
// which keeps the 3-card fan symmetric since transforms stay keyed to the
// 5-slot config.
//
// Cards are a fixed-dark product surface in BOTH themes (plate art is
// authored against black), so light mode re-pins the dark tokens on the
// fan root — the same convention as the page's `html.light .shp-reserve`
// block — and all on-art text uses literal near-white, never zinc.
//
// Self-contained styled-jsx under the `shpm-` prefix. Uses the shared
// chip primitives (BuyChip/PriceTag/OwnedChip) and their `shpc-hoverable`
// + `--tile-accent` hover contract.

import type { MouseEvent } from 'react'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { PLATE_RARITY_META, type PlateDef } from '@/lib/cosmetics/plates'
import { MARQUEE_PLATES, plateAnchorId, proPrice, usd } from './catalog'
import { BuyChip, OwnedChip, PriceTag } from './chips'

/** Per-slot fan geometry, left→right. Symmetric around the center card so
 * hiding the outer pair on mobile keeps the fan balanced; `z` stacks the
 * hand center-out like held cards. Center-out stacking means each wing
 * card is overlapped on its center-facing edge, so labels anchor to the
 * outward edge (`labelEnd` on the right wing) to stay clear of the
 * neighbor on top.
 *
 * The entrance deals the hand from a squared deck at center: `fi` is the
 * slot's pitch count to center (deck `translateX` = fi × slot pitch, so
 * it survives every width breakpoint), `srot` the deck's held-cards
 * rotation jitter, `dstag` the outward ripple delay per ring. Symmetry
 * again keeps mobile honest — with the outer pair hidden the middle
 * three read `fi` 1/0/-1 and deal as a 3-card hand. */
const FAN_SLOTS = [
  { rot: '-13deg', ty: '26px', z: 1, labelEnd: false, fi: 2, srot: '-3deg', dstag: '110ms' },
  { rot: '-6.5deg', ty: '10px', z: 2, labelEnd: false, fi: 1, srot: '2deg', dstag: '55ms' },
  { rot: '0deg', ty: '0px', z: 3, labelEnd: false, fi: 0, srot: '0deg', dstag: '0ms' },
  { rot: '6.5deg', ty: '10px', z: 2, labelEnd: true, fi: -1, srot: '-2deg', dstag: '55ms' },
  { rot: '13deg', ty: '26px', z: 1, labelEnd: true, fi: -2, srot: '3deg', dstag: '110ms' }
] as const

/** The anchor targets live inside horizontal scroll-snap shelves, so the
 * scroll needs `inline: 'center'` as well as `block: 'center'`. The in-app
 * reduce-motion preference (mirrored onto <html data-motion="reduced"> by
 * navBoot) can't reach an explicit scrollIntoView behavior via CSS, so it
 * is honored here alongside the OS-level media query. */
function scrollToPlate(event: MouseEvent<HTMLAnchorElement>, plateId: string) {
  event.preventDefault()
  const target = document.getElementById(plateAnchorId(plateId))
  if (!target) return
  const reduced =
    document.documentElement.dataset.motion === 'reduced' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({
    behavior: reduced ? 'auto' : 'smooth',
    block: 'center',
    inline: 'center'
  })
}

export function MarqueeFan({
  loading,
  isPro,
  owned
}: {
  loading: boolean
  isPro: boolean
  owned: ReadonlySet<string>
}) {
  return (
    <nav
      aria-label="Featured plates"
      className="shpm-fan relative isolate flex items-end justify-center overflow-visible pt-6 pb-10 md:pb-16"
    >
      {MARQUEE_PLATES.map((plate, index) => (
        <FanCard
          key={plate.id}
          plate={plate}
          index={index}
          loading={loading}
          isPro={isPro}
          owned={!loading && owned.has(plate.id)}
        />
      ))}

      <style jsx global>{`
        /* fixed-dark product surface in both themes: re-pin the dark
           surface + type tokens in light mode, exactly like the page's
           .shp-reserve showcase band. */
        html.light .shpm-fan {
          --lb-panel-bg: 9 10 13;
          --lb-panel-edge: 255 255 255;
          --lb-up: 74 222 128;
          --c-black: 0 0 0;
          --c-white: 255 255 255;
          --z50: 250 250 250;
          --z100: 244 244 245;
          --z200: 228 228 231;
          --z300: 212 212 216;
          --z400: 161 161 170;
          --z500: 113 113 122;
          --z600: 82 82 91;
          --z700: 63 63 70;
          --z800: 39 39 42;
          --z900: 24 24 27;
          --z950: 9 9 11;
          --r-mythic: 205 190 255;
        }

        /* fan card — a held-hand spread: per-card --rot/--ty/--z from the
           slot config, transform-origin at the hand's pivot. margin-inline
           (via --mi, which the deck-deal entrance below also needs) overlaps
           neighbors symmetrically, so hiding the outer pair on mobile can't
           skew the centering.

           will-change pre-promotes exactly these 5 cards to compositor
           layers: the hover transform (lift + scale) otherwise created the
           layer on demand, paying a first-frame raster hitch every time.
           A deliberate, bounded budget — shelf cards must NOT get this.
           contain is layout+style, NOT paint: paint containment would clip
           the glow pseudos exactly like overflow: hidden. */
        .shpm-card {
          --mi: -12px;
          /* deck pose: pull this card --fi slot-pitches toward center. The
             translateX percentage is the card's own width, so pitch =
             100% + 2 × margin — correct at every width breakpoint. */
          --stack-x: calc(var(--fi, 0) * (100% + var(--mi) * 2));
          margin-inline: var(--mi);
          background: rgb(9 10 13);
          border: 1px solid rgb(var(--tile-accent) / 0.5);
          z-index: var(--z, 1);
          transform-origin: bottom center;
          transform: translateY(var(--ty)) rotate(var(--rot));
          outline: none;
          will-change: transform;
          contain: layout style;
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms cubic-bezier(0.22, 1, 0.36, 1);
          /* deck-deal entrance — one-shot, transform-only, zero steady-state
             cost. backwards fill holds the squared deck through the delay
             (the page reveal fades it in), then center settles first and the
             wings ripple outward (--dstag per ring) with a slight spring
             overshoot. The 'to' pose == the static transform above, so the
             animation releases into the resting fan with no snap and hover
             transitions take over untouched. */
          animation: shpm-deal 700ms cubic-bezier(0.3, 1.35, 0.35, 1) backwards;
          animation-delay: calc(480ms + var(--dstag, 0ms));
        }
        @media (min-width: 1024px) {
          .shpm-card {
            --mi: -14px;
          }
        }
        @keyframes shpm-deal {
          from {
            transform: translateX(var(--stack-x)) translateY(16px)
              rotate(var(--srot, 0deg)) scale(0.97);
          }
          to {
            transform: translateY(var(--ty)) rotate(var(--rot));
          }
        }

        /* rest/hover glows as a crossfading pseudo pair: both box-shadows
           pre-paint once and only their opacities transition (compositor-
           only — the old transitioned box-shadow re-painted the 50px blur
           on the main thread every frame). Outer shadows never paint
           inside their own box, so nothing shows over the card face; the
           root must NOT be overflow: hidden (art clips in .shpm-art). */
        .shpm-card::before,
        .shpm-card::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          z-index: -1;
          transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .shpm-card::before {
          box-shadow:
            0 18px 50px -20px rgb(var(--tile-accent) / 0.45),
            0 14px 34px -18px rgb(0 0 0 / 0.8);
        }
        .shpm-card::after {
          box-shadow:
            0 22px 60px -22px rgb(var(--tile-accent) / 0.6),
            0 16px 40px -20px rgb(0 0 0 / 0.85);
          opacity: 0;
        }

        /* inner art clip — the rounded mask the root used to provide via
           overflow: hidden, moved inward so the glow pseudos can paint
           past the card edge. Paint containment is safe (and free) here:
           this box already clips. */
        .shpm-art {
          contain: layout style paint;
        }

        /* hover/focus — the card straightens, lifts out of the hand and
           jumps to the top of the stack; the glow pair crossfades toward
           the deeper accent shadow */
        @media (hover: hover) and (pointer: fine) {
          .shpm-card:hover {
            z-index: 10;
            transform: translateY(calc(var(--ty) - 14px)) rotate(0deg) scale(1.04);
            border-color: rgb(var(--tile-accent) / 0.85);
          }
          .shpm-card:hover::before {
            opacity: 0;
          }
          .shpm-card:hover::after {
            opacity: 1;
          }
        }
        .shpm-card:focus-visible {
          z-index: 10;
          transform: translateY(calc(var(--ty) - 14px)) rotate(0deg) scale(1.04);
          border-color: rgb(var(--tile-accent) / 0.85);
          outline: 2px solid rgb(var(--tile-accent) / 0.85);
          outline-offset: 3px;
        }
        .shpm-card:focus-visible::before {
          opacity: 0;
        }
        .shpm-card:focus-visible::after {
          opacity: 1;
        }

        /* stage budget — at rest only the center card (.shpm-live) plays
           its scene; the wings hold as paused stills (their negative
           animation delays park them on composed mid-loop frames) and wake
           the moment they're hovered or keyboard-focused. !important is
           required: the scenes' animation shorthands implicitly reset
           play-state to running. */
        .shpm-card:not(:hover):not(:focus-visible):not(.shpm-live) [data-plate-fx] * {
          animation-play-state: paused !important;
        }

        /* bottom scrim keeps the name legible over full-bleed art */
        .shpm-scrim {
          background: linear-gradient(180deg, transparent 45%, rgb(5 6 9 / 0.88) 82%);
        }
        .shpm-rarity {
          color: rgb(var(--tile-accent) / 0.9);
        }

        /* reduced motion: the deal needs an explicit animation: none — the
           global data-motion kill-switch caps animation-duration but NOT
           animation-delay, which would leave a frozen deck (backwards fill)
           for 480ms and then a snap. Opted out here, the fan simply renders
           open. */
        @media (prefers-reduced-motion: reduce) {
          .shpm-card,
          .shpm-card::before,
          .shpm-card::after {
            transition: none;
          }
          .shpm-card {
            animation: none;
          }
        }
        html[data-motion='reduced'] .shpm-card,
        html[data-motion='reduced'] .shpm-card::before,
        html[data-motion='reduced'] .shpm-card::after {
          transition: none;
        }
        html[data-motion='reduced'] .shpm-card {
          animation: none;
        }
      `}</style>
    </nav>
  )
}

function FanCard({
  plate,
  index,
  loading,
  isPro,
  owned
}: {
  plate: PlateDef
  index: number
  loading: boolean
  isPro: boolean
  owned: boolean
}) {
  const slot = FAN_SLOTS[index] ?? FAN_SLOTS[2]
  // image-kind renders carry no accent in the catalog — neutral fallback
  // (same pattern as PlatePreview / the page's tiles)
  const accent = plate.render.kind === 'css' ? plate.render.accent : '161 161 170'
  const priceUsd = plate.priceUsd
  // catalog is static — while ownership hydrates, show the base price and
  // let the Pro discount pop in after; no skeleton
  const showPro = !loading && isPro
  const priceLabel =
    priceUsd !== null ? usd(showPro ? proPrice(priceUsd) : priceUsd) : null
  const hiddenOnMobile = index === 0 || index === 4
  // the z=3 center slot is the hand's one ambient scene at rest — the
  // stage-budget pause rule skips .shpm-live (and hovered/focused cards)
  const live = index === 2

  return (
    <a
      href={`#${plateAnchorId(plate.id)}`}
      aria-label={`View ${plate.name} — ${owned ? 'owned' : (priceLabel ?? 'featured')}`}
      onClick={(event) => scrollToPlate(event, plate.id)}
      className={`shpm-card shpc-hoverable relative aspect-[3/4.2] w-[148px] shrink-0 rounded-2xl sm:w-[168px] lg:w-[196px] ${
        live ? 'shpm-live ' : ''
      }${hiddenOnMobile ? 'hidden md:block' : 'block'}`}
      style={{
        ['--tile-accent' as string]: accent,
        ['--rot' as string]: slot.rot,
        ['--ty' as string]: slot.ty,
        ['--z' as string]: slot.z,
        ['--fi' as string]: slot.fi,
        ['--srot' as string]: slot.srot,
        ['--dstag' as string]: slot.dstag
      }}
    >
      {/* rounded clip for the art — the root itself must stay
          overflow-visible so the glow pseudos can paint past the edge */}
      <div
        aria-hidden
        className="shpm-art pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      >
        <PlateLayer plateId={plate.id} fade="none" />
        <div className="shpm-scrim absolute inset-0 z-[1]" />
      </div>

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] px-3 pb-2.5 ${
          slot.labelEnd ? 'text-right' : ''
        }`}
      >
        {/* literal near-white, not text-zinc-100: the card surface is
            fixed dark in both themes */}
        <p
          className="font-display text-[13px] font-semibold leading-tight"
          style={{ color: 'rgb(244 244 245)' }}
        >
          {plate.name}
        </p>
        <p className="shpm-rarity mt-1 text-[8px] tracking-[0.3em]">
          {PLATE_RARITY_META[plate.rarity].label}
        </p>
      </div>

      {owned ? (
        <span className="absolute right-2 top-2 z-10">
          <OwnedChip overlay />
        </span>
      ) : (
        priceUsd !== null && (
          <span className="absolute right-2 top-2 z-10">
            <BuyChip className="px-2 py-1">
              <PriceTag priceUsd={priceUsd} isPro={showPro} size="md" />
            </BuyChip>
          </span>
        )
      )}
    </a>
  )
}
