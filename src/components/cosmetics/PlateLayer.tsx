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

import { useEffect, useState } from 'react'
import { getPlate, type PlateFx, type PlateImageRender } from '@/lib/cosmetics/plates'

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

        .plx-petal {
          animation: plx-petal 9s linear infinite;
        }
        @keyframes plx-petal {
          0% {
            transform: translate3d(0, -10px, 0) rotate(0deg);
            opacity: 0;
          }
          8% {
            opacity: 0.9;
          }
          50% {
            transform: translate3d(-18px, 38px, 0) rotate(150deg);
            opacity: 0.85;
          }
          78% {
            transform: translate3d(-4px, 66px, 0) rotate(230deg);
            opacity: 0.7;
          }
          100% {
            transform: translate3d(-22px, 96px, 0) rotate(320deg);
            opacity: 0;
          }
        }

        .plx-koi {
          animation: plx-koi 15s ease-in-out infinite;
        }
        @keyframes plx-koi {
          0% {
            transform: translate3d(14px, 0, 0) rotate(0deg);
            opacity: 0;
          }
          7% {
            opacity: 1;
          }
          30% {
            transform: translate3d(-34px, 3px, 0) rotate(-4deg);
          }
          55% {
            transform: translate3d(-82px, -2px, 0) rotate(3deg);
            opacity: 1;
          }
          80% {
            transform: translate3d(-128px, 2px, 0) rotate(-3deg);
            opacity: 0.9;
          }
          92%,
          100% {
            transform: translate3d(-150px, 0, 0) rotate(0deg);
            opacity: 0;
          }
        }

        .plx-wag {
          transform-origin: right center;
          animation: plx-wag 0.9s ease-in-out infinite;
        }
        @keyframes plx-wag {
          0%,
          100% {
            transform: rotate(7deg);
          }
          50% {
            transform: rotate(-9deg);
          }
        }

        .plx-ripple {
          animation: plx-ripple 8s ease-out infinite;
        }
        @keyframes plx-ripple {
          0% {
            transform: scale(0.25);
            opacity: 0;
          }
          5% {
            opacity: 0.45;
          }
          32%,
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }

        .plx-caustic {
          animation: plx-caustic 13s ease-in-out infinite;
        }
        @keyframes plx-caustic {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(10px, 4px, 0);
          }
        }

        .plx-bubble {
          animation: plx-bubble 5s ease-in infinite;
        }
        @keyframes plx-bubble {
          0% {
            transform: translate3d(0, 6px, 0);
            opacity: 0;
          }
          15% {
            opacity: 0.6;
          }
          60% {
            transform: translate3d(3px, -12px, 0);
            opacity: 0.5;
          }
          100% {
            transform: translate3d(-2px, -26px, 0);
            opacity: 0;
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

        .plx-ember {
          animation: plx-ember 4s linear infinite;
        }
        @keyframes plx-ember {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0;
          }
          12% {
            opacity: 0.9;
          }
          100% {
            transform: translate3d(-120px, -12px, 0) scale(0.35);
            opacity: 0;
          }
        }

        .plx-line {
          animation: plx-line 2.4s linear infinite;
        }
        @keyframes plx-line {
          0% {
            transform: translate3d(50px, 0, 0);
            opacity: 0;
          }
          8% {
            opacity: 0.85;
          }
          85% {
            opacity: 0.5;
          }
          100% {
            transform: translate3d(-230px, 0, 0);
            opacity: 0;
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

const PETALS = [
  { right: '6%', top: '10%', size: 8, dur: '9s', delay: '-2s' },
  { right: '17%', top: '-6%', size: 5, dur: '11.5s', delay: '-7.2s' },
  { right: '28%', top: '30%', size: 6, dur: '8.4s', delay: '-4.1s' },
  { right: '40%', top: '4%', size: 5, dur: '12.5s', delay: '-9.6s' },
  { right: '12%', top: '46%', size: 9, dur: '10s', delay: '-5.4s' },
  { right: '34%', top: '52%', size: 6, dur: '9.4s', delay: '-1.3s' },
  { right: '48%', top: '24%', size: 4, dur: '13s', delay: '-6.6s' }
]

const EMBERS = [
  { top: '24%', size: 3, dur: '3.4s', delay: '-1s' },
  { top: '44%', size: 2, dur: '4.6s', delay: '-2.4s' },
  { top: '58%', size: 2.5, dur: '3.9s', delay: '-3.2s' },
  { top: '70%', size: 2, dur: '5.1s', delay: '-0.6s' }
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

const BUBBLES = [
  { right: '15%', bottom: '22%', size: 3, dur: '4.6s', delay: '-1.2s' },
  { right: '27%', bottom: '14%', size: 2, dur: '5.8s', delay: '-3.4s' },
  { right: '38%', bottom: '28%', size: 2.5, dur: '5.2s', delay: '-0.4s' }
]

function Koi({
  scale = 1,
  bodyFrom,
  bodyTo,
  tail,
  spot,
  dur,
  delay,
  right,
  top
}: {
  scale?: number
  bodyFrom: string
  bodyTo: string
  tail: string
  spot: string
  dur: string
  delay?: string
  right: string
  top: string
}) {
  // The loop travels right→left, so the head is the LEFT end: rounded brow
  // on the left, tail fanning off the right edge, wagging at its body joint.
  return (
    <div className="absolute" style={{ right, top, transform: scale !== 1 ? `scale(${scale})` : undefined }}>
      <div className="plx-koi" style={{ animationDuration: dur, animationDelay: delay, opacity: 0 }}>
        <div className="relative" style={{ width: 22, height: 10 }}>
          <div
            className="plx-wag absolute"
            style={{
              right: -7,
              top: 1.5,
              width: 8,
              height: 7,
              clipPath: 'polygon(0 50%, 100% 0, 100% 100%)',
              background: tail,
              transformOrigin: 'left center'
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              borderRadius: '45% 55% 52% 48% / 55% 60% 40% 45%',
              background: `linear-gradient(90deg, ${bodyTo} 28%, ${bodyFrom})`
            }}
          />
          <div
            className="absolute rounded-full"
            style={{ right: 8, top: 1, width: 4.5, height: 4, background: spot }}
          />
          <div
            className="absolute rounded-full"
            style={{ right: 14, top: 4, width: 3, height: 2.5, background: spot, opacity: 0.7 }}
          />
        </div>
      </div>
    </div>
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
      // caustic light webs, three koi at sorted depths, bubbles rising,
      // ripples opening on the surface — lily pads live in the base art
      return (
        <>
          <div
            className="plx-caustic absolute rounded-full"
            style={{
              right: '6%',
              top: '8%',
              width: 110,
              height: 40,
              background: 'radial-gradient(closest-side, rgb(148 240 220 / 0.12), transparent)',
              filter: 'blur(6px)',
              animationDuration: '13s'
            }}
          />
          <div
            className="plx-caustic absolute rounded-full"
            style={{
              right: '28%',
              bottom: '4%',
              width: 90,
              height: 34,
              background: 'radial-gradient(closest-side, rgb(255 255 255 / 0.06), transparent)',
              filter: 'blur(7px)',
              animationDuration: '17s',
              animationDelay: '-6s'
            }}
          />
          <Koi
            right="8%"
            top="34%"
            dur="15s"
            bodyFrom="rgb(255 122 60 / 0.95)"
            bodyTo="rgb(255 244 235 / 0.97)"
            tail="rgb(255 122 60 / 0.88)"
            spot="rgb(226 74 30 / 0.9)"
          />
          <Koi
            right="30%"
            top="60%"
            scale={0.72}
            dur="19s"
            delay="-9s"
            bodyFrom="rgb(226 232 240 / 0.88)"
            bodyTo="rgb(255 255 255 / 0.96)"
            tail="rgb(235 240 244 / 0.75)"
            spot="rgb(255 122 60 / 0.85)"
          />
          <Koi
            right="18%"
            top="16%"
            scale={0.5}
            dur="23s"
            delay="-14s"
            bodyFrom="rgb(255 176 92 / 0.6)"
            bodyTo="rgb(255 236 214 / 0.7)"
            tail="rgb(255 176 92 / 0.5)"
            spot="rgb(226 74 30 / 0.55)"
          />
          {BUBBLES.map((b, i) => (
            <span
              key={i}
              className="plx-bubble absolute rounded-full"
              style={{
                right: b.right,
                bottom: b.bottom,
                width: b.size,
                height: b.size,
                background: 'rgb(220 248 240 / 0.55)',
                boxShadow: '0 0 3px rgb(220 248 240 / 0.4)',
                opacity: 0,
                animationDuration: b.dur,
                animationDelay: b.delay
              }}
            />
          ))}
          <div
            className="plx-ripple absolute rounded-full"
            style={{
              right: '18%',
              top: '30%',
              width: 22,
              height: 22,
              border: '1px solid rgb(210 240 235 / 0.4)',
              opacity: 0,
              animationDelay: '-3s'
            }}
          />
          <div
            className="plx-ripple absolute rounded-full"
            style={{
              right: '36%',
              top: '54%',
              width: 16,
              height: 16,
              border: '1px solid rgb(210 240 235 / 0.3)',
              opacity: 0,
              animationDuration: '9.5s',
              animationDelay: '-7.5s'
            }}
          />
        </>
      )

    case 'cherry-blossom':
      // moonlight breathing over the branch (base art) while petals fall
      return (
        <>
          <div
            className="plx-breathe absolute rounded-full"
            style={{
              right: 'calc(24% - 30px)',
              top: 'calc(34% - 30px)',
              width: 60,
              height: 60,
              background: 'radial-gradient(circle, rgb(255 220 235 / 0.3), transparent 70%)',
              filter: 'blur(8px)',
              animationDuration: '9s'
            }}
          />
          <div
            className="plx-breathe absolute inset-y-0"
            style={{
              right: 0,
              width: '45%',
              background:
                'radial-gradient(70% 110% at 90% 20%, rgb(255 154 194 / 0.13), transparent 70%)',
              animationDuration: '11s',
              animationDelay: '-4s'
            }}
          />
          {PETALS.map((p, i) => (
            <div
              key={i}
              className="plx-petal absolute"
              style={{
                right: p.right,
                top: p.top,
                width: p.size,
                height: p.size,
                borderRadius: '100% 8% 100% 8%',
                background:
                  i % 2 === 0
                    ? 'linear-gradient(135deg, rgb(255 196 220 / 0.95), rgb(255 133 184 / 0.8))'
                    : 'linear-gradient(135deg, rgb(255 173 205 / 0.9), rgb(240 110 165 / 0.75))',
                opacity: 0,
                animationDuration: p.dur,
                animationDelay: p.delay
              }}
            />
          ))}
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
      // afterburner scene: a flickering twin-cone flame on the right edge,
      // speed lines and embers streaking left over the checkered flag
      return (
        <>
          <div
            className="plx-breathe absolute inset-y-0"
            style={{
              right: 0,
              width: '32%',
              background:
                'radial-gradient(70% 120% at 100% 55%, rgb(255 106 40 / 0.3), transparent 70%)',
              animationDuration: '4.5s'
            }}
          />
          {/* afterburner cone breathing off the right edge, white-hot core */}
          <div className="absolute" style={{ right: 0, top: '50%' }}>
            <div
              className="plx-flame"
              style={{
                width: 58,
                height: 22,
                marginTop: -11,
                clipPath: 'polygon(0 50%, 74% 8%, 100% 28%, 93% 50%, 100% 72%, 74% 92%)',
                background:
                  'linear-gradient(90deg, transparent, rgb(255 122 40 / 0.55) 30%, rgb(255 180 80 / 0.85) 62%, rgb(255 224 130 / 0.98))',
                filter: 'blur(1.5px)'
              }}
            />
            <div
              className="plx-flame absolute"
              style={{
                right: 0,
                top: '50%',
                width: 30,
                height: 8,
                marginTop: -4,
                clipPath: 'polygon(0 50%, 70% 0, 100% 30%, 100% 70%, 70% 100%)',
                background:
                  'linear-gradient(90deg, transparent, rgb(255 240 200 / 0.9) 55%, rgb(255 255 255 / 0.98))',
                filter: 'blur(0.5px)',
                animationDuration: '0.6s'
              }}
            />
            {/* shock diamonds inside the plume */}
            <div
              className="plx-flame absolute"
              style={{
                right: 26,
                top: '50%',
                width: 10,
                height: 5,
                marginTop: -2.5,
                clipPath: 'polygon(0 50%, 50% 0, 100% 50%, 50% 100%)',
                background: 'rgb(255 244 214 / 0.85)',
                filter: 'blur(0.5px)',
                animationDuration: '0.7s',
                animationDelay: '-0.2s'
              }}
            />
          </div>
          <div
            className="plx-line absolute"
            style={{
              right: 0,
              top: '26%',
              width: 64,
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgb(255 140 66 / 0.85))',
              opacity: 0,
              animationDuration: '1.9s'
            }}
          />
          <div
            className="plx-line absolute"
            style={{
              right: 0,
              top: '48%',
              width: 82,
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgb(255 200 120 / 0.6))',
              opacity: 0,
              animationDuration: '2.2s',
              animationDelay: '-0.6s'
            }}
          />
          <div
            className="plx-line absolute"
            style={{
              right: 0,
              top: '68%',
              width: 48,
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgb(255 92 30 / 0.7))',
              opacity: 0,
              animationDuration: '2.6s',
              animationDelay: '-1.2s'
            }}
          />
          {EMBERS.map((e, i) => (
            <div
              key={i}
              className="plx-ember absolute rounded-full"
              style={{
                right: '3%',
                top: e.top,
                width: e.size,
                height: e.size,
                background: i % 2 === 1 ? 'rgb(255 214 68 / 0.95)' : 'rgb(255 122 40 / 0.95)',
                boxShadow: '0 0 5px rgb(255 106 40 / 0.8)',
                opacity: 0,
                animationDuration: e.dur,
                animationDelay: e.delay
              }}
            />
          ))}
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
