'use client'

// Landing hero globe stage — the WebGL Earth plus its two CSS satellites
// (equatorial ring rider and polar orbiter with limb clipping).
// Extracted verbatim from src/app/page.tsx.

import dynamic from 'next/dynamic'
import type { GlobeHandle } from '@/components/Globe'
import { PILOTS } from '../pilots'

const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  // Square placeholder reserves the canvas box, so the hero copy doesn't
  // jump when the globe chunk lands (mobile stacks it below the copy).
  loading: () => <div className="w-full aspect-square" />
})

export function GlobeStage({
  onGlobeReady
}: {
  /** Forwarded to Globe's onReady — next/dynamic drops refs, so the hero
   *  pin timeline gets its setScrollPose handle through this callback. */
  onGlobeReady?: (handle: GlobeHandle) => void
}) {
  // The orbit ring + satellite share these dimensions so the satellite
  // always traces exactly the visible dashed circle. Both derive from
  // --orbit (set on .globe-stage below), which steps down on phones so
  // the stacked hero leaves room for the headline above the fold.
  const ORBIT_SIZE = 'var(--orbit)'

  return (
    <div className="globe-stage relative w-full flex items-center justify-center">
      {/* outer thin orbit ring */}
      <div
        aria-hidden
        className="absolute inset-0 m-auto rounded-full pointer-events-none"
        style={{
          width: ORBIT_SIZE,
          height: ORBIT_SIZE,
          border: '1px dashed rgb(var(--star-rgb) / 0.06)'
        }}
      />

      {/* soft blue atmospheric spill behind the Earth — sized to catch the
          shader's exospheric haze where the canvas edge cuts it off */}
      <div
        aria-hidden
        className="absolute inset-0 m-auto rounded-full blur-3xl opacity-30 pointer-events-none transition-[background] duration-700"
        style={{
          width: 'calc(var(--orbit) * 0.915)',
          height: 'calc(var(--orbit) * 0.915)',
          background: 'radial-gradient(circle, rgb(var(--globe-glow-rgb) / 0.19), transparent 70%)'
        }}
      />

      {/* SATELLITE — sits on the top of the orbit ring; the wrapper spins
          to carry it around the dashed circle while the craft itself slowly
          tumbles about its own axis. */}
      <div
        aria-hidden
        className="cribble-satellite absolute inset-0 m-auto pointer-events-none"
        style={{
          width: ORBIT_SIZE,
          height: ORBIT_SIZE
        }}
      >
        {/* motion trail — orbit runs clockwise, so it streams off to the
            left of the craft at the top of the ring */}
        <div
          className="absolute top-0 left-1/2 h-px w-16"
          style={{
            transform: 'translate(calc(-100% - 22px), -50%)',
            background:
              'linear-gradient(to right, transparent, rgb(var(--star-rgb) / 0.5))'
          }}
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="cribble-sat-spin cribble-sat-spin-slow">
            <SatelliteMark />
          </div>
        </div>
      </div>

      <div className="relative z-[1] w-full" style={{ maxWidth: 'var(--globe)' }}>
        <Globe size={400} onReady={onGlobeReady} />
      </div>

      {/* POLAR SATELLITE — a real orbit, not a fade: the keyframes sample a
          tilted circle (position + depth-scale + heading), and on the far
          half its z-index drops below the globe canvas, so the opaque
          planet pixels clip it at the limb. It slides out from behind the
          top of the Earth, sweeps down the face growing as it nears the
          viewer, swings around below, recedes, and slips behind the planet
          again. Track radius stays inside the dashed ring so it never meets
          the first satellite. */}
      <div
        aria-hidden
        className="cribble-polar-sat absolute left-1/2 top-1/2 pointer-events-none"
      >
        {/* velocity-matched motion trail: always streams opposite the
            flight direction and stretches with projected speed, so it
            collapses to nothing at the turnarounds and hides the flip */}
        <div className="cribble-polar-trail" />
        <div className="cribble-sat-spin">
          <SatelliteMark />
        </div>
      </div>

      {/* tiny corner annotation. The stage fills the hero's globe column,
          which bleeds past the container edge on lg+ (lg:-mr-24 xl:-mr-36
          in page.tsx) — the hero's overflow-hidden clips that overhang, so
          right-2 alone would push the text off-viewport at 1024. The lg/xl
          offsets mirror the bleed (6rem / 9rem) plus the base 0.5rem inset,
          anchoring the annotation to the visible container edge instead of
          the bled box. */}
      <div className="absolute bottom-2 right-2 lg:right-[6.5rem] xl:right-[9.5rem] text-[9px] tracking-[0.3em] text-zinc-700 pointer-events-none">
        {`// ${PILOTS.length} pilots worldwide · drag to spin`}
      </div>

      <style jsx global>{`
        /* One knob sizes the whole stage: ring + satellites trace --orbit,
           the Earth fills --globe (same 400/470 ratio at every step, so
           the polar sat still clips at the planet's limb). Phones get a
           smaller stage so the stacked hero copy stays near the fold. */
        .globe-stage {
          --orbit: min(470px, 92vw);
          --globe: min(400px, calc(var(--orbit) * 0.851));
        }
        @media (max-width: 639px) {
          .globe-stage {
            --orbit: min(340px, 86vw);
          }
        }
        .cribble-satellite {
          transform-origin: 50% 50%;
          will-change: transform;
          animation: cribble-orbit 32s linear infinite;
        }
        @keyframes cribble-orbit {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .cribble-satellite-body {
          filter: drop-shadow(0 0 5px rgb(var(--star-rgb) / 0.45));
        }
        .cribble-satellite-beacon {
          animation: cribble-beacon 1.6s ease-in-out infinite;
        }
        @keyframes cribble-beacon {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.2;
          }
        }
        .cribble-polar-sat {
          /* one orbit unit, scaled off the stage size (470px orbit = 1px
             unit); the track spans ±196 units against the planet radius,
             so limb crossings keep happening inside the frame at every
             viewport, including the smaller phone stage */
          --pu: calc(var(--orbit, 470px) / 470);
          z-index: 2;
          will-change: transform;
          animation: cribble-polar 26s linear infinite;
        }
        /* Keyframes sample a tilted orbit circle every 15°:
           x = 24·cosθ + 14·sinθ (tilt + lean), y = -196·cosθ,
           scale = 0.825 + 0.325·sinθ (depth). Craft attitude is handled by
           the separate self-spin, which keeps the angular rate constant.
           Front half (0–50%) rides above the globe; at the bottom
           turnaround the z-index drops under the canvas, so on the way up
           the opaque planet itself clips the craft at the limb. */
        @keyframes cribble-polar {
          0% {
            transform: translate(
                calc(-50% + 24 * var(--pu)),
                calc(-50% - 196 * var(--pu))
              )
              scale(0.825);
            z-index: 2;
          }
          4.17% {
            transform: translate(
                calc(-50% + 26.8 * var(--pu)),
                calc(-50% - 189.3 * var(--pu))
              )
              scale(0.909);
          }
          8.33% {
            transform: translate(
                calc(-50% + 27.8 * var(--pu)),
                calc(-50% - 169.7 * var(--pu))
              )
              scale(0.988);
          }
          12.5% {
            transform: translate(
                calc(-50% + 26.9 * var(--pu)),
                calc(-50% - 138.6 * var(--pu))
              )
              scale(1.055);
          }
          16.67% {
            transform: translate(
                calc(-50% + 24.1 * var(--pu)),
                calc(-50% - 98 * var(--pu))
              )
              scale(1.106);
          }
          20.83% {
            transform: translate(
                calc(-50% + 19.7 * var(--pu)),
                calc(-50% - 50.7 * var(--pu))
              )
              scale(1.139);
          }
          25% {
            transform: translate(calc(-50% + 14 * var(--pu)), -50%) scale(1.15);
          }
          29.17% {
            transform: translate(
                calc(-50% + 7.3 * var(--pu)),
                calc(-50% + 50.7 * var(--pu))
              )
              scale(1.139);
          }
          33.33% {
            transform: translate(
                calc(-50% + 0.1 * var(--pu)),
                calc(-50% + 98 * var(--pu))
              )
              scale(1.106);
          }
          37.5% {
            transform: translate(
                calc(-50% - 7.1 * var(--pu)),
                calc(-50% + 138.6 * var(--pu))
              )
              scale(1.055);
          }
          41.67% {
            transform: translate(
                calc(-50% - 13.8 * var(--pu)),
                calc(-50% + 169.7 * var(--pu))
              )
              scale(0.988);
          }
          45.83% {
            transform: translate(
                calc(-50% - 19.6 * var(--pu)),
                calc(-50% + 189.3 * var(--pu))
              )
              scale(0.909);
          }
          50% {
            transform: translate(
                calc(-50% - 24 * var(--pu)),
                calc(-50% + 196 * var(--pu))
              )
              scale(0.825);
            z-index: 2;
          }
          /* bottom turnaround happens clear of the planet, so the z-order
             swap under the canvas is invisible */
          50.2% {
            z-index: 0;
          }
          54.17% {
            transform: translate(
                calc(-50% - 26.8 * var(--pu)),
                calc(-50% + 189.3 * var(--pu))
              )
              scale(0.741);
          }
          58.33% {
            transform: translate(
                calc(-50% - 27.8 * var(--pu)),
                calc(-50% + 169.7 * var(--pu))
              )
              scale(0.663);
          }
          62.5% {
            transform: translate(
                calc(-50% - 26.9 * var(--pu)),
                calc(-50% + 138.6 * var(--pu))
              )
              scale(0.595);
          }
          66.67% {
            transform: translate(
                calc(-50% - 24.1 * var(--pu)),
                calc(-50% + 98 * var(--pu))
              )
              scale(0.544);
          }
          70.83% {
            transform: translate(
                calc(-50% - 19.7 * var(--pu)),
                calc(-50% + 50.7 * var(--pu))
              )
              scale(0.511);
          }
          75% {
            transform: translate(calc(-50% - 14 * var(--pu)), -50%) scale(0.5);
          }
          79.17% {
            transform: translate(
                calc(-50% - 7.3 * var(--pu)),
                calc(-50% - 50.7 * var(--pu))
              )
              scale(0.511);
          }
          83.33% {
            transform: translate(
                calc(-50% - 0.1 * var(--pu)),
                calc(-50% - 98 * var(--pu))
              )
              scale(0.544);
          }
          87.5% {
            transform: translate(
                calc(-50% + 7.1 * var(--pu)),
                calc(-50% - 138.6 * var(--pu))
              )
              scale(0.595);
          }
          91.67% {
            transform: translate(
                calc(-50% + 13.8 * var(--pu)),
                calc(-50% - 169.7 * var(--pu))
              )
              scale(0.663);
          }
          95.83% {
            transform: translate(
                calc(-50% + 19.6 * var(--pu)),
                calc(-50% - 189.3 * var(--pu))
              )
              scale(0.741);
          }
          100% {
            transform: translate(
                calc(-50% + 24 * var(--pu)),
                calc(-50% - 196 * var(--pu))
              )
              scale(0.825);
            z-index: 0;
          }
        }
        /* Trail anchored to the polar craft's center. transform-origin sits
           on the craft, so rotate() aims the streak opposite the flight
           direction and scaleX() stretches it with projected speed. The
           fast heading flips at the turnarounds happen while the trail is
           collapsed, so they are invisible. Sampled every 15° of the same
           orbit the position keyframes trace. */
        .cribble-polar-trail {
          position: absolute;
          top: 50%;
          right: 50%;
          width: 64px;
          height: 1px;
          margin-top: -0.5px;
          transform-origin: 100% 50%;
          background: linear-gradient(
            to right,
            transparent,
            rgb(var(--star-rgb) / 0.5)
          );
          animation: cribble-polar-trail 26s linear infinite;
        }
        @keyframes cribble-polar-trail {
          0% {
            transform: rotate(0deg) scaleX(0.07);
          }
          4.17% {
            transform: rotate(81.8deg) scaleX(0.26);
          }
          8.33% {
            transform: rotate(89.9deg) scaleX(0.5);
          }
          12.5% {
            transform: rotate(92.9deg) scaleX(0.7);
          }
          16.67% {
            transform: rotate(94.6deg) scaleX(0.86);
          }
          20.83% {
            transform: rotate(95.9deg) scaleX(0.96);
          }
          25% {
            transform: rotate(97deg) scaleX(1);
          }
          29.17% {
            transform: rotate(98.1deg) scaleX(0.97);
          }
          33.33% {
            transform: rotate(99.3deg) scaleX(0.87);
          }
          37.5% {
            transform: rotate(101deg) scaleX(0.71);
          }
          41.67% {
            transform: rotate(103.8deg) scaleX(0.51);
          }
          45.83% {
            transform: rotate(111.3deg) scaleX(0.28);
          }
          50% {
            transform: rotate(180deg) scaleX(0.07);
          }
          54.17% {
            transform: rotate(261.8deg) scaleX(0.26);
          }
          58.33% {
            transform: rotate(269.9deg) scaleX(0.5);
          }
          62.5% {
            transform: rotate(272.9deg) scaleX(0.7);
          }
          66.67% {
            transform: rotate(274.6deg) scaleX(0.86);
          }
          70.83% {
            transform: rotate(275.9deg) scaleX(0.96);
          }
          75% {
            transform: rotate(277deg) scaleX(1);
          }
          79.17% {
            transform: rotate(278.1deg) scaleX(0.97);
          }
          83.33% {
            transform: rotate(279.3deg) scaleX(0.87);
          }
          87.5% {
            transform: rotate(281deg) scaleX(0.71);
          }
          91.67% {
            transform: rotate(283.8deg) scaleX(0.51);
          }
          95.83% {
            transform: rotate(291.3deg) scaleX(0.28);
          }
          100% {
            transform: rotate(360deg) scaleX(0.07);
          }
        }
        /* slow tumble about each craft's own axis; constant angular rate
           so nothing snaps at the orbit turnarounds */
        .cribble-sat-spin {
          animation: cribble-sat-spin 14s linear infinite;
        }
        .cribble-sat-spin > svg {
          display: block;
        }
        .cribble-sat-spin-slow {
          animation-duration: 22s;
          animation-direction: reverse;
        }
        @keyframes cribble-sat-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cribble-satellite,
          .cribble-satellite-beacon,
          .cribble-sat-spin {
            animation: none !important;
          }
          /* without its animation the polar craft has no valid resting
             spot, so it sits out entirely */
          .cribble-polar-sat {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}

function SatelliteMark() {
  // Side-view comms satellite: long twin solar wings on booms, silver bus
  // with a sensor strip, uplink dish, and a blinking accent beacon.
  return (
    <svg
      width="56"
      height="22"
      viewBox="0 0 56 22"
      className="cribble-satellite-body"
      aria-hidden
    >
      {/* left solar wing */}
      <rect
        x="1"
        y="7"
        width="18"
        height="8.5"
        rx="1"
        fill="rgb(30 64 175 / 0.92)"
        stroke="rgb(148 163 184 / 0.95)"
        strokeWidth="0.8"
      />
      <path
        d="M5.5 7v8.5M10 7v8.5M14.5 7v8.5M1 11.25h18"
        stroke="rgb(191 219 254 / 0.55)"
        strokeWidth="0.6"
      />
      {/* right solar wing */}
      <rect
        x="37"
        y="7"
        width="18"
        height="8.5"
        rx="1"
        fill="rgb(30 64 175 / 0.92)"
        stroke="rgb(148 163 184 / 0.95)"
        strokeWidth="0.8"
      />
      <path
        d="M41.5 7v8.5M46 7v8.5M50.5 7v8.5M37 11.25h18"
        stroke="rgb(191 219 254 / 0.55)"
        strokeWidth="0.6"
      />
      {/* wing booms */}
      <path
        d="M19 11.25h4M33 11.25h4"
        stroke="rgb(161 161 170)"
        strokeWidth="1"
      />
      {/* bus */}
      <rect
        x="23"
        y="5.5"
        width="10"
        height="11.5"
        rx="1.8"
        fill="#e4e4e7"
        stroke="#3f3f46"
        strokeWidth="0.9"
      />
      {/* sensor strip */}
      <rect x="24.8" y="7.4" width="6.4" height="2.6" rx="0.6" fill="#27272a" />
      <rect
        x="25.5"
        y="8.1"
        width="2.1"
        height="1.2"
        rx="0.3"
        fill="rgb(56 189 248 / 0.85)"
      />
      {/* uplink dish */}
      <path d="M28 5.5V2.9" stroke="#a1a1aa" strokeWidth="0.9" />
      <circle
        cx="28"
        cy="2.2"
        r="1.5"
        fill="#f4f4f5"
        stroke="#52525b"
        strokeWidth="0.7"
      />
      <circle cx="28" cy="2.2" r="0.45" fill="#52525b" />
      {/* status beacon */}
      <circle
        className="cribble-satellite-beacon"
        cx="28"
        cy="14.4"
        r="1.2"
        fill="rgb(var(--accent-rgb))"
      />
    </svg>
  )
}
