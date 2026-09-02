'use client'

// MOBIUS GAP — the Touchdown sheet's ∞. Not a glyph: the data font has no
// ∞ so the old text fell back to a system face, the one letterform on the
// page that wasn't ours. This draws it instead — a Möbius ribbon traced
// along a lemniscate on a small 2D canvas (mobiusRibbon.ts, pure math and
// paint), in the signal color, rolling its half-twist on time and tilting
// on scroll.
//
//  · Fallback handoff. The text ∞ stays in the markup as the SSR, no-JS
//    and still-tier picture (and what a screen reader hears); the canvas
//    is aria-hidden and sits over it at opacity 0. The build flips
//    [data-live] on the box — one static attribute, the CSS swaps their
//    opacities (.lx-ribbon in globals.css) — and the cleanup removes it,
//    so a mid-session reduced-motion flip hands the glyph back exactly
//    as it was. The `.st` wrapper keeps the generic stage rise: the glyph
//    still has an entrance when the ribbon never builds.
//  · One engine tick. useSectionMotion owns the loop: an anime timer on
//    the shared engine (pauses offstage and in hidden tabs, cancels on
//    revert) paints one frame per tick; the draw-in is an anime tween on a
//    plain proxy the same tick reads. No private rAF, no setInterval, and
//    nothing here touches React state after mount — every write is a
//    canvas paint or a textContent on the θ span Touchdown hands over.
//  · Scroll tilt. A GSAP ScrollTrigger scrubbed over the section (top
//    enters bottom → bottom leaves top) writes its progress into a ref;
//    pitch and yaw are derived from that per frame, so the ribbon leans as
//    the sheet crosses the viewport and the scrub math never touches DOM.
//  · Colors from tokens. Signal is the box's computed `color`
//    (--lx-signal), the hairline ink is the canvas's computed `color`
//    (--lx-ink-dim), the sheet is --lx-sheet — all read once per build via
//    getComputedStyle, and the build re-runs on resolvedTheme so light
//    mode's orange-on-white comes for free.
//  · No useMaskedLines. SplitText slices text into lines; a canvas can't be
//    line-split, and claiming the wrapper with data-split would only strand
//    the fallback glyph outside the stage reveal.

import { useRef, type CSSProperties, type RefObject } from 'react'
import { useTheme } from 'next-themes'
import type { JSAnimation } from 'animejs'
import { CRIBBLE_EASE } from '@/lib/landingMotion'
import { createMobiusRibbon, type RibbonPose } from './mobiusRibbon'
import { useSectionMotion } from './useSectionMotion'

/** One full roll of the half-twist — constant, linear (AUDIT §2). */
const ROLL_MS = 14000
/** The ribbon drawing itself in along the loop, on the site curve. */
const DRAW_IN_MS = 1100
const DEG = Math.PI / 180
/** Resting pitch about X — the sheet seen slightly from above. 22°. */
const BASE_PITCH = 22 * DEG
/** Pitch travel across the scroll scrub (±8°). 16°. */
const PITCH_SWING = 16 * DEG
/** Yaw travel about Y across the scroll scrub (±12°). 24°. */
const YAW_SWING = 24 * DEG
/** Retina is plenty; 3x phones would triple the fill for no visible gain. */
const DPR_CAP = 2
/** What the θ readout says with no ribbon running (also the SSR text). */
const READOUT_IDLE = 'θ ———'
/** --space-deep's literal, for a box that somehow lacks the token. */
const FALLBACK_SHEET = '#05060a'
const [EASE_X1, EASE_Y1, EASE_X2, EASE_Y2] = CRIBBLE_EASE.split(',').map(Number)

const formatTheta = (phase: number): string => {
  const deg = Math.round((phase * 180) / Math.PI) % 360
  return `θ ${String(deg).padStart(3, '0')}°`
}

export function MobiusGap({
  readoutRef
}: {
  /** Touchdown's θ span in the caption row; written per whole degree. */
  readoutRef?: RefObject<HTMLSpanElement>
}) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Latched on the first build: a theme flip rebuilds with fresh colors
  // and must not replay the draw-in.
  const everDrawnRef = useRef(false)
  // Where the roll is, in ms of the current loop — carried across those
  // rebuilds too, so the twist doesn't snap back to θ = 0 with the recolor.
  const rollMsRef = useRef(0)
  const { resolvedTheme } = useTheme()

  useSectionMotion(
    'touchdown',
    ({ motion, timer }) => {
      const box = boxRef.current
      const canvas = canvasRef.current
      if (!box || !canvas) return

      const ribbon = createMobiusRibbon(canvas)

      const boxStyle = getComputedStyle(box)
      ribbon.setColors({
        signal: boxStyle.color,
        ink: getComputedStyle(canvas).color,
        sheet: boxStyle.getPropertyValue('--lx-sheet').trim() || FALLBACK_SHEET
      })

      // The box is em-sized off .lx-numeral's container-fit font-size, so
      // it tracks the sheet width; the observer keeps the backing store in
      // step (and the immediate call sizes the first frame). Sizing the
      // bitmap clears it, and observer callbacks land after this frame's
      // tick has already painted — the observer's initial delivery
      // included — so repaint the last pose or the frame goes blank.
      const pose: RibbonPose = { phase: 0, drawn: 0, pitch: BASE_PITCH, yaw: 0 }
      let posed = false
      const fit = () => {
        const rect = box.getBoundingClientRect()
        ribbon.resize(
          rect.width,
          rect.height,
          Math.min(window.devicePixelRatio || 1, DPR_CAP)
        )
        if (posed) ribbon.draw(pose)
      }
      fit()
      const observer = new ResizeObserver(fit)
      observer.observe(box)

      // Glyph → canvas. Static toggle; the draw-in below is the entrance.
      box.dataset.live = ''

      // Scroll tilt. 0.5 is the sheet centered in the viewport (rest pose);
      // onUpdate only fires on change, so seed from the trigger's own
      // reading the moment it exists.
      const tilt = { p: 0.5 }
      const trigger = motion.ScrollTrigger.create({
        trigger: box.closest('section') ?? box,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          tilt.p = self.progress
        }
      })
      tilt.p = trigger.progress

      const proxy = { drawn: everDrawnRef.current ? 1 : 0 }
      let drawIn: JSAnimation | null = null
      if (!everDrawnRef.current) {
        drawIn = motion.animate(proxy, {
          drawn: 1,
          duration: DRAW_IN_MS,
          ease: motion.cubicBezier(EASE_X1, EASE_Y1, EASE_X2, EASE_Y2)
        })
      }
      everDrawnRef.current = true

      // The render loop. iterationCurrentTime is the ms within the current
      // loop (currentTime keeps counting across iterations), so phase stays
      // in 0..2π. The readout is deduped on its formatted string — one
      // textContent write per whole degree, the CountUp pattern.
      let painted = ''
      const roll = timer({
        duration: ROLL_MS,
        loop: true,
        onUpdate: (self) => {
          const ms = self.iterationCurrentTime
          rollMsRef.current = ms
          pose.phase = (ms / ROLL_MS) * Math.PI * 2
          pose.drawn = proxy.drawn
          pose.pitch = BASE_PITCH + (tilt.p - 0.5) * PITCH_SWING
          pose.yaw = (0.5 - tilt.p) * YAW_SWING
          posed = true
          ribbon.draw(pose)

          const readout = readoutRef?.current
          if (!readout) return
          const text = formatTheta(pose.phase)
          if (text === painted) return
          painted = text
          readout.textContent = text
        }
      })
      // A rebuild picks the roll up where the previous build left it; seek
      // also runs one update now, so the recolored ribbon is on the canvas
      // in the same task that cleared it.
      if (rollMsRef.current > 0) roll.seek(rollMsRef.current)

      // The timer is cancelled by useSectionMotion's revert; everything
      // else is ours. Dropping data-live returns the glyph — the
      // mid-session reduced-motion path.
      return () => {
        trigger.kill()
        drawIn?.cancel()
        observer.disconnect()
        ribbon.dispose()
        delete box.dataset.live
        const readout = readoutRef?.current
        if (readout) readout.textContent = READOUT_IDLE
      }
    },
    [resolvedTheme]
  )

  return (
    <div
      className="st lx-hero-title mt-[var(--rhythm-3)]"
      style={{ '--d': '110ms' } as CSSProperties}
    >
      <span
        ref={boxRef}
        className="lx-numeral lx-ribbon"
        style={{ color: 'var(--lx-signal)' }}
      >
        {/* SSR / no-JS / still-tier fallback, also what SR reads */}
        <span>∞</span>
        <canvas ref={canvasRef} aria-hidden />
      </span>
    </div>
  )
}
