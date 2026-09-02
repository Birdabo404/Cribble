'use client'

// Landing hero globe instrument — the dithered WebGL Earth as a small live
// readout in its own compartment, plus a one-line annotation. No
// satellites, rings or glow: the hero's single ambient animation is the
// WorldwideText rotator, and the globe's idle spin (already paused
// offscreen and under reduced motion by Globe.tsx's own loop gates) is the
// instrument doing its job.
//
// On the full tier the pinned entry (hero/heroPin.ts) drifts this element
// to the viewport center while the renderer's ortho zoom grows the planet
// from ~155–183px to well over half the viewport before the dither dropout
// erodes it. The room for that comes from the canvas bleed: the canvas
// reaches far past the square footprint, so neither this element nor its
// compartment may clip overflow — the hero root's overflow-hidden (the
// viewport) is the only clip.

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import type { GlobePinInput } from '@/components/ditherEarthRenderer'
import type { GlobeHandle } from '@/components/Globe'
import { landingTier } from '@/lib/landingMotion'

// The dynamic import() is the documented exception to imports-at-top: the
// three.js chunk must stay out of the critical bundle.
const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  // Square placeholder reserves the footprint, so the compartment doesn't
  // jump when the globe chunk lands.
  loading: () => <div className="w-full aspect-square" />
})

/** Square footprint the instrument is authored at (layout px), and the
 *  larger one the tall xl compartment gets so the planet doesn't float in
 *  dead space. The --instrument variable below mirrors both (min(…, 60vw)
 *  steps them down on narrow viewports); keep the three in sync. */
const INSTRUMENT_SIZE = 220
const INSTRUMENT_SIZE_XL = 260
/** Tailwind's xl breakpoint — the media query the CSS below switches on. */
const XL_QUERY = '(min-width: 1280px)'

// Full-tier push-in geometry, authored in absolute layout px so the grown
// planet and the canvas come out the same size whichever footprint the
// CSS picked — the renderer's `bleed` and `zoomMax` are just those extents
// divided by the footprint in effect (3.7 / 5.4 at 220, 3.13 / 4.57 at
// 260). The disk renders at footprint / 1.42, the ortho zoom at pose p is
// 1 + (zoomMax − 1)·p, heroPin tops it off with ≤ 1.1× container scale,
// and .page-zoom-out shows the result at 0.9. At DISSOLVE_START (p = 0.6)
// that is 155 × 3.64 × 1.1 × 0.9 ≈ 558px at 220 (183 × 3.14 × 1.1 × 0.9
// ≈ 569px at 260) — 62–63% of a 900px viewport, the target. (The plan's
// 3.6 assumed the footprint itself was the disk; the disk is 70% of it,
// hence the larger zoom.) The canvas must hold the disk (radius 1) while
// it is visible and the corona (radius 1.18) while it survives the
// dropout: the disk fits until zoom = 1.42 × bleed (5.25 at 220 → p ≈
// 0.97; 4.44 at 260 → p ≈ 0.96 — the raster is fully eroded at 0.85) and
// the corona until that / 1.18 (p ≈ 0.78 at both; its dot density is gone
// by p ≈ 0.66). 814 CSS px → 2.65M fragments at DPR 2, inside the
// renderer's FRAGMENT_BUDGET at either footprint.
const PUSH_IN_CANVAS_PX = 814 // 220 × 3.7
const PUSH_IN_PLANET_PX = 1188 // 220 × 5.4: footprint × zoom at p = 1

const numberFormat = new Intl.NumberFormat('en-US')

/** The footprint the CSS below resolves to on this viewport. Server and
 *  first client render agree on the base size: the Globe is client-only
 *  (ssr: false), so nothing SSR'd depends on the answer. */
const footprintFor = (xl: boolean) =>
  xl ? INSTRUMENT_SIZE_XL : INSTRUMENT_SIZE

/** Footprint in effect, tracked across the xl boundary — bleed/zoomMax
 *  are baked into the renderer at creation, so a stale value would grow
 *  the planet 18% off target; Globe rebuilds when they change. */
function useInstrumentFootprint(): number {
  const [xl, setXl] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(XL_QUERY).matches
  )
  useEffect(() => {
    const query = window.matchMedia(XL_QUERY)
    const onChange = (event: MediaQueryListEvent) => setXl(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return footprintFor(xl)
}

export function GlobeInstrument({
  onGlobeReady,
  className = '',
  pins,
  playerCount
}: {
  /** Forwarded to Globe's onReady — next/dynamic drops refs, so the hero
   *  pin timeline gets its setScrollPose handle through this callback. */
  onGlobeReady?: (handle: GlobeHandle) => void
  className?: string
  /** Non-empty — HomeV2 substitutes the static roster when nothing is live. */
  pins: GlobePinInput[]
  /** Accounts on the board; null when the live read failed (the
   *  annotation then drops the number rather than print a stale one). */
  playerCount: number | null
}) {
  // Only the full tier builds the pin, so only it pays for the big canvas;
  // lite/still keep the renderer defaults (a 1.6× canvas for the
  // footprint). Decided once per mount: SSR sees 'still' (defaults), the
  // client decides at hydration — the dynamic placeholder markup is the
  // same either way, so nothing mismatches.
  const [pushIn] = useState(() => landingTier() === 'full')
  const footprint = useInstrumentFootprint()

  return (
    // z-[1]: the bled canvas is absolutely positioned inside the footprint,
    // and as the planet grows during the pin it crosses the neighbouring
    // compartments (tower above, footer strip below). Lifting the whole
    // instrument keeps the planet above any later-in-DOM positioned
    // sibling that still paints a background mid-exit.
    <div
      className={`globe-instrument relative z-[1] flex flex-col items-center ${className}`}
    >
      <div className="relative" style={{ width: 'var(--instrument)' }}>
        <Globe
          size={footprint}
          pins={pins}
          onReady={onGlobeReady}
          bleed={pushIn ? PUSH_IN_CANVAS_PX / footprint : undefined}
          zoomMax={pushIn ? PUSH_IN_PLANET_PX / footprint : undefined}
        />
      </div>

      {/* Annotation — lifts out with the copy during the pin (.lx-hero-exit).
          --lx-ink-faint is the hero's decoration token; the --z600 fallback
          is the same value it resolves to today. */}
      <div
        className="lx-hero-exit mt-3 max-w-full text-center font-mono text-[9px] leading-none tracking-[0.3em] pointer-events-none"
        style={{ color: 'var(--lx-ink-faint, rgb(var(--z600)))' }}
      >
        {playerCount === null
          ? '// PLAYERS WORLDWIDE · DRAG TO SPIN'
          : `// ${numberFormat.format(playerCount)} PLAYERS WORLDWIDE · DRAG TO SPIN`}
      </div>

      <style jsx>{`
        /* One knob sizes the footprint (INSTRUMENT_SIZE / _XL above, the
           xl query being XL_QUERY); phones get a smaller instrument so the
           stacked hero stays near the fold, the tall xl compartment a
           larger one so the planet fills it. */
        .globe-instrument {
          --instrument: min(220px, 60vw);
        }
        @media (min-width: 1280px) {
          .globe-instrument {
            --instrument: min(260px, 60vw);
          }
        }
      `}</style>
    </div>
  )
}
