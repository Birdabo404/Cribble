'use client'

// THE ROPE — the descent's one depth instrument. A fixed left-gutter SVG
// trajectory drawn (DrawSVGPlugin) against the WHOLE fall — progress 0 at
// the hero pin's start, 1 at touchdown — with five stage ticks keyed to the
// [data-sec] sheets (each a real link into its sheet) and a square marker
// riding the path with the altitude readout beside it. It absorbs what the
// old right-hand HUD did (ladder nav + KM readout) and draws in the
// manifest's own grammar: 1px hairlines, Plex Mono, one signal color, no
// filters.
//
// lg+ and full tier only: nothing renders until the landing runtime
// publishes with tier 'full', and the CSS hides it below lg. Mounted from
// HomeV2 OUTSIDE #smooth-wrapper — position:fixed dies inside
// ScrollSmoother's transformed content.

import { MouseEvent, RefObject, useEffect, useRef, useState } from 'react'
import {
  landingSmoother,
  onLandingRuntime,
  type LandingMotion
} from '@/lib/landingMotion'
import { SECTIONS } from './Descent'

type TimelineInstance = ReturnType<LandingMotion['gsap']['timeline']>
type ScrollTriggerInstance = ReturnType<LandingMotion['ScrollTrigger']['create']>

// One gentle re-entry arc in SVG user units. Both paths (ghost track +
// drawn trajectory) share it; ticks and the marker are positioned along it
// from one lookup table, so every consumer agrees on the geometry.
const TRAJECTORY = 'M 38 6 C 10 130, 38 330, 16 634'
const SAMPLES = 256

/** Fall progress past which the rope shows. The resting hero has no rope;
 *  it fades in as the pinned entry starts to scrub. */
const LIVE_AT = 0.02

/** How close (in fall progress) the marker gets to a tick before that
 *  tick's label yields to the riding KM readout — the two share the
 *  column right of the path and would otherwise print over each other.
 *  Geometry: the readout's 7px glyphs sit 6–13 units above the marker,
 *  the label's 4 above to 3 below its tick, so they collide while the
 *  marker is 2–16 units below the tick; 0.025 of a ~650-unit path covers
 *  that band (0.015 left a ~6-unit collision window on the way down). */
const NEAR_TICK = 0.025

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 100 km at the start of the fall, 000 km at touchdown — integer km,
 *  zero-padded so the readout never changes width. */
const altitudeLabel = (progress: number) =>
  `${String(Math.round((1 - progress) * 100)).padStart(3, '0')} KM`

/** Where the fall starts, in scroll px: the hero's natural top. Measured
 *  off the pin-spacer once the hero pin has wrapped the hero — the spacer
 *  stays in flow while the hero itself is held — and against the
 *  smoother's scrollTop, consistent with the content transform (equal to
 *  window.scrollY without one). Returned as a NUMBER on purpose: a string
 *  start ('top top') on an element another trigger pins is pushed by
 *  ScrollTrigger to that pin's END (the element never "reaches" the top
 *  while held), which would put progress 0 after the fall instead of
 *  before it. Numeric starts are absolute and skip the push. */
export function fallStart(hero: HTMLElement): number {
  const spacer = hero.parentElement
  const box = spacer?.classList.contains('pin-spacer') ? spacer : hero
  return (
    box.getBoundingClientRect().top +
    (landingSmoother()?.scrollTop() ?? window.scrollY)
  )
}

/** Under transform-based smoothing the native anchor jump scrolls the
 *  (fixed) wrapper nowhere — route through the smoother. Without one,
 *  native behavior stands. */
function scrollToSheet(e: MouseEvent, id: string) {
  const smoother = landingSmoother()
  if (!smoother) return
  e.preventDefault()
  smoother.scrollTo(`#descent-${id}`, true)
}

export function DescentSpine({
  heroRef,
  descentRef
}: {
  heroRef: RefObject<HTMLDivElement>
  descentRef: RefObject<HTMLDivElement>
}) {
  const [armed, setArmed] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const drawPathRef = useRef<SVGPathElement | null>(null)
  const markerRef = useRef<SVGGElement | null>(null)
  const altRef = useRef<SVGTextElement | null>(null)
  const tickRefs = useRef<(SVGGElement | null)[]>([])

  // Tier gate: the runtime never publishes on 'still', and 'lite' skips the
  // rope — so nothing (not even the SVG DOM) exists off the full tier.
  useEffect(
    () =>
      onLandingRuntime(({ tier }) => {
        if (tier === 'full') setArmed(true)
      }),
    []
  )

  useEffect(() => {
    if (!armed) return
    let timeline: TimelineInstance | null = null

    const off = onLandingRuntime(({ motion }) => {
      const hero = heroRef.current
      const root = descentRef.current
      const path = drawPathRef.current
      const marker = markerRef.current
      const alt = altRef.current
      const host = hostRef.current
      if (!hero || !root || !path || !marker || !alt || !host || timeline) return
      const { gsap } = motion

      // The trajectory is a fixed path in SVG user units, so its geometry is
      // sampled ONCE into a lookup table here. getPointAtLength forces a
      // synchronous style+layout pass in Blink, and the marker rides the path
      // on every scrubbed scroll frame — interleaved with the runtime's
      // per-frame CSS-var writes that read was a full-document reflow per
      // frame. 256 samples on a 640-unit path keeps the marker within a
      // small fraction of a pixel.
      const total = path.getTotalLength()
      const lut: { x: number; y: number }[] = Array.from(
        { length: SAMPLES + 1 },
        (_, i) => {
          const pt = path.getPointAtLength((i / SAMPLES) * total)
          return { x: pt.x, y: pt.y }
        }
      )
      const pointAt = (p: number) => {
        const t = clamp01(p) * SAMPLES
        const i = Math.min(SAMPLES - 1, Math.floor(t))
        const f = t - i
        const a = lut[i]
        const b = lut[i + 1]
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
      }
      const place = (el: SVGGElement, p: number) => {
        const pt = pointAt(p)
        el.setAttribute(
          'transform',
          `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`
        )
      }

      // Fall progress at which each sheet "passes" (its centre crosses the
      // viewport centre). Measured, not assumed, so uneven sheet heights
      // can't drift the ticks away from the marker; recomputed on every
      // trigger refresh. Evenly spaced until the first measurement.
      const fractions: number[] = SECTIONS.map(
        (_, i) => (i + 1) / (SECTIONS.length + 1)
      )
      const lit: boolean[] = SECTIONS.map(() => false)
      const near: boolean[] = SECTIONS.map(() => false)
      let live = false
      let altText = ''

      const update = (self: ScrollTriggerInstance) => {
        const p = clamp01(self.progress)
        place(marker, p)
        const label = altitudeLabel(p)
        if (label !== altText) {
          altText = label
          alt.textContent = label
        }
        const nowLive = p > LIVE_AT
        if (nowLive !== live) {
          live = nowLive
          host.classList.toggle('is-live', live)
        }
        SECTIONS.forEach((_, i) => {
          const tick = tickRefs.current[i]
          const on = p >= fractions[i]
          if (on !== lit[i]) {
            lit[i] = on
            tick?.classList.toggle('is-lit', on)
          }
          // The marker is on this tick: its label steps aside for the
          // readout, and comes back once the marker has passed.
          const close = Math.abs(p - fractions[i]) < NEAR_TICK
          if (close !== near[i]) {
            near[i] = close
            tick?.classList.toggle('is-near', close)
          }
        })
      }

      // Reads start/end (scroll px) off the trigger itself: the hero pin is
      // built late (after fonts + the entrance settle) and its +260vh
      // spacer moves every position below it, so the trigger's own
      // recomputed values are the only trustworthy domain. Sheet centres
      // are visual rects plus the smoother's scrollTop — consistent with
      // the content transform, and equal to window.scrollY without one.
      const placeTicks = (self: ScrollTriggerInstance) => {
        const span = self.end - self.start
        // Negated so NaN bails too: a timeline-attached trigger defers its
        // first refresh a tick (ScrollTrigger schedules it via delayedCall
        // so the timeline can populate), and until then end is undefined.
        if (!(span > 0)) return
        const scrollTop = landingSmoother()?.scrollTop() ?? window.scrollY
        const halfViewport = window.innerHeight / 2
        SECTIONS.forEach((s, i) => {
          const sec = document.querySelector(`[data-sec="${s.id}"]`)
          const tick = tickRefs.current[i]
          if (!sec || !tick) return
          const r = sec.getBoundingClientRect()
          const centre = r.top + r.height / 2 + scrollTop
          fractions[i] = clamp01((centre - halfViewport - self.start) / span)
          place(tick, fractions[i])
        })
        // A refresh pass runs onUpdate before onRefresh — re-sync the lit
        // states against the fractions that were just measured.
        update(self)
      }

      timeline = gsap.timeline({
        scrollTrigger: {
          // The descent root is the trigger (not the hero): a trigger on
          // the pinned hero has the pin reverted while it measures, so
          // `end` would come out 260vh short of the root's real bottom.
          // With the root as trigger the pin-spacer stays in flow and
          // 'bottom bottom' lands on touchdown; the numeric start puts
          // progress 0 at the hero's top — see fallStart.
          trigger: root,
          start: () => fallStart(hero),
          end: 'bottom bottom',
          scrub: true,
          // Born BEFORE the pin builds; refreshing before the pin has
          // re-applied its spacer in a refresh pass would still measure
          // `end` short. A lower priority sorts this after every
          // default-priority trigger, the pin included.
          refreshPriority: -1,
          onRefresh: placeTicks,
          onUpdate: update
        }
      })
      timeline.fromTo(
        path,
        { drawSVG: '0%' },
        { drawSVG: '100%', ease: 'none', duration: 1 }
      )
      // No synchronous seed: a timeline's ScrollTrigger measures itself on
      // the next tick (see placeTicks), and that refresh — like every
      // refreshAll after it — runs onRefresh, which places the ticks and
      // re-syncs the marker, readout and lit states through update().
    })

    return () => {
      off()
      timeline?.scrollTrigger?.kill()
      timeline?.kill()
      timeline = null
    }
  }, [armed, heroRef, descentRef])

  if (!armed) return null

  return (
    <div
      ref={hostRef}
      className="lx-spine pointer-events-none fixed z-30 hidden lg:block"
    >
      <svg
        className="lx-spine-svg"
        viewBox="0 0 48 640"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ghost track — the full trajectory at a whisper, so the drawn
            portion reads as progress along a known route */}
        <path aria-hidden className="lx-spine-track" d={TRAJECTORY} />
        {/* the drawn trajectory: DrawSVG needs a visible stroke — set in
            CSS below, scrubbed from 0% to 100% against fall progress */}
        <path
          aria-hidden
          ref={drawPathRef}
          className="lx-spine-draw"
          d={TRAJECTORY}
        />

        {/* stage ticks — real links into their sheets (the old HUD ladder).
            The host swallows pointer events; the anchors take them back. */}
        {SECTIONS.map((s, i) => (
          <g
            key={s.id}
            ref={(el) => {
              tickRefs.current[i] = el
            }}
            className="lx-spine-tick"
          >
            <a
              href={`#descent-${s.id}`}
              aria-label={s.label}
              onClick={(e) => scrollToSheet(e, s.id)}
            >
              {/* invisible hit area: 7px type and a 1px line are no target */}
              <rect
                aria-hidden
                className="lx-spine-hit"
                x="-8"
                y="-7"
                width="96"
                height="14"
              />
              <line x1="-4" y1="0" x2="4" y2="0" />
              <text x="10" y="3">{`${s.index} ${s.label}`}</text>
            </a>
          </g>
        ))}

        {/* position marker riding the path, altitude readout above-right of
            it — off the tick labels' baseline, which sit level with their
            tick; the label the marker is on hides (is-near) so the two
            never print over each other while it passes */}
        <g aria-hidden ref={markerRef} className="lx-spine-marker">
          <rect
            x="-2.5"
            y="-2.5"
            width="5"
            height="5"
            fill="var(--lx-signal)"
          />
          <text ref={altRef} className="lx-spine-alt" x="10" y="-6">
            100 KM
          </text>
        </g>
      </svg>

      <style jsx global>{`
        .lx-spine {
          /* The rope sits outside .lx-hero / .lx-descent, so the landing
             accent and the manifest's role tokens are re-pinned here
             (same values as globals.css; light mode flips below). */
          --accent: #ccff00;
          --accent-rgb: 204 255 0;
          --lx-line: rgb(var(--z800) / 0.7);
          --lx-line-strong: rgb(var(--z700));
          --lx-ink: rgb(var(--z100));
          --lx-ink-dim: rgb(var(--z400));
          --lx-ink-faint: rgb(var(--z600));
          --lx-signal: var(--accent);
          /* in the grid's gutter when there is one, 12px from the edge
             otherwise; the labels run right of the 48-unit viewBox */
          left: max(12px, calc((100vw - 72rem) / 2 - 40px));
          top: 50%;
          width: 140px;
          transform: translateY(-50%);
          /* visibility rides along so the tick links leave the tab order
             while the rope is faded out */
          opacity: 0;
          visibility: hidden;
          transition:
            opacity 500ms ease,
            visibility 0s linear 500ms;
        }
        .lx-spine.is-live {
          opacity: 1;
          visibility: visible;
          transition: opacity 500ms ease;
        }
        html.light .lx-spine {
          /* the hero's light re-pin (globals.css html.light .lx-hero), so
             the rope matches the white sheet it hangs beside */
          --accent: #ff5e00;
          --accent-rgb: 255 94 0;
          --z50: 9 9 11;
          --z100: 24 24 27;
          --z200: 39 39 42;
          --z300: 63 63 70;
          --z400: 82 82 91;
          --z500: 113 113 122;
          --z600: 161 161 170;
          --z700: 212 212 216;
          --z800: 228 228 231;
          --z900: 244 244 245;
          --z950: 250 250 250;
          --lx-ink-dim: rgb(var(--z500));
        }
        .lx-spine-svg {
          display: block;
          height: min(64vh, 620px);
          width: auto;
          overflow: visible;
        }
        .lx-spine-track {
          stroke: var(--lx-line);
          stroke-width: 1;
          stroke-dasharray: 2 4;
        }
        .lx-spine-draw {
          stroke: var(--lx-signal);
          stroke-width: 1;
          stroke-linecap: butt;
        }
        .lx-spine-tick a {
          pointer-events: auto;
          cursor: pointer;
        }
        .lx-spine-hit {
          fill: none;
          pointer-events: all;
        }
        .lx-spine-tick line {
          stroke: var(--lx-line-strong);
          stroke-width: 1;
          transition: stroke 300ms ease;
        }
        .lx-spine-tick text {
          font-family: var(--font-data), ui-monospace, monospace;
          font-size: 7px;
          letter-spacing: 0.14em;
          fill: var(--lx-ink-faint);
          transition:
            fill 300ms ease,
            opacity 150ms ease;
        }
        .lx-spine-tick.is-lit line {
          stroke: var(--lx-ink);
        }
        .lx-spine-tick.is-lit text {
          fill: var(--lx-ink);
        }
        /* the marker (and its KM readout) is on this tick */
        .lx-spine-tick.is-near text {
          opacity: 0;
        }
        .lx-spine-tick a:hover text,
        .lx-spine-tick a:focus-visible text {
          fill: var(--lx-signal);
        }
        .lx-spine-marker {
          will-change: transform;
        }
        .lx-spine-alt {
          font-family: var(--font-data), ui-monospace, monospace;
          font-size: 7px;
          letter-spacing: 0.14em;
          font-variant-numeric: tabular-nums;
          fill: var(--lx-ink-dim);
        }
      `}</style>
    </div>
  )
}
