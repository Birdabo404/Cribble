'use client'

// Leaderboard Plate renderer. A plate is a Discord-style nameplate strip
// painted BEHIND a player's avatar + name: mount it as the first child of a
// `relative overflow-hidden` container and it absolutely fills the parent.
// `fade: 'left'` (default) applies a left→right gradient mask so the plate
// melts into the parent panel where the identity text sits — readable in
// both themes because the panel + text are theme-aware while the plate art
// is a fixed product.
//
// css-kind plates are the launch assets: a painted scene from the catalog
// (gradient skies + inline-SVG scenery) topped by an animated scene (the
// `PlateFx` switch below) and a film finish (grain + glass edge + ground
// shadow) that keeps the procedural art from reading flat. Scenes animate
// transform/opacity only, on a handful of elements, so a page of 100 rows
// stays on the compositor. image-kind plates (future final art in
// /public/plates/) render an <img> with the SafeBannerImg-style error
// ladder: animated → static → nothing.
//
// prefers-reduced-motion: css scenes freeze to a designed static state
// (the media query below), image plates serve staticSrc via <picture>.

import { useEffect, useId, useState } from 'react'
import {
  ANOMALY_CRACKS,
  KOI_CAUSTICS,
  SAKURA_CLOUD,
  SAKURA_PETAL_BACK,
  SAKURA_PETAL_BACK_DEEP,
  SAKURA_PETAL_BACK_PALE,
  SAKURA_PETAL_FAR,
  SAKURA_PETAL_FAR_DEEP,
  SAKURA_PETAL_FAR_PALE,
  SAKURA_PETAL_FRONT,
  SAKURA_PETAL_FRONT_DEEP,
  SAKURA_PETAL_FRONT_PALE,
  getPlate,
  type PlateFx,
  type PlateImageRender
} from '@/lib/cosmetics/plates'

export interface PlateLayerProps {
  plateId: string
  /** 'left' (default): Discord-nameplate readability fade. 'none': full-bleed
   * art (shop tiles, previews that provide their own scrim). */
  fade?: 'left' | 'none'
  className?: string
}

export interface PlatePreviewProps {
  plateId: string
  className?: string
}

/** In mask space black = visible: art at full strength on the right, gone at
 * the left edge where the avatar + name live. */
const LEFT_FADE_MASK =
  'linear-gradient(90deg, transparent 0%, rgb(0 0 0 / 0.14) 22%, rgb(0 0 0 / 0.55) 50%, rgb(0 0 0 / 0.92) 74%, rgb(0 0 0) 100%)'

/** Monochrome film-grain tile (SVG turbulence) — breaks up the flat CSS
 * gradients so procedural plates read like printed art, not UI chrome. */
const GRAIN_TILE = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='120' height='120' filter='url(#n)'/></svg>"
).replace(/%20/g, ' ')}")`

export function PlateLayer({ plateId, fade = 'left', className = '' }: PlateLayerProps) {
  const plate = getPlate(plateId)
  if (!plate) return null

  const mask =
    fade === 'left'
      ? { WebkitMaskImage: LEFT_FADE_MASK, maskImage: LEFT_FADE_MASK }
      : undefined

  return (
    <div
      aria-hidden
      data-plate-fx
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{ borderRadius: 'inherit', ...mask }}
    >
      {plate.render.kind === 'image' ? (
        <PlateImage render={plate.render} />
      ) : (
        <>
          <div className="absolute inset-0" style={{ background: plate.render.base.join(', ') }} />
          <FxOverlay fx={plate.render.fx} />
          {/* film finish: grain + glass top edge + grounded bottom shade —
              breaks the flat-gradient look so the art reads printed */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: GRAIN_TILE,
              backgroundSize: '120px 120px',
              opacity: 0.05,
              mixBlendMode: 'overlay'
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgb(255 255 255 / 0.06), transparent 24%, transparent 74%, rgb(0 0 0 / 0.28))'
            }}
          />
        </>
      )}
      <style jsx global>{`
        .plx-beam {
          animation: plx-beam-sweep 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes plx-beam-sweep {
          0% {
            transform: translate3d(-140%, 0, 0) skewX(-14deg);
          }
          55%,
          100% {
            transform: translate3d(620%, 0, 0) skewX(-14deg);
          }
        }

        .plx-bob {
          animation: plx-bob 6s ease-in-out infinite;
        }
        @keyframes plx-bob {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(0, -3px, 0);
          }
        }

        .plx-breathe {
          animation: plx-breathe 7s ease-in-out infinite;
        }
        @keyframes plx-breathe {
          0%,
          100% {
            opacity: 0.5;
          }
          50% {
            opacity: 1;
          }
        }

        /* the synthwave floor: a plane tilted away from the horizon inside a
           perspective container, sliding one tile per loop so the grid rushes
           toward the viewer forever */
        .plx-gridrun {
          animation: plx-gridrun 1.4s linear infinite;
        }
        @keyframes plx-gridrun {
          from {
            transform: rotateX(60deg) translate3d(0, -34px, 0);
          }
          to {
            transform: rotateX(60deg) translate3d(0, 0, 0);
          }
        }

        /* seamless tiled drift — element extends past one edge by exactly
           one background tile (--plx-d) so the loop wrap is invisible */
        .plx-drift {
          animation: plx-drift 60s linear infinite;
        }
        @keyframes plx-drift {
          to {
            transform: translate3d(var(--plx-d, -88px), 0, 0);
          }
        }

        /* seamless vertical rain — shifts by one repeat period (--plx-f) */
        .plx-fall {
          animation: plx-fall 2s linear infinite;
        }
        @keyframes plx-fall {
          from {
            transform: translate3d(0, var(--plx-f, -24px), 0);
          }
          to {
            transform: translate3d(0, 0, 0);
          }
        }

        .plx-twinkle {
          animation: plx-twinkle 4.5s ease-in-out infinite;
        }
        @keyframes plx-twinkle {
          0%,
          26%,
          100% {
            opacity: 0;
            transform: scale(0.3) rotate(45deg);
          }
          10% {
            opacity: 1;
            transform: scale(1) rotate(45deg);
          }
          20% {
            opacity: 0.1;
            transform: scale(0.45) rotate(45deg);
          }
        }

        .plx-comet {
          animation: plx-comet 12s linear infinite;
        }
        @keyframes plx-comet {
          0% {
            transform: translate3d(0, 0, 0) rotate(-16deg);
            opacity: 0;
          }
          4% {
            opacity: 0.9;
          }
          14%,
          100% {
            transform: translate3d(-170px, 38px, 0) rotate(-16deg);
            opacity: 0;
          }
        }

        /* terminal caret — hard blink, no easing */
        .plx-cursor {
          animation: plx-cursor 1.1s linear infinite;
        }
        @keyframes plx-cursor {
          0%,
          49% {
            opacity: 1;
          }
          50%,
          100% {
            opacity: 0.12;
          }
        }

        /* CRT interference bar — two fast flashes every few seconds */
        .plx-glitch {
          animation: plx-glitch 7s linear infinite;
        }
        @keyframes plx-glitch {
          0%,
          87.5%,
          100% {
            opacity: 0;
            transform: translate3d(0, 0, 0);
          }
          88.5% {
            opacity: 0.85;
            transform: translate3d(0, 0, 0);
          }
          90% {
            opacity: 0.15;
            transform: translate3d(0, 3px, 0);
          }
          91.5% {
            opacity: 0.6;
            transform: translate3d(0, -2px, 0);
          }
          93% {
            opacity: 0;
          }
        }

        /* ---- Cherry Blossom (plx-skb-*) --------------------------------
           A spring gust off the hanami branch. The wind is written in the
           fall keyframes: every layer sweeps down-left out of the canopy
           zone with sinusoidal sway (the x reversals), one updraft stall
           (the y plateau mid-fall) and a fade past the bottom edge. Near
           petals fall fastest with the widest sway and a full spin; the
           far layer barely sways and dissolves into the haze. The tumble
           is a separate clock — a preserve-3d card-flip crossing rotateX
           with a full rotateY so the two painted faces (pale front /
           pinker back) flash as the petal rolls. Fall and tumble periods
           are coprime per petal, so no two loops visibly repeat. */

        /* near: big sweep, hard gust at 63%, one full pirouette */
        .plx-skb-fall-n {
          animation: plx-skb-fall-n 8s linear infinite;
        }
        @keyframes plx-skb-fall-n {
          0% {
            transform: translate3d(2px, -16px, 0) rotate(-8deg);
            opacity: 0;
          }
          5% {
            opacity: 0.95;
          }
          20% {
            transform: translate3d(-12px, 16px, 0) rotate(38deg);
          }
          34% {
            transform: translate3d(-30px, 26px, 0) rotate(84deg);
          }
          48% {
            /* sway-back + the updraft: y nearly stalls while x recovers */
            transform: translate3d(-24px, 42px, 0) rotate(138deg);
          }
          63% {
            transform: translate3d(-46px, 54px, 0) rotate(196deg);
          }
          78% {
            transform: translate3d(-40px, 82px, 0) rotate(262deg);
            opacity: 0.85;
          }
          100% {
            transform: translate3d(-58px, 122px, 0) rotate(330deg);
            opacity: 0;
          }
        }

        /* mid: the meander — long left reach, stall at 52%, slow counter-spin */
        .plx-skb-fall-m {
          animation: plx-skb-fall-m 11s linear infinite;
        }
        @keyframes plx-skb-fall-m {
          0% {
            transform: translate3d(0, -12px, 0) rotate(6deg);
            opacity: 0;
          }
          7% {
            opacity: 0.8;
          }
          18% {
            transform: translate3d(-10px, 10px, 0) rotate(-24deg);
          }
          36% {
            transform: translate3d(-34px, 24px, 0) rotate(-58deg);
          }
          52% {
            /* riding the updraft — horizontal, almost weightless */
            transform: translate3d(-52px, 28px, 0) rotate(-80deg);
          }
          68% {
            transform: translate3d(-64px, 50px, 0) rotate(-30deg);
          }
          84% {
            transform: translate3d(-78px, 76px, 0) rotate(20deg);
            opacity: 0.7;
          }
          100% {
            transform: translate3d(-92px, 108px, 0) rotate(58deg);
            opacity: 0;
          }
        }

        /* far: lazy haze descent — small sway, half opacity, early dissolve */
        .plx-skb-fall-f {
          animation: plx-skb-fall-f 16s linear infinite;
        }
        @keyframes plx-skb-fall-f {
          0% {
            transform: translate3d(0, -8px, 0) rotate(-4deg);
            opacity: 0;
          }
          10% {
            opacity: 0.55;
          }
          30% {
            transform: translate3d(-12px, 14px, 0) rotate(14deg);
          }
          55% {
            transform: translate3d(-30px, 34px, 0) rotate(-12deg);
          }
          80% {
            transform: translate3d(-44px, 62px, 0) rotate(10deg);
            opacity: 0.5;
          }
          100% {
            transform: translate3d(-56px, 92px, 0) rotate(24deg);
            opacity: 0;
          }
        }

        /* the card-flip: rotateX rocks through the horizontal while
           rotateY spins — the petal rolls like a falling leaf, its two
           faces flashing light/dark. Duration and direction vary per
           petal; the loop closes on the same pose it opened on. */
        .plx-skb-tumble {
          animation: plx-skb-tumble 3.4s linear infinite;
        }
        @keyframes plx-skb-tumble {
          0% {
            transform: rotateX(-26deg) rotateY(0deg);
          }
          25% {
            transform: rotateX(12deg) rotateY(90deg);
          }
          50% {
            transform: rotateX(28deg) rotateY(180deg);
          }
          75% {
            transform: rotateX(-8deg) rotateY(270deg);
          }
          100% {
            transform: rotateX(-26deg) rotateY(360deg);
          }
        }

        /* weather: one cumulus puff crossing the right sky per loop —
           fades before the name zone, re-enters off the right edge */
        .plx-skb-cloud {
          animation: plx-skb-cloud 86s linear infinite;
        }
        @keyframes plx-skb-cloud {
          0% {
            transform: translate3d(150px, 0, 0);
            opacity: 0;
          }
          6% {
            opacity: 0.8;
          }
          84% {
            opacity: 0.8;
          }
          96%,
          100% {
            transform: translate3d(-640px, 0, 0);
            opacity: 0;
          }
        }

        /* ---- Koi Pond (plx-koip-*) ------------------------------------
           A sunlit pond seen from above, light entering top-right. Three
           clocks carry the story: the Kohaku's 26s lap (its 42% surface
           kiss shares one -6s delay with the nose glow, both ripple
           rings and the bubble pair, so the splash can never drift off
           the fish), an 11s pad cycle (an unseen fish tugs the big pad
           from below — dip, rings off the rim, one bubble), and slow
           scenery: a 16s swell sheen, an 18s petal cast off the lotus, a
           28s dragonfly visit. Water shimmer is two counter-drifting
           copies of the base art's caustic tile (via plx-drift), so live
           light and painted light share one geometry and only differ in
           strength. */

        /* the light body (caustics + shafts + sheen) blooms as one while
           the row is hovered */
        .plx-koip-hlight {
          opacity: 0.8;
          transition: opacity 480ms ease;
        }
        @media (hover: hover) and (pointer: fine) {
          .group:hover .plx-koip-hlight {
            opacity: 1;
          }
        }

        .plx-koip-shaft {
          animation: plx-koip-shaft 11s ease-in-out infinite;
        }
        @keyframes plx-koip-shaft {
          0%,
          100% {
            opacity: 0.45;
          }
          50% {
            opacity: 0.9;
          }
        }

        /* one soft swell highlight washing across the art zone and back
           (the skew lives on a static parent so the frozen frame keeps
           its slant) */
        .plx-koip-sheen {
          animation: plx-koip-sheen 16s ease-in-out infinite;
        }
        @keyframes plx-koip-sheen {
          0%,
          100% {
            transform: translate3d(26px, 0, 0);
          }
          50% {
            transform: translate3d(-240px, 0, 0);
          }
        }

        /* the Kohaku's lap: in from the deep left, an S-curve up into the
           light, the kiss, then burst-and-coast into the pad shade — it
           never swims out, under the pads is home. ease-in-out between
           unevenly spaced keyframes = the burst-glide pulse real carp
           swim with. Rotation follows the path tangent. */
        .plx-koip-kohaku {
          animation: plx-koip-kohaku 26s ease-in-out infinite;
        }
        @keyframes plx-koip-kohaku {
          0% {
            transform: translate3d(-268px, 10px, 0) rotate(-3deg) scale(1);
            opacity: 0;
          }
          5% {
            transform: translate3d(-236px, 8px, 0) rotate(-4deg) scale(1);
            opacity: 0.92;
          }
          15% {
            transform: translate3d(-176px, 2px, 0) rotate(-5deg) scale(1);
          }
          26% {
            transform: translate3d(-118px, -2px, 0) rotate(-2deg) scale(1);
          }
          36% {
            transform: translate3d(-58px, -5px, 0) rotate(-7deg) scale(1.02);
          }
          42% {
            /* the kiss — nose up at the surface; glow/rings/bubbles fire
               on this exact clock position */
            transform: translate3d(-18px, -11px, 0) rotate(-8deg) scale(1.08);
          }
          47% {
            transform: translate3d(0px, -6px, 0) rotate(5deg) scale(1.02);
          }
          58% {
            transform: translate3d(16px, 0, 0) rotate(3deg) scale(1);
          }
          70% {
            transform: translate3d(30px, 3px, 0) rotate(1deg) scale(1);
            opacity: 0.92;
          }
          84% {
            transform: translate3d(46px, 1px, 0) rotate(-2deg) scale(1);
          }
          94%,
          100% {
            transform: translate3d(60px, -2px, 0) rotate(-1deg) scale(1);
            opacity: 0;
          }
        }

        /* the gold Ogon slips out from under the pad cluster, meanders
           the opposite way and sinks off into the deep left (scale eases
           down as it goes — depth, not shrinkage) */
        .plx-koip-ogon {
          animation: plx-koip-ogon 30s ease-in-out infinite;
        }
        @keyframes plx-koip-ogon {
          0% {
            transform: translate3d(138px, -13px, 0) rotate(-2deg) scale(1);
            opacity: 0;
          }
          4% {
            transform: translate3d(126px, -11px, 0) rotate(-4deg) scale(1);
            opacity: 0.95;
          }
          13% {
            transform: translate3d(98px, -7px, 0) rotate(-5deg) scale(1);
          }
          25% {
            transform: translate3d(52px, 3px, 0) rotate(5deg) scale(1);
          }
          39% {
            transform: translate3d(4px, 12px, 0) rotate(2deg) scale(0.99);
          }
          53% {
            transform: translate3d(-38px, 6px, 0) rotate(-5deg) scale(0.98);
          }
          67% {
            transform: translate3d(-72px, -3px, 0) rotate(-2deg) scale(0.97);
            opacity: 0.88;
          }
          80% {
            transform: translate3d(-96px, 3px, 0) rotate(3deg) scale(0.95);
            opacity: 0.75;
          }
          92%,
          100% {
            transform: translate3d(-116px, 8px, 0) rotate(2deg) scale(0.93);
            opacity: 0;
          }
        }

        /* the ghost koi patrols the deep — small, blurred, barely there */
        .plx-koip-ghost {
          animation: plx-koip-ghost 40s ease-in-out infinite;
        }
        @keyframes plx-koip-ghost {
          0% {
            transform: translate3d(118px, -2px, 0) rotate(2deg);
            opacity: 0;
          }
          7% {
            transform: translate3d(96px, 1px, 0) rotate(3deg);
            opacity: 0.55;
          }
          22% {
            transform: translate3d(52px, 6px, 0) rotate(1deg);
          }
          38% {
            transform: translate3d(6px, -1px, 0) rotate(-4deg);
          }
          54% {
            transform: translate3d(-40px, -7px, 0) rotate(-3deg);
          }
          70% {
            transform: translate3d(-84px, -2px, 0) rotate(3deg);
          }
          85% {
            transform: translate3d(-122px, 4px, 0) rotate(2deg);
            opacity: 0.5;
          }
          94%,
          100% {
            transform: translate3d(-148px, 6px, 0) rotate(1deg);
            opacity: 0;
          }
        }

        /* swimming articulation (transform-box: fill-box seats origins on
           the fish geometry): caudal fin wags at the peduncle, the body
           counter-sways at low amplitude, pectorals scull in counter-
           phase (the pair de-syncs via a full-period negative delay) */
        .plx-koip-tail {
          transform-box: fill-box;
          /* the peduncle — the caudal fin's left edge, where it meets the
             body (fish are drawn head-left; travel direction is a static
             scaleX flip on the wrapper) */
          transform-origin: left center;
          animation: plx-koip-tail 1.15s ease-in-out infinite alternate;
        }
        @keyframes plx-koip-tail {
          from {
            transform: rotate(9deg);
          }
          to {
            transform: rotate(-11deg);
          }
        }

        .plx-koip-sway {
          /* view-box, not fill-box: the group contains the sculling fins,
             whose motion must not feed back into this pivot. 40% of the
             52-unit box = the fish's center of mass, just behind the head */
          transform-box: view-box;
          transform-origin: 40% 50%;
          animation: plx-koip-sway 2.3s ease-in-out infinite alternate;
        }
        @keyframes plx-koip-sway {
          from {
            transform: rotate(1.6deg);
          }
          to {
            transform: rotate(-1.6deg);
          }
        }

        .plx-koip-pect {
          transform-box: fill-box;
          animation: plx-koip-pect 2.8s ease-in-out infinite alternate;
        }
        @keyframes plx-koip-pect {
          from {
            transform: rotate(-7deg);
          }
          to {
            transform: rotate(11deg);
          }
        }

        /* the surface kiss (42% of the 26s lap): nose glow pops while two
           elliptical rings open — rings are ~3:1 ellipses so they lie ON
           the water plane — and a bubble pair breaks away */
        .plx-koip-kiss {
          animation: plx-koip-kiss 26s linear infinite;
        }
        @keyframes plx-koip-kiss {
          0%,
          40.5% {
            opacity: 0;
            transform: scale(0.7);
          }
          42.5% {
            opacity: 0.75;
            transform: scale(1.05);
          }
          45.5% {
            opacity: 0.35;
            transform: scale(1);
          }
          50%,
          100% {
            opacity: 0;
            transform: scale(0.9);
          }
        }

        /* rings outlive the glow — the fish glides on while the water
           remembers; they must still read once the white back has cleared
           the kiss point (that lag is most of the realism) */
        .plx-koip-ripple-a {
          animation: plx-koip-ripple-a 26s linear infinite;
        }
        @keyframes plx-koip-ripple-a {
          0%,
          42% {
            transform: scale(0.22);
            opacity: 0;
          }
          43.5% {
            opacity: 0.8;
          }
          47% {
            transform: scale(0.82);
          }
          55%,
          100% {
            transform: scale(1.35);
            opacity: 0;
          }
        }

        .plx-koip-ripple-b {
          animation: plx-koip-ripple-b 26s linear infinite;
        }
        @keyframes plx-koip-ripple-b {
          0%,
          43.4% {
            transform: scale(0.2);
            opacity: 0;
          }
          45% {
            opacity: 0.65;
          }
          49.5% {
            transform: scale(0.78);
          }
          57%,
          100% {
            transform: scale(1.25);
            opacity: 0;
          }
        }

        .plx-koip-bubble {
          animation: plx-koip-bubble 26s linear infinite;
        }
        @keyframes plx-koip-bubble {
          0%,
          42.5% {
            transform: translate3d(0, 3px, 0);
            opacity: 0;
          }
          44.5% {
            opacity: 0.7;
          }
          50% {
            transform: translate3d(2px, -9px, 0);
            opacity: 0.55;
          }
          56%,
          100% {
            transform: translate3d(-1px, -17px, 0);
            opacity: 0;
          }
        }

        /* the big pad rides a quiet bob until something below tugs it at
           55% — the dip, both rim rings and the bubble share the 11s
           clock and a -4s delay */
        .plx-koip-pad-a {
          animation: plx-koip-pad-a 11s ease-in-out infinite;
        }
        @keyframes plx-koip-pad-a {
          0%,
          100% {
            transform: translate3d(0, 0, 0) rotate(0deg);
          }
          18% {
            transform: translate3d(0, -1.3px, 0) rotate(0.8deg);
          }
          36% {
            transform: translate3d(0, 0.4px, 0) rotate(-0.5deg);
          }
          52% {
            transform: translate3d(0, 0, 0) rotate(0deg);
          }
          55% {
            transform: translate3d(0.6px, 1.7px, 0) rotate(-2.6deg);
          }
          59% {
            transform: translate3d(0, -0.9px, 0) rotate(1deg);
          }
          64% {
            transform: translate3d(0, 0.3px, 0) rotate(-0.4deg);
          }
          80% {
            transform: translate3d(0, -1px, 0) rotate(0.6deg);
          }
        }

        .plx-koip-nibble-a {
          animation: plx-koip-nibble-a 11s linear infinite;
        }
        @keyframes plx-koip-nibble-a {
          0%,
          55% {
            transform: scale(0.25);
            opacity: 0;
          }
          56.5% {
            opacity: 0.5;
          }
          60% {
            transform: scale(0.85);
          }
          66%,
          100% {
            transform: scale(1.3);
            opacity: 0;
          }
        }

        .plx-koip-nibble-b {
          animation: plx-koip-nibble-b 11s linear infinite;
        }
        @keyframes plx-koip-nibble-b {
          0%,
          57% {
            transform: scale(0.25);
            opacity: 0;
          }
          58.5% {
            opacity: 0.4;
          }
          62% {
            transform: scale(0.8);
          }
          69%,
          100% {
            transform: scale(1.25);
            opacity: 0;
          }
        }

        .plx-koip-pad-bubble {
          animation: plx-koip-pad-bubble 11s linear infinite;
        }
        @keyframes plx-koip-pad-bubble {
          0%,
          56% {
            transform: translate3d(0, 2px, 0);
            opacity: 0;
          }
          58% {
            opacity: 0.6;
          }
          63% {
            transform: translate3d(1.5px, -7px, 0);
            opacity: 0.45;
          }
          67%,
          100% {
            transform: translate3d(0, -13px, 0);
            opacity: 0;
          }
        }

        /* generic scenery bob for the other pads / lotus / bud (the bud
           pivots at its stem base via an inline transform-origin) */
        .plx-koip-bob {
          animation: plx-koip-bob 8s ease-in-out infinite;
        }
        @keyframes plx-koip-bob {
          0%,
          100% {
            transform: translate3d(0, 0.4px, 0) rotate(-0.6deg);
          }
          50% {
            transform: translate3d(0, -1.1px, 0) rotate(0.8deg);
          }
        }

        /* every 18s the lotus lets one petal go: it lifts on the breeze,
           then rides the swell left in slowing hops until it soaks */
        .plx-koip-petal {
          animation: plx-koip-petal 18s linear infinite;
        }
        @keyframes plx-koip-petal {
          0%,
          4% {
            transform: translate3d(0, 0, 0) rotate(0deg);
            opacity: 0;
          }
          7% {
            transform: translate3d(1px, -3px, 0) rotate(14deg);
            opacity: 0.95;
          }
          15% {
            transform: translate3d(-14px, 3px, 0) rotate(-38deg);
          }
          25% {
            transform: translate3d(-36px, 8px, 0) rotate(-74deg);
          }
          35% {
            transform: translate3d(-58px, 6px, 0) rotate(-112deg);
          }
          45% {
            transform: translate3d(-82px, 11px, 0) rotate(-148deg);
            opacity: 0.85;
          }
          54%,
          100% {
            transform: translate3d(-102px, 13px, 0) rotate(-172deg);
            opacity: 0;
          }
        }

        /* the 28s dragonfly visit: darts in high, settles over the lotus
           bud with micro-hover bobs (~2.3s of the cycle), darts off right
           — the rare-event beat, same language as the mythics' shooting
           star. Wings flutter on their own fast clock. */
        .plx-koip-dfly {
          animation: plx-koip-dfly 28s linear infinite;
        }
        @keyframes plx-koip-dfly {
          0%,
          69% {
            transform: translate3d(46px, -18px, 0) rotate(6deg);
            opacity: 0;
          }
          70.5% {
            transform: translate3d(8px, -3px, 0) rotate(-4deg);
            opacity: 1;
          }
          71.5% {
            transform: translate3d(-1px, 2px, 0) rotate(2deg);
          }
          72.5% {
            transform: translate3d(1.5px, -1px, 0) rotate(0deg);
          }
          74% {
            transform: translate3d(0, 1px, 0) rotate(0deg);
          }
          76% {
            transform: translate3d(1px, -1.5px, 0) rotate(1deg);
          }
          78% {
            transform: translate3d(-0.5px, 1.5px, 0) rotate(-1deg);
          }
          80% {
            transform: translate3d(1.5px, -1px, 0) rotate(1deg);
          }
          81.5% {
            transform: translate3d(0, 0.5px, 0) rotate(0deg);
          }
          83% {
            transform: translate3d(-3px, -7px, 0) rotate(-6deg);
            opacity: 1;
          }
          85%,
          100% {
            transform: translate3d(44px, -22px, 0) rotate(10deg);
            opacity: 0;
          }
        }

        .plx-koip-wing {
          transform-box: fill-box;
          animation: plx-koip-wing 0.24s ease-in-out infinite alternate;
        }
        @keyframes plx-koip-wing {
          from {
            transform: scaleY(1);
          }
          to {
            transform: scaleY(0.4);
          }
        }

        /* cat rests peeked (the reduced-motion state); the animation ducks
           it down and periodically pops it back up */
        .plx-peek {
          animation: plx-peek 7s ease-in-out infinite;
        }
        @keyframes plx-peek {
          0%,
          100% {
            transform: translate3d(0, 14px, 0);
          }
          16%,
          64% {
            transform: translate3d(0, 0, 0);
          }
          78% {
            transform: translate3d(0, 14px, 0);
          }
        }

        .plx-blink {
          animation: plx-blink 5.5s ease-in-out infinite;
        }
        @keyframes plx-blink {
          0%,
          91%,
          100% {
            transform: scaleY(1);
          }
          94%,
          96% {
            transform: scaleY(0.15);
          }
        }

        .plx-twitch {
          transform-origin: bottom center;
          animation: plx-twitch 5.2s ease-in-out infinite;
        }
        @keyframes plx-twitch {
          0%,
          86%,
          94%,
          100% {
            transform: rotate(0deg);
          }
          88% {
            transform: rotate(-12deg);
          }
          91% {
            transform: rotate(8deg);
          }
        }

        /* paw slap — quick press, small recoil, rest */
        .plx-pat {
          transform-origin: 50% 0;
          animation: plx-pat 0.9s ease-in-out infinite;
        }
        @keyframes plx-pat {
          0%,
          55%,
          100% {
            transform: translate3d(0, 0, 0) rotate(0deg);
          }
          20% {
            transform: translate3d(0, 4px, 0) rotate(4deg);
          }
          35% {
            transform: translate3d(0, 1px, 0) rotate(-2deg);
          }
        }

        .plx-key {
          animation: plx-key 1.9s ease-in-out infinite;
        }
        @keyframes plx-key {
          0%,
          32%,
          100% {
            transform: translate3d(0, 0, 0);
            opacity: 0.25;
          }
          16% {
            transform: translate3d(0, 2px, 0);
            opacity: 0.8;
          }
        }

        .plx-note {
          animation: plx-note 3.6s ease-out infinite;
        }
        @keyframes plx-note {
          0% {
            transform: translate3d(0, 2px, 0);
            opacity: 0;
          }
          15% {
            opacity: 0.9;
          }
          100% {
            transform: translate3d(-6px, -22px, 0);
            opacity: 0;
          }
        }

        /* gold dust rising off the champion's plate */
        .plx-mote {
          animation: plx-mote 7s linear infinite;
        }
        @keyframes plx-mote {
          0% {
            transform: translate3d(0, 6px, 0);
            opacity: 0;
          }
          12% {
            opacity: 0.8;
          }
          55% {
            transform: translate3d(-5px, -14px, 0);
            opacity: 0.5;
          }
          100% {
            transform: translate3d(3px, -30px, 0);
            opacity: 0;
          }
        }

        /* afterburner jitter — fast asymmetric flicker */
        .plx-flame {
          transform-origin: right center;
          animation: plx-flame 0.85s ease-in-out infinite;
        }
        @keyframes plx-flame {
          0%,
          100% {
            transform: scaleX(1) scaleY(1);
            opacity: 0.85;
          }
          25% {
            transform: scaleX(1.28) scaleY(0.92);
            opacity: 1;
          }
          50% {
            transform: scaleX(0.88) scaleY(1.08);
            opacity: 0.72;
          }
          75% {
            transform: scaleX(1.16) scaleY(0.96);
            opacity: 0.95;
          }
        }

        /* ---- Season 01: Ignition — kerolox plume physics ---- */

        /* igniter sparks: ballistic ejecta off the nozzle mouth. The
           trajectory lives in per-spark vars (--plx-sx/-sy/-sr) so one
           keyframe set serves slivers and droplets alike; ease-out =
           violent ejection decaying under drag, and the sliver stretch
           (scaleX 0.35→1→0.6) sells velocity foreshortening */
        .plx-spark {
          animation: plx-spark 1.4s cubic-bezier(0.16, 0.6, 0.35, 1) infinite;
        }
        @keyframes plx-spark {
          0% {
            transform: translate3d(0, 0, 0) rotate(0deg) scaleX(0.35);
            opacity: 0;
          }
          7% {
            opacity: 1;
          }
          55% {
            transform: translate3d(calc(var(--plx-sx, -90px) * 0.62), calc(var(--plx-sy, 6px) * 0.3), 0)
              rotate(calc(var(--plx-sr, -10deg) * 0.5)) scaleX(1);
            opacity: 0.9;
          }
          100% {
            transform: translate3d(var(--plx-sx, -90px), var(--plx-sy, 6px), 0)
              rotate(var(--plx-sr, -10deg)) scaleX(0.6);
            opacity: 0;
          }
        }

        /* mach diamonds: standing shocks re-igniting unburned fuel — a
           brightness/scale swell as the pressure ratio breathes, never a
           position change (the shock chain is anchored to the nozzle).
           The 1.34 swell is the static-test retune: the chain should
           punch as the combustion thump rolls through, not shimmer */
        .plx-diamond {
          transform-origin: center;
          animation: plx-diamond 0.9s ease-in-out infinite;
        }
        @keyframes plx-diamond {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.72;
          }
          50% {
            transform: scale(1.34);
            opacity: 1;
          }
        }

        /* pad smoke: a slow billow crawling left along the strip floor —
           scaleX swell as the puff lofts and shears, opacity inhaling
           then exhaling over one long breath */
        .plx-smoke {
          animation: plx-smoke 11s ease-in-out infinite;
        }
        @keyframes plx-smoke {
          0% {
            transform: translate3d(6px, 4px, 0) scaleX(0.82);
            opacity: 0;
          }
          32% {
            opacity: 0.5;
          }
          58% {
            transform: translate3d(-12px, -1px, 0) scaleX(1.14);
            opacity: 0.42;
          }
          100% {
            transform: translate3d(-26px, -6px, 0) scaleX(1.3);
            opacity: 0;
          }
        }

        /* the 11s blast surge (TDE precedent: the event owns <7% of the
           loop, so the plate reads as a steady burn punctuated by a
           detonation — not a strobe). The flash double-strikes: an
           igniter spike, a quarter-beat collapse, then the main bang;
           two shockwave rings roll left through the plume a beat apart */
        .plx-ign-flash {
          animation: plx-ign-flash 11s linear infinite;
        }
        @keyframes plx-ign-flash {
          0%,
          89.5% {
            transform: scale(0.5);
            opacity: 0;
          }
          91% {
            transform: scale(1.18);
            opacity: 1;
          }
          92.3% {
            transform: scale(0.92);
            opacity: 0.5;
          }
          93.2% {
            transform: scale(1.3);
            opacity: 0.92;
          }
          96%,
          100% {
            transform: scale(1.55);
            opacity: 0;
          }
        }

        .plx-ign-ring {
          transform-origin: right center;
          animation: plx-ign-ring 11s linear infinite;
        }
        @keyframes plx-ign-ring {
          0%,
          90% {
            transform: translate3d(0, 0, 0) scale3d(0.3, 0.3, 1);
            opacity: 0;
          }
          91.6% {
            opacity: 0.85;
          }
          95%,
          100% {
            transform: translate3d(-58px, 0, 0) scale3d(3.2, 2.3, 1);
            opacity: 0;
          }
        }

        /* combustion thump: the low-frequency instability under the fast
           flicker. Origin pinned to the bell mouth so the whole plume —
           fireball, jet, diamonds — surges radially out of the nozzle,
           overshoots, and settles like shockwaves finding their flow */
        .plx-thump {
          transform-origin: right center;
          animation: plx-thump 2.8s cubic-bezier(0.22, 0.9, 0.36, 1) infinite;
        }
        @keyframes plx-thump {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.9;
          }
          9% {
            transform: scale(1.14);
            opacity: 1;
          }
          24% {
            transform: scale(0.95);
            opacity: 0.82;
          }
          42% {
            transform: scale(1.06);
            opacity: 0.96;
          }
          64% {
            transform: scale(0.98);
            opacity: 0.87;
          }
        }

        /* fume tumble: each puff spawns tight at the plume, lofts along
           its own --plx-dx/--plx-dy fan (up-left and down-left off the
           fireball) and shears out 0.5 → 2.1 as it cools; the rotate is
           the billow rolling over itself, never a sideways slide */
        .plx-billow {
          animation: plx-billow 8s ease-out infinite;
        }
        @keyframes plx-billow {
          0% {
            transform: translate3d(0, 0, 0) rotate(0deg) scale(0.7);
            opacity: 0;
          }
          15% {
            opacity: 0.55;
          }
          58% {
            transform: translate3d(calc(var(--plx-dx, -48px) * 0.55), calc(var(--plx-dy, -20px) * 0.55), 0)
              rotate(calc(var(--plx-br, 12deg) * 0.6)) scale(1.35);
            opacity: 0.4;
          }
          100% {
            transform: translate3d(var(--plx-dx, -48px), var(--plx-dy, -20px), 0)
              rotate(var(--plx-br, 12deg)) scale(2.1);
            opacity: 0;
          }
        }

        /* tip bloom: the plume's mushrooming burnout — a slow swell at
           the jet's ragged end where the exhaust slams into still air
           and curls back on itself */
        .plx-bloom {
          transform-origin: center;
          animation: plx-bloom 2.2s ease-in-out infinite;
        }
        @keyframes plx-bloom {
          0%,
          100% {
            transform: scale(0.92);
            opacity: 0.62;
          }
          44% {
            transform: scale(1.15);
            opacity: 0.92;
          }
          70% {
            transform: scale(1.03);
            opacity: 0.74;
          }
        }

        /* surge debris fan: bright streaks of spalled igniter spray shot
           outward from the bell inside the blast window only. --plx-ra
           aims each spoke; the translate runs down the rotated axis, so
           one keyframe set serves the whole fan */
        .plx-burst-streak {
          transform-origin: right center;
          animation: plx-burst-streak 11s linear infinite;
        }
        @keyframes plx-burst-streak {
          0%,
          90% {
            transform: rotate(var(--plx-ra, 0deg)) translate3d(0, 0, 0) scaleX(0.35);
            opacity: 0;
          }
          91.4% {
            opacity: 0.9;
          }
          95.5%,
          100% {
            transform: rotate(var(--plx-ra, 0deg)) translate3d(-72px, 0, 0) scaleX(1.2);
            opacity: 0;
          }
        }

        /* concussion shake: the anchor's 1–2px jolt as the blast wave
           passes — five decaying oscillations parked inside the flash
           window, dead still the rest of the loop */
        .plx-shake {
          animation: plx-shake 11s linear infinite;
        }
        @keyframes plx-shake {
          0%,
          89.8%,
          96.5%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          90.4% {
            transform: translate3d(1.5px, -1px, 0);
          }
          91.2% {
            transform: translate3d(-1px, 1.5px, 0);
          }
          92.2% {
            transform: translate3d(1px, 1px, 0);
          }
          93.4% {
            transform: translate3d(-1.5px, -0.5px, 0);
          }
          94.8% {
            transform: translate3d(0.5px, -1px, 0);
          }
        }

        /* packet / glint traveling a fixed distance (--plx-p) inside an
           overflow-hidden lane */
        .plx-travel {
          animation: plx-travel 4.5s linear infinite;
        }
        @keyframes plx-travel {
          0% {
            transform: translate3d(0, 0, 0);
            opacity: 0;
          }
          10% {
            opacity: 0.9;
          }
          90% {
            opacity: 0.9;
          }
          100% {
            transform: translate3d(var(--plx-p, 240px), 0, 0);
            opacity: 0;
          }
        }

        .plx-node {
          animation: plx-node 2.8s ease-in-out infinite;
        }
        @keyframes plx-node {
          0%,
          100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.4);
          }
        }

        /* rest transform matches the keyframe midpoint so the reduced-motion
           freeze keeps the curtains leaning */
        .plx-aurora {
          transform: skewX(-13deg);
          animation: plx-aurora 11s ease-in-out infinite;
        }
        @keyframes plx-aurora {
          0%,
          100% {
            transform: skewX(-16deg) translate3d(0, 0, 0);
          }
          50% {
            transform: skewX(-10deg) translate3d(12px, 0, 0);
          }
        }

        .plx-rotate {
          animation: plx-rotate 8s linear infinite;
        }
        @keyframes plx-rotate {
          to {
            transform: rotate(360deg);
          }
        }

        .plx-blip {
          animation: plx-blip 6s linear infinite;
        }
        @keyframes plx-blip {
          0% {
            opacity: 0;
          }
          5% {
            opacity: 1;
          }
          45% {
            opacity: 0.12;
          }
          100% {
            opacity: 0;
          }
        }

        /* intel scanner — a line sweeping down, then a dark dwell. The
           124px travel clears the tallest plate surface (the 112px podium
           banner) before parking; on shorter surfaces (68px rows) the
           overflow-hidden lane clips the line at the row edge mid-sweep,
           which reads as the scan running off the plate. */
        .plx-scan {
          animation: plx-scan 9s linear infinite;
        }
        @keyframes plx-scan {
          0% {
            transform: translate3d(0, -4px, 0);
            opacity: 0;
          }
          4% {
            opacity: 0.5;
          }
          38% {
            opacity: 0.5;
          }
          46%,
          100% {
            transform: translate3d(0, 124px, 0);
            opacity: 0;
          }
        }

        /* ---- mythic scenes ------------------------------------------- */

        /* Event Horizon — Gargantua. Continuous life: three conic shear
           bands lap the disk plane at Keplerian-staggered speeds (7/16/34s,
           same direction — differential rotation, never a rigid body), a
           white-hot surge lobe flashes the approaching limb each pass
           through a static crescent mask (relativistic beaming), a bead of
           light orbits the photon ring every 3.5s, the lensed halo
           breathes, and doomed matter spirals in. The rare beat is a 45s
           tidal-disruption master clock (plx-eh-tde-*): a star drifts in,
           spaghettifies around the well, the disk flares end-to-end, and
           the embers cool. Rotation reuses plx-rotate (phase lives on
           static parent wrappers so the freeze frame stays composed). */

        /* spiral infall: one keyframed element per lane. Its transform
           origin sits at the hole center, so interpolating rotate(a0→a1)
           while the streak translates inward traces a tightening spiral;
           the disk-plane wrapper squashes the path onto the disk ellipse
           (streaks foreshorten when they swing through the far side). */
        .plx-eh-infall {
          animation: plx-eh-infall 11s cubic-bezier(0.52, 0, 0.88, 0.62) infinite;
        }
        @keyframes plx-eh-infall {
          0% {
            transform: rotate(var(--plx-ia, 0deg)) translate3d(var(--plx-ir, -130px), 0, 0);
            opacity: 0;
          }
          11% {
            opacity: 0.7;
          }
          78% {
            opacity: 0.55;
          }
          100% {
            transform: rotate(var(--plx-ib, 100deg)) translate3d(-6px, 0, 0);
            opacity: 0;
          }
        }

        /* the disruption: the whip wrapper holds still through the star's
           approach, then slings ~126° around the well (ease-in — gravity)
           and resets while its passenger is invisible */
        .plx-eh-tde-whip {
          animation: plx-eh-tde-whip 45s linear infinite;
        }
        @keyframes plx-eh-tde-whip {
          0%,
          80% {
            transform: rotate(0deg);
            animation-timing-function: cubic-bezier(0.6, 0, 0.82, 1);
          }
          85.2%,
          86.4% {
            transform: rotate(126deg);
          }
          86.5%,
          100% {
            transform: rotate(0deg);
          }
        }

        /* the star itself: drifts in as a dot (scaleX 0.13), then tidal
           forces stretch it ~14× into a filament while the whip swings —
           spaghettification — and it vanishes past the horizon */
        .plx-eh-tde-star {
          animation: plx-eh-tde-star 45s linear infinite;
        }
        @keyframes plx-eh-tde-star {
          0%,
          75.4% {
            transform: translate3d(-118px, -46px, 0) scale3d(0.24, 1, 1);
            opacity: 0;
          }
          76.2% {
            opacity: 0.95;
          }
          80% {
            transform: translate3d(-30px, -40px, 0) scale3d(0.24, 1, 1);
            opacity: 1;
            animation-timing-function: cubic-bezier(0.55, 0, 0.85, 1);
          }
          84.6% {
            transform: translate3d(-8px, -26px, 0) scale3d(1.9, 0.68, 1);
            opacity: 0.95;
          }
          85.6%,
          100% {
            transform: translate3d(0, -22px, 0) scale3d(2.15, 0.42, 1);
            opacity: 0;
          }
        }

        /* accretion flare: the whole disk plane brightens as the star is
           eaten (peak 84.8% = 38.16s — the harness freezes here), then a
           long ember afterglow tail */
        .plx-eh-tde-flare {
          animation: plx-eh-tde-flare 45s linear infinite;
        }
        @keyframes plx-eh-tde-flare {
          0%,
          82.8% {
            opacity: 0;
            transform: scale(0.8);
          }
          84.8% {
            opacity: 0.9;
            transform: scale(1.02);
          }
          87.5% {
            opacity: 0.45;
            transform: scale(1.06);
          }
          93.5%,
          100% {
            opacity: 0;
            transform: scale(1.12);
          }
        }

        /* the photon ring blooms with the flare and cools slightly later */
        .plx-eh-tde-ring {
          animation: plx-eh-tde-ring 45s linear infinite;
        }
        @keyframes plx-eh-tde-ring {
          0%,
          83% {
            opacity: 0;
            transform: scale(0.86);
          }
          84.8% {
            opacity: 0.95;
            transform: scale(1.03);
          }
          88.5% {
            opacity: 0.35;
            transform: scale(1.09);
          }
          92.5%,
          100% {
            opacity: 0;
            transform: scale(1.13);
          }
        }

        /* ---- hover: "feed the disk" — transition wrappers, separate from
           every keyframed loop (same contract as Prime Anomaly's h-layers).
           In: disk luminance blooms (0ms) → a hidden faster band crossfades
           in for perceived spin-up (80ms) → ring + halo bloom (160ms) → the
           whole well scales 1.03, a lens pull (280ms). Out reverses the
           causality: the well settles first, rings die, the spin-up fades,
           the disk dims last. */
        .plx-eh-hdisk {
          opacity: 0.62;
          transition: opacity 460ms cubic-bezier(0.33, 0, 0.2, 1) 260ms;
        }
        .plx-eh-hspin {
          opacity: 0;
          transition: opacity 400ms cubic-bezier(0.33, 0, 0.2, 1) 120ms;
        }
        .plx-eh-hring {
          opacity: 0;
          transition: opacity 380ms cubic-bezier(0.33, 0, 0.2, 1) 60ms;
        }
        .plx-eh-hwell {
          transform: scale(1);
          transition: transform 480ms cubic-bezier(0.33, 0, 0.2, 1) 0ms;
        }
        @media (hover: hover) and (pointer: fine) {
          .group:hover .plx-eh-hdisk {
            opacity: 1;
            transition: opacity 300ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
          }
          .group:hover .plx-eh-hspin {
            opacity: 0.85;
            transition: opacity 340ms cubic-bezier(0.22, 1, 0.36, 1) 80ms;
          }
          .group:hover .plx-eh-hring {
            opacity: 1;
            transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1) 160ms;
          }
          .group:hover .plx-eh-hwell {
            transform: scale(1.03);
            transition: transform 460ms cubic-bezier(0.22, 1.1, 0.36, 1) 280ms;
          }
        }

        /* Prime Anomaly: one ~45s reality cycle. Rest (sealed) → RGB-split
           ticks (~35s in) → the tear snaps open with overshoot → ~6s of
           chrome dimension → snaps shut → white line flash. All phases are
           percentages of the same 45s clock so they stay in sync. */
        .plx-anom-tear {
          animation: plx-anom-tear 45s linear infinite;
        }
        @keyframes plx-anom-tear {
          0%,
          78.4% {
            transform: scaleX(0);
            opacity: 0;
          }
          79.2% {
            transform: scaleX(0.08);
            opacity: 0.75;
          }
          80% {
            transform: scaleX(1.08);
            opacity: 1;
          }
          80.8% {
            transform: scaleX(0.97);
            opacity: 1;
          }
          81.6%,
          93.2% {
            transform: scaleX(1);
            opacity: 1;
          }
          94.2% {
            transform: scaleX(0.06);
            opacity: 0.85;
          }
          94.8%,
          100% {
            transform: scaleX(0);
            opacity: 0;
          }
        }

        /* ---- hover choreography: TRANSITIONS, never animation swaps ----
           Keyframes cannot reverse — swapping them on :hover snaps to base
           styles in one frame on unhover. So hover "openness" lives on
           dedicated hover-layer wrappers driven by transitions (they reverse
           from the current computed value, and redirect smoothly when the
           pointer flicks in/out mid-flight), while every infinite loop
           (chrome drift, ray spin/flicker, vein shimmer, the 45s cycle)
           stays keyframed on SEPARATE nested elements. The base rules below
           carry the HOVER-OUT timing (slower, softer, reverse stagger); the
           :hover rules carry HOVER-IN (snappier, slight overshoot).

           In:  cracks widen (0ms) → seam blooms (40ms) → rift grows out of
                the seam (110ms) → rays extend + the worlds' rim-lights
                answer (240ms) → core flare (360ms) → the rift interior
                settles deeper on its parallax layer (360ms, slow).
           Out: rays sucked back in (0ms) → flare dies (60ms) → interior
                surfaces + rim-lights fade (120/200ms) → rift narrows
                (180ms) → seam settles (380ms) → cracks dim last (480ms).

           The 45s cycle content sits in a .plx-anom-cycle gate that fades
           out under hover (so a mid-burst hover crossfades instead of
           double-brightening) and fades back in after the rift has closed —
           unhover during cycle-open eases to the cycle's live frame. */
        .plx-anom-cycle {
          opacity: 1;
          transition: opacity 380ms cubic-bezier(0.33, 0, 0.2, 1) 500ms;
        }
        .plx-anom-hveins {
          opacity: 0.6;
          transform: scale(1);
          transition:
            opacity 400ms cubic-bezier(0.33, 0, 0.2, 1) 480ms,
            transform 440ms cubic-bezier(0.33, 0, 0.2, 1) 480ms;
        }
        .plx-anom-hseam {
          opacity: 0.85;
          transform: scale(1);
          transition:
            opacity 360ms cubic-bezier(0.33, 0, 0.2, 1) 380ms,
            transform 400ms cubic-bezier(0.33, 0, 0.2, 1) 380ms;
        }
        .plx-anom-hrift {
          opacity: 0;
          transform: scaleX(0);
          transition:
            opacity 320ms cubic-bezier(0.33, 0, 0.2, 1) 180ms,
            transform 380ms cubic-bezier(0.45, 0, 0.55, 1) 180ms;
        }
        .plx-anom-hburst {
          opacity: 0;
          transform: scale(0.5);
          transition:
            opacity 420ms cubic-bezier(0.33, 0, 0.2, 1) 0ms,
            transform 500ms cubic-bezier(0.45, 0, 0.55, 1) 0ms;
        }
        .plx-anom-hflare {
          opacity: 0;
          transform: scale(0.55);
          transition:
            opacity 300ms cubic-bezier(0.33, 0, 0.2, 1) 60ms,
            transform 340ms cubic-bezier(0.33, 0, 0.2, 1) 60ms;
        }
        /* the rift interior's depth layer: shifts against the pinned torn
           edge while held open — parallax through the aperture */
        .plx-anom-hdepth {
          transform: translate3d(0, 0, 0) scale(1);
          transition: transform 420ms cubic-bezier(0.33, 0, 0.2, 1) 120ms;
        }
        /* the worlds answer the light: rim-glows lift while the rift pours */
        .plx-anom-hrim {
          opacity: 0.75;
          transition: opacity 380ms cubic-bezier(0.33, 0, 0.2, 1) 200ms;
        }
        @media (hover: hover) and (pointer: fine) {
          .group:hover .plx-anom-cycle {
            opacity: 0;
            transition: opacity 260ms cubic-bezier(0.4, 0, 0.6, 1) 0ms;
          }
          .group:hover .plx-anom-hveins {
            opacity: 1;
            transform: scale(1.14, 1.2);
            transition:
              opacity 240ms cubic-bezier(0.22, 1, 0.36, 1) 0ms,
              transform 280ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
          }
          .group:hover .plx-anom-hseam {
            opacity: 1;
            transform: scale(1.9, 1.12);
            transition:
              opacity 280ms cubic-bezier(0.22, 1, 0.36, 1) 40ms,
              transform 320ms cubic-bezier(0.22, 1, 0.36, 1) 40ms;
          }
          .group:hover .plx-anom-hrift {
            opacity: 1;
            transform: scaleX(1.16);
            transition:
              opacity 200ms cubic-bezier(0.33, 0, 0.2, 1) 110ms,
              transform 340ms cubic-bezier(0.22, 1.2, 0.36, 1) 110ms;
          }
          .group:hover .plx-anom-hburst {
            opacity: 1;
            transform: scale(1.26);
            transition:
              opacity 300ms cubic-bezier(0.33, 0, 0.2, 1) 240ms,
              transform 380ms cubic-bezier(0.22, 1.18, 0.36, 1) 240ms;
          }
          .group:hover .plx-anom-hflare {
            opacity: 1;
            transform: scale(1);
            transition:
              opacity 260ms cubic-bezier(0.22, 1, 0.36, 1) 360ms,
              transform 300ms cubic-bezier(0.22, 1, 0.36, 1) 360ms;
          }
          .group:hover .plx-anom-hdepth {
            transform: translate3d(-2.5px, 0, 0) scale(1.06);
            transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1) 360ms;
          }
          .group:hover .plx-anom-hrim {
            opacity: 1;
            transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1) 240ms;
          }
        }

        /* the light inside the rift churns: two counter-phased boil fields
           (only visible while the tear/rift is open) */
        .plx-anom-boil-a {
          animation: plx-anom-boil-a 15s ease-in-out infinite alternate;
        }
        @keyframes plx-anom-boil-a {
          from {
            transform: translate3d(-7%, -9%, 0) rotate(-3deg);
          }
          to {
            transform: translate3d(7%, 9%, 0) rotate(3deg);
          }
        }
        .plx-anom-boil-b {
          animation: plx-anom-boil-b 21s ease-in-out infinite alternate-reverse;
        }
        @keyframes plx-anom-boil-b {
          from {
            transform: translate3d(6%, -7%, 0) rotate(2.5deg);
          }
          to {
            transform: translate3d(-6%, 8%, 0) rotate(-2.5deg);
          }
        }

        /* the blinding core column never rests — stepped overexposure
           instability, like a fluorescent tube about to give */
        .plx-anom-core {
          animation: plx-anom-core-flicker 3.1s steps(1, end) infinite;
        }
        @keyframes plx-anom-core-flicker {
          0% {
            opacity: 0.93;
          }
          14% {
            opacity: 1;
          }
          26% {
            opacity: 0.88;
          }
          39% {
            opacity: 1;
          }
          55% {
            opacity: 0.95;
          }
          67% {
            opacity: 1;
          }
          81% {
            opacity: 0.9;
          }
          100% {
            opacity: 0.93;
          }
        }

        /* RGB-split interference slabs — two fast tick bursts before the
           tear opens, timed on the same 45s clock */
        .plx-anom-tick {
          animation: plx-anom-tick 45s linear infinite;
        }
        @keyframes plx-anom-tick {
          0%,
          77.2%,
          79.9%,
          100% {
            opacity: 0;
            transform: translate3d(0, 0, 0);
          }
          77.5% {
            opacity: 0.9;
            transform: translate3d(-4px, 0, 0);
          }
          78.1% {
            opacity: 0.2;
            transform: translate3d(3px, 0, 0);
          }
          78.7% {
            opacity: 0.85;
            transform: translate3d(-2px, 0, 0);
          }
          79.4% {
            opacity: 0.3;
            transform: translate3d(4px, 0, 0);
          }
        }

        /* glowing fragments drifting out of the open tear */
        .plx-anom-shard {
          animation: plx-anom-shard 45s linear infinite;
        }
        @keyframes plx-anom-shard {
          0%,
          80%,
          94%,
          100% {
            opacity: 0;
            transform: translate3d(0, 0, 0) rotate(0deg);
          }
          82.5% {
            opacity: 0.9;
          }
          92.5% {
            opacity: 0.55;
            transform: translate3d(var(--plx-sx, 18px), var(--plx-sy, -10px), 0)
              rotate(26deg);
          }
          93.6% {
            opacity: 0;
            transform: translate3d(var(--plx-sx, 18px), var(--plx-sy, -10px), 0)
              rotate(26deg);
          }
        }

        /* the snap-shut white line flash */
        .plx-anom-flash {
          animation: plx-anom-flash 45s linear infinite;
        }
        @keyframes plx-anom-flash {
          0%,
          94%,
          96.6%,
          100% {
            opacity: 0;
            transform: scaleY(0.35);
          }
          94.9% {
            opacity: 1;
            transform: scaleY(1);
          }
          95.8% {
            opacity: 0.2;
            transform: scaleY(1);
          }
        }
        /* …and its magenta afterimage, one dispersion beat behind the
           white line (retinal echo of an overexposed snap) */
        .plx-anom-flash-echo {
          animation: plx-anom-flash-echo 45s linear infinite;
        }
        @keyframes plx-anom-flash-echo {
          0%,
          94.6%,
          97.4%,
          100% {
            opacity: 0;
            transform: scaleY(0.3);
          }
          95.3% {
            opacity: 0.8;
            transform: scaleY(1);
          }
          96.4% {
            opacity: 0.12;
            transform: scaleY(1.02);
          }
        }

        /* hover dust: motes escaping ALONG the beams while the rift is
           held open (visibility is the hover burst gate's job) */
        .plx-anom-mote {
          animation-name: plx-anom-mote;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @keyframes plx-anom-mote {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(0.7);
          }
          12% {
            opacity: 0.9;
            transform: translate3d(calc(var(--plx-mx, 40px) * 0.12), calc(var(--plx-my, 0px) * 0.12), 0) scale(1);
          }
          70% {
            opacity: 0.5;
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--plx-mx, 40px), var(--plx-my, 0px), 0) scale(0.85);
          }
        }

        /* Ray burst gate — the single 45s visibility switch for everything
           light-emitting (fans, flare, ambient wash live inside it). Pops
           with the tear (79.2%), rakes the panel while open, dies with the
           snap. Children animate infinite wobble/flicker only, so hover can
           re-use them by lighting this one wrapper. */
        .plx-anom-burst {
          animation: plx-anom-burst 45s linear infinite;
        }
        @keyframes plx-anom-burst {
          0%,
          79% {
            opacity: 0;
            transform: scale(0.45);
          }
          79.8% {
            opacity: 0.95;
            transform: scale(1.14);
          }
          81% {
            opacity: 1;
            transform: scale(1);
          }
          88% {
            opacity: 0.78;
            transform: scale(0.98);
          }
          93.2% {
            opacity: 0.88;
            transform: scale(1.03);
          }
          94.4% {
            opacity: 0.25;
            transform: scale(0.7);
          }
          94.9%,
          100% {
            opacity: 0;
            transform: scale(0.45);
          }
        }

        /* the three light layers move against each other so the composite
           never repeats: blades rake + stretch, needles counter-rake +
           scintillate, the glow body (bloom column, ambient, anamorphic
           streak) only breathes — a lens artifact must not rotate */
        .plx-anom-rays-blades {
          animation: plx-anom-rake-a 11s ease-in-out infinite alternate;
        }
        @keyframes plx-anom-rake-a {
          0% {
            transform: rotate(-2.6deg) scale(1);
          }
          100% {
            transform: rotate(2.6deg) scale(1.05);
          }
        }
        .plx-anom-rays-needles {
          animation: plx-anom-rake-b 7.5s ease-in-out infinite alternate,
            plx-anom-ray-flicker 2.3s steps(1, end) infinite;
        }
        @keyframes plx-anom-rake-b {
          0% {
            transform: rotate(3.4deg);
          }
          100% {
            transform: rotate(-3.4deg);
          }
        }
        .plx-anom-rays-glow {
          animation: plx-anom-glow-breathe 5.5s ease-in-out infinite;
        }
        @keyframes plx-anom-glow-breathe {
          0%,
          100% {
            opacity: 0.8;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.04);
          }
        }
        /* stepped opacity = electric flicker, not a smooth pulse */
        @keyframes plx-anom-ray-flicker {
          0% {
            opacity: 0.85;
          }
          19% {
            opacity: 0.55;
          }
          31% {
            opacity: 0.95;
          }
          47% {
            opacity: 0.65;
          }
          58% {
            opacity: 1;
          }
          76% {
            opacity: 0.6;
          }
          88% {
            opacity: 0.9;
          }
          100% {
            opacity: 0.85;
          }
        }

        /* core flare breathing (visibility is the burst wrapper's job) */
        .plx-anom-flare-core {
          animation: plx-anom-flare-core 3.4s ease-in-out infinite;
        }
        @keyframes plx-anom-flare-core {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.92;
          }
          50% {
            transform: scale(1.18);
            opacity: 1;
          }
        }

        /* faint life crawling along the containment cracks at rest. Pulse +
           drift both live on the INNER light element (the wrapper above is
           a hover layer — transitions only, or the two would fight). */
        .plx-anom-vein-light {
          animation:
            plx-anom-vein-light 11s ease-in-out infinite alternate,
            plx-anom-veins 6.5s ease-in-out infinite;
        }
        @keyframes plx-anom-veins {
          0%,
          100% {
            opacity: 0.5;
          }
          50% {
            opacity: 0.95;
          }
        }
        @keyframes plx-anom-vein-light {
          0% {
            transform: translate3d(-16px, -9px, 0);
          }
          100% {
            transform: translate3d(16px, 9px, 0);
          }
        }

        /* ---- the crack CRACKS, on loop: a 12s propagation cycle (15:4
           against the 45s master so the phases drift). A pre-painted ring
           gradient scales out of the nucleus inside the crack mask — light
           racing along the arms — and as the front passes the etched arm
           tips, three extension arms jump outward in discrete increments
           (real fracture propagates in jumps, not tweens), hold etched,
           then fade back: the panel perpetually fails to finish cracking.

           The arm growth is a TRUE wipe, not a squish: an overflow-hidden
           wrapper scales up while the sprite inside counter-scales down,
           so already-etched elbows stay pinned and new segments appear at
           the tip. steps() can't drive this (its value jumps don't stay
           reciprocal across two elements), so both sides use manual
           staircases — paired stops 0.05% (6ms) apart read as instant. */
        .plx-anom-front {
          animation: plx-anom-front 12s linear infinite;
        }
        @keyframes plx-anom-front {
          0%,
          2% {
            transform: scale(0.08);
            opacity: 0;
          }
          4% {
            /* nucleus pop — the gradient's core reads as the flash */
            transform: scale(0.18);
            opacity: 0.95;
          }
          8% {
            opacity: 0.85;
          }
          13%,
          100% {
            transform: scale(2.05);
            opacity: 0;
          }
        }
        .plx-anom-armw {
          animation: plx-anom-armw 12s linear infinite;
        }
        @keyframes plx-anom-armw {
          0%,
          10.45% {
            transform: scaleX(0.34);
            opacity: 0;
          }
          10.5%,
          12.95% {
            transform: scaleX(0.34);
            opacity: 1;
          }
          13%,
          15.45% {
            transform: scaleX(0.67);
            opacity: 1;
          }
          15.5%,
          50% {
            transform: scaleX(1);
            opacity: 1;
          }
          62% {
            /* re-seal: fade while holding length — never retract visibly */
            transform: scaleX(1);
            opacity: 0;
          }
          62.05%,
          100% {
            transform: scaleX(0.34);
            opacity: 0;
          }
        }
        .plx-anom-armi {
          animation: plx-anom-armi 12s linear infinite;
        }
        @keyframes plx-anom-armi {
          0%,
          12.95% {
            transform: scaleX(2.941);
          }
          13%,
          15.45% {
            transform: scaleX(1.4925);
          }
          15.5%,
          62% {
            transform: scaleX(1);
          }
          62.05%,
          100% {
            transform: scaleX(2.941);
          }
        }
        /* 1-frame stress ticks on the propagation assembly, timed to the
           three arm jumps at 10.5 / 13 / 15.5% of the 12s clock */
        .plx-anom-crackjit {
          animation: plx-anom-crackjit 12s linear infinite;
        }
        @keyframes plx-anom-crackjit {
          0%,
          10.45% {
            transform: translate3d(0, 0, 0);
          }
          10.5%,
          10.8% {
            transform: translate3d(1px, -0.5px, 0);
          }
          10.85%,
          12.95% {
            transform: translate3d(0, 0, 0);
          }
          13%,
          13.3% {
            transform: translate3d(-1px, 0.5px, 0);
          }
          13.35%,
          15.45% {
            transform: translate3d(0, 0, 0);
          }
          15.5%,
          15.8% {
            transform: translate3d(0.6px, 1px, 0);
          }
          15.85%,
          100% {
            transform: translate3d(0, 0, 0);
          }
        }

        /* nebula aurora-drift: oversized pre-painted violet radials
           translating/scaling on very slow alternating loops */
        .plx-anom-nebula {
          animation: plx-anom-nebula 55s ease-in-out infinite alternate;
        }
        @keyframes plx-anom-nebula {
          from {
            transform: translate3d(0, 0, 0) scale(1);
          }
          to {
            transform: translate3d(-28px, 16px, 0) scale(1.14);
          }
        }

        /* moonlet orbit: a 12-point translate keyframe tracing the ring's
           -16° ellipse (rx32 ry9, precomputed — cheaper than nested
           rotator/counter-rotator wrappers), with an opacity dip at 75%
           where the path crosses the gas giant's disk on the far side —
           fake occlusion, the dot passes BEHIND the planet */
        .plx-anom-moonlet {
          animation: plx-anom-moonlet 18s linear infinite;
        }
        @keyframes plx-anom-moonlet {
          0% {
            transform: translate3d(30.8px, -8.8px, 0);
            opacity: 1;
          }
          8.33% {
            transform: translate3d(27.9px, -3.3px, 0);
          }
          16.67% {
            transform: translate3d(17.5px, 3.1px, 0);
          }
          25% {
            /* transit: crossing the disk face IN FRONT — stays lit */
            transform: translate3d(2.5px, 8.7px, 0);
          }
          33.33% {
            transform: translate3d(-13.2px, 11.9px, 0);
          }
          41.67% {
            transform: translate3d(-25.4px, 12px, 0);
          }
          50% {
            transform: translate3d(-30.8px, 8.8px, 0);
          }
          58.33% {
            transform: translate3d(-27.9px, 3.3px, 0);
          }
          66.67% {
            transform: translate3d(-17.5px, -3.1px, 0);
            opacity: 1;
          }
          71% {
            opacity: 0;
          }
          75% {
            transform: translate3d(-2.5px, -8.7px, 0);
          }
          79% {
            opacity: 0;
          }
          83.33% {
            transform: translate3d(13.2px, -11.9px, 0);
            opacity: 1;
          }
          91.67% {
            transform: translate3d(25.4px, -12px, 0);
          }
          100% {
            transform: translate3d(30.8px, -8.8px, 0);
            /* explicit: an implied 100% would sample the inline opacity: 0
               (the reduced-motion hidden state) and fade the lap tail out */
            opacity: 1;
          }
        }

        /* ring glint: a bright dash sweeping the lit lower-left front arc
           of the painted ring ellipse once per lap, dark the rest */
        .plx-anom-ringlint {
          animation: plx-anom-ringlint 9s linear infinite;
        }
        @keyframes plx-anom-ringlint {
          0%,
          30% {
            transform: translate3d(1.9px, 6.7px, 0) rotate(-20deg);
            opacity: 0;
          }
          36% {
            transform: translate3d(-6.5px, 8.6px, 0) rotate(-20deg);
            opacity: 0.95;
          }
          47% {
            transform: translate3d(-20.7px, 9.6px, 0) rotate(-14deg);
            opacity: 0.8;
          }
          53% {
            transform: translate3d(-25px, 7.2px, 0) rotate(-8deg);
            opacity: 0;
          }
          53.1%,
          100% {
            transform: translate3d(1.9px, 6.7px, 0) rotate(-20deg);
            opacity: 0;
          }
        }

        /* Reduced motion: every scene freezes to its resting state.
           Transient elements carry inline opacity: 0 so they vanish instead
           of parking mid-flight. */
        @media (prefers-reduced-motion: reduce) {
          [data-plate-fx] * {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  )
}

/** Future final-art pathway: animated WebP with the SafeBannerImg-style
 * degradation ladder (animated → static → nothing). The <picture> source
 * swaps in the static frame for prefers-reduced-motion users — the browser
 * then never even downloads the animated file. */
function PlateImage({ render }: { render: PlateImageRender }) {
  const [stage, setStage] = useState<'animated' | 'static' | 'dead'>('animated')

  useEffect(() => setStage('animated'), [render.animatedSrc])

  if (stage === 'dead') return null

  if (stage === 'static') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={render.staticSrc}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setStage('dead')}
      />
    )
  }

  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={render.staticSrc} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={render.animatedSrc}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setStage('static')}
      />
    </picture>
  )
}

// ---------------------------------------------------------------------------
// Animated scenes — one living moment per plate, layered over the painted
// base and concentrated on the right where the fade leaves the art at full
// strength. Live geometry: ~68px standings rows (py-4 + 36px avatars),
// 88/112px podium banners, and aspect-[4/1] previews that bottom out near
// ~58px in the edit-profile picker (the sm-width Pro-collection strip can
// dip to ~43px, but its three scenes all anchor center-or-edge and survive
// it). Fixed-px motifs seat off the bottom edge or the vertical center so
// shorter surfaces crop sky rather than subject. Negative animation
// delays de-sync loops so a full page of rows never pulses in unison.
// Elements whose keyframes own `transform` sit inside plain positioning
// wrappers so the animation never fights a centering translate.
// ---------------------------------------------------------------------------

/** Petal palettes — the flurry mixes petals let go from different
 * blossoms: pale near-white blush, the signature mid pink, and a
 * saturated deep pink. Each tone keeps its own front/back face pair so
 * the two-faced card-flip still flashes light/dark within one petal. */
type SakuraTone = 'pale' | 'mid' | 'deep'
const SAKURA_PETAL_FACES: Record<SakuraTone, { front: string; back: string }> = {
  pale: { front: SAKURA_PETAL_FRONT_PALE, back: SAKURA_PETAL_BACK_PALE },
  mid: { front: SAKURA_PETAL_FRONT, back: SAKURA_PETAL_BACK },
  deep: { front: SAKURA_PETAL_FRONT_DEEP, back: SAKURA_PETAL_BACK_DEEP }
}
const SAKURA_PETAL_FARS: Record<SakuraTone, string> = {
  pale: SAKURA_PETAL_FAR_PALE,
  mid: SAKURA_PETAL_FAR,
  deep: SAKURA_PETAL_FAR_DEEP
}

/** The cherry-blossom petal field: twelve petals at three depths, spawned
 * under the canopy (the branch art owns the top-right, so spawns cluster
 * right-of-center). n/m/f pick the fall choreography; `dur`/`delay`
 * stagger the wind phase, `tumble`/`dir` set the card-flip clock (coprime
 * with the fall so the flash never syncs with the sway); `tone` picks the
 * blossom palette — neighbors never share one. `park`/`parkFlip` are the
 * reduced-motion tableau — when the media query freezes the scene, inline
 * styles take over and every petal hangs mid-air mid-tumble. Near petals
 * are big and saturated, far petals small and slow with the blur baked
 * into their SVG. */
const SAKURA_PETALS: {
  depth: 'n' | 'm' | 'f'
  tone: SakuraTone
  right: string
  top: string
  size: number
  dur: string
  delay: string
  tumble: string
  dir: 'normal' | 'reverse'
  park: string
  parkFlip: string
}[] = [
  // near — the petals that brush past the viewer
  { depth: 'n', tone: 'mid', right: '9%', top: '-8%', size: 11, dur: '7.6s', delay: '-1.2s', tumble: '2.9s', dir: 'normal', park: 'translate3d(-24px, 38px, 0) rotate(96deg)', parkFlip: 'rotateX(30deg) rotateY(140deg)' },
  { depth: 'n', tone: 'pale', right: '22%', top: '4%', size: 10, dur: '8.4s', delay: '-5.8s', tumble: '3.4s', dir: 'reverse', park: 'translate3d(-14px, 52px, 0) rotate(-40deg)', parkFlip: 'rotateX(-24deg) rotateY(215deg)' },
  { depth: 'n', tone: 'deep', right: '36%', top: '-4%', size: 9.5, dur: '7.9s', delay: '-3.4s', tumble: '2.6s', dir: 'normal', park: 'translate3d(-32px, 26px, 0) rotate(160deg)', parkFlip: 'rotateX(44deg) rotateY(60deg)' },
  // mid — the body of the flurry
  { depth: 'm', tone: 'pale', right: '6%', top: '12%', size: 7.5, dur: '10.5s', delay: '-7.7s', tumble: '3.8s', dir: 'reverse', park: 'translate3d(-44px, 46px, 0) rotate(75deg)', parkFlip: 'rotateX(-36deg) rotateY(300deg)' },
  { depth: 'm', tone: 'deep', right: '14%', top: '-6%', size: 7, dur: '11.8s', delay: '-2.9s', tumble: '4.2s', dir: 'normal', park: 'translate3d(-20px, 60px, 0) rotate(-110deg)', parkFlip: 'rotateX(14deg) rotateY(105deg)' },
  { depth: 'm', tone: 'mid', right: '27%', top: '8%', size: 8, dur: '9.6s', delay: '-6.1s', tumble: '3.6s', dir: 'reverse', park: 'translate3d(-52px, 30px, 0) rotate(30deg)', parkFlip: 'rotateX(-44deg) rotateY(250deg)' },
  { depth: 'm', tone: 'deep', right: '40%', top: '-2%', size: 6.5, dur: '12.4s', delay: '-9.3s', tumble: '4.5s', dir: 'normal', park: 'translate3d(-36px, 54px, 0) rotate(-70deg)', parkFlip: 'rotateX(38deg) rotateY(175deg)' },
  { depth: 'm', tone: 'pale', right: '18%', top: '22%', size: 6.5, dur: '11.1s', delay: '-4.6s', tumble: '3.3s', dir: 'reverse', park: 'translate3d(-60px, 42px, 0) rotate(140deg)', parkFlip: 'rotateX(-18deg) rotateY(330deg)' },
  // far — haze drift, one blurred face each
  { depth: 'f', tone: 'pale', right: '12%', top: '2%', size: 4.5, dur: '15s', delay: '-9s', tumble: '0s', dir: 'normal', park: 'translate3d(-18px, 28px, 0) rotate(10deg)', parkFlip: '' },
  { depth: 'f', tone: 'deep', right: '24%', top: '14%', size: 4, dur: '17.5s', delay: '-13.2s', tumble: '0s', dir: 'normal', park: 'translate3d(-34px, 40px, 0) rotate(-14deg)', parkFlip: '' },
  { depth: 'f', tone: 'mid', right: '33%', top: '-8%', size: 5, dur: '14.2s', delay: '-5.5s', tumble: '0s', dir: 'normal', park: 'translate3d(-26px, 22px, 0) rotate(22deg)', parkFlip: '' },
  { depth: 'f', tone: 'pale', right: '44%', top: '6%', size: 4, dur: '18.6s', delay: '-16.8s', tumble: '0s', dir: 'normal', park: 'translate3d(-42px, 34px, 0) rotate(-8deg)', parkFlip: '' }
]

/** Ignition ejecta, fired from the nozzle exit plane. 1px slivers are the
 * igniter spray — white and pale-yellow burn hottest; the 2px droplets are
 * the old embers' heirs, their palette pushed past orange into pink and
 * violet so the debris field echoes the sheath's cooled fringe. sx/sy/sr
 * feed the shared plx-spark trajectory vars; staggered negative delays
 * keep the re-fires irregular. The blast retune steepened three
 * trajectories (sy -30/-36/+28) so the spray fans wide off the fireball
 * instead of streaming in the jet's narrow corridor. */
const IGN_SPARKS = [
  { w: 14, h: 1, top: -2, sx: -112, sy: -30, sr: -22, dur: '1.3s', delay: '-0.4s', tint: 'rgb(255 255 255 / 0.95)', glow: 'rgb(255 240 200 / 0.8)' },
  { w: 11, h: 1, top: 1, sx: -86, sy: 10, sr: 11, dur: '1.6s', delay: '-1.1s', tint: 'rgb(255 236 170 / 0.95)', glow: 'rgb(255 200 90 / 0.8)' },
  { w: 2, h: 2, top: -1, sx: -98, sy: -7, sr: 0, dur: '1.2s', delay: '-0.2s', tint: 'rgb(255 122 40 / 0.95)', glow: 'rgb(255 106 40 / 0.8)' },
  { w: 16, h: 1, top: 2, sx: -126, sy: -36, sr: -26, dur: '1.8s', delay: '-1.5s', tint: 'rgb(255 140 60 / 0.95)', glow: 'rgb(255 106 40 / 0.8)' },
  { w: 2, h: 2, top: 0, sx: -74, sy: 28, sr: 0, dur: '1.1s', delay: '-0.8s', tint: 'rgb(255 143 178 / 0.95)', glow: 'rgb(244 114 182 / 0.8)' },
  { w: 9, h: 1, top: -3, sx: -66, sy: -5, sr: -8, dur: '1.4s', delay: '-0.6s', tint: 'rgb(255 255 255 / 0.95)', glow: 'rgb(255 236 170 / 0.8)' },
  { w: 2, h: 2, top: 3, sx: -122, sy: 7, sr: 0, dur: '1.7s', delay: '-1.3s', tint: 'rgb(216 180 255 / 0.95)', glow: 'rgb(168 85 247 / 0.8)' }
]

/** Ignition fume bank — the thick static-test exhaust clouds. Each puff is
 * lit ember-orange on its flame-facing side, cooling to grey-violet
 * outside; right/top pin the spawn point along the plume's underbelly and
 * dx/dy/br feed plx-billow's tumble fan (up-left and down-left off the
 * fireball). Staggered negative delays keep the bank rolling instead of
 * pulsing. */
const IGN_BILLOWS = [
  { right: 30, top: 4, size: 24, dx: -44, dy: 26, br: 16, dur: '6.8s', delay: '-2.1s', bg: 'radial-gradient(52% 52% at 66% 58%, rgb(255 150 70 / 0.5), rgb(190 168 220 / 0.24) 55%, transparent 74%)' },
  { right: 58, top: -6, size: 30, dx: -58, dy: -30, br: -13, dur: '8.2s', delay: '-4.6s', bg: 'radial-gradient(52% 52% at 66% 58%, rgb(255 150 70 / 0.42), rgb(190 168 220 / 0.2) 55%, transparent 74%)' },
  { right: 84, top: 0, size: 34, dx: -70, dy: 18, br: 9, dur: '9.4s', delay: '-6.3s', bg: 'radial-gradient(52% 52% at 66% 58%, rgb(255 150 70 / 0.36), rgb(190 168 220 / 0.18) 55%, transparent 74%)' },
  { right: 14, top: -4, size: 20, dx: -36, dy: -22, br: -18, dur: '7.6s', delay: '-1.2s', bg: 'radial-gradient(52% 52% at 66% 58%, rgb(255 150 70 / 0.55), rgb(190 168 220 / 0.26) 55%, transparent 74%)' },
  { right: 104, top: -8, size: 26, dx: -62, dy: -36, br: -10, dur: '10s', delay: '-7.8s', bg: 'radial-gradient(52% 52% at 66% 58%, rgb(255 150 70 / 0.3), rgb(190 168 220 / 0.16) 55%, transparent 74%)' }
]

/** Blast-surge debris fan: spalled igniter spray streaking out of the bell
 * inside the 11s window only. ra aims each spoke off the plume axis
 * (negative climbs up-left); small width/stagger variance keeps the fan
 * ragged rather than a wheel. */
const IGN_BURST = [
  { ra: -38, w: 32, delay: '0.1s' },
  { ra: -24, w: 42, delay: '0s' },
  { ra: -11, w: 48, delay: '0.06s' },
  { ra: 4, w: 50, delay: '0s' },
  { ra: 17, w: 44, delay: '0.08s' },
  { ra: 31, w: 34, delay: '0.14s' }
]

const GLINTS = [
  { right: '9%', top: '18%', size: 6, delay: '-1s' },
  { right: '27%', top: '60%', size: 4, delay: '-2.6s' },
  { right: '44%', top: '28%', size: 5, delay: '-4.1s' }
]

const GOLD_MOTES = [
  { right: '14%', bottom: '18%', size: 2.5, dur: '6.5s', delay: '-1.5s' },
  { right: '30%', bottom: '10%', size: 2, dur: '8s', delay: '-4.2s' },
  { right: '46%', bottom: '24%', size: 1.5, dur: '7.2s', delay: '-6s' }
]

/** Koi Pond surface twinkles — sun catching micro-ripples over the open
 * water left of the pad raft (the reference paintings sprinkle these
 * everywhere; three is enough at plate scale). */
const KOIP_TWINKLES = [
  { right: 158, top: '16%', size: 5, dur: '5.2s', delay: '-1.1s' },
  { right: 224, top: '52%', size: 4.5, dur: '6.6s', delay: '-3.4s' }
]

/** Event Horizon spiral infall lanes. Each lane is one streak centered on
 * the hole (right 96px / 50%) whose keyframes interpolate rotate(from→to)
 * while translating inward — a tightening clockwise spiral, same rotation
 * sense as the disk's shear bands. Radii/angles picked so no two lanes
 * ever read as a repeat; negative delays de-sync the plunges. */
const INFALL_LANES = [
  { from: -34, to: 78, radius: -126, dur: '11s', delay: '-3.2s' },
  { from: 141, to: 262, radius: -132, dur: '14s', delay: '-9.5s' },
  { from: 63, to: 178, radius: -112, dur: '9.2s', delay: '-5.4s' }
]

/** Prime Anomaly shards — fragments that drift out while the tear is open,
 * on the same 45s master clock (delay de-syncs them slightly). */
const ANOM_SHARDS = [
  {
    left: 'calc(64% + 6px)',
    top: '26%',
    size: 3.5,
    sx: '22px',
    sy: '-12px',
    delay: '0s',
    tint: 'rgb(216 250 255 / 0.95)',
    glow: 'rgb(125 244 255 / 0.8)'
  },
  {
    left: 'calc(64% - 9px)',
    top: '52%',
    size: 2.5,
    sx: '-18px',
    sy: '-7px',
    delay: '-0.4s',
    tint: 'rgb(207 200 255 / 0.95)',
    glow: 'rgb(139 124 255 / 0.8)'
  },
  {
    left: 'calc(64% + 2px)',
    top: '68%',
    size: 3,
    sx: '14px',
    sy: '11px',
    delay: '-0.8s',
    tint: 'rgb(216 250 255 / 0.95)',
    glow: 'rgb(125 244 255 / 0.8)'
  }
]

/** Hover dust — motes that ride the light shafts while the rift is held
 * open. They live inside the hover burst gate (invisible at rest, zero
 * extra cost), and their drift is horizontal-biased: dust escapes ALONG
 * the beams, not up out of them. Offsets are relative to the 640×440
 * burst box whose center is the rift mouth. */
const ANOM_MOTES = [
  { left: 'calc(50% + 10px)', top: '44%', size: 2.5, dx: '58px', dy: '-14px', dur: '4.6s', delay: '0s' },
  { left: 'calc(50% - 6px)', top: '56%', size: 2, dx: '-44px', dy: '10px', dur: '5.8s', delay: '-2.1s' },
  { left: 'calc(50% + 4px)', top: '50%', size: 1.8, dx: '66px', dy: '12px', dur: '5.2s', delay: '-3.4s' },
  { left: 'calc(50% - 2px)', top: '40%', size: 2.2, dx: '-36px', dy: '-18px', dur: '6.4s', delay: '-1.2s' }
]

/** Rift silhouette for the Prime Anomaly — a mask, so black = the window
 * of light. Drawn in the same polyline voice as the etched ANOMALY_CRACKS
 * arms (short elbowed segments, thorny side spurs where the filament arms
 * root), tapering to needle points before the strip edges so it reads as
 * a finite fracture, not a full-height column. Much thinner at the waist
 * than the old faceted sliver. Left edge stays left of the right edge at
 * every depth or the path self-intersects. Scaled horizontally by the
 * tear wrapper; never an animated clip-path. */
const ANOM_TEAR_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 120' preserveAspectRatio='none'>" +
    "<path d='M24 4L26 12L23 20L28 30L25 38L31 46L41 49L29 53L31 60L28 67L37 74L27 79L29 88L24 96L26 104L22 116L20 106L17 97L19 88L14 80L18 72L12 63L17 57L15 49L19 42L16 33L20 25L18 15Z' fill='#000'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** The rift's torn edge, painted on the same silhouette path: a wide hot
 * white stroke UNDER a razor dark stroke. The mask clips both to their
 * inner halves, so from the boundary inward the sandwich reads: dark lip
 * (the panel's torn thickness — the 3D cross-section) → white-hot line
 * (light wrapping the lip) → the light volume. */
const ANOM_TEAR_EDGE = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 120' preserveAspectRatio='none'>" +
    "<path d='M24 4L26 12L23 20L28 30L25 38L31 46L41 49L29 53L31 60L28 67L37 74L27 79L29 88L24 96L26 104L22 116L20 106L17 97L19 88L14 80L18 72L12 63L17 57L15 49L19 42L16 33L20 25L18 15Z' fill='none' stroke='#f6feff' stroke-opacity='.9' stroke-width='3.2' stroke-linejoin='round'/>" +
    "<path d='M24 4L26 12L23 20L28 30L25 38L31 46L41 49L29 53L31 60L28 67L37 74L27 79L29 88L24 96L26 104L22 116L20 106L17 97L19 88L14 80L18 72L12 63L17 57L15 49L19 42L16 33L20 25L18 15Z' fill='none' stroke='#07031c' stroke-opacity='.85' stroke-width='1.4' stroke-linejoin='round'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Chromatic aberration for the torn edge — the same silhouette stroked
 * cyan shifted LEFT and magenta shifted RIGHT, blurred a hair. Painted
 * OVER the masked light (not clipped), so the visible halves are the
 * outer fringes: dispersion hugging every jag of the silhouette instead
 * of floating as straight lines beside it. The only pink in the scene. */
const ANOM_TEAR_FRINGE = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 120' preserveAspectRatio='none'>" +
    "<defs><filter id='f' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='.5'/></filter></defs>" +
    "<g filter='url(#f)' fill='none' stroke-linejoin='round'>" +
    "<path d='M24 4L26 12L23 20L28 30L25 38L31 46L41 49L29 53L31 60L28 67L37 74L27 79L29 88L24 96L26 104L22 116L20 106L17 97L19 88L14 80L18 72L12 63L17 57L15 49L19 42L16 33L20 25L18 15Z' stroke='#7df4ff' stroke-opacity='.5' stroke-width='1.3' transform='translate(-1.4 0)'/>" +
    "<path d='M24 4L26 12L23 20L28 30L25 38L31 46L41 49L29 53L31 60L28 67L37 74L27 79L29 88L24 96L26 104L22 116L20 106L17 97L19 88L14 80L18 72L12 63L17 57L15 49L19 42L16 33L20 25L18 15Z' stroke='#ff4fd8' stroke-opacity='.36' stroke-width='1.1' transform='translate(1.5 0)'/>" +
    '</g>' +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Prime Anomaly ray system — light escaping a tall thin rift, in three
 * pre-painted 640×440 tiles (origin 320,220 = the rift mouth) that
 * animate independently so the composite never repeats. Slit light is
 * ANISOTROPIC: every shaft lives within ~±45° of horizontal
 * (perpendicular to the vertical rift), nothing travels along the slit
 * axis, the east fan is long and bright while the west fan stays short
 * and dim (name-zone discipline). Blades are blurred volumetric wedges,
 * each with its own falloff gradient (userSpaceOnUse gradients rotate
 * with their polygon, so falloff always runs along the shaft). */
const ANOM_RAYS_BLADES = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 440'>" +
    '<defs>' +
    "<linearGradient id='bw' gradientUnits='userSpaceOnUse' x1='320' y1='220' x2='640' y2='220'>" +
    "<stop offset='0' stop-color='#ffffff' stop-opacity='.9'/><stop offset='.35' stop-color='#eafcff' stop-opacity='.5'/><stop offset='1' stop-color='#9bd8ff' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<linearGradient id='bc' gradientUnits='userSpaceOnUse' x1='320' y1='220' x2='640' y2='220'>" +
    "<stop offset='0' stop-color='#dffbff' stop-opacity='.85'/><stop offset='.4' stop-color='#7df4ff' stop-opacity='.45'/><stop offset='1' stop-color='#22d3ee' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<linearGradient id='bv' gradientUnits='userSpaceOnUse' x1='320' y1='220' x2='640' y2='220'>" +
    "<stop offset='0' stop-color='#cfc8ff' stop-opacity='.75'/><stop offset='.42' stop-color='#8b7cff' stop-opacity='.4'/><stop offset='1' stop-color='#4c38c8' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<filter id='bb' x='-15%' y='-15%' width='130%' height='130%'><feGaussianBlur stdDeviation='6'/></filter>" +
    '</defs>' +
    "<g filter='url(#bb)'>" +
    "<polygon points='331,216 630,194 630,246 331,224' fill='url(#bw)' fill-opacity='.6' transform='rotate(3 320 220)'/>" +
    "<polygon points='331,216 612,182 612,258 331,224' fill='url(#bc)' fill-opacity='.5' transform='rotate(-8 320 220)'/>" +
    "<polygon points='331,216 590,186 590,254 331,224' fill='url(#bc)' fill-opacity='.45' transform='rotate(14 320 220)'/>" +
    "<polygon points='331,216 544,174 544,266 331,224' fill='url(#bv)' fill-opacity='.42' transform='rotate(-25 320 220)'/>" +
    "<polygon points='331,216 556,170 556,270 331,224' fill='url(#bv)' fill-opacity='.38' transform='rotate(30 320 220)'/>" +
    "<polygon points='331,216 474,180 474,260 331,224' fill='url(#bc)' fill-opacity='.28' transform='rotate(-40 320 220)'/>" +
    "<polygon points='331,216 466,176 466,264 331,224' fill='url(#bv)' fill-opacity='.25' transform='rotate(43 320 220)'/>" +
    "<polygon points='331,216 468,186 468,254 331,224' fill='url(#bv)' fill-opacity='.3' transform='rotate(174 320 220)'/>" +
    "<polygon points='331,216 448,190 448,250 331,224' fill='url(#bc)' fill-opacity='.26' transform='rotate(188 320 220)'/>" +
    "<polygon points='331,216 428,184 428,256 331,224' fill='url(#bw)' fill-opacity='.18' transform='rotate(159 320 220)'/>" +
    '</g>' +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Sharp scintillating streaks over the blades — same anisotropy, plus a
 * razor magenta dispersion pair near horizontal (the only place pink is
 * allowed to live: chromatic aberration, never fill). */
const ANOM_RAYS_NEEDLES = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 440'>" +
    '<defs>' +
    "<linearGradient id='nw' gradientUnits='userSpaceOnUse' x1='320' y1='220' x2='640' y2='220'>" +
    "<stop offset='0' stop-color='#ffffff' stop-opacity='.95'/><stop offset='.3' stop-color='#eafcff' stop-opacity='.55'/><stop offset='1' stop-color='#9bd8ff' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<linearGradient id='nc' gradientUnits='userSpaceOnUse' x1='320' y1='220' x2='640' y2='220'>" +
    "<stop offset='0' stop-color='#eafcff' stop-opacity='.9'/><stop offset='.35' stop-color='#7df4ff' stop-opacity='.5'/><stop offset='1' stop-color='#22d3ee' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<linearGradient id='nv' gradientUnits='userSpaceOnUse' x1='320' y1='220' x2='640' y2='220'>" +
    "<stop offset='0' stop-color='#cfc8ff' stop-opacity='.8'/><stop offset='.4' stop-color='#8b7cff' stop-opacity='.42'/><stop offset='1' stop-color='#5b48d8' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<linearGradient id='nm' gradientUnits='userSpaceOnUse' x1='320' y1='220' x2='640' y2='220'>" +
    "<stop offset='0' stop-color='#ffd1f4' stop-opacity='.55'/><stop offset='.5' stop-color='#ff4fd8' stop-opacity='.3'/><stop offset='1' stop-color='#ff4fd8' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<filter id='nb' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='1.1'/></filter>" +
    '</defs>' +
    "<g filter='url(#nb)'>" +
    "<polygon points='332,218.7 634,220 332,221.3' fill='url(#nw)' fill-opacity='.6' transform='rotate(-3 320 220)'/>" +
    "<polygon points='332,218.8 604,220 332,221.2' fill='url(#nc)' fill-opacity='.55' transform='rotate(8 320 220)'/>" +
    "<polygon points='332,218.6 566,220 332,221.4' fill='url(#nc)' fill-opacity='.45' transform='rotate(-15 320 220)'/>" +
    "<polygon points='332,218.8 578,220 332,221.2' fill='url(#nw)' fill-opacity='.42' transform='rotate(20 320 220)'/>" +
    "<polygon points='332,218.5 500,220 332,221.5' fill='url(#nv)' fill-opacity='.35' transform='rotate(-33 320 220)'/>" +
    "<polygon points='332,218.6 512,220 332,221.4' fill='url(#nv)' fill-opacity='.3' transform='rotate(38 320 220)'/>" +
    "<polygon points='332,218.8 436,220 332,221.2' fill='url(#nc)' fill-opacity='.22' transform='rotate(-48 320 220)'/>" +
    "<polygon points='332,218.7 428,220 332,221.3' fill='url(#nv)' fill-opacity='.2' transform='rotate(52 320 220)'/>" +
    "<polygon points='332,219.2 588,220 332,220.8' fill='url(#nm)' fill-opacity='.4' transform='rotate(-1.5 320 220)'/>" +
    "<polygon points='332,219.2 548,220 332,220.8' fill='url(#nm)' fill-opacity='.32' transform='rotate(5.5 320 220)'/>" +
    "<polygon points='332,218.9 500,220 332,221.1' fill='url(#nc)' fill-opacity='.3' transform='rotate(176 320 220)'/>" +
    "<polygon points='332,219 472,220 332,221' fill='url(#nv)' fill-opacity='.26' transform='rotate(184 320 220)'/>" +
    "<polygon points='332,219 448,220 332,221' fill='url(#nw)' fill-opacity='.2' transform='rotate(167 320 220)'/>" +
    '</g>' +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** The non-rotating light body: a wide ambient ellipse, the vertical
 * bloom column hugging the seam, a faint blurred spoke structure, and the
 * anamorphic horizontal streak (a lens artifact — it must NOT rake with
 * the fans, so it lives here and only breathes). */
const ANOM_RAYS_GLOW = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 440'>" +
    '<defs>' +
    "<radialGradient id='gw'>" +
    "<stop offset='0' stop-color='#eafcff' stop-opacity='.32'/><stop offset='.35' stop-color='#7df4ff' stop-opacity='.14'/><stop offset='.65' stop-color='#6d5bff' stop-opacity='.07'/><stop offset='1' stop-color='#6d5bff' stop-opacity='0'/>" +
    '</radialGradient>' +
    "<radialGradient id='gc'>" +
    "<stop offset='0' stop-color='#eafcff' stop-opacity='.5'/><stop offset='.5' stop-color='#7df4ff' stop-opacity='.22'/><stop offset='1' stop-color='#7df4ff' stop-opacity='0'/>" +
    '</radialGradient>' +
    "<linearGradient id='ga' gradientUnits='userSpaceOnUse' x1='40' y1='220' x2='636' y2='220'>" +
    "<stop offset='0' stop-color='#bff4ff' stop-opacity='0'/><stop offset='.38' stop-color='#bff4ff' stop-opacity='.5'/><stop offset='.5' stop-color='#ffffff' stop-opacity='.95'/><stop offset='.62' stop-color='#bff4ff' stop-opacity='.5'/><stop offset='1' stop-color='#bff4ff' stop-opacity='0'/>" +
    '</linearGradient>' +
    "<filter id='gb' x='-15%' y='-15%' width='130%' height='130%'><feGaussianBlur stdDeviation='8'/></filter>" +
    "<filter id='ab' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='1.4'/></filter>" +
    '</defs>' +
    "<ellipse cx='320' cy='220' rx='310' ry='170' fill='url(#gw)'/>" +
    "<ellipse cx='320' cy='220' rx='24' ry='218' fill='url(#gc)'/>" +
    "<g filter='url(#gb)' fill='#7df4ff'>" +
    "<polygon points='330,214 520,168 520,272 330,226' fill-opacity='.07' transform='rotate(-18 320 220)'/>" +
    "<polygon points='330,214 540,172 540,268 330,226' fill-opacity='.08' transform='rotate(9 320 220)'/>" +
    "<polygon points='330,214 500,164 500,276 330,226' fill-opacity='.06' transform='rotate(26 320 220)'/>" +
    "<polygon points='330,214 480,170 480,270 330,226' fill-opacity='.05' transform='rotate(-32 320 220)'/>" +
    "<polygon points='330,214 460,166 460,274 330,226' fill-opacity='.05' transform='rotate(40 320 220)'/>" +
    "<polygon points='330,214 470,176 470,264 330,226' fill-opacity='.05' transform='rotate(171 320 220)'/>" +
    "<polygon points='330,214 450,172 450,268 330,226' fill-opacity='.04' transform='rotate(190 320 220)'/>" +
    '</g>' +
    "<g filter='url(#ab)'>" +
    "<polygon points='40,220 320,212.5 636,220 320,227.5' fill='url(#ga)'/>" +
    "<polygon points='150,220 320,216.5 610,220 320,223.5' fill='url(#ga)' fill-opacity='.8'/>" +
    '</g>' +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Prime Anomaly fracture extensions — fresh crack arms that jump outward
 * from the tips of the etched ANOMALY_CRACKS arms during each propagation
 * surge. Painted in the exact stroke voice of the base tile (cyan arm /
 * bright nucleus-side segment / dim violet stray) so grown state reads as
 * one continuous fracture. Each sprite's origin (0, start-y) sits exactly
 * on a base-art arm tip; scaleX growth from that origin etches outward. */
const ANOM_ARM_A = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 14'>" +
    "<path d='M0 7L13 5L17 7L29 3L33 5L47 2' stroke='#7df4ff' stroke-opacity='.36' stroke-width='1' fill='none'/>" +
    "<path d='M0 7L13 5' stroke='#eafcff' stroke-opacity='.55' stroke-width='1.1' fill='none'/>" +
    "<path d='M17 7L23 11' stroke='#a99cff' stroke-opacity='.22' stroke-width='.8' fill='none'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

const ANOM_ARM_B = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 20'>" +
    "<path d='M0 18L11 13L14 14L25 6L29 7L39 1' stroke='#7df4ff' stroke-opacity='.3' stroke-width='1' fill='none'/>" +
    "<path d='M0 18L11 13' stroke='#eafcff' stroke-opacity='.5' stroke-width='1.1' fill='none'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

const ANOM_ARM_C = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 42 21'>" +
    "<path d='M0 2L11 8L14 7L26 14L29 13L41 19' stroke='#7df4ff' stroke-opacity='.28' stroke-width='1' fill='none'/>" +
    "<path d='M0 2L11 8' stroke='#eafcff' stroke-opacity='.48' stroke-width='1.1' fill='none'/>" +
    "<path d='M14 7L19 3' stroke='#a99cff' stroke-opacity='.2' stroke-width='.8' fill='none'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

// ---- Koi Pond scenery -------------------------------------------------
// Pads and the lotus are pre-painted data-URI documents (own <defs>, no
// gradient-id collisions across plate instances); only their bob wrappers
// animate. The koi and the dragonfly are inline SVG because their parts
// (tail, fins, wings) carry CSS animations that must reach real elements.

/** Big lily pad, notch opening east. The shadow is the SAME slit-cut disc
 * path nudged down-left (away from the top-right sun) — never a full
 * ellipse, which would fill the notch with a flat wedge; through the slit
 * the real water gradient must show. Pale arc on the sun side is rim
 * light; those two are what seat a pad IN water instead of over it. */
const KOIP_PAD_BIG = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 42'>" +
    "<defs><radialGradient id='g' cx='.4' cy='.32' r='.78'>" +
    "<stop offset='0' stop-color='#4a9a5e'/><stop offset='.5' stop-color='#256e46'/><stop offset='1' stop-color='#0d4531'/>" +
    '</radialGradient></defs>' +
    "<path d='M21 20 L39.4 14.2 A18.4 18.4 0 1 0 39.7 24.6 Z' fill='#02181e' fill-opacity='.5' transform='translate(-1.5 1.9)'/>" +
    "<path d='M21 20 L39.4 14.2 A18.4 18.4 0 1 0 39.7 24.6 Z' fill='url(#g)'/>" +
    "<g stroke='#8fe0a4' stroke-opacity='.3' stroke-width='.7' fill='none'>" +
    "<path d='M21 20L10.5 6.8M21 20L4.6 14.6M21 20L5.6 27.8M21 20L13.6 36M21 20L26.8 37M21 20L35 32'/>" +
    '</g>' +
    "<path d='M33.6 8.2 A18 18 0 0 0 14.6 3.1' stroke='#c8ffd8' stroke-opacity='.55' stroke-width='1.1' fill='none'/>" +
    "<path d='M39 15.4 A19.6 19.6 0 0 1 39.7 23.9' stroke='#052a2c' stroke-opacity='.45' stroke-width='.9' fill='none'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Mid pad, cooler green (deeper leaf, less sun). Its notch opens north,
 * INTO the raft where the lotus hides it — an exposed notch on a mostly
 * hidden disc silhouettes as an arrow, which is exactly what pass 7's
 * zoom caught. Only the smooth south arc stays visible. */
const KOIP_PAD_MID = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 30'>" +
    "<defs><radialGradient id='g' cx='.42' cy='.36' r='.75'>" +
    "<stop offset='0' stop-color='#357a52'/><stop offset='.55' stop-color='#1c5c40'/><stop offset='1' stop-color='#0a3a2c'/>" +
    '</radialGradient></defs>' +
    "<path d='M15.8 14.8 L11.4 2.5 A13.2 13.2 0 1 0 19.4 2.4 Z' fill='#02181e' fill-opacity='.45' transform='translate(-1.2 1.6)'/>" +
    "<path d='M15.8 14.8 L11.4 2.5 A13.2 13.2 0 1 0 19.4 2.4 Z' fill='url(#g)'/>" +
    "<g stroke='#84d49a' stroke-opacity='.26' stroke-width='.6' fill='none'>" +
    "<path d='M15.8 14.8L27.6 9.4M15.8 14.8L28.4 17.8M15.8 14.8L23 25.6M15.8 14.8L8.6 25.2M15.8 14.8L3.6 17.6'/>" +
    '</g>' +
    "<path d='M28.2 12.4 A13 13 0 0 1 26.4 22.6' stroke='#c8ffd8' stroke-opacity='.4' stroke-width='.9' fill='none'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Small pad peeking from under the big one — same green family with a
 * reddish-bronze rim tint (the young-leaf accent in the references lives
 * in the RIM, not the blade). Notch opens west, away from the raft. */
const KOIP_PAD_SMALL = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 22'>" +
    "<defs><radialGradient id='g' cx='.44' cy='.36' r='.8'>" +
    "<stop offset='0' stop-color='#43905c'/><stop offset='.55' stop-color='#256648'/><stop offset='1' stop-color='#0e4634'/>" +
    '</radialGradient></defs>' +
    "<path d='M11.8 10.8 L2.6 7.2 A9.8 9.2 0 1 0 2.4 13.4 Z' fill='#02181e' fill-opacity='.42' transform='translate(-1 1.4)'/>" +
    "<path d='M11.8 10.8 L2.6 7.2 A9.8 9.2 0 1 0 2.4 13.4 Z' fill='url(#g)'/>" +
    "<g stroke='#8fe0a4' stroke-opacity='.24' stroke-width='.5' fill='none'>" +
    "<path d='M11.8 10.8L15 2.6M11.8 10.8L19.8 6.2M11.8 10.8L20.6 13.8M11.8 10.8L14.6 19'/>" +
    '</g>' +
    "<path d='M3.4 15.6 A9.4 8.8 0 0 0 15.2 19' stroke='#a86a38' stroke-opacity='.55' stroke-width='1' fill='none'/>" +
    "<path d='M16.6 2.9 A9.4 8.8 0 0 1 21 9.2' stroke='#d8ffe4' stroke-opacity='.5' stroke-width='.9' fill='none'/>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Open lotus, top-down: dark under-ring petals, a bright mid ring, a
 * small cupped crown, gold stamen disc. Petal tips carry the deep-rose
 * edge the flat-illustration reference uses. The two soft ellipses under
 * it are its contact shadow on the pad it sits on. */
const KOIP_LOTUS = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 36'>" +
    "<ellipse cx='19' cy='19.6' rx='13.6' ry='11.8' fill='#04241e' fill-opacity='.18'/>" +
    "<ellipse cx='18.6' cy='19.9' rx='11' ry='9.4' fill='#04241e' fill-opacity='.24'/>" +
    '<defs>' +
    "<linearGradient id='p' x1='0' y1='1' x2='0' y2='0'>" +
    "<stop offset='0' stop-color='#ff9ec4'/><stop offset='.72' stop-color='#f0679f'/><stop offset='1' stop-color='#d84884'/>" +
    '</linearGradient>' +
    "<linearGradient id='q' x1='0' y1='1' x2='0' y2='0'>" +
    "<stop offset='0' stop-color='#ffc4d9'/><stop offset='1' stop-color='#ff8ab6'/>" +
    '</linearGradient>' +
    '</defs>' +
    // under ring — 8 petals, deep rose, the shaded layer
    "<g fill='#c4356e'>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(22 20 18)'/>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(67 20 18)'/>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(112 20 18)'/>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(157 20 18)'/>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(202 20 18)'/>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(247 20 18)'/>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(292 20 18)'/>" +
    "<path d='M20 18 C17.2 14.6 16.8 9.4 20 5.6 C23.2 9.4 22.8 14.6 20 18Z' transform='rotate(337 20 18)'/>" +
    '</g>' +
    // main ring — 6 petals
    "<g fill='url(#p)'>" +
    "<path d='M20 18 C16.6 14 16.2 8 20 3.6 C23.8 8 23.4 14 20 18Z'/>" +
    "<path d='M20 18 C16.6 14 16.2 8 20 3.6 C23.8 8 23.4 14 20 18Z' transform='rotate(60 20 18)'/>" +
    "<path d='M20 18 C16.6 14 16.2 8 20 3.6 C23.8 8 23.4 14 20 18Z' transform='rotate(120 20 18)'/>" +
    "<path d='M20 18 C16.6 14 16.2 8 20 3.6 C23.8 8 23.4 14 20 18Z' transform='rotate(180 20 18)'/>" +
    "<path d='M20 18 C16.6 14 16.2 8 20 3.6 C23.8 8 23.4 14 20 18Z' transform='rotate(240 20 18)'/>" +
    "<path d='M20 18 C16.6 14 16.2 8 20 3.6 C23.8 8 23.4 14 20 18Z' transform='rotate(300 20 18)'/>" +
    '</g>' +
    // crown — 4 short cupped petals
    "<g fill='url(#q)'>" +
    "<path d='M20 18 C17.8 15.6 17.6 12 20 9.4 C22.4 12 22.2 15.6 20 18Z' transform='rotate(30 20 18)'/>" +
    "<path d='M20 18 C17.8 15.6 17.6 12 20 9.4 C22.4 12 22.2 15.6 20 18Z' transform='rotate(120 20 18)'/>" +
    "<path d='M20 18 C17.8 15.6 17.6 12 20 9.4 C22.4 12 22.2 15.6 20 18Z' transform='rotate(210 20 18)'/>" +
    "<path d='M20 18 C17.8 15.6 17.6 12 20 9.4 C22.4 12 22.2 15.6 20 18Z' transform='rotate(300 20 18)'/>" +
    '</g>' +
    "<circle cx='20' cy='18' r='2.7' fill='#ffd644'/>" +
    "<g fill='#e8a428'><circle cx='20' cy='14.9' r='.7'/><circle cx='22.8' cy='16.5' r='.7'/><circle cx='22.8' cy='19.5' r='.7'/><circle cx='20' cy='21.1' r='.7'/><circle cx='17.2' cy='19.5' r='.7'/><circle cx='17.2' cy='16.5' r='.7'/></g>" +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Fallen lotus bud floating beside the raft, the way the flat-painting
 * reference lays one: stem lying diagonally ON the surface, bud head
 * pointing up-left. Only the head gets a water shadow (offset down-left
 * like the pads' meniscus); a floating stem casts nothing readable. */
const KOIP_BUD = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 26 16'>" +
    "<ellipse cx='7.2' cy='10.6' rx='5' ry='1.7' fill='#02181e' fill-opacity='.35'/>" +
    "<path d='M9.4 8.2 C13.5 10.2 18.5 11.6 24.2 12.4' stroke='#47764c' stroke-width='1' fill='none' stroke-linecap='round'/>" +
    "<g transform='rotate(-38 8.6 8.4)'>" +
    "<path d='M8.4 0.8 C10.7 3.4 11.4 7 8.7 10.6 C6 7 6.3 3.4 8.4 0.8Z' fill='#f9b7ce'/>" +
    "<path d='M8.4 0.8 C6.8 4 6.6 7.2 8.7 10.6 C6.6 8.6 5.4 5 6.8 2.2Z' fill='#e0709f'/>" +
    "<path d='M8.4 0.8 C10.1 4 10.4 7.2 8.7 10.6 C10.7 8.6 11.9 5 10.4 2.2Z' fill='#ee88b2'/>" +
    "<path d='M8.4 0.8 C8.9 3.8 9 7 8.7 10.6 C8.2 7 8.1 3.6 8.4 0.8Z' fill='#ff9ec4'/>" +
    "<path d='M6.2 7 C6.9 8.9 7.7 10 8.7 10.7 C7.3 11 6 10.1 5.4 8.5Z' fill='#568c58'/>" +
    "<path d='M11.1 7.2 C10.4 9 9.7 10 8.7 10.7 C10.1 11 11.4 10.1 12 8.6Z' fill='#4a7c50'/>" +
    '</g>' +
    '</svg>'
).replace(/%20/g, ' ')}")`

/** Koi geometry — drawn head-left in a 52×24 box; travel direction is a
 * static scaleX flip on a wrapper. The paths are shared by all three
 * variants; color and patchwork arrive as props. */
const KOIF_BODY =
  'M2.2 12 C2.6 9.4 5.4 7.3 9.2 6.9 C15.5 6.1 24.5 7.7 30.8 9.6 C33.4 10.4 35.2 11.2 35.8 12 C35.2 12.8 33.4 13.6 30.8 14.4 C24.5 16.3 15.5 17.9 9.2 17.1 C5.4 16.7 2.6 14.6 2.2 12 Z'
/** Root starts at x=33 with real thickness so the fin tucks UNDER the
 * body tip (drawn first, body over it) — no pinch at the peduncle. */
const KOIF_TAIL =
  'M33 11.2 C36.8 9.2 41 6.6 48.8 4.6 C46.9 7.5 46.1 9.9 46.3 12 C46.1 14.1 46.9 16.5 48.8 19.4 C41 17.4 36.8 14.8 33 12.8 Z'
const KOIF_PECT_TOP = 'M13.5 7.7 C16 4.8 19.6 3.4 23.2 3.9 C21.1 6.3 18.4 7.9 15.1 8.7 Z'
const KOIF_PECT_BOT = 'M13.5 16.3 C16 19.2 19.6 20.6 23.2 20.1 C21.1 17.7 18.4 16.1 15.1 15.3 Z'

interface KoiPatch {
  d: string
  fill: string
  opacity?: number
}

/** Kohaku patchwork — vermillion saddles that wrap the back edge-to-edge
 * (drawn wider than the body and clipped to it, like real koi markings). */
const KOHAKU_PATCHES: KoiPatch[] = [
  { d: 'M5.8 5.4 C10.4 4.6 14.2 6.4 15 9.6 C15.6 12.2 13 14 9.8 13.4 C6.4 12.8 4.8 8.8 5.8 5.4 Z', fill: 'rgb(244 84 38)' },
  { d: 'M18.4 6.2 C23.2 5.4 27.6 8 28.6 11.4 C29.6 14.6 26.4 17.2 22.4 16.4 C18.6 15.6 16.6 12.2 17.6 8.8 Z', fill: 'rgb(255 96 48)' },
  { d: 'M30.4 9.2 C32.8 8.6 35 9.9 35.8 12 C35 14.1 32.8 15.4 30.6 14.6 C29.2 14 29.2 10.6 30.4 9.2 Z', fill: 'rgb(238 76 32)' }
]

/** Ogon "patchwork" — a metallic dorsal sheen streak, not a marking. */
const OGON_PATCHES: KoiPatch[] = [
  { d: 'M6 10.2 C14 8.6 24 8.8 33 10.8 C24 12.4 14 12.6 6 12.8 Z', fill: 'rgb(255 246 200)', opacity: 0.9 }
]

/** Ghost koi — one dusk shadow-patch, barely against the pale body. */
const GHOST_PATCHES: KoiPatch[] = [
  { d: 'M16 7 C21 6.2 26 8.4 27.4 11.4 C28.2 14 25 16.2 21 15.4 C17.2 14.6 15.2 10.4 16 7 Z', fill: 'rgb(56 96 102)', opacity: 0.55 }
]

/** Articulated top-down koi. The caudal fin wags at the peduncle, the
 * body counter-sways around its center of mass, pectorals scull in
 * counter-phase — the wag/sway phase offset is what reads as swimming
 * instead of sliding. `wiggleDelay` de-syncs the articulation clocks per
 * fish so the school never rows in unison. */
function KoiFish({
  w,
  bodyFrom,
  bodyTo,
  fin,
  spine,
  patches,
  flip = false,
  simple = false,
  wiggleDelay = 0,
  blur
}: {
  /** Rendered width in px (52-unit viewBox scales to it). */
  w: number
  bodyFrom: string
  bodyTo: string
  /** Translucent fin/tail tint. */
  fin: string
  /** Spine highlight + fin-ray stroke. */
  spine: string
  patches: KoiPatch[]
  /** true = head faces right. */
  flip?: boolean
  /** Deep background fish: skip pectorals, sway and tail wag (compositor
   * budget — at 0.8px blur and 26px the wag is invisible anyway). */
  simple?: boolean
  wiggleDelay?: number
  blur?: number
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const gradId = `koipg${uid}`
  const clipId = `koipc${uid}`
  const delay = (offset = 0) => ({ animationDelay: `${wiggleDelay + offset}s` })

  const bodyGroup = (
    <>
      <path
        className={simple ? undefined : 'plx-koip-pect'}
        style={simple ? undefined : { transformOrigin: 'left bottom', ...delay(-0.9) }}
        d={KOIF_PECT_TOP}
        fill={fin}
      />
      <path
        className={simple ? undefined : 'plx-koip-pect'}
        style={simple ? undefined : { transformOrigin: 'left top', ...delay(-3.7) }}
        d={KOIF_PECT_BOT}
        fill={fin}
      />
      <path d={KOIF_BODY} fill={`url(#${gradId})`} stroke="rgb(8 38 42 / 0.4)" strokeWidth="0.5" />
      <g clipPath={`url(#${clipId})`}>
        {/* a whisper of warm shade under the jaw so the head is a form,
            not a flat blob (drawn before the patches, which own the back) */}
        <path
          d="M2.2 12 C3 14.8 5.6 16.6 9.2 17.1 C6.6 17.4 4.2 16.4 3 14.6 Z"
          fill="rgb(196 156 128 / 0.4)"
        />
        {patches.map((patch, i) => (
          <path key={i} d={patch.d} fill={patch.fill} fillOpacity={patch.opacity ?? 1} />
        ))}
      </g>
      <path
        d="M5.5 10.9 C13 9.2 23 9.5 32.5 11.3"
        fill="none"
        stroke={spine}
        strokeOpacity="0.5"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
      {/* eyes hug the snout: small dark iris + a pinprick glint (a big
          mid-head dot reads googly at row scale) */}
      <circle cx="4.6" cy="10.1" r="0.58" fill="rgb(14 20 22 / 0.95)" />
      <circle cx="4.6" cy="13.9" r="0.58" fill="rgb(14 20 22 / 0.95)" />
      <circle cx="4.42" cy="9.92" r="0.22" fill="rgb(210 232 234 / 0.9)" />
      <circle cx="4.42" cy="13.72" r="0.22" fill="rgb(210 232 234 / 0.9)" />
    </>
  )

  return (
    <svg
      viewBox="0 0 52 24"
      width={w}
      height={(w * 24) / 52}
      aria-hidden
      style={{
        display: 'block',
        overflow: 'visible',
        transform: flip ? 'scaleX(-1)' : undefined,
        filter: blur ? `blur(${blur}px)` : undefined
      }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={bodyFrom} />
          <stop offset="1" stopColor={bodyTo} />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={KOIF_BODY} />
        </clipPath>
      </defs>
      <g className={simple ? undefined : 'plx-koip-tail'} style={simple ? undefined : delay()}>
        <path d={KOIF_TAIL} fill={fin} />
        <g stroke={spine} strokeOpacity="0.35" strokeWidth="0.5" fill="none">
          <path d="M37 11.3 L46.4 7.4 M37.3 12 L45.8 12 M37 12.7 L46.4 16.6" />
        </g>
      </g>
      {simple ? (
        <g>{bodyGroup}</g>
      ) : (
        <g className="plx-koip-sway" style={delay()}>
          {bodyGroup}
        </g>
      )}
    </svg>
  )
}

function FxOverlay({ fx }: { fx: PlateFx }) {
  switch (fx) {
    case 'synthwave-grid':
      // striped sun setting on the horizon, an endless grid floor rushing
      // toward the viewer, a burning horizon line and a sky sweep
      return (
        <>
          {/* sun glow (breathes) behind the striped disc */}
          <div
            className="plx-breathe absolute rounded-full"
            style={{
              right: 'calc(13% - 14px)',
              bottom: 'calc(44% - 12px)',
              width: 62,
              height: 62,
              background: 'radial-gradient(circle, rgb(255 45 149 / 0.5), transparent 70%)',
              filter: 'blur(6px)',
              animationDuration: '6s'
            }}
          />
          <div
            className="absolute"
            style={{
              right: '13%',
              bottom: '44%',
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: [
                'repeating-linear-gradient(180deg, transparent 0 4px, rgb(24 7 40 / 0.9) 4px 6px)',
                'linear-gradient(180deg, rgb(255 224 130) 0%, rgb(255 120 150) 55%, rgb(255 45 149) 100%)'
              ].join(', '),
              boxShadow: '0 0 14px rgb(255 45 149 / 0.55)'
            }}
          />
          {/* the grid floor — perspective plane sliding one tile per loop */}
          <div
            className="absolute inset-x-0 bottom-0 overflow-hidden"
            style={{ height: '44%', perspective: '110px' }}
          >
            <div
              className="plx-gridrun absolute"
              style={{
                left: '-40%',
                right: '-40%',
                top: '-8%',
                height: '360%',
                transformOrigin: 'top center',
                transform: 'rotateX(60deg)',
                backgroundImage: [
                  'repeating-linear-gradient(90deg, rgb(255 45 149 / 0.5) 0 1.5px, transparent 1.5px 46px)',
                  'repeating-linear-gradient(180deg, rgb(255 45 149 / 0.55) 0 1.5px, transparent 1.5px 34px)'
                ].join(', ')
              }}
            />
          </div>
          {/* burning horizon line */}
          <div
            className="plx-breathe absolute inset-x-0"
            style={{
              bottom: '44%',
              height: 2,
              background:
                'linear-gradient(90deg, transparent 6%, rgb(255 45 149 / 0.75) 46%, rgb(255 214 120 / 0.95) 87%, rgb(255 45 149 / 0.6))',
              boxShadow: '0 0 12px rgb(255 45 149 / 0.7)',
              animationDuration: '5s'
            }}
          />
          <div
            className="plx-beam absolute inset-y-0"
            style={{
              left: 0,
              width: '16%',
              background:
                'linear-gradient(105deg, transparent, rgb(255 45 149 / 0.13) 50%, transparent)',
              transform: 'translate3d(-140%, 0, 0) skewX(-14deg)',
              animationDuration: '9s'
            }}
          />
        </>
      )

    case 'deep-space':
      // three star depths (one static in the base, two drifting), a ringed
      // gas giant, a twinkling star and a rare shooting star
      return (
        <>
          <div
            className="plx-drift absolute inset-y-0"
            style={{
              left: 0,
              right: -88,
              backgroundImage:
                'radial-gradient(circle, rgb(226 232 255 / 0.5) 1px, transparent 1.5px)',
              backgroundSize: '88px 46px',
              ['--plx-d' as string]: '-88px',
              animationDuration: '70s'
            }}
          />
          <div
            className="plx-drift absolute inset-y-0"
            style={{
              left: 0,
              right: -132,
              backgroundImage:
                'radial-gradient(circle, rgb(191 219 254 / 0.7) 1.3px, transparent 1.9px)',
              backgroundSize: '132px 58px',
              backgroundPosition: '30px 18px',
              ['--plx-d' as string]: '-132px',
              animationDuration: '38s'
            }}
          />
          {/* ringed gas giant, drifting on a slow bob */}
          <div className="absolute" style={{ right: '14%', top: '18%' }}>
            <div className="plx-bob" style={{ animationDuration: '9s' }}>
              <div className="relative" style={{ width: 30, height: 30 }}>
                <span
                  className="absolute rounded-full"
                  style={{
                    left: '50%',
                    top: '50%',
                    width: 52,
                    height: 52,
                    transform: 'translate(-50%, -50%) rotate(-24deg) scaleY(0.3)',
                    border: '1.5px solid rgb(165 180 252 / 0.5)',
                    boxShadow: '0 0 6px rgb(129 140 248 / 0.25)'
                  }}
                />
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 32% 28%, rgb(196 205 255), rgb(99 102 241) 48%, rgb(49 46 129) 78%, rgb(23 21 60))',
                    boxShadow:
                      'inset -5px -4px 8px rgb(0 0 0 / 0.55), 0 0 14px rgb(129 140 248 / 0.35)'
                  }}
                />
                <span
                  className="absolute"
                  style={{
                    left: -12,
                    top: '50%',
                    width: 54,
                    height: 5,
                    transform: 'translateY(-50%) rotate(-24deg)',
                    borderRadius: 3,
                    background:
                      'linear-gradient(90deg, rgb(165 180 252 / 0.4), transparent 42%, transparent 58%, rgb(165 180 252 / 0.55))',
                    clipPath: 'polygon(0 0, 38% 0, 38% 100%, 0 100%, 0 0, 62% 0, 100% 0, 100% 100%, 62% 100%)'
                  }}
                />
              </div>
            </div>
          </div>
          <div
            className="plx-twinkle absolute rounded-full"
            style={{
              right: '30%',
              top: '30%',
              width: 3,
              height: 3,
              background: 'rgb(255 255 255 / 0.95)',
              boxShadow: '0 0 6px rgb(191 219 254 / 0.9)',
              opacity: 0,
              animationDuration: '5s'
            }}
          />
          <div
            className="plx-twinkle absolute rounded-full"
            style={{
              right: '46%',
              top: '58%',
              width: 2.5,
              height: 2.5,
              background: 'rgb(255 255 255 / 0.85)',
              boxShadow: '0 0 5px rgb(191 219 254 / 0.8)',
              opacity: 0,
              animationDuration: '6.4s',
              animationDelay: '-3.1s'
            }}
          />
          <div
            className="plx-comet absolute"
            style={{
              right: '5%',
              top: '10%',
              width: 60,
              height: 1.5,
              borderRadius: 2,
              background: 'linear-gradient(90deg, rgb(255 255 255 / 0.95), transparent)',
              boxShadow: '0 0 6px rgb(180 200 255 / 0.6)',
              opacity: 0,
              animationDuration: '13s',
              animationDelay: '2.5s'
            }}
          />
        </>
      )

    case 'terminal-rain':
      // three phosphor columns falling at depth-sorted speeds, a live
      // prompt with a blinking caret, and a CRT interference bar
      return (
        <>
          <div
            className="plx-fall absolute inset-x-0"
            style={{
              top: -30,
              bottom: -30,
              background:
                'repeating-linear-gradient(180deg, rgb(2 254 1 / 0.22) 0 5px, rgb(2 254 1 / 0.07) 5px 8px, transparent 8px 24px)',
              WebkitMaskImage:
                'repeating-linear-gradient(90deg, rgb(0 0 0) 0 2px, transparent 2px 13px)',
              maskImage:
                'repeating-linear-gradient(90deg, rgb(0 0 0) 0 2px, transparent 2px 13px)',
              ['--plx-f' as string]: '-24px',
              animationDuration: '1.7s'
            }}
          />
          <div
            className="plx-fall absolute inset-x-0"
            style={{
              top: -36,
              bottom: -36,
              background:
                'repeating-linear-gradient(180deg, rgb(2 254 1 / 0.12) 0 7px, rgb(2 254 1 / 0.04) 7px 10px, transparent 10px 30px)',
              WebkitMaskImage:
                'repeating-linear-gradient(90deg, rgb(0 0 0) 0 2px, transparent 2px 17px)',
              maskImage:
                'repeating-linear-gradient(90deg, rgb(0 0 0) 0 2px, transparent 2px 17px)',
              WebkitMaskPosition: '7px 0',
              maskPosition: '7px 0',
              ['--plx-f' as string]: '-30px',
              animationDuration: '2.6s'
            }}
          />
          <div
            className="plx-fall absolute inset-x-0"
            style={{
              top: -42,
              bottom: -42,
              background:
                'repeating-linear-gradient(180deg, rgb(2 254 1 / 0.06) 0 9px, transparent 9px 36px)',
              WebkitMaskImage:
                'repeating-linear-gradient(90deg, rgb(0 0 0) 0 1.5px, transparent 1.5px 23px)',
              maskImage:
                'repeating-linear-gradient(90deg, rgb(0 0 0) 0 1.5px, transparent 1.5px 23px)',
              WebkitMaskPosition: '13px 0',
              maskPosition: '13px 0',
              ['--plx-f' as string]: '-36px',
              animationDuration: '4s'
            }}
          />
          {/* live prompt, bottom right */}
          <div className="absolute flex items-center" style={{ right: '5%', bottom: 5, gap: 3 }}>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 10,
                lineHeight: 1,
                color: 'rgb(2 254 1 / 0.9)',
                textShadow: '0 0 6px rgb(2 254 1 / 0.7)'
              }}
            >
              &gt;
            </span>
            <span
              className="plx-cursor"
              style={{
                width: 5,
                height: 10,
                background: 'rgb(2 254 1 / 0.85)',
                boxShadow: '0 0 7px rgb(2 254 1 / 0.7)'
              }}
            />
          </div>
          <div
            className="plx-glitch absolute inset-x-0"
            style={{
              top: '34%',
              height: 3,
              background:
                'linear-gradient(90deg, transparent, rgb(2 254 1 / 0.3) 30%, rgb(180 255 180 / 0.2) 55%, rgb(2 254 1 / 0.14) 80%, transparent)',
              opacity: 0
            }}
          />
          <div
            className="plx-breathe absolute inset-y-0"
            style={{
              right: 0,
              width: '40%',
              background: 'radial-gradient(80% 120% at 100% 50%, rgb(2 254 1 / 0.1), transparent 70%)',
              animationDuration: '8s'
            }}
          />
        </>
      )

    case 'koi-pond':
      // a sunlit pond from above. Light: two counter-drifting caustic webs
      // (the base art's own tile, brighter) + breathing sun shafts + a slow
      // swell sheen, all inside one hover-bloom gate. Life: three koi at
      // sorted depths on their own laps — the Kohaku surface-kisses at 42%
      // of its 26s lap (glow, elliptical rings and a bubble pair share that
      // clock), the gold Ogon emerges from under the pads, a ghost patrols
      // the deep. Scenery: bobbing pads + lotus the koi pass UNDER, an
      // 11s unseen-fish nibble at the big pad, an 18s petal cast, a 28s
      // dragonfly visit. Anchors double as the reduced-motion tableau.
      return (
        <>
          <div className="plx-koip-hlight absolute inset-0">
            {/* the sun pool — a broad warm-aqua bloom under the caustics
                where the light lands (static; the drift layers carry the
                live shimmer, keeping the row's animation budget lean) */}
            <div
              className="absolute"
              style={{
                right: '-10%',
                top: '-40%',
                width: '46%',
                height: '130%',
                background:
                  'radial-gradient(60% 90% at 70% 30%, rgb(150 255 224 / 0.13), transparent 70%)'
              }}
            />
            {/* caustic webs — one geometry at three strengths: a faint
                static wash (the "painted" light) under two counter-drifting
                live copies at different cell scales, whose interference
                makes the shimmer. All share one mask that dies toward the
                name zone so no hairline ever crosses the text. */}
            <div
              className="absolute inset-0"
              style={{
                WebkitMaskImage:
                  'linear-gradient(90deg, transparent 6%, rgb(0 0 0 / 0.25) 38%, rgb(0 0 0 / 0.75) 64%, rgb(0 0 0) 84%)',
                maskImage:
                  'linear-gradient(90deg, transparent 6%, rgb(0 0 0 / 0.25) 38%, rgb(0 0 0 / 0.75) 64%, rgb(0 0 0) 84%)'
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: KOI_CAUSTICS,
                  backgroundSize: '160px 80px',
                  mixBlendMode: 'screen',
                  opacity: 0.16,
                  filter: 'blur(0.5px)'
                }}
              />
              <div
                className="plx-drift absolute inset-y-0"
                style={{
                  left: 0,
                  right: -200,
                  backgroundImage: KOI_CAUSTICS,
                  backgroundSize: '200px 100px',
                  mixBlendMode: 'screen',
                  opacity: 0.42,
                  filter: 'blur(0.7px)',
                  ['--plx-d' as string]: '-200px',
                  animationDuration: '26s'
                }}
              />
              <div
                className="plx-drift absolute inset-y-0"
                style={{
                  left: -264,
                  right: 0,
                  backgroundImage: KOI_CAUSTICS,
                  backgroundSize: '264px 132px',
                  backgroundPosition: '52px 40px',
                  mixBlendMode: 'screen',
                  opacity: 0.3,
                  filter: 'blur(1px)',
                  ['--plx-d' as string]: '264px',
                  animationDuration: '34s'
                }}
              />
            </div>
            {/* sun shafts raking in from the top-right, breathing */}
            <div
              className="absolute"
              style={{
                right: 34,
                top: '-16%',
                width: 36,
                height: '150%',
                transform: 'rotate(24deg)',
                transformOrigin: 'top right'
              }}
            >
              <div
                className="plx-koip-shaft absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgb(220 255 244 / 0.2), rgb(220 255 244 / 0.06) 55%, transparent 80%)',
                  mixBlendMode: 'screen',
                  opacity: 0.75
                }}
              />
            </div>
            <div
              className="absolute"
              style={{
                right: 118,
                top: '-16%',
                width: 20,
                height: '140%',
                transform: 'rotate(24deg)',
                transformOrigin: 'top right'
              }}
            >
              <div
                className="plx-koip-shaft absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgb(220 255 244 / 0.15), rgb(220 255 244 / 0.05) 50%, transparent 78%)',
                  mixBlendMode: 'screen',
                  opacity: 0.75,
                  animationDelay: '-5.5s'
                }}
              />
            </div>
            {/* the swell — one soft highlight band washing across and back */}
            <div
              className="absolute"
              style={{
                right: 30,
                top: '-20%',
                width: 150,
                height: '140%',
                transform: 'skewX(-16deg)'
              }}
            >
              <div
                className="plx-koip-sheen absolute inset-0"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgb(198 255 240 / 0.14) 45%, transparent)',
                  animationDelay: '-7s'
                }}
              />
            </div>
          </div>

          {/* ghost koi — deep, blurred, half-there */}
          <div className="absolute" style={{ right: 286, top: 'calc(50% + 2px)' }}>
            <div className="plx-koip-ghost" style={{ opacity: 0.62, animationDelay: '-22s' }}>
              <div className="relative">
                <KoiFish
                  w={26}
                  simple
                  blur={0.8}
                  bodyFrom="rgb(196 228 226 / 0.72)"
                  bodyTo="rgb(150 198 198 / 0.6)"
                  fin="rgb(196 230 228 / 0.45)"
                  spine="rgb(232 250 248 / 0.6)"
                  patches={GHOST_PATCHES}
                />
              </div>
            </div>
          </div>

          {/* gold Ogon — slips out from under the pads, meanders for the
              deep and sinks away (scale eases down = depth, not shrink) */}
          <div className="absolute" style={{ right: 210, top: 'calc(50% - 6px)' }}>
            <div className="plx-koip-ogon" style={{ opacity: 1, animationDelay: '-4s' }}>
              <div className="relative" style={{ width: 36, height: 16.6 }}>
                <div
                  className="absolute rounded-full"
                  style={{
                    left: '-7%',
                    top: '58%',
                    width: '84%',
                    height: '40%',
                    background: 'radial-gradient(closest-side, rgb(2 18 24 / 0.4), transparent 80%)',
                    filter: 'blur(2px)'
                  }}
                />
                <KoiFish
                  w={36}
                  wiggleDelay={-1.3}
                  bodyFrom="rgb(255 226 120)"
                  bodyTo="rgb(248 164 52)"
                  fin="rgb(255 216 108 / 0.72)"
                  spine="rgb(255 248 214 / 0.95)"
                  patches={OGON_PATCHES}
                />
              </div>
            </div>
          </div>

          {/* the Kohaku — the star. Enters from the deep left, S-curves up
              into the light, kisses the surface and coasts home under the
              pads. Head faces right (static flip; the path owns rotate). */}
          <div className="absolute" style={{ right: 132, top: 'calc(50% - 12px)' }}>
            {/* -6s master delay is shared by the kiss glow/rings/bubbles:
                one clock, so the splash can never drift off the fish */}
            <div className="plx-koip-kohaku" style={{ opacity: 1, animationDelay: '-6s' }}>
              <div className="relative" style={{ width: 46, height: 21.2 }}>
                <div
                  className="absolute rounded-full"
                  style={{
                    left: '-8%',
                    top: '60%',
                    width: '86%',
                    height: '42%',
                    background: 'radial-gradient(closest-side, rgb(2 18 24 / 0.5), transparent 80%)',
                    filter: 'blur(2.5px)'
                  }}
                />
                <KoiFish
                  w={46}
                  flip
                  bodyFrom="rgb(255 250 242)"
                  bodyTo="rgb(244 230 214)"
                  fin="rgb(255 244 232 / 0.6)"
                  spine="rgb(255 255 250 / 0.9)"
                  patches={KOHAKU_PATCHES}
                />
              </div>
            </div>
          </div>

          {/* the surface kiss — glow, two rings lying ON the water plane
              (3:1 ellipses), a bubble pair; all on the Kohaku's 26s clock.
              Anchors sit where the nose IS at the 42% keyframe (wrapper
              right 132 + translate 12, y center-19): the rings then hang
              at the kiss point while the fish glides on — rings don't
              follow fish, water remembers. */}
          <div
            className="plx-koip-kiss absolute rounded-full"
            style={{
              right: 134,
              top: 'calc(50% - 22px)',
              width: 34,
              height: 15,
              background: 'radial-gradient(closest-side, rgb(255 252 240 / 0.9), transparent 75%)',
              filter: 'blur(1.5px)',
              opacity: 0,
              animationDelay: '-6s'
            }}
          />
          {/* rings are wider than the fish so their arcs clear the white
              back instead of drowning in it */}
          <div
            className="plx-koip-ripple-a absolute"
            style={{
              right: 130,
              top: 'calc(50% - 21px)',
              width: 38,
              height: 13,
              borderRadius: '50%',
              border: '2px solid rgb(240 255 250 / 0.95)',
              boxShadow: '0 0 6px rgb(214 255 242 / 0.5)',
              opacity: 0,
              animationDelay: '-6s'
            }}
          />
          <div
            className="plx-koip-ripple-b absolute"
            style={{
              right: 137,
              top: 'calc(50% - 19px)',
              width: 26,
              height: 9,
              borderRadius: '50%',
              border: '1.5px solid rgb(240 255 250 / 0.8)',
              opacity: 0,
              animationDelay: '-6s'
            }}
          />
          <span
            className="plx-koip-bubble absolute rounded-full"
            style={{
              right: 146,
              top: 'calc(50% - 17px)',
              width: 2.5,
              height: 2.5,
              background: 'rgb(230 252 246 / 0.75)',
              boxShadow: '0 0 3px rgb(230 252 246 / 0.55)',
              opacity: 0,
              animationDelay: '-6s'
            }}
          />
          <span
            className="plx-koip-bubble absolute rounded-full"
            style={{
              right: 153,
              top: 'calc(50% - 13px)',
              width: 1.8,
              height: 1.8,
              background: 'rgb(230 252 246 / 0.65)',
              opacity: 0,
              animationDelay: '-6.5s'
            }}
          />

          {/* sun catching micro-ripples over the open water */}
          {KOIP_TWINKLES.map((t, i) => (
            <span
              key={i}
              className="plx-twinkle absolute rounded-[1px]"
              style={{
                right: t.right,
                top: t.top,
                width: t.size,
                height: t.size,
                background: 'rgb(236 255 250 / 0.9)',
                boxShadow: '0 0 5px rgb(214 255 242 / 0.8)',
                opacity: 0,
                animationDuration: t.dur,
                animationDelay: t.delay
              }}
            />
          ))}

          {/* something nibbles the big pad from below (11s): rim rings +
              one bubble hugging the pad's shaded south-east rim while the
              pad dips — the unseen fourth koi */}
          <div
            className="plx-koip-nibble-a absolute"
            style={{
              right: 20,
              top: 17,
              width: 24,
              height: 9,
              borderRadius: '50%',
              border: '1.5px solid rgb(224 252 244 / 0.8)',
              opacity: 0,
              animationDelay: '-4s'
            }}
          />
          <div
            className="plx-koip-nibble-b absolute"
            style={{
              right: 25,
              top: 18.5,
              width: 17,
              height: 6.5,
              borderRadius: '50%',
              border: '1px solid rgb(224 252 244 / 0.65)',
              opacity: 0,
              animationDelay: '-4s'
            }}
          />
          <span
            className="plx-koip-pad-bubble absolute rounded-full"
            style={{
              right: 30,
              top: 14,
              width: 2,
              height: 2,
              background: 'rgb(230 252 246 / 0.7)',
              opacity: 0,
              animationDelay: '-4s'
            }}
          />

          {/* the pad raft — one overlapping cluster in the corner, the way
              real pads crowd: small pad peeking from under the big one and
              cropping off the top edge, mid pad tucked under its south-west
              rim, lotus seated ON the big pad. Koi pass UNDER all of it.
              The big pad rides the 11s nibble clock; the rest bob out of
              phase. The bud floats alone off the raft, stem on the water. */}
          <div className="absolute" style={{ right: 12, top: -10 }}>
            <div
              className="plx-koip-bob"
              style={{
                width: 22,
                height: 20.2,
                backgroundImage: KOIP_PAD_SMALL,
                backgroundSize: '100% 100%',
                animationDelay: '-3.2s'
              }}
            />
          </div>
          {/* far enough south-east that a readable half-disc (rim arc +
              veins) emerges from under the lotus — a thinner sliver here
              silhouettes as an abstract dark wedge (the pass-7 "arrow") */}
          <div className="absolute" style={{ right: 46, top: 16 }}>
            <div
              className="plx-koip-bob"
              style={{
                width: 27,
                height: 25.3,
                backgroundImage: KOIP_PAD_MID,
                backgroundSize: '100% 100%',
                animationDelay: '-5.8s'
              }}
            />
          </div>
          <div className="absolute" style={{ right: 22, top: -9 }}>
            <div
              className="plx-koip-pad-a"
              style={{
                width: 40,
                height: 38.2,
                backgroundImage: KOIP_PAD_BIG,
                backgroundSize: '100% 100%',
                animationDelay: '-4s'
              }}
            />
          </div>
          <div className="absolute" style={{ right: 42, top: -6 }}>
            <div
              className="plx-koip-bob"
              style={{
                width: 34,
                height: 30.6,
                backgroundImage: KOIP_LOTUS,
                backgroundSize: '100% 100%',
                animationDelay: '-7.1s',
                animationDuration: '10s'
              }}
            />
          </div>
          <div className="absolute" style={{ right: 88, top: 7 }}>
            <div
              className="plx-koip-bob"
              style={{
                width: 24,
                height: 14.8,
                backgroundImage: KOIP_BUD,
                backgroundSize: '100% 100%',
                animationDelay: '-1.9s'
              }}
            />
          </div>

          {/* every 18s the lotus lets one petal ride the swell away (spawns
              at the flower's west petals) */}
          <div
            className="plx-koip-petal absolute"
            style={{
              right: 72,
              top: 3,
              width: 5.5,
              height: 8,
              borderRadius: '58% 58% 58% 10%',
              background: 'linear-gradient(160deg, rgb(255 190 216), rgb(240 105 159))',
              opacity: 0,
              animationDelay: '-9s'
            }}
          />

          {/* the 28s dragonfly visit: darts in, hovers above the floating
              bud's head with wing-flicker, darts off — blink and you miss it */}
          <div className="absolute" style={{ right: 102, top: -7 }}>
            <div className="plx-koip-dfly" style={{ opacity: 0, animationDelay: '-12s' }}>
              <svg
                viewBox="0 0 26 18"
                width={30}
                height={20.8}
                aria-hidden
                style={{ display: 'block', overflow: 'visible', transform: 'rotate(-24deg)' }}
              >
                <path
                  className="plx-koip-wing"
                  d="M13 8.6 C10.5 4 7 1.8 4.2 2.6 C6.8 5.6 10 8 13 8.6 Z M13 9.4 C10.5 14 7 16.2 4.2 15.4 C6.8 12.4 10 10 13 9.4 Z"
                  fill="rgb(232 252 255 / 0.7)"
                  stroke="rgb(255 255 255 / 0.75)"
                  strokeWidth="0.5"
                />
                <path
                  className="plx-koip-wing"
                  style={{ animationDelay: '-0.12s' }}
                  d="M15 8.6 C13.5 4.4 10.5 2 7.6 2.4 C9.8 5.4 12.4 7.9 15 8.6 Z M15 9.4 C13.5 13.6 10.5 16 7.6 15.6 C9.8 12.6 12.4 10.1 15 9.4 Z"
                  fill="rgb(232 252 255 / 0.55)"
                  stroke="rgb(255 255 255 / 0.6)"
                  strokeWidth="0.5"
                />
                <rect x="14" y="8.2" width="10.5" height="1.7" rx="0.85" fill="rgb(88 216 236)" />
                <path
                  d="M17 8.2 V9.9 M19.5 8.2 V9.9 M22 8.2 V9.9"
                  stroke="rgb(16 96 116 / 0.8)"
                  strokeWidth="0.5"
                />
                <ellipse cx="13.4" cy="9" rx="2" ry="1.7" fill="rgb(64 186 210)" />
                <circle cx="10.9" cy="9" r="1.4" fill="rgb(64 186 210)" />
                <circle cx="10.3" cy="8.2" r="0.7" fill="rgb(170 240 252)" />
                <circle cx="10.3" cy="9.8" r="0.7" fill="rgb(170 240 252)" />
              </svg>
            </div>
          </div>
        </>
      )

    case 'cherry-blossom':
      // a spring gust off the hanami branch (base art). Light: the sun
      // bloom breathes behind the canopy while two gold shafts rake the
      // right sky. Weather: two cumulus puffs drift across on 72s/104s
      // clocks. Life: twelve petals at three depths — near/mid petals are
      // two-faced cards (pale front, pinker back) tumbling in preserve-3d
      // so they flash as they roll; far petals ride a single face with
      // the depth-of-field blur baked into the SVG — no animated CSS
      // filters anywhere in the scene. Frozen (reduced motion), every
      // petal parks mid-air on its inline pose — the designed tableau.
      return (
        <>
          {/* the sun's breath — halo spilling over the canopy corner */}
          <div
            className="plx-breathe absolute rounded-full"
            style={{
              right: 'calc(16% - 90px)',
              top: 'calc(16% - 90px)',
              width: 180,
              height: 180,
              background:
                'radial-gradient(circle, rgb(255 246 214 / 0.42), rgb(255 238 190 / 0.16) 46%, transparent 70%)',
              mixBlendMode: 'screen',
              animationDuration: '9s'
            }}
          />
          {/* god rays off the top-right corner — static slant on the
              wrappers, only the light level breathes */}
          <div
            className="absolute"
            style={{
              right: 64,
              top: '-28%',
              width: 46,
              height: '170%',
              transform: 'rotate(-24deg)',
              transformOrigin: 'top right'
            }}
          >
            <div
              className="plx-breathe absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgb(255 248 214 / 0.26), rgb(255 248 214 / 0.08) 55%, transparent 82%)',
                mixBlendMode: 'screen',
                animationDuration: '11s',
                animationDelay: '-4s'
              }}
            />
          </div>
          <div
            className="absolute"
            style={{
              right: 172,
              top: '-30%',
              width: 26,
              height: '160%',
              transform: 'rotate(-24deg)',
              transformOrigin: 'top right'
            }}
          >
            <div
              className="plx-breathe absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgb(255 248 214 / 0.2), rgb(255 248 214 / 0.06) 50%, transparent 78%)',
                mixBlendMode: 'screen',
                animationDuration: '13s',
                animationDelay: '-8s'
              }}
            />
          </div>
          {/* live clouds — the base bank's moving counterparts */}
          <div
            className="plx-skb-cloud absolute"
            style={{
              right: 0,
              top: '9%',
              width: 130,
              height: 50,
              backgroundImage: SAKURA_CLOUD,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              opacity: 0.75,
              transform: 'translate3d(-180px, 0, 0)',
              animationDuration: '72s',
              animationDelay: '-18s'
            }}
          />
          <div
            className="plx-skb-cloud absolute"
            style={{
              right: 0,
              top: '26%',
              width: 86,
              height: 33,
              backgroundImage: SAKURA_CLOUD,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              opacity: 0.5,
              transform: 'translate3d(-380px, 0, 0)',
              animationDuration: '104s',
              animationDelay: '-61s'
            }}
          />
          {/* the flurry — three depths, one wind */}
          {SAKURA_PETALS.map((p, i) =>
            p.depth === 'f' ? (
              <div
                key={i}
                className="plx-skb-fall-f absolute"
                style={{
                  right: p.right,
                  top: p.top,
                  width: p.size,
                  height: p.size,
                  backgroundImage: SAKURA_PETAL_FARS[p.tone],
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat',
                  opacity: 0.5,
                  transform: p.park,
                  animationDuration: p.dur,
                  animationDelay: p.delay
                }}
              />
            ) : (
              <div
                key={i}
                className={`absolute ${p.depth === 'n' ? 'plx-skb-fall-n' : 'plx-skb-fall-m'}`}
                style={{
                  right: p.right,
                  top: p.top,
                  width: p.size,
                  height: p.size,
                  perspective: '340px',
                  opacity: 0.9,
                  transform: p.park,
                  animationDuration: p.dur,
                  animationDelay: p.delay
                }}
              >
                <div
                  className="plx-skb-tumble absolute inset-0"
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: p.parkFlip,
                    animationDuration: p.tumble,
                    animationDelay: p.delay,
                    animationDirection: p.dir
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      backgroundImage: SAKURA_PETAL_FACES[p.tone].front,
                      backgroundSize: 'contain',
                      backgroundRepeat: 'no-repeat'
                    }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                      backgroundImage: SAKURA_PETAL_FACES[p.tone].back,
                      backgroundSize: 'contain',
                      backgroundRepeat: 'no-repeat'
                    }}
                  />
                </div>
              </div>
            )
          )}
        </>
      )

    case 'keyboard-cat':
      // the cat rises over its keyboard (base art) and actually plays it:
      // alternating paw slaps, keys lighting under each hit, notes rising.
      // The whole ensemble is keyed in fixed px to the base keyboard strip
      // (200×32, bottom-anchored in plates.ts) — paws and lit keycaps must
      // land on its top key row — so it deliberately does NOT re-seat with
      // row height. At ~68px rows the full pop-up (ears to bottom:54) and
      // the 22px note arcs now fit uncropped; on the old 48px rows the
      // ears clipped at peak peek.
      return (
        <>
          <div
            className="plx-peek absolute"
            style={{ right: 52, bottom: 24, width: 36, height: 24 }}
          >
            {/* ears — the right one twitches */}
            <div
              className="absolute"
              style={{
                left: 4,
                top: -6,
                width: 9,
                height: 9,
                clipPath: 'polygon(50% 0, 0 100%, 100% 100%)',
                background: 'rgb(92 78 122)'
              }}
            />
            <div
              className="plx-twitch absolute"
              style={{
                right: 4,
                top: -6,
                width: 9,
                height: 9,
                clipPath: 'polygon(50% 0, 0 100%, 100% 100%)',
                background: 'rgb(92 78 122)'
              }}
            />
            <div
              className="absolute inset-x-0"
              style={{
                top: 0,
                height: 26,
                borderRadius: '16px 16px 5px 5px',
                background: 'linear-gradient(180deg, rgb(99 84 132), rgb(58 48 82))',
                boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.16)'
              }}
            />
            <div
              className="plx-blink absolute rounded-full"
              style={{
                left: 9,
                top: 9,
                width: 4,
                height: 4,
                background: 'rgb(255 214 120)',
                boxShadow: '11px 0 0 rgb(255 214 120), 0 0 5px rgb(255 214 120 / 0.6), 11px 0 5px rgb(255 214 120 / 0.6)'
              }}
            />
            {/* muzzle dot */}
            <div
              className="absolute rounded-full"
              style={{ left: 16, top: 15, width: 3, height: 2, background: 'rgb(255 176 92 / 0.8)' }}
            />
          </div>

          {/* paws slapping the top key row */}
          <div
            className="plx-pat absolute"
            style={{
              right: 40,
              bottom: 26,
              width: 9,
              height: 8,
              borderRadius: '45% 45% 40% 40%',
              background: 'linear-gradient(180deg, rgb(99 84 132), rgb(74 62 102))',
              animationDelay: '0s'
            }}
          />
          <div
            className="plx-pat absolute"
            style={{
              right: 82,
              bottom: 26,
              width: 9,
              height: 8,
              borderRadius: '45% 45% 40% 40%',
              background: 'linear-gradient(180deg, rgb(99 84 132), rgb(74 62 102))',
              animationDelay: '-0.45s'
            }}
          />
          {/* keycaps lighting under each hit (aligned to the base strip) */}
          <div
            className="plx-key absolute"
            style={{
              right: 38,
              bottom: 18,
              width: 18,
              height: 12,
              borderRadius: 3,
              background: 'rgb(255 176 92 / 0.5)',
              boxShadow: '0 0 8px rgb(255 176 92 / 0.5)',
              opacity: 0.3,
              animationDuration: '0.9s',
              animationDelay: '-0.79s'
            }}
          />
          <div
            className="plx-key absolute"
            style={{
              right: 80,
              bottom: 18,
              width: 18,
              height: 12,
              borderRadius: 3,
              background: 'rgb(255 176 92 / 0.5)',
              boxShadow: '0 0 8px rgb(255 176 92 / 0.5)',
              opacity: 0.3,
              animationDuration: '0.9s',
              animationDelay: '-0.34s'
            }}
          />
          <span
            className="plx-note absolute"
            style={{
              right: 46,
              bottom: 34,
              fontSize: 9,
              lineHeight: 1,
              color: 'rgb(255 214 120 / 0.9)',
              opacity: 0
            }}
          >
            ♪
          </span>
          <span
            className="plx-note absolute"
            style={{
              right: 90,
              bottom: 32,
              fontSize: 8,
              lineHeight: 1,
              color: 'rgb(255 176 92 / 0.85)',
              opacity: 0,
              animationDelay: '1.8s'
            }}
          >
            ♫
          </span>
          <span
            className="plx-note absolute"
            style={{
              right: 66,
              bottom: 36,
              fontSize: 8,
              lineHeight: 1,
              color: 'rgb(255 214 120 / 0.75)',
              opacity: 0,
              animationDelay: '2.7s'
            }}
          >
            ♪
          </span>
        </>
      )

    case 'champions-gold':
      // the trophy scene: rotating light rays behind the laurel-wrapped
      // pixel "1" (base art), a crown tossed at an angle onto the numeral's
      // shoulder, a breathing floor pool, diamond glints, rising gold dust
      // and a sheen sweep. Never sold — minted when APEX (#1) unlocks.
      return (
        <>
          {/* ray wheel hub sits on the numeral (48px in from the right) */}
          <div
            className="absolute"
            style={{ right: 0, top: '50%', width: 96, height: 96, transform: 'translateY(-50%)' }}
          >
            <div
              className="plx-rotate absolute inset-0 rounded-full"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent, rgb(255 214 68 / 0.16) 30deg, transparent 60deg, transparent 150deg, rgb(255 214 68 / 0.11) 190deg, transparent 230deg, transparent 300deg, rgb(255 214 68 / 0.14) 330deg, transparent)',
                WebkitMaskImage: 'radial-gradient(closest-side, rgb(0 0 0), transparent 74%)',
                maskImage: 'radial-gradient(closest-side, rgb(0 0 0), transparent 74%)',
                animationDuration: '16s'
              }}
            />
          </div>
          {/* breathing light pool grounding the trophy */}
          <div
            className="plx-breathe absolute"
            style={{
              right: 6,
              bottom: -2,
              width: 96,
              height: 18,
              background: 'radial-gradient(50% 100% at 50% 100%, rgb(255 214 68 / 0.22), transparent 75%)',
              animationDuration: '5.5s'
            }}
          />
          {/* crown worn on the numeral's tip at an angle. The old 48px rows
              forced a crop-safe seat sunk ~7px into the stem; ~68px rows
              clear the full bob with room, so the crown now rides the tip
              with just its band overlapping (~4px). Seat floor: on the
              smallest live surface (~58px edit-modal preview) the rotated
              top corner still stays inside the strip at peak bob. */}
          <div
            className="absolute"
            style={{ right: 44, top: 'calc(50% - 24px)', transform: 'rotate(-16deg)' }}
          >
            <div className="plx-bob" style={{ animationDuration: '5s' }}>
              <div
                style={{
                  width: 17,
                  height: 11,
                  clipPath:
                    'polygon(6% 100%, 0% 26%, 26% 48%, 50% 4%, 74% 48%, 100% 26%, 94% 100%)',
                  background: 'linear-gradient(180deg, rgb(255 240 160), rgb(255 190 40))',
                  filter: 'drop-shadow(0 0 6px rgb(255 214 68 / 0.8))'
                }}
              />
            </div>
          </div>
          {GLINTS.map((g, i) => (
            <div
              key={i}
              className="plx-twinkle absolute"
              style={{
                right: g.right,
                top: g.top,
                width: g.size,
                height: g.size,
                background: 'rgb(255 226 120)',
                boxShadow: '0 0 6px rgb(255 214 68 / 0.8)',
                opacity: 0,
                animationDelay: g.delay
              }}
            />
          ))}
          {GOLD_MOTES.map((m, i) => (
            <span
              key={i}
              className="plx-mote absolute rounded-full"
              style={{
                right: m.right,
                bottom: m.bottom,
                width: m.size,
                height: m.size,
                background: 'rgb(255 226 120 / 0.9)',
                boxShadow: '0 0 4px rgb(255 214 68 / 0.7)',
                opacity: 0,
                animationDuration: m.dur,
                animationDelay: m.delay
              }}
            />
          ))}
          <div
            className="plx-beam absolute inset-y-0"
            style={{
              left: 0,
              width: '18%',
              background:
                'linear-gradient(105deg, transparent, rgb(255 226 120 / 0.17) 50%, transparent)',
              transform: 'translate3d(-140%, 0, 0) skewX(-14deg)',
              animationDuration: '6.5s'
            }}
          />
        </>
      )

    case 'ignition':
      // static-test ignition: a fireball erupting radially out of the
      // bell, a fat ragged kerolox jet jerking downstream as its
      // shockwaves find their flow, and a fume bank tumbling off the pad.
      // Every flame layer's right edge is pinned to the bell-nozzle exit
      // plane (right: 38, 50% — the same coordinate the plates.ts booster
      // SVG seats its nozzle mouth on), so the whole blast burns out of
      // the bell. Physics ladder, back → front: fireball bloom, ragged
      // sheath lobes, torn blackbody body, mushrooming tip bloom, blue
      // Swan-band root, white-hot spear, white throat core, then the
      // mach-diamond chain, throat glow, sparks, fume bank, and the 11s
      // blast surge. The left half stays dark for the fade mask.
      return (
        <>
          {/* ambient firelight washing the right third: hot orange at the
              nozzle cooling through pink to violet at the edges — the
              long-exposure night-launch glow */}
          <div
            className="plx-breathe absolute inset-y-0"
            style={{
              right: 0,
              width: '36%',
              background:
                'radial-gradient(75% 140% at 88% 50%, rgb(255 106 40 / 0.2), rgb(236 72 153 / 0.11) 48%, rgb(168 85 247 / 0.08) 68%, transparent 80%)',
              animationDuration: '5.5s'
            }}
          />
          {/* trench-pool: exhaust glow pooling on the pad beneath the
              plume, flaring in step with the thump */}
          <div
            className="plx-breathe absolute"
            style={{
              right: 0,
              bottom: 1,
              width: 124,
              height: 15,
              background:
                'radial-gradient(64% 100% at 78% 100%, rgb(255 122 40 / 0.3), rgb(215 48 90 / 0.12) 56%, transparent 78%)',
              filter: 'blur(2px)',
              animationDuration: '2.8s'
            }}
          />
          {/* the blast stack: zero-size anchor on the nozzle exit plane,
              children hanging left off it. Two wrappers divide the
              violence — plx-shake owns the surge concussion, plx-thump
              the slow combustion pulse (its origin is the bell mouth, so
              the plume surges radially out of the nozzle) — and
              plx-flame's fast jitter keeps running on top per layer */}
          <div className="absolute" style={{ right: 38, top: '50%' }}>
            <div className="plx-shake absolute" style={{ right: 0, top: 0 }}>
              <div className="plx-thump absolute" style={{ right: 0, top: 0 }}>
                {/* fireball bloom: the radial eruption at the bell mouth the
                    eye goes to first — a white-yellow heart burning through
                    orange into the pink/violet static-fire halo, its edge
                    sunk into the bell's dark interior, swelling with the
                    thump */}
                <div
                  className="absolute"
                  style={{
                    right: -12,
                    top: 0,
                    width: 56,
                    height: 44,
                    marginTop: -22,
                    borderRadius: '50%',
                    background:
                      'radial-gradient(52% 52% at 60% 50%, rgb(255 252 230 / 1), rgb(255 226 150 / 0.92) 38%, rgb(255 140 50 / 0.62) 60%, rgb(236 72 153 / 0.26) 80%, transparent 94%)',
                    filter: 'blur(1px)'
                  }}
                />
                {/* outer sheath, lobe A: the feathered cooling fringe,
                    orange → pink → purple trailing left. The zigzag clip
                    reads as ragged combustion lobes once the blur feathers
                    it; the heavy blur is what sells the long exposure */}
                <div
                  className="plx-flame absolute"
                  style={{
                    right: 0,
                    top: 0,
                    width: 120,
                    height: 52,
                    marginTop: -26,
                    clipPath:
                      'polygon(100% 34%, 100% 66%, 86% 78%, 74% 56%, 62% 92%, 50% 62%, 38% 100%, 28% 66%, 16% 96%, 8% 58%, 0 46%, 8% 34%, 16% 4%, 28% 28%, 38% 0, 50% 32%, 62% 8%, 74% 40%, 86% 22%)',
                    background:
                      'linear-gradient(90deg, transparent, rgb(168 85 247 / 0.34) 22%, rgb(244 114 182 / 0.4) 48%, rgb(255 122 40 / 0.42) 72%, rgb(255 140 55 / 0.48))',
                    filter: 'blur(2.5px)',
                    animationDuration: '2.4s'
                  }}
                />
                {/* sheath tongue B: a second fringe lobe on a phase-offset
                    flicker, riding low, so the sheath's edge never settles
                    into one shape */}
                <div
                  className="plx-flame absolute"
                  style={{
                    right: 0,
                    top: 0,
                    width: 96,
                    height: 38,
                    marginTop: -17,
                    clipPath:
                      'polygon(100% 34%, 100% 66%, 82% 82%, 66% 60%, 50% 96%, 36% 66%, 22% 100%, 12% 64%, 0 52%, 12% 38%, 22% 4%, 36% 32%, 50% 6%, 66% 40%, 82% 20%)',
                    background:
                      'linear-gradient(90deg, transparent, rgb(168 85 247 / 0.3) 26%, rgb(255 122 40 / 0.4) 60%, rgb(255 140 60 / 0.52))',
                    filter: 'blur(2px)',
                    animationDuration: '1.9s',
                    animationDelay: '-0.8s'
                  }}
                />
                {/* mid body: the blackbody core, orange bleeding to yellow
                    toward the nozzle, its trailing edge torn where the
                    shear layer rips the flame apart */}
                <div
                  className="plx-flame absolute"
                  style={{
                    right: 0,
                    top: 0,
                    width: 80,
                    height: 28,
                    marginTop: -14,
                    clipPath:
                      'polygon(100% 34%, 100% 66%, 85% 78%, 71% 60%, 57% 92%, 44% 66%, 32% 100%, 22% 70%, 12% 92%, 5% 58%, 0 50%, 5% 40%, 12% 8%, 22% 28%, 32% 0, 44% 32%, 57% 8%, 71% 40%, 85% 22%)',
                    background:
                      'linear-gradient(90deg, transparent, rgb(255 122 40 / 0.42) 30%, rgb(255 190 80 / 0.8) 64%, rgb(255 236 150 / 0.92))',
                    filter: 'blur(1px)',
                    animationDuration: '1.1s',
                    animationDelay: '-0.3s'
                  }}
                />
                {/* tip bloom: the plume's left end mushrooming as the
                    exhaust slams into still air and curls back — a slow
                    swell, never a tapered point */}
                <div
                  className="plx-bloom absolute"
                  style={{
                    right: 86,
                    top: 0,
                    width: 42,
                    height: 30,
                    marginTop: -15,
                    borderRadius: '50%',
                    background:
                      'radial-gradient(50% 50% at 64% 50%, rgb(255 168 80 / 0.6), rgb(244 114 182 / 0.34) 48%, rgb(168 85 247 / 0.16) 70%, transparent)',
                    filter: 'blur(2.5px)'
                  }}
                />
                {/* blue root: translucent Swan-band radical emission hugging
                    the nozzle exit — the tell of a fresh kerolox light */}
                <div
                  className="plx-flame absolute"
                  style={{
                    right: 0,
                    top: 0,
                    width: 46,
                    height: 14,
                    marginTop: -7,
                    clipPath: 'polygon(100% 28%, 100% 72%, 55% 96%, 0 50%, 55% 4%)',
                    background:
                      'linear-gradient(90deg, transparent, rgb(56 189 248 / 0.48) 45%, rgb(125 211 252 / 0.85))',
                    filter: 'blur(1px)',
                    animationDuration: '0.7s'
                  }}
                />
                {/* white-hot spear: the supersonic core — shortest, hottest,
                    fastest flicker */}
                <div
                  className="plx-flame absolute"
                  style={{
                    right: 0,
                    top: 0,
                    width: 64,
                    height: 9,
                    marginTop: -4.5,
                    clipPath: 'polygon(100% 36%, 100% 64%, 45% 100%, 0 50%, 45% 0)',
                    background:
                      'linear-gradient(90deg, transparent, rgb(255 244 200 / 0.72) 42%, rgb(255 255 255 / 0.95))',
                    filter: 'blur(0.5px)',
                    animationDuration: '0.6s'
                  }}
                />
                {/* throat core: the fireball's tight white heart, strobing
                    on the fastest flicker */}
                <div
                  className="plx-flame absolute"
                  style={{
                    right: -4,
                    top: 0,
                    width: 26,
                    height: 18,
                    marginTop: -9,
                    borderRadius: '50%',
                    background:
                      'radial-gradient(50% 50% at 60% 50%, rgb(255 255 255 / 0.98), rgb(255 226 150 / 0.72) 50%, transparent 74%)',
                    filter: 'blur(0.5px)',
                    animationDuration: '0.55s'
                  }}
                />
                {/* mach diamonds: standing shocks re-igniting unburned fuel
                    in the first half of the plume — white cores with cyan
                    fringes, phase-offset so the chain punches downstream */}
                {[8, 22, 36, 50].map((r, i) => (
                  <div
                    key={i}
                    className="plx-diamond absolute"
                    style={{
                      right: r,
                      top: 0,
                      width: 12,
                      height: 8,
                      marginTop: -4,
                      clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                      background:
                        'linear-gradient(90deg, rgb(125 244 255 / 0.95), rgb(255 255 255 / 1) 50%, rgb(125 244 255 / 0.95))',
                      filter: 'drop-shadow(0 0 3px rgb(125 244 255 / 0.8))',
                      animationDelay: `${-0.15 * i}s`
                    }}
                  />
                ))}
                {/* throat glow: the white-hot ellipse straddling the nozzle
                    plane, half sunk in the bell's dark interior */}
                <div
                  className="plx-breathe absolute"
                  style={{
                    right: -4,
                    top: 0,
                    width: 8,
                    height: 9,
                    marginTop: -4.5,
                    borderRadius: '50%',
                    background:
                      'radial-gradient(50% 50% at 50% 50%, rgb(255 255 255 / 0.95), rgb(255 224 150 / 0.55) 55%, transparent 75%)',
                    animationDuration: '1.3s'
                  }}
                />
              </div>
              {/* igniter sparks fanning off the nozzle mouth — transient,
                  so they park at opacity: 0 for the reduced-motion freeze */}
              {IGN_SPARKS.map((s, i) => (
                <div
                  key={i}
                  className="plx-spark absolute"
                  style={{
                    right: 0,
                    top: s.top,
                    width: s.w,
                    height: s.h,
                    borderRadius: s.h > 1 ? '50%' : 1,
                    background: s.tint,
                    boxShadow: `0 0 5px ${s.glow}`,
                    opacity: 0,
                    animationDuration: s.dur,
                    animationDelay: s.delay,
                    ['--plx-sx' as string]: `${s.sx}px`,
                    ['--plx-sy' as string]: `${s.sy}px`,
                    ['--plx-sr' as string]: `${s.sr}deg`
                  }}
                />
              ))}
              {/* the 11s blast surge: a double-strike igniter flash at the
                  nozzle, two shockwave rings rolling left through the
                  plume a beat apart, and the spalled-spray debris fan */}
              <div
                className="plx-ign-flash absolute"
                style={{
                  right: -22,
                  top: 0,
                  width: 44,
                  height: 44,
                  marginTop: -22,
                  borderRadius: '50%',
                  background:
                    'radial-gradient(50% 50% at 50% 50%, rgb(255 255 255 / 0.95), rgb(255 214 150 / 0.5) 45%, transparent 70%)',
                  opacity: 0
                }}
              />
              <div
                className="plx-ign-ring absolute"
                style={{
                  right: 0,
                  top: 0,
                  width: 26,
                  height: 26,
                  marginTop: -13,
                  borderRadius: '50%',
                  border: '1.5px solid rgb(255 240 214 / 0.8)',
                  boxShadow: '0 0 8px rgb(255 190 120 / 0.5)',
                  opacity: 0
                }}
              />
              <div
                className="plx-ign-ring absolute"
                style={{
                  right: 0,
                  top: 0,
                  width: 18,
                  height: 18,
                  marginTop: -9,
                  borderRadius: '50%',
                  border: '1px solid rgb(255 214 170 / 0.7)',
                  boxShadow: '0 0 6px rgb(255 170 100 / 0.45)',
                  opacity: 0,
                  animationDelay: '0.45s'
                }}
              />
              {IGN_BURST.map((b, i) => (
                <div
                  key={i}
                  className="plx-burst-streak absolute"
                  style={{
                    right: 0,
                    top: 0,
                    width: b.w,
                    height: 3,
                    marginTop: -1.5,
                    background:
                      'linear-gradient(90deg, transparent, rgb(255 244 210 / 0.95))',
                    boxShadow: '0 0 5px rgb(255 200 120 / 0.7)',
                    opacity: 0,
                    animationDelay: b.delay,
                    ['--plx-ra' as string]: `${b.ra}deg`
                  }}
                />
              ))}
              {/* fume bank: thick exhaust clouds spawning along the plume's
                  underbelly, tumbling up-left and down-left as they cool —
                  transient, parked invisible for the reduced-motion frame */}
              {IGN_BILLOWS.map((b, i) => (
                <div
                  key={i}
                  className="plx-billow absolute"
                  style={{
                    right: b.right,
                    top: b.top,
                    width: b.size,
                    height: Math.round(b.size * 0.78),
                    marginTop: -Math.round(b.size * 0.39),
                    borderRadius: '50%',
                    background: b.bg,
                    filter: 'blur(2.5px)',
                    opacity: 0,
                    animationDuration: b.dur,
                    animationDelay: b.delay,
                    ['--plx-dx' as string]: `${b.dx}px`,
                    ['--plx-dy' as string]: `${b.dy}px`,
                    ['--plx-br' as string]: `${b.br}deg`
                  }}
                />
              ))}
            </div>
          </div>
          {/* pad smoke: one low wisp pooling on the strip floor, drifting
              left; tinted lavender/rose by the fire */}
          <div
            className="plx-smoke absolute"
            style={{
              right: 6,
              bottom: 3,
              width: 92,
              height: 16,
              borderRadius: '50%',
              background:
                'radial-gradient(50% 50% at 50% 50%, rgb(196 160 230 / 0.18), transparent 70%)',
              filter: 'blur(2px)',
              opacity: 0,
              animationDuration: '9.5s'
            }}
          />
        </>
      )

    case 'pro-circuit':
      // a live IC: packets flow down the input trace, the die pulses on
      // arrival, the output trace carries the signal off the board edge
      return (
        <>
          {/* input trace — packets travel toward the chip */}
          <div
            className="absolute overflow-hidden"
            style={{
              right: 'calc(9% + 32px)',
              top: '32%',
              width: 170,
              height: 2,
              background: 'rgb(34 211 238 / 0.12)'
            }}
          >
            <div
              className="plx-travel absolute inset-y-0"
              style={{
                left: -28,
                width: 26,
                borderRadius: 2,
                background: 'linear-gradient(90deg, transparent, rgb(34 211 238 / 0.9))',
                boxShadow: '0 0 6px rgb(34 211 238 / 0.6)',
                opacity: 0,
                ['--plx-p' as string]: '230px',
                animationDuration: '3.8s'
              }}
            />
          </div>
          {/* output trace — signal leaves for the board edge */}
          <div
            className="absolute overflow-hidden"
            style={{
              right: '1%',
              top: '62%',
              width: 110,
              height: 2,
              background: 'rgb(94 234 212 / 0.1)'
            }}
          >
            <div
              className="plx-travel absolute inset-y-0"
              style={{
                left: -24,
                width: 22,
                borderRadius: 2,
                background: 'linear-gradient(90deg, transparent, rgb(94 234 212 / 0.85))',
                boxShadow: '0 0 6px rgb(94 234 212 / 0.5)',
                opacity: 0,
                ['--plx-p' as string]: '160px',
                animationDuration: '3.8s',
                animationDelay: '-1.6s'
              }}
            />
          </div>
          {/* the IC package between the traces */}
          <div
            className="absolute"
            style={{ right: '9%', top: '50%', transform: 'translateY(-50%)' }}
          >
            <div
              className="relative"
              style={{
                width: 30,
                height: 24,
                borderRadius: 3,
                border: '1px solid rgb(34 211 238 / 0.55)',
                background: 'rgb(34 211 238 / 0.07)'
              }}
            >
              <span
                className="absolute"
                style={{
                  left: 4,
                  right: 4,
                  top: -4,
                  height: 3,
                  backgroundImage:
                    'repeating-linear-gradient(90deg, rgb(34 211 238 / 0.45) 0 1.5px, transparent 1.5px 5.5px)'
                }}
              />
              <span
                className="absolute"
                style={{
                  left: 4,
                  right: 4,
                  bottom: -4,
                  height: 3,
                  backgroundImage:
                    'repeating-linear-gradient(90deg, rgb(34 211 238 / 0.45) 0 1.5px, transparent 1.5px 5.5px)'
                }}
              />
              <span
                className="plx-node absolute rounded-[2px]"
                style={{
                  inset: 6,
                  background: 'rgb(34 211 238 / 0.3)',
                  boxShadow: '0 0 10px rgb(34 211 238 / 0.5)',
                  animationDuration: '3.8s',
                  animationDelay: '-0.9s'
                }}
              />
            </div>
          </div>
          <div
            className="plx-node absolute rounded-full"
            style={{
              right: 'calc(9% + 200px)',
              top: 'calc(32% - 1px)',
              width: 4,
              height: 4,
              background: 'rgb(34 211 238 / 0.9)',
              boxShadow: '0 0 6px rgb(34 211 238 / 0.7)',
              animationDuration: '2.8s'
            }}
          />
          <div
            className="plx-node absolute rounded-full"
            style={{
              right: 'calc(1% + 2px)',
              top: 'calc(62% - 1px)',
              width: 4,
              height: 4,
              background: 'rgb(94 234 212 / 0.9)',
              boxShadow: '0 0 6px rgb(94 234 212 / 0.7)',
              animationDuration: '3.4s',
              animationDelay: '-1.3s'
            }}
          />
        </>
      )

    case 'aurora-drift':
      // four undulating curtains over the ridge (base art), auroral glow
      // pooling on the ridge tops, a twinkle and a rare meteor
      return (
        <>
          <div
            className="plx-aurora absolute"
            style={{
              right: '6%',
              top: '-30%',
              width: 34,
              height: '160%',
              background:
                'linear-gradient(180deg, transparent, rgb(94 234 212 / 0.75) 30%, rgb(45 212 191 / 0.5) 70%, transparent)',
              filter: 'blur(7px)',
              opacity: 0.85,
              animationDuration: '9s'
            }}
          />
          <div
            className="plx-aurora absolute"
            style={{
              right: '17%',
              top: '-30%',
              width: 44,
              height: '160%',
              background:
                'linear-gradient(180deg, transparent, rgb(129 140 248 / 0.65) 35%, rgb(94 234 212 / 0.42) 75%, transparent)',
              filter: 'blur(8px)',
              opacity: 0.75,
              animationDuration: '13s',
              animationDelay: '-4s'
            }}
          />
          <div
            className="plx-aurora absolute"
            style={{
              right: '27%',
              top: '-30%',
              width: 12,
              height: '150%',
              background:
                'linear-gradient(180deg, transparent, rgb(190 250 225 / 0.8) 40%, rgb(94 234 212 / 0.5) 75%, transparent)',
              filter: 'blur(3px)',
              opacity: 0.8,
              animationDuration: '10.5s',
              animationDelay: '-7s'
            }}
          />
          <div
            className="plx-aurora absolute"
            style={{
              right: '34%',
              top: '-30%',
              width: 28,
              height: '160%',
              background:
                'linear-gradient(180deg, transparent, rgb(52 211 153 / 0.5) 40%, rgb(129 140 248 / 0.38) 80%, transparent)',
              filter: 'blur(7px)',
              opacity: 0.65,
              animationDuration: '15s',
              animationDelay: '-8s'
            }}
          />
          {/* glow pooling where the curtains meet the ridge */}
          <div
            className="plx-breathe absolute"
            style={{
              right: 0,
              bottom: '26%',
              width: '58%',
              height: 8,
              background:
                'linear-gradient(90deg, transparent, rgb(94 234 212 / 0.4) 40%, rgb(129 140 248 / 0.28) 75%, transparent)',
              filter: 'blur(3px)',
              animationDuration: '8s'
            }}
          />
          <div
            className="plx-twinkle absolute rounded-full"
            style={{
              right: '46%',
              top: '20%',
              width: 2.5,
              height: 2.5,
              background: 'rgb(255 255 255 / 0.9)',
              boxShadow: '0 0 5px rgb(191 219 254 / 0.8)',
              opacity: 0,
              animationDuration: '6s',
              animationDelay: '-2s'
            }}
          />
          <div
            className="plx-comet absolute"
            style={{
              right: '10%',
              top: '8%',
              width: 44,
              height: 1.5,
              borderRadius: 2,
              background: 'linear-gradient(90deg, rgb(255 255 255 / 0.85), transparent)',
              boxShadow: '0 0 5px rgb(180 220 255 / 0.5)',
              opacity: 0,
              animationDuration: '17s',
              animationDelay: '5s'
            }}
          />
        </>
      )

    case 'midnight-ops':
      // command display: radar scope sweeping over the topo chart (base
      // art), blips lighting as the wedge passes, an intel scanner line
      return (
        <>
          <div
            className="absolute"
            style={{
              right: '6%',
              top: '50%',
              height: '74%',
              aspectRatio: '1 / 1',
              transform: 'translateY(-50%)'
            }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{ border: '1px solid rgb(96 165 250 / 0.32)' }}
            />
            <div
              className="absolute rounded-full"
              style={{ inset: '20%', border: '1px solid rgb(96 165 250 / 0.18)' }}
            />
            <div
              className="absolute rounded-full"
              style={{ inset: '40%', border: '1px solid rgb(96 165 250 / 0.12)' }}
            />
            <div
              className="absolute"
              style={{
                left: 0,
                right: 0,
                top: '50%',
                height: 1,
                background: 'rgb(96 165 250 / 0.12)'
              }}
            />
            <div
              className="absolute"
              style={{
                top: 0,
                bottom: 0,
                left: '50%',
                width: 1,
                background: 'rgb(96 165 250 / 0.09)'
              }}
            />
            <div
              className="plx-rotate absolute rounded-full"
              style={{
                inset: 1,
                background:
                  'conic-gradient(from 0deg, rgb(96 165 250 / 0.45), rgb(96 165 250 / 0.06) 70deg, transparent 85deg)',
                animationDuration: '6s'
              }}
            />
            <div
              className="plx-blip absolute rounded-full"
              style={{
                left: '26%',
                top: '58%',
                width: 2.5,
                height: 2.5,
                background: 'rgb(147 197 253)',
                boxShadow: '0 0 4px rgb(96 165 250 / 0.9)',
                opacity: 0,
                animationDelay: '-4.9s'
              }}
            />
            <div
              className="plx-blip absolute rounded-full"
              style={{
                left: '62%',
                top: '30%',
                width: 2.5,
                height: 2.5,
                background: 'rgb(147 197 253)',
                boxShadow: '0 0 4px rgb(96 165 250 / 0.9)',
                opacity: 0,
                animationDelay: '-2.4s'
              }}
            />
            <div
              className="plx-blip absolute rounded-full"
              style={{
                left: '70%',
                top: '66%',
                width: 2,
                height: 2,
                background: 'rgb(147 197 253)',
                boxShadow: '0 0 4px rgb(96 165 250 / 0.9)',
                opacity: 0,
                animationDelay: '-1.1s'
              }}
            />
          </div>
          {/* intel scanner sweeping the chart */}
          <div className="absolute inset-y-0 overflow-hidden" style={{ right: '22%', width: '34%' }}>
            <div
              className="plx-scan absolute inset-x-0"
              style={{
                top: 0,
                height: 1.5,
                background:
                  'linear-gradient(90deg, transparent, rgb(96 165 250 / 0.5) 30%, rgb(96 165 250 / 0.5) 70%, transparent)',
                boxShadow: '0 0 6px rgb(96 165 250 / 0.4)',
                opacity: 0
              }}
            />
          </div>
        </>
      )

    case 'founder':
      // an engraved seal over the guilloché (base art): rotating conic
      // highlight, compass-star center, twin etched glint lanes, a slow
      // gold sheen catching the engraving
      return (
        <>
          <div
            className="absolute"
            style={{
              right: '8%',
              top: '50%',
              width: 22,
              height: 22,
              transform: 'translateY(-50%)'
            }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: '1px solid rgb(255 214 68 / 0.75)',
                boxShadow: '0 0 12px rgb(255 214 68 / 0.35), inset 0 0 6px rgb(255 214 68 / 0.3)'
              }}
            />
            <div
              className="absolute rounded-full"
              style={{ inset: 3, border: '1px solid rgb(255 214 68 / 0.3)' }}
            />
            <div
              className="plx-rotate absolute rounded-full"
              style={{
                inset: 1,
                background:
                  'conic-gradient(from 0deg, transparent, rgb(255 214 68 / 0.4) 60deg, transparent 120deg)',
                animationDuration: '11s'
              }}
            />
            <div
              className="absolute"
              style={{
                left: '50%',
                top: '50%',
                width: 9,
                height: 9,
                transform: 'translate(-50%, -50%)',
                clipPath:
                  'polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%)',
                background: 'rgb(255 224 130 / 0.95)',
                filter: 'drop-shadow(0 0 3px rgb(255 214 68 / 0.7))'
              }}
            />
          </div>
          <div
            className="absolute overflow-hidden"
            style={{
              right: '17%',
              top: '30%',
              width: '30%',
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgb(255 214 68 / 0.35))'
            }}
          >
            <div
              className="plx-travel absolute inset-y-0"
              style={{
                left: -24,
                width: 22,
                background:
                  'linear-gradient(90deg, transparent, rgb(255 240 170 / 0.95), transparent)',
                opacity: 0,
                ['--plx-p' as string]: '190px',
                animationDuration: '6s'
              }}
            />
          </div>
          <div
            className="absolute overflow-hidden"
            style={{
              right: '17%',
              top: '68%',
              width: '30%',
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgb(255 214 68 / 0.3))'
            }}
          >
            <div
              className="plx-travel absolute inset-y-0"
              style={{
                left: -24,
                width: 22,
                background:
                  'linear-gradient(90deg, transparent, rgb(255 240 170 / 0.9), transparent)',
                opacity: 0,
                ['--plx-p' as string]: '190px',
                animationDuration: '8s',
                animationDelay: '-3.5s'
              }}
            />
          </div>
          <div
            className="plx-beam absolute inset-y-0"
            style={{
              left: 0,
              width: '20%',
              background:
                'linear-gradient(105deg, transparent, rgb(255 226 120 / 0.08) 50%, transparent)',
              transform: 'translate3d(-140%, 0, 0) skewX(-14deg)',
              animationDuration: '11s'
            }}
          />
        </>
      )

    case 'beta-tester':
      // the flight-test bench: a drafting lamp breathing over the blueprint
      // (base art), a review scanline sweeping the sheet, a telemetry packet
      // running the dashed centerline tail-to-nose, wingtip strobes pulsing,
      // QA glints sparking on the airframe. Fixed-px offsets mirror the base
      // sheet box (right 10px center / 154×56).
      return (
        <>
          <div
            className="plx-breathe absolute inset-y-0"
            style={{
              right: 0,
              width: '42%',
              background:
                'radial-gradient(75% 120% at 88% 45%, rgb(125 211 252 / 0.12), transparent 70%)',
              animationDuration: '7.5s'
            }}
          />
          {/* review scanline confined to the sheet */}
          <div className="absolute inset-y-0 overflow-hidden" style={{ right: 10, width: 154 }}>
            <div
              className="plx-scan absolute inset-x-0"
              style={{
                top: 0,
                height: 1.5,
                background:
                  'linear-gradient(90deg, transparent, rgb(125 211 252 / 0.55) 30%, rgb(125 211 252 / 0.55) 70%, transparent)',
                boxShadow: '0 0 6px rgb(125 211 252 / 0.45)',
                opacity: 0
              }}
            />
          </div>
          {/* telemetry packet on the dashed centerline (drawn by the base) */}
          <div
            className="absolute overflow-hidden"
            style={{ right: 32, top: 'calc(50% - 1px)', width: 96, height: 2 }}
          >
            <div
              className="plx-travel absolute inset-y-0"
              style={{
                left: -20,
                width: 18,
                borderRadius: 2,
                background: 'linear-gradient(90deg, transparent, rgb(186 230 253 / 0.9))',
                boxShadow: '0 0 6px rgb(125 211 252 / 0.6)',
                opacity: 0,
                ['--plx-p' as string]: '130px',
                animationDuration: '5s'
              }}
            />
          </div>
          {/* wingtip strobes — de-synced so they never pulse in unison */}
          <div
            className="plx-node absolute rounded-full"
            style={{
              right: 55,
              top: 'calc(50% - 21px)',
              width: 3,
              height: 3,
              background: 'rgb(251 191 36 / 0.9)',
              boxShadow: '0 0 5px rgb(251 191 36 / 0.7)',
              animationDuration: '2.6s'
            }}
          />
          <div
            className="plx-node absolute rounded-full"
            style={{
              right: 55,
              top: 'calc(50% + 18px)',
              width: 3,
              height: 3,
              background: 'rgb(125 211 252 / 0.9)',
              boxShadow: '0 0 5px rgb(125 211 252 / 0.7)',
              animationDuration: '3.2s',
              animationDelay: '-1.4s'
            }}
          />
          {/* QA glints: calibration patches, then the cockpit */}
          <div
            className="plx-twinkle absolute"
            style={{
              right: 84,
              top: 'calc(50% - 10px)',
              width: 5,
              height: 5,
              background: 'rgb(255 236 170)',
              boxShadow: '0 0 6px rgb(251 191 36 / 0.8)',
              opacity: 0,
              animationDuration: '5.5s',
              animationDelay: '-1.8s'
            }}
          />
          <div
            className="plx-twinkle absolute"
            style={{
              right: 106,
              top: 'calc(50% - 2px)',
              width: 4,
              height: 4,
              background: 'rgb(224 242 254)',
              boxShadow: '0 0 5px rgb(125 211 252 / 0.8)',
              opacity: 0,
              animationDuration: '6.6s',
              animationDelay: '-4.2s'
            }}
          />
          <div
            className="plx-beam absolute inset-y-0"
            style={{
              left: 0,
              width: '18%',
              background:
                'linear-gradient(105deg, transparent, rgb(168 216 255 / 0.09) 50%, transparent)',
              transform: 'translate3d(-140%, 0, 0) skewX(-14deg)',
              animationDuration: '10s'
            }}
          />
        </>
      )

    case 'event-horizon':
      // Gargantua, alive. Hole center pinned at right 96px / 50% (mirrors
      // the base art in plates.ts). Continuous: three conic shear bands lap
      // the disk plane at 7/16/34s (differential rotation), a hot lobe
      // flashes the approaching left limb each 9s pass through a static
      // crescent mask (relativistic beaming), a bead of light circles the
      // photon ring every 3.5s, the lensed arches shimmer in counter-phase
      // and matter spirals in along three lanes. Every 45s a star wanders
      // in from the left, spaghettifies around the well and sets the whole
      // disk flaring (plx-eh-tde-*). Hover feeds the disk: luminance
      // blooms → hidden fast band crossfades in (spin-up) → ring + arches
      // bloom → the well pulls 3% closer (transition layers, separate from
      // every keyframed loop). Reduced motion: keyframes freeze to their
      // designed rest (hot limb lit, bead parked on the doppler side) and
      // the transients carry inline opacity 0.
      return (
        <div className="absolute" style={{ right: 96, top: '50%' }}>
          {/* lens-pull hover wrapper — transitions only */}
          <div className="plx-eh-hwell absolute" style={{ left: -170, top: -170, width: 340, height: 340 }}>
            {/* ---- disk plane: squashed onto the painted disk ellipse ---- */}
            <div className="absolute inset-0" style={{ transform: 'rotate(-8deg) scaleY(0.13)' }}>
              {/* disk luminance gate — rests dimmed, hover blooms it */}
              <div className="plx-eh-hdisk absolute inset-0">
                {/* inner band, one lap / 7s (annulus masks are concentric,
                    so they ride the rotating children rotation-invariant) */}
                <div
                  className="plx-rotate absolute inset-0 rounded-full"
                  style={{
                    background:
                      'conic-gradient(from 0deg, transparent 0deg, rgb(255 246 232 / 0.5) 30deg, transparent 58deg, rgb(255 232 204 / 0.3) 96deg, transparent 128deg, rgb(255 240 218 / 0.4) 168deg, transparent 205deg, rgb(255 250 240 / 0.62) 245deg, rgb(255 236 210 / 0.34) 275deg, transparent 305deg, rgb(255 244 226 / 0.36) 335deg, transparent 360deg)',
                    WebkitMaskImage:
                      'radial-gradient(circle, transparent 0 26px, rgb(0 0 0) 33px 52px, transparent 58px)',
                    maskImage:
                      'radial-gradient(circle, transparent 0 26px, rgb(0 0 0) 33px 52px, transparent 58px)',
                    mixBlendMode: 'screen',
                    animationDuration: '7s'
                  }}
                />
                {/* mid band, 16s */}
                <div
                  className="plx-rotate absolute inset-0 rounded-full"
                  style={{
                    background:
                      'conic-gradient(from 0deg, transparent 0deg, rgb(255 216 178 / 0.34) 45deg, transparent 82deg, rgb(255 200 155 / 0.24) 130deg, transparent 172deg, rgb(255 224 190 / 0.42) 225deg, rgb(255 205 165 / 0.26) 262deg, transparent 300deg, rgb(255 214 176 / 0.26) 340deg, transparent 360deg)',
                    WebkitMaskImage:
                      'radial-gradient(circle, transparent 0 52px, rgb(0 0 0) 60px 84px, transparent 91px)',
                    maskImage:
                      'radial-gradient(circle, transparent 0 52px, rgb(0 0 0) 60px 84px, transparent 91px)',
                    mixBlendMode: 'screen',
                    animationDuration: '16s',
                    animationDelay: '-5s'
                  }}
                />
                {/* outer band, 34s — dusty fringe luminance */}
                <div
                  className="plx-rotate absolute inset-0 rounded-full"
                  style={{
                    background:
                      'conic-gradient(from 0deg, transparent 0deg, rgb(224 158 118 / 0.24) 55deg, transparent 100deg, rgb(205 138 100 / 0.18) 150deg, transparent 196deg, rgb(235 175 135 / 0.3) 250deg, transparent 294deg, rgb(214 148 110 / 0.2) 330deg, transparent 360deg)',
                    WebkitMaskImage:
                      'radial-gradient(circle, transparent 0 84px, rgb(0 0 0) 93px 120px, transparent 130px)',
                    maskImage:
                      'radial-gradient(circle, transparent 0 84px, rgb(0 0 0) 93px 120px, transparent 130px)',
                    mixBlendMode: 'screen',
                    animationDuration: '34s',
                    animationDelay: '-13s'
                  }}
                />
                {/* doppler surge — the hot lobe under a static crescent mask
                    on the approaching limb; every 9s pass = one beaming
                    flash. At rest (0°) the lobe parks inside the crescent. */}
                <div
                  className="absolute inset-0"
                  style={{
                    WebkitMaskImage:
                      'radial-gradient(130px 64px at 24% 50%, rgb(0 0 0) 0 32%, rgb(0 0 0 / 0.5) 56%, transparent 74%)',
                    maskImage:
                      'radial-gradient(130px 64px at 24% 50%, rgb(0 0 0) 0 32%, rgb(0 0 0 / 0.5) 56%, transparent 74%)'
                  }}
                >
                  <div
                    className="plx-rotate absolute inset-0 rounded-full"
                    style={{
                      background:
                        'conic-gradient(from 0deg, transparent 0deg 232deg, rgb(255 250 242 / 0.5) 260deg, rgb(255 255 255 / 0.68) 272deg, rgb(255 244 226 / 0.42) 288deg, transparent 314deg 360deg)',
                      WebkitMaskImage:
                        'radial-gradient(circle, transparent 0 30px, rgb(0 0 0) 40px 112px, transparent 122px)',
                      maskImage:
                        'radial-gradient(circle, transparent 0 30px, rgb(0 0 0) 40px 112px, transparent 122px)',
                      mixBlendMode: 'screen',
                      animationDuration: '9s'
                    }}
                  />
                </div>
              </div>
              {/* hover spin-up — a hidden faster band that crossfades in, so
                  the disk reads as accelerating without restarting a loop */}
              <div className="plx-eh-hspin absolute inset-0">
                <div
                  className="plx-rotate absolute inset-0 rounded-full"
                  style={{
                    background:
                      'conic-gradient(from 0deg, transparent 0deg, rgb(255 248 236 / 0.5) 24deg, transparent 58deg, rgb(255 240 220 / 0.4) 130deg, transparent 170deg, rgb(255 250 242 / 0.55) 250deg, transparent 296deg, rgb(255 238 214 / 0.36) 330deg, transparent 360deg)',
                    WebkitMaskImage:
                      'radial-gradient(circle, transparent 0 30px, rgb(0 0 0) 40px 116px, transparent 126px)',
                    maskImage:
                      'radial-gradient(circle, transparent 0 30px, rgb(0 0 0) 40px 116px, transparent 126px)',
                    mixBlendMode: 'screen',
                    animationDuration: '5s'
                  }}
                />
              </div>
              {/* tidal-disruption accretion flare — the whole disk brightens
                  as the star is eaten, then a long ember afterglow */}
              <div
                className="plx-eh-tde-flare absolute inset-0 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgb(255 244 226 / 0) 5%, rgb(255 240 212 / 0.7) 24%, rgb(255 208 152 / 0.42) 52%, rgb(232 152 102 / 0.2) 68%, transparent 78%)',
                  WebkitMaskImage:
                    'radial-gradient(circle, transparent 0 17px, rgb(0 0 0) 25px 122px, transparent 136px)',
                  maskImage:
                    'radial-gradient(circle, transparent 0 17px, rgb(0 0 0) 25px 122px, transparent 136px)',
                  mixBlendMode: 'screen',
                  opacity: 0,
                  transform: 'scale(0.8)'
                }}
              />
            </div>
            {/* ---- infall plane: milder squash so spirals read as matter
                folding down onto the disk from above/below ---- */}
            <div className="absolute inset-0" style={{ transform: 'rotate(-8deg) scaleY(0.5)' }}>
              {INFALL_LANES.map((lane, i) => (
                <div
                  key={i}
                  className="plx-eh-infall absolute"
                  style={{
                    left: 157,
                    top: 168.7,
                    width: 26,
                    height: 2.6,
                    borderRadius: 2,
                    background: 'linear-gradient(90deg, transparent, rgb(255 236 214 / 0.75))',
                    boxShadow: '0 0 4px rgb(255 220 180 / 0.45)',
                    opacity: 0,
                    ['--plx-ia' as string]: `${lane.from}deg`,
                    ['--plx-ib' as string]: `${lane.to}deg`,
                    ['--plx-ir' as string]: `${lane.radius}px`,
                    animationDuration: lane.dur,
                    animationDelay: lane.delay
                  }}
                />
              ))}
              {/* the 45s disruption: whip wrapper slings the star around the
                  well while tidal forces stretch it into a filament. The
                  approach rides ~20 screen px ABOVE the disk plane (the y
                  offset lives in the star's translate keyframes) so the
                  doomed star drifts in against dark sky instead of hiding
                  in the hot limb; the 126° whip then slings it over the
                  halo and the filament smears into the disk far side. */}
              <div className="plx-eh-tde-whip absolute inset-0">
                <div
                  className="plx-eh-tde-star absolute"
                  style={{
                    left: 162,
                    top: 168.1,
                    width: 16,
                    height: 3.8,
                    borderRadius: 2,
                    background:
                      'linear-gradient(90deg, transparent, rgb(255 240 220 / 0.92) 40%, rgb(255 255 255 / 1))',
                    boxShadow: '0 0 7px rgb(255 238 205 / 0.9), 0 0 16px rgb(255 210 150 / 0.5)',
                    opacity: 0
                  }}
                />
              </div>
            </div>
            {/* photon-ring bead — light orbiting the photon sphere every
                3.5s; rests parked on the doppler-bright left side */}
            <div className="absolute" style={{ left: 156, top: 156, width: 28, height: 28 }}>
              <div
                className="plx-rotate absolute inset-0"
                style={{
                  background:
                    'radial-gradient(4.4px 4.4px at 1.4px 50%, rgb(255 255 255 / 1), rgb(255 235 205 / 0.55) 55%, transparent 80%)',
                  animationDuration: '3.5s'
                }}
              />
            </div>
            {/* tidal-disruption photon-ring bloom */}
            <div
              className="plx-eh-tde-ring absolute rounded-full"
              style={{
                left: 153,
                top: 153,
                width: 34,
                height: 34,
                border: '1.5px solid rgb(255 248 238 / 0.9)',
                boxShadow:
                  '0 0 16px rgb(255 228 180 / 0.8), 0 0 40px rgb(255 200 130 / 0.5), inset 0 0 12px rgb(255 240 214 / 0.65)',
                opacity: 0,
                transform: 'scale(0.86)'
              }}
            />
            {/* the lensed arches shimmer in loose counter-phase */}
            <div
              className="plx-breathe absolute"
              style={{
                left: 150,
                top: 141,
                width: 40,
                height: 20,
                borderRadius: '50%',
                background:
                  'radial-gradient(50% 50% at 50% 50%, rgb(255 243 224 / 0.34), rgb(255 220 180 / 0.13) 55%, transparent 76%)',
                filter: 'blur(3px)',
                animationDuration: '8s'
              }}
            />
            <div
              className="plx-breathe absolute"
              style={{
                left: 153,
                top: 179,
                width: 34,
                height: 16,
                borderRadius: '50%',
                background:
                  'radial-gradient(50% 50% at 50% 50%, rgb(255 238 214 / 0.26), rgb(255 214 172 / 0.1) 55%, transparent 76%)',
                filter: 'blur(3px)',
                animationDuration: '9s',
                animationDelay: '-4.5s'
              }}
            />
            {/* hover ring + arch bloom — pure transition layer */}
            <div
              className="plx-eh-hring absolute"
              style={{
                left: 136,
                top: 130,
                width: 68,
                height: 80,
                background: [
                  'radial-gradient(24px 12px at 50% 24px, rgb(255 244 226 / 0.5), transparent 72%)',
                  'radial-gradient(19px 10px at 50% 56px, rgb(255 238 214 / 0.36), transparent 74%)',
                  'radial-gradient(circle 20px at 50% 40px, transparent 0 11px, rgb(255 250 240 / 0.55) 13.5px, transparent 19px)'
                ].join(', '),
                mixBlendMode: 'screen'
              }}
            />
          </div>
        </div>
      )

    case 'prime-anomaly':
      // the flagship: a cracked patch of sky (stars + two worlds in the
      // base art) on a ~45s reality cycle — rest
      // (containment cracks shimmering around the seam) → RGB-split ticks →
      // a jagged tear snaps open (transform-scaled wrapper behind an SVG
      // mask, never an animated clip-path) and the dimension inside EMITS:
      // two pre-painted ray fans counter-rotate and flicker out of the rift,
      // a white-violet core flare breathes, an ambient wash tints the whole
      // panel — all gated by one burst wrapper on the master clock → shards
      // escape → it snaps shut with a white line flash.
      //
      // Hover is a CHOREOGRAPHED TRANSFORMATION of the resting crack, not a
      // state swap: transition-driven hover layers (hveins/hseam/hrift/
      // hburst — see the choreography comment in the styles) open the crack
      // into the rift in causal order and reverse in causal order, while
      // the 45s cycle content sits in a .plx-anom-cycle gate that
      // crossfades away under hover.
      //
      // NOTHING IS STATIC: the sky carries two parallax star strata, three
      // discrete twinkles and a rare shooting star; the nebula aurora-
      // drifts in two counter-phased veils; the gas giant gets an orbiting
      // moonlet (occluded through the far side), a traveling ring glint
      // and a rim-light breathe; the moon's crescent shimmers; and the
      // etched crack RE-CRACKS on a 12s propagation loop (light front +
      // stepped extension arms + stress jitter). All ambient amplitude —
      // the rift stays the protagonist. Reduced motion: sealed panel, the
      // etched cracks + a static center glow.
      return (
        <>
          {/* ---- the living sky (everything here is ambient amplitude) ----
              nebula aurora: two counter-phased violet veils over the baked
              radial, upper right */}
          <div
            className="plx-anom-nebula absolute"
            style={{
              right: '-16%',
              top: '-60%',
              width: '72%',
              height: '150%',
              background:
                'radial-gradient(50% 50% at 50% 50%, rgb(122 96 220 / 0.12), rgb(91 74 176 / 0.05) 55%, transparent 75%)'
            }}
          />
          <div
            className="plx-anom-nebula absolute"
            style={{
              right: '-4%',
              top: '-35%',
              width: '46%',
              height: '110%',
              background:
                'radial-gradient(50% 50% at 50% 50%, rgb(151 118 255 / 0.09), transparent 70%)',
              animationDuration: '78s',
              animationDirection: 'alternate-reverse'
            }}
          />
          {/* two star strata drifting at different speeds in opposite
              directions over the static base field — parallax depth. Each
              extends one tile past its wrap edge so the loop is seamless. */}
          <div
            className="plx-drift absolute inset-y-0"
            style={{
              left: 0,
              right: -96,
              backgroundImage:
                'radial-gradient(circle, rgb(125 232 255 / 0.4) 0.8px, transparent 1.4px)',
              backgroundSize: '96px 52px',
              backgroundPosition: '31px 14px',
              ['--plx-d' as string]: '-96px',
              animationDuration: '95s'
            }}
          />
          <div
            className="plx-drift absolute inset-y-0"
            style={{
              left: -148,
              right: 0,
              backgroundImage:
                'radial-gradient(circle, rgb(199 190 255 / 0.35) 1px, transparent 1.6px)',
              backgroundSize: '148px 64px',
              backgroundPosition: '87px 40px',
              ['--plx-d' as string]: '148px',
              animationDuration: '140s'
            }}
          />
          {/* discrete twinkles — sharp attack, staggered, right of the name */}
          <div
            className="plx-twinkle absolute"
            style={{
              right: '27%',
              top: '22%',
              width: 3,
              height: 3,
              background: 'rgb(234 252 255 / 0.95)',
              boxShadow: '0 0 6px rgb(125 232 255 / 0.9)',
              opacity: 0,
              animationDuration: '5.4s'
            }}
          />
          <div
            className="plx-twinkle absolute"
            style={{
              right: '44%',
              top: '64%',
              width: 2.5,
              height: 2.5,
              background: 'rgb(234 252 255 / 0.9)',
              boxShadow: '0 0 5px rgb(125 232 255 / 0.8)',
              opacity: 0,
              animationDuration: '6.8s',
              animationDelay: '-2.3s'
            }}
          />
          <div
            className="plx-twinkle absolute"
            style={{
              right: '11%',
              top: '74%',
              width: 2.5,
              height: 2.5,
              background: 'rgb(223 246 255 / 0.9)',
              boxShadow: '0 0 5px rgb(199 190 255 / 0.8)',
              opacity: 0,
              animationDuration: '7.6s',
              animationDelay: '-4.9s'
            }}
          />
          {/* one rare shooting star, upper right, every ~24s */}
          <div
            className="plx-comet absolute"
            style={{
              right: '6%',
              top: '14%',
              width: 54,
              height: 1.5,
              borderRadius: 2,
              background: 'linear-gradient(90deg, rgb(234 252 255 / 0.9), transparent)',
              boxShadow: '0 0 5px rgb(125 232 255 / 0.55)',
              opacity: 0,
              animationDuration: '24s',
              animationDelay: '-6s'
            }}
          />
          {/* ---- the worlds (pinned to the baked planets tile: right 4px
              center / 190×110 → planet center at right 56px, 50% − 21px;
              moon center at right 142px, 50% + 23px) ----
              rim-light breathe: the rift's glow catching the gas giant's
              seam-facing limb, loosely in phase with the veins pulse */}
          <div
            className="plx-anom-hrim absolute"
            style={{ right: 43, top: 'calc(50% - 34px)', width: 26, height: 26 }}
          >
            <div
              className="plx-breathe absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 20% 32%, rgb(125 244 255 / 0.34), transparent 56%)',
                animationDuration: '7.5s'
              }}
            />
          </div>
          {/* moonlet: a bright grain orbiting the ring's -16° ellipse
              (precomputed 12-point translate path), occluded through the
              far-side transit behind the planet's disk */}
          <div
            className="plx-anom-moonlet absolute rounded-full"
            style={{
              right: 55,
              top: 'calc(50% - 22px)',
              width: 2.5,
              height: 2.5,
              background: 'rgb(234 252 255 / 0.95)',
              boxShadow: '0 0 4px rgb(125 232 255 / 0.8)',
              opacity: 0
            }}
          />
          {/* ring glint: a bright dash sweeping the ring's lit front arc */}
          <div
            className="plx-anom-ringlint absolute"
            style={{
              right: 52,
              top: 'calc(50% - 22px)',
              width: 8,
              height: 2,
              borderRadius: 1,
              background:
                'linear-gradient(90deg, transparent, rgb(240 253 255 / 0.9), transparent)',
              opacity: 0
            }}
          />
          {/* the dusty-rose moon's crescent shimmer — lit BY the rift, so
              it carries the rift's icy light, not its own pink */}
          <div
            className="plx-anom-hrim absolute"
            style={{ right: 136, top: 'calc(50% + 17px)', width: 12, height: 12 }}
          >
            <div
              className="plx-breathe absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 28% 28%, rgb(191 244 255 / 0.4), transparent 58%)',
                animationDuration: '10.5s',
                animationDelay: '-4s'
              }}
            />
          </div>
          {/* rest state: faint life crawling along the containment cracks.
              Masked by the exact SVG tile the base art etches, seated on
              the same box (left = 64% seam - tile half-width; see plates.ts
              for the position math). HOVER LAYER: the wrapper's transition
              widens/brightens the fracture first-in and dims it last-out;
              the inner light keeps the ambient pulse + drift keyframes. */}
          <div
            className="plx-anom-hveins absolute"
            style={{
              left: 'calc(64% - 130px)',
              top: '50%',
              width: 260,
              height: 120,
              marginTop: -60,
              WebkitMaskImage: ANOMALY_CRACKS,
              WebkitMaskSize: '100% 100%',
              maskImage: ANOMALY_CRACKS,
              maskSize: '100% 100%',
              // the filaments EMIT: a soft halo resolved from the masked
              // art, so the crack reads as a hairline of light at rest
              filter: 'drop-shadow(0 0 3px rgb(125 244 255 / 0.4))'
            }}
          >
            {/* constant heart of light at the nucleus — never sleeps */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(22% 38% at 50% 50%, rgb(234 252 255 / 0.55), rgb(125 244 255 / 0.2) 60%, transparent 80%)'
              }}
            />
            <div
              className="plx-anom-vein-light absolute"
              style={{
                inset: '-30% -20%',
                background:
                  'radial-gradient(42% 58% at 50% 50%, rgb(244 254 255 / 0.9), rgb(125 244 255 / 0.55) 40%, rgb(109 91 255 / 0.24) 68%, transparent 82%)'
              }}
            />
          </div>
          {/* the seam glow. HOVER LAYER: blooms wide as the crack gives;
              the inner div keeps the ambient breathe keyframes. */}
          <div
            className="plx-anom-hseam absolute inset-y-0"
            style={{ left: '56%', width: '16%' }}
          >
            <div
              className="plx-breathe absolute inset-0"
              style={{
                background:
                  'radial-gradient(40% 70% at 50% 50%, rgb(125 244 255 / 0.1), transparent 72%)',
                animationDuration: '8s'
              }}
            />
          </div>
          {/* ============ CYCLE LAYER: the 45s loop, untouched by hover
              except through this gate, which crossfades the whole loop out
              while the hover rift owns the seam (no double-brightening if
              the pointer arrives mid-burst) and back in after unhover. */}
          <div className="plx-anom-cycle absolute inset-0">
          {/* ---- fracture propagation, 12s loop (offset from the 45s
              master so surges land in different cycle phases). Inside the
              cycle gate: hover crossfades it away while the rift owns the
              seam. The assembly rides a stepped ±1px stress jitter. */}
          <div
            className="plx-anom-crackjit absolute"
            style={{
              left: 'calc(64% - 130px)',
              top: '50%',
              width: 260,
              height: 120,
              marginTop: -60
            }}
          >
            {/* the light front: a pre-painted ring gradient scaling out of
                the nucleus, confined to the filaments by the crack mask —
                light racing outward along the arms */}
            <div
              className="absolute inset-0"
              style={{
                WebkitMaskImage: ANOMALY_CRACKS,
                WebkitMaskSize: '100% 100%',
                maskImage: ANOMALY_CRACKS,
                maskSize: '100% 100%'
              }}
            >
              <div
                className="plx-anom-front absolute"
                style={{
                  left: '50%',
                  top: '50%',
                  width: 220,
                  height: 220,
                  marginLeft: -110,
                  marginTop: -110,
                  background:
                    'radial-gradient(circle closest-side, rgb(244 254 255 / 0.9) 4%, rgb(165 243 252 / 0.5) 12%, transparent 34%, transparent 50%, rgb(234 252 255 / 0.85) 62%, rgb(125 232 255 / 0.35) 72%, transparent 80%)',
                  opacity: 0
                }}
              />
            </div>
            {/* extension arms: reveal-wipe pairs (overflow-hidden wrapper
                scaleX staircase 0.34→0.67→1, inner counter-scale keeps the
                art unstretched) growing off three etched arm tips — east
                (236,60), northeast (206,18), southeast (206,98) */}
            <div
              className="plx-anom-armw absolute overflow-hidden"
              style={{
                left: 236,
                top: 53,
                width: 48,
                height: 14,
                transformOrigin: 'left center',
                opacity: 0
              }}
            >
              <div
                className="plx-anom-armi absolute inset-0"
                style={{
                  backgroundImage: ANOM_ARM_A,
                  backgroundSize: '100% 100%',
                  transformOrigin: 'left center'
                }}
              />
            </div>
            <div
              className="plx-anom-armw absolute overflow-hidden"
              style={{
                left: 206,
                top: 0,
                width: 40,
                height: 20,
                transformOrigin: 'left center',
                opacity: 0
              }}
            >
              <div
                className="plx-anom-armi absolute inset-0"
                style={{
                  backgroundImage: ANOM_ARM_B,
                  backgroundSize: '100% 100%',
                  transformOrigin: 'left center'
                }}
              />
            </div>
            <div
              className="plx-anom-armw absolute overflow-hidden"
              style={{
                left: 206,
                top: 96,
                width: 42,
                height: 21,
                transformOrigin: 'left center',
                opacity: 0
              }}
            >
              <div
                className="plx-anom-armi absolute inset-0"
                style={{
                  backgroundImage: ANOM_ARM_C,
                  backgroundSize: '100% 100%',
                  transformOrigin: 'left center'
                }}
              />
            </div>
          </div>
          {/* RGB-split interference ticks, centered on the seam */}
          <div
            className="plx-anom-tick absolute"
            style={{
              left: '42%',
              right: '6%',
              top: '30%',
              height: 2.5,
              background:
                'linear-gradient(90deg, transparent, rgb(125 244 255 / 0.55) 28%, rgb(240 253 255 / 0.35) 52%, rgb(255 79 216 / 0.42) 74%, transparent)',
              opacity: 0
            }}
          />
          <div
            className="plx-anom-tick absolute"
            style={{
              left: '48%',
              right: '10%',
              top: '62%',
              height: 2,
              background:
                'linear-gradient(90deg, transparent, rgb(255 79 216 / 0.38) 30%, rgb(125 244 255 / 0.5) 68%, transparent)',
              opacity: 0,
              animationDelay: '-0.22s'
            }}
          />
          {/* the tear — scaleX wrapper opening a masked window of LIGHT
              along the crack's own polyline; chromatic dispersion rides
              its edges. Inside the mask, back to front: ultraviolet→cyan→
              white falloff, two counter-drifting boil fields (the light
              churns), the blinding core column (overexposure flicker),
              then the torn-edge tile — a dark lip + white-hot line that
              follow the silhouette exactly (the panel's torn thickness,
              the 3D cross-section). */}
          <div
            className="absolute inset-y-0"
            style={{ left: 'calc(64% - 22px)', width: 44 }}
          >
            <div
              className="plx-anom-tear absolute inset-0"
              style={{ transform: 'scaleX(0)', opacity: 0 }}
            >
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  WebkitMaskImage: ANOM_TEAR_MASK,
                  WebkitMaskSize: '100% 100%',
                  maskImage: ANOM_TEAR_MASK,
                  maskSize: '100% 100%',
                  // bloom hierarchy outside the silhouette: tight hot rim +
                  // wide soft ultraviolet halo (the mask shape is constant,
                  // so both shadows resolve on GPU)
                  filter:
                    'drop-shadow(0 0 3px rgb(191 244 255 / 0.9)) drop-shadow(0 0 13px rgb(109 91 255 / 0.55))'
                }}
              >
                {/* light volume: edges fall to ultraviolet, center clips white.
                    Overbled 4px so hover parity (the rift's parallax layer)
                    shares identical gradient geometry. */}
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: -4,
                    right: -4,
                    background:
                      'linear-gradient(90deg, rgb(43 30 120 / 0.98) 20%, rgb(87 108 228 / 0.9) 29%, rgb(34 211 238 / 0.85) 37%, rgb(234 252 255 / 0.97) 47%, rgb(255 255 255) 50%, rgb(234 252 255 / 0.97) 53%, rgb(34 211 238 / 0.85) 63%, rgb(87 108 228 / 0.9) 71%, rgb(43 30 120 / 0.98) 80%)'
                  }}
                />
                <div
                  className="plx-anom-boil-a absolute"
                  style={{
                    inset: '-30% -40%',
                    background:
                      'radial-gradient(42% 30% at 38% 30%, rgb(125 244 255 / 0.5), transparent 70%), radial-gradient(36% 26% at 66% 74%, rgb(139 124 255 / 0.5), transparent 70%), radial-gradient(26% 20% at 52% 50%, rgb(255 255 255 / 0.5), transparent 70%)',
                    mixBlendMode: 'screen'
                  }}
                />
                <div
                  className="plx-anom-boil-b absolute"
                  style={{
                    inset: '-30% -40%',
                    background:
                      'radial-gradient(38% 26% at 60% 24%, rgb(234 252 255 / 0.5), transparent 70%), radial-gradient(34% 24% at 36% 66%, rgb(125 244 255 / 0.45), transparent 70%)',
                    mixBlendMode: 'screen'
                  }}
                />
                <div
                  className="plx-anom-core absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 38%, rgb(255 255 255 / 0.95) 47%, rgb(255 255 255) 50%, rgb(255 255 255 / 0.95) 53%, transparent 62%)'
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: ANOM_TEAR_EDGE,
                    backgroundSize: '100% 100%'
                  }}
                />
              </div>
              {/* chromatic dispersion: cyan/magenta strokes of the SAME
                  silhouette, offset a hair left/right — aberration hugging
                  every jag of the torn edge (the only pink in the scene) */}
              <div
                className="absolute"
                style={{
                  inset: 0,
                  backgroundImage: ANOM_TEAR_FRINGE,
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  mixBlendMode: 'screen',
                  opacity: 0.9
                }}
              />
            </div>
          </div>
          {/* THE RAY BURST — light escaping the rift. One wrapper carries
              cycle visibility + hover; the fans/flare inside only wobble
              and flicker, so they inherit whichever gate is active. Fixed
              640×440 px star tiles centered on the tear so beams rake far
              across the panel at every strip height. */}
          <div
            className="plx-anom-burst absolute"
            style={{
              left: 'calc(64% - 320px)',
              top: '50%',
              width: 640,
              height: 440,
              marginTop: -220,
              opacity: 0,
              transform: 'scale(0.45)'
            }}
          >
            {/* ambient ultraviolet wash — the whole panel catches the light */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(50% 50% at 50% 50%, rgb(109 91 255 / 0.3), rgb(76 56 200 / 0.12) 55%, transparent 78%)'
              }}
            />
            {/* light body: ambient ellipse + seam bloom column + anamorphic
                streak — a lens artifact, so it never rakes, only breathes */}
            <div
              className="plx-anom-rays-glow absolute inset-0"
              style={{
                backgroundImage: ANOM_RAYS_GLOW,
                backgroundSize: '100% 100%',
                mixBlendMode: 'screen'
              }}
            />
            {/* volumetric blades: blurred wedges raking slowly */}
            <div
              className="plx-anom-rays-blades absolute inset-0"
              style={{
                backgroundImage: ANOM_RAYS_BLADES,
                backgroundSize: '100% 100%',
                mixBlendMode: 'screen'
              }}
            />
            {/* scintillating needles: counter-raking + stepped flicker */}
            <div
              className="plx-anom-rays-needles absolute inset-0"
              style={{
                backgroundImage: ANOM_RAYS_NEEDLES,
                backgroundSize: '100% 100%',
                mixBlendMode: 'screen'
              }}
            />
            {/* core flare at the rift mouth */}
            <div
              className="plx-anom-flare-core absolute"
              style={{
                left: '50%',
                top: '50%',
                width: 88,
                height: 64,
                marginLeft: -44,
                marginTop: -32,
                background:
                  'radial-gradient(50% 50% at 50% 50%, rgb(255 255 255 / 0.95), rgb(207 200 255 / 0.55) 38%, rgb(109 91 255 / 0.24) 62%, transparent 80%)',
                mixBlendMode: 'screen'
              }}
            />
          </div>
          {/* escaping shards — only alive while the tear is open */}
          {ANOM_SHARDS.map((shard, i) => (
            <div
              key={i}
              className="plx-anom-shard absolute"
              style={{
                left: shard.left,
                top: shard.top,
                width: shard.size,
                height: shard.size,
                background: shard.tint,
                boxShadow: `0 0 6px ${shard.glow}`,
                clipPath: 'polygon(50% 0, 100% 62%, 24% 100%)',
                opacity: 0,
                ['--plx-sx' as string]: shard.sx,
                ['--plx-sy' as string]: shard.sy,
                animationDelay: shard.delay
              }}
            />
          ))}
          {/* the snap-shut flash on the seam… */}
          <div
            className="plx-anom-flash absolute inset-y-0"
            style={{
              left: 'calc(64% - 1px)',
              width: 2,
              background: 'rgb(245 253 255 / 0.95)',
              boxShadow: '0 0 12px rgb(190 245 255 / 0.9), 0 0 30px rgb(125 244 255 / 0.5)',
              opacity: 0
            }}
          />
          {/* …and its chromatic afterimage, one dispersion beat behind */}
          <div
            className="plx-anom-flash-echo absolute inset-y-0"
            style={{
              left: 'calc(64% + 1px)',
              width: 1.5,
              background: 'rgb(255 79 216 / 0.8)',
              boxShadow: '0 0 9px rgb(255 79 216 / 0.55)',
              opacity: 0
            }}
          />
          </div>
          {/* ============ HOVER LAYER: the rift the crack becomes. Same
              seam geometry as the cycle tear; opened purely by transitions
              (reversible, interruption-safe). The chrome inside keeps its
              ambient drift keyframes. */}
          <div
            className="absolute inset-y-0"
            style={{ left: 'calc(64% - 22px)', width: 44 }}
          >
            <div className="plx-anom-hrift absolute inset-0">
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  WebkitMaskImage: ANOM_TEAR_MASK,
                  WebkitMaskSize: '100% 100%',
                  maskImage: ANOM_TEAR_MASK,
                  maskSize: '100% 100%',
                  filter:
                    'drop-shadow(0 0 3px rgb(191 244 255 / 0.9)) drop-shadow(0 0 13px rgb(109 91 255 / 0.55))'
                }}
              >
                {/* interior on its own depth layer: a late, slow shift
                    against the fixed torn edge — parallax through the
                    aperture, the "you are looking INTO something" cue */}
                <div className="plx-anom-hdepth absolute inset-0">
                  <div
                    className="absolute inset-y-0"
                    style={{
                      left: -4,
                      right: -4,
                      background:
                        'linear-gradient(90deg, rgb(43 30 120 / 0.98) 20%, rgb(87 108 228 / 0.9) 29%, rgb(34 211 238 / 0.85) 37%, rgb(234 252 255 / 0.97) 47%, rgb(255 255 255) 50%, rgb(234 252 255 / 0.97) 53%, rgb(34 211 238 / 0.85) 63%, rgb(87 108 228 / 0.9) 71%, rgb(43 30 120 / 0.98) 80%)'
                    }}
                  />
                  <div
                    className="plx-anom-boil-a absolute"
                    style={{
                      inset: '-30% -40%',
                      background:
                        'radial-gradient(42% 30% at 38% 30%, rgb(125 244 255 / 0.5), transparent 70%), radial-gradient(36% 26% at 66% 74%, rgb(139 124 255 / 0.5), transparent 70%), radial-gradient(26% 20% at 52% 50%, rgb(255 255 255 / 0.5), transparent 70%)',
                      mixBlendMode: 'screen'
                    }}
                  />
                  <div
                    className="plx-anom-boil-b absolute"
                    style={{
                      inset: '-30% -40%',
                      background:
                        'radial-gradient(38% 26% at 60% 24%, rgb(234 252 255 / 0.5), transparent 70%), radial-gradient(34% 24% at 36% 66%, rgb(125 244 255 / 0.45), transparent 70%)',
                      mixBlendMode: 'screen'
                    }}
                  />
                  <div
                    className="plx-anom-core absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent 38%, rgb(255 255 255 / 0.95) 47%, rgb(255 255 255) 50%, rgb(255 255 255 / 0.95) 53%, transparent 62%)'
                    }}
                  />
                </div>
                {/* the torn edge stays pinned while the interior shifts */}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: ANOM_TEAR_EDGE,
                    backgroundSize: '100% 100%'
                  }}
                />
              </div>
              {/* dispersion — full intensity while held open */}
              <div
                className="absolute"
                style={{
                  inset: 0,
                  backgroundImage: ANOM_TEAR_FRINGE,
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  mixBlendMode: 'screen',
                  opacity: 0.9
                }}
              />
            </div>
          </div>
          {/* hover ray burst — same star tiles as the cycle burst, opened
              by transitions with the fans' spin/flicker keyframes running
              inside, so the held-open state stays alive */}
          <div
            className="plx-anom-hburst absolute"
            style={{
              left: 'calc(64% - 320px)',
              top: '50%',
              width: 640,
              height: 440,
              marginTop: -220
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(50% 50% at 50% 50%, rgb(109 91 255 / 0.3), rgb(76 56 200 / 0.12) 55%, transparent 78%)'
              }}
            />
            <div
              className="plx-anom-rays-glow absolute inset-0"
              style={{
                backgroundImage: ANOM_RAYS_GLOW,
                backgroundSize: '100% 100%',
                mixBlendMode: 'screen'
              }}
            />
            <div
              className="plx-anom-rays-blades absolute inset-0"
              style={{
                backgroundImage: ANOM_RAYS_BLADES,
                backgroundSize: '100% 100%',
                mixBlendMode: 'screen'
              }}
            />
            <div
              className="plx-anom-rays-needles absolute inset-0"
              style={{
                backgroundImage: ANOM_RAYS_NEEDLES,
                backgroundSize: '100% 100%',
                mixBlendMode: 'screen'
              }}
            />
            {/* dust escaping ALONG the beams while the rift is held open —
                the gate's opacity hides them at rest, so their loops cost
                nothing visible */}
            {ANOM_MOTES.map((mote, i) => (
              <div
                key={i}
                className="plx-anom-mote absolute rounded-full"
                style={{
                  left: mote.left,
                  top: mote.top,
                  width: mote.size,
                  height: mote.size,
                  background: 'rgb(234 252 255 / 0.95)',
                  boxShadow: '0 0 5px rgb(125 244 255 / 0.8)',
                  opacity: 0,
                  ['--plx-mx' as string]: mote.dx,
                  ['--plx-my' as string]: mote.dy,
                  animationDuration: mote.dur,
                  animationDelay: mote.delay
                }}
              />
            ))}
            {/* core flare — pure transition child, last to arrive, first
                (after the rays) to die on the way out */}
            <div
              className="plx-anom-hflare absolute"
              style={{
                left: '50%',
                top: '50%',
                width: 88,
                height: 64,
                marginLeft: -44,
                marginTop: -32,
                background:
                  'radial-gradient(50% 50% at 50% 50%, rgb(255 255 255 / 0.95), rgb(207 200 255 / 0.55) 38%, rgb(109 91 255 / 0.24) 62%, transparent 80%)',
                mixBlendMode: 'screen'
              }}
            />
          </div>
        </>
      )

    default: {
      const exhaustive: never = fx
      return exhaustive
    }
  }
}

/** Shop / profile-editor preview: a fixed-ratio strip that mirrors how the
 * plate reads equipped — panel surface behind, left fade, name where the
 * identity text sits on a real row. The panel is the DARK board surface
 * as a literal, not the theme var: plate art is authored against black,
 * and a white fade-out in light mode washes the whole product. A plate is
 * a product — it must look identical in both themes. */
export function PlatePreview({ plateId, className = '' }: PlatePreviewProps) {
  const plate = getPlate(plateId)
  if (!plate) return null

  return (
    <div
      className={`relative aspect-[4/1] w-full overflow-hidden rounded-xl ${className}`}
      style={{
        background: 'rgb(9 10 13)',
        border: '1px solid rgb(255 255 255 / 0.1)'
      }}
    >
      <PlateLayer plateId={plateId} />
      <div className="absolute inset-y-0 left-4 z-10 flex items-center">
        {/* literal near-white, not text-zinc-100: zinc is theme-flipped and
            would go dark-on-dark in light mode over the fixed dark panel */}
        <span
          className="font-display text-sm font-semibold tracking-tight"
          style={{ color: 'rgb(244 244 245)' }}
        >
          {plate.name}
        </span>
      </div>
    </div>
  )
}
