'use client'

// THE SPINE — Layer 3 of the "Controlled Fall" plan: the continuous
// through-line. A fixed left-gutter SVG trajectory drawn (DrawSVGPlugin)
// against total descent progress, five altitude ticks keyed to the
// [data-sec] sections that ignite as each stage passes, and a position
// marker riding the path. Left gutter is trajectory, right rail (the HUD)
// is telemetry — the two frame the content instead of decorating it.
//
// lg+ and full tier only: the component renders nothing until the landing
// runtime publishes with tier 'full', and the CSS hides it below lg. It is
// mounted from page.tsx OUTSIDE #smooth-wrapper — position:fixed dies
// inside ScrollSmoother's transformed content.

import { RefObject, useEffect, useRef, useState } from 'react'
import { onLandingRuntime, type LandingMotion } from '@/lib/landingMotion'
import { SECTIONS } from './Descent'

type TimelineInstance = ReturnType<LandingMotion['gsap']['timeline']>

// One gentle re-entry arc in SVG user units. Both paths (ghost track +
// drawn trajectory) share it; ticks and the marker are positioned along it
// with getPointAtLength, so every consumer agrees on the geometry.
const TRAJECTORY = 'M 38 6 C 10 130, 38 330, 16 634'

export function DescentSpine({
  descentRef
}: {
  descentRef: RefObject<HTMLDivElement>
}) {
  const [armed, setArmed] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const drawPathRef = useRef<SVGPathElement | null>(null)
  const markerRef = useRef<SVGGElement | null>(null)
  const tickRefs = useRef<(SVGGElement | null)[]>([])

  // Tier gate: the runtime never publishes on 'still', and 'lite' skips the
  // spine — so nothing (not even the SVG DOM) exists off the full tier.
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
    let visibility: IntersectionObserver | null = null

    const off = onLandingRuntime(({ motion }) => {
      const root = descentRef.current
      const path = drawPathRef.current
      const marker = markerRef.current
      const host = hostRef.current
      if (!root || !path || !marker || !host || timeline) return
      const { gsap } = motion

      // The trajectory is a fixed path in SVG user units, so its geometry is
      // sampled ONCE into a lookup table here. getPointAtLength forces a
      // synchronous style+layout pass in Blink, and the marker rides the path
      // on every scrubbed scroll frame — interleaved with the runtime's
      // per-frame CSS-var writes that read was a full-document reflow per
      // frame (~25% of scroll-time CPU in profiles). 256 samples on a
      // 640-unit path keeps the marker within a small fraction of a pixel.
      const total = path.getTotalLength()
      const SAMPLES = 256
      const lut: { x: number; y: number }[] = Array.from(
        { length: SAMPLES + 1 },
        (_, i) => {
          const pt = path.getPointAtLength((i / SAMPLES) * total)
          return { x: pt.x, y: pt.y }
        }
      )
      const pointAt = (p: number) => {
        const t = Math.min(1, Math.max(0, p)) * SAMPLES
        const i = Math.min(SAMPLES - 1, Math.floor(t))
        const f = t - i
        const a = lut[i]
        const b = lut[i + 1]
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
      }

      // Descent progress at which each stage "passes" (its center crosses
      // the viewport center — the same band the HUD ladder's IO uses).
      // Measured, not assumed, so uneven section heights can't drift the
      // ticks away from the marker. Recomputed on every trigger refresh.
      const fractions: number[] = SECTIONS.map(
        (_, i) => (i + 1) / (SECTIONS.length + 1)
      )
      const lit: boolean[] = SECTIONS.map(() => false)

      const placeTicks = () => {
        const vh = window.innerHeight
        const rootRect = root.getBoundingClientRect()
        const denom = Math.max(1, rootRect.height - vh)
        SECTIONS.forEach((s, i) => {
          const sec = document.querySelector(`[data-sec="${s.id}"]`)
          const tick = tickRefs.current[i]
          if (!sec || !tick) return
          const r = sec.getBoundingClientRect()
          const centerInRoot = r.top - rootRect.top + r.height / 2
          const f = Math.min(1, Math.max(0, (centerInRoot - vh / 2) / denom))
          fractions[i] = f
          const pt = pointAt(f)
          tick.setAttribute(
            'transform',
            `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`
          )
        })
      }

      const update = (progress: number) => {
        const p = Math.min(1, Math.max(0, progress))
        const pt = pointAt(p)
        marker.setAttribute(
          'transform',
          `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`
        )
        SECTIONS.forEach((_, i) => {
          const on = p >= fractions[i]
          if (on === lit[i]) return
          lit[i] = on
          tickRefs.current[i]?.classList.toggle('is-lit', on)
        })
      }

      // Same 0..1 geometry as the HUD altitude readout, so the marker's
      // position and "ALT xx KM" always tell the same story.
      timeline = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
          onRefresh: placeTicks,
          onUpdate: (self) => update(self.progress)
        }
      })
      timeline.fromTo(
        path,
        { drawSVG: '0%' },
        { drawSVG: '100%', ease: 'none', duration: 1 }
      )

      // Fade-in gate: live once the descent root's top crosses 75% of the
      // viewport, off again when it's back below. An IntersectionObserver
      // (not a ScrollTrigger) on purpose — IO measures visual rects, so it
      // stays correct under the smoother's transform (same reasoning as the
      // HUD ladder), and it fires its seed callback on observe.
      visibility = new IntersectionObserver(
        (entries) =>
          host.classList.toggle(
            'is-live',
            entries.some((e) => e.isIntersecting)
          ),
        { threshold: 0, rootMargin: '0px 0px -25% 0px' }
      )
      visibility.observe(root)

      placeTicks()
      update(timeline.scrollTrigger?.progress ?? 0)
    })

    return () => {
      off()
      timeline?.scrollTrigger?.kill()
      timeline?.kill()
      visibility?.disconnect()
    }
  }, [armed, descentRef])

  if (!armed) return null

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="lx-spine pointer-events-none fixed left-3 top-1/2 z-30 hidden -translate-y-1/2 lg:block"
    >
      <svg
        className="lx-spine-svg"
        viewBox="0 0 48 640"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ghost track — the full trajectory at a whisper, so the drawn
            portion reads as progress along a known route */}
        <path className="lx-spine-track" d={TRAJECTORY} />
        {/* the drawn trajectory: DrawSVG needs a visible stroke — set in
            CSS below, scrubbed from 0% to 100% against descent progress */}
        <path ref={drawPathRef} className="lx-spine-draw" d={TRAJECTORY} />

        {SECTIONS.map((s, i) => (
          <g
            key={s.id}
            ref={(el) => {
              tickRefs.current[i] = el
            }}
            className="lx-spine-tick"
          >
            <line x1="-6" y1="0" x2="6" y2="0" />
            <text x="10" y="2.5">{`0${i + 1}`}</text>
          </g>
        ))}

        {/* position marker riding the path */}
        <g ref={markerRef} className="lx-spine-marker">
          <circle className="lx-spine-marker-ring" r="4.5" />
          <circle className="lx-spine-marker-dot" r="1.8" />
        </g>
      </svg>

      <style jsx global>{`
        .lx-spine {
          /* landing accent, re-pinned: the spine sits outside .lx-hero /
             .lx-descent, so it would otherwise inherit the app-wide green */
          --accent: #ccff00;
          --accent-rgb: 204 255 0;
          opacity: 0;
          transition: opacity 600ms ease;
        }
        html.light .lx-spine {
          --accent: #ff5e00;
          --accent-rgb: 255 94 0;
        }
        .lx-spine.is-live {
          opacity: 1;
        }
        .lx-spine-svg {
          display: block;
          height: min(64vh, 620px);
          width: auto;
          overflow: visible;
        }
        .lx-spine-track {
          stroke: rgb(var(--z700) / 0.35);
          stroke-width: 1;
          stroke-dasharray: 2 5;
        }
        .lx-spine-draw {
          stroke: rgb(var(--accent-rgb) / 0.85);
          stroke-width: 1.5;
          stroke-linecap: round;
          filter: drop-shadow(0 0 4px rgb(var(--accent-rgb) / 0.45));
        }
        .lx-spine-tick line {
          stroke: rgb(var(--z700) / 0.8);
          stroke-width: 1;
          transition: stroke 400ms ease;
        }
        .lx-spine-tick text {
          font-family: var(--font-pixel);
          font-size: 5.5px;
          letter-spacing: 0.14em;
          fill: rgb(var(--z600) / 0.9);
          transition: fill 400ms ease;
        }
        .lx-spine-tick.is-lit line {
          stroke: var(--accent);
          filter: drop-shadow(0 0 5px rgb(var(--accent-rgb) / 0.7));
        }
        .lx-spine-tick.is-lit text {
          fill: var(--accent);
        }
        .lx-spine-marker-ring {
          stroke: rgb(var(--accent-rgb) / 0.4);
          stroke-width: 1;
        }
        .lx-spine-marker-dot {
          fill: var(--accent);
          filter: drop-shadow(0 0 6px rgb(var(--accent-rgb) / 0.8));
        }
      `}</style>
    </div>
  )
}
