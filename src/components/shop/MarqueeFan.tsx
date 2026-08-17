'use client'

// The Marquee — five portrait plate cards dealt like a held hand
// (prime-anomaly center, on top). Showcase only: each card is an anchor
// that scrolls to that plate's buy surface (`plateAnchorId`) below.
// Outer pair hides below `md`, which keeps the 3-card fan symmetric
// since transforms stay keyed to the 5-slot config.
//
// Cards are a fixed-dark art well in both themes (plate art is authored
// against black), so light mode re-pins dark tokens on the card itself
// — not the fan root. On-art text uses literal near-white, never zinc.
//
// Self-contained styled-jsx under the `shpm-` prefix.

import type { MouseEvent } from 'react'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import type { PlateDef } from '@/lib/cosmetics/plates'
import { MARQUEE_PLATES, plateAnchorId } from './catalog'
import { rarityLabel } from './chips'

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
 * rotation jitter, `dstag` the outward ripple delay per ring. */
const FAN_SLOTS = [
  { rot: '-13deg', ty: '26px', z: 1, labelEnd: false, fi: 2, srot: '-3deg', dstag: '110ms' },
  { rot: '-6.5deg', ty: '10px', z: 2, labelEnd: false, fi: 1, srot: '2deg', dstag: '55ms' },
  { rot: '0deg', ty: '0px', z: 3, labelEnd: false, fi: 0, srot: '0deg', dstag: '0ms' },
  { rot: '6.5deg', ty: '10px', z: 2, labelEnd: true, fi: -1, srot: '-2deg', dstag: '55ms' },
  { rot: '13deg', ty: '26px', z: 1, labelEnd: true, fi: -2, srot: '3deg', dstag: '110ms' }
] as const

/** The anchor targets live inside the grids below, so the scroll needs
 * `inline: 'center'` as well as `block: 'center'`. The in-app
 * reduce-motion preference (mirrored onto <html data-motion="reduced">)
 * can't reach scrollIntoView via CSS, so it is honored here alongside
 * the OS-level media query. */
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

export function MarqueeFan() {
  return (
    <nav
      aria-label="Featured plates"
      className="shpm-fan relative isolate flex items-end justify-center overflow-visible pt-6 pb-10 md:pb-16"
    >
      {MARQUEE_PLATES.map((plate, index) => (
        <FanCard key={plate.id} plate={plate} index={index} />
      ))}

      <style jsx global>{`
        /* art well: re-pin dark surface + type tokens on the card in
           light mode. The fan chrome around it follows the theme. */
        html.light .shpm-card {
          --lb-panel-bg: 9 10 13;
          --lb-panel-edge: 255 255 255;
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
        }

        /* fan card — a held-hand spread: per-card --rot/--ty/--z from the
           slot config, transform-origin at the hand's pivot. margin-inline
           (via --mi, which the deck-deal entrance below also needs) overlaps
           neighbors symmetrically, so hiding the outer pair on mobile can't
           skew the centering.
           will-change pre-promotes exactly these 5 cards to compositor
           layers. contain is layout+style, NOT paint: paint containment
           would clip the rest shadow. */
        .shpm-card {
          --mi: -12px;
          --stack-x: calc(var(--fi, 0) * (100% + var(--mi) * 2));
          margin-inline: var(--mi);
          background: rgb(9 10 13);
          border: 1px solid rgb(255 255 255 / 0.14);
          z-index: var(--z, 1);
          transform-origin: bottom center;
          transform: translateY(var(--ty)) rotate(var(--rot));
          outline: none;
          will-change: transform;
          contain: layout style;
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms cubic-bezier(0.22, 1, 0.36, 1);
          animation: shpm-deal 700ms cubic-bezier(0.22, 1.15, 0.36, 1) backwards;
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

        /* rest shadow only — pre-painted, no hover glow crossfade */
        .shpm-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          z-index: -1;
          box-shadow:
            0 18px 40px -20px rgb(0 0 0 / 0.7),
            0 10px 24px -16px rgb(0 0 0 / 0.55);
        }

        .shpm-art {
          contain: layout style paint;
        }

        @media (hover: hover) and (pointer: fine) {
          .shpm-card:hover {
            z-index: 10;
            transform: translateY(calc(var(--ty) - 10px)) rotate(0deg) scale(1.02);
            border-color: rgb(var(--tile-accent) / 0.35);
          }
        }
        .shpm-card:focus-visible {
          z-index: 10;
          transform: translateY(calc(var(--ty) - 10px)) rotate(0deg) scale(1.02);
          border-color: rgb(var(--tile-accent) / 0.35);
          outline: 2px solid rgb(var(--tile-accent) / 0.85);
          outline-offset: 3px;
        }

        /* stage budget — at rest only the center card (.shpm-live) plays
           its scene; the wings hold as paused stills and wake on hover
           or keyboard focus. */
        .shpm-card:not(:hover):not(:focus-visible):not(.shpm-live) [data-plate-fx] * {
          animation-play-state: paused !important;
        }

        .shpm-scrim {
          background: linear-gradient(180deg, transparent 45%, rgb(5 6 9 / 0.88) 82%);
        }
        .shpm-rarity {
          color: rgb(255 255 255 / 0.55);
        }

        @media (prefers-reduced-motion: reduce) {
          .shpm-card,
          .shpm-card::before {
            transition: none;
          }
          .shpm-card {
            animation: none;
          }
        }
        html[data-motion='reduced'] .shpm-card,
        html[data-motion='reduced'] .shpm-card::before {
          transition: none;
        }
        html[data-motion='reduced'] .shpm-card {
          animation: none;
        }
      `}</style>
    </nav>
  )
}

function FanCard({ plate, index }: { plate: PlateDef; index: number }) {
  const slot = FAN_SLOTS[index] ?? FAN_SLOTS[2]
  const accent = plate.render.kind === 'css' ? plate.render.accent : '161 161 170'
  const hiddenOnMobile = index === 0 || index === 4
  const live = index === 2

  return (
    <a
      href={`#${plateAnchorId(plate.id)}`}
      aria-label={`View ${plate.name}`}
      onClick={(event) => scrollToPlate(event, plate.id)}
      className={`shpm-card group relative aspect-[3/4.2] w-[148px] shrink-0 rounded-2xl sm:w-[168px] lg:w-[196px] ${
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
        <p
          className="font-display text-[13px] font-semibold leading-tight"
          style={{ color: 'rgb(244 244 245)' }}
        >
          {plate.name}
        </p>
        <p className="shpm-rarity mt-1 text-[11px]">{rarityLabel(plate.rarity)}</p>
      </div>
    </a>
  )
}
