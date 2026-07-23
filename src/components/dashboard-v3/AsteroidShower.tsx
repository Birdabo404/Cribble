'use client'

import { useEffect, useRef } from 'react'

// Streaks in flight behind the glass. Each re-launches on its own
// randomized schedule with a fresh color, trajectory, and speed.
const ASTEROID_COUNT = 3

// Duotone palette (r g b triplets via CSS vars, all theme-aware): ember,
// ice, and "white" (--star-rgb, which flips so streaks never vanish
// against the light-mode canvas).
const ASTEROID_COLORS = [
  'var(--ember-rgb)',
  'var(--ice-rgb)',
  'var(--star-rgb)'
]

type LaunchOpts = {
  speedMin: number // px per second
  speedMax: number
  gapMin: number // idle ms between passes
  gapMax: number
  randomColor: boolean
}

/**
 * Dashboard asteroid shower — same fly-by physics as the landing page's
 * AsteroidField (straight diagonal pass, speed-derived duration, long
 * randomized idle gaps). Two layers:
 *  - regular colored streaks BEHIND the glass panels (z-0), whose halos
 *    the panels blur into a soft diffused bloom
 *  - one rare, slow "grazer" comet ABOVE the panels (z-20), roughly every
 *    ten minutes
 */
export function AsteroidShower() {
  const behindRef = useRef<HTMLDivElement>(null)
  const aboveRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduceMotion.matches) return

    const timers = new Set<number>()
    const anims = new Set<Animation>()
    let disposed = false

    const rand = (min: number, max: number) => min + Math.random() * (max - min)

    const launch = (el: HTMLSpanElement, opts: LaunchOpts) => {
      if (disposed) return
      const w = window.innerWidth
      const h = window.innerHeight
      const margin = 280

      if (opts.randomColor) {
        const rgb = ASTEROID_COLORS[Math.floor(Math.random() * ASTEROID_COLORS.length)]
        el.style.setProperty('--ast-rgb', rgb)
      }

      // Travel direction: a shallow-to-medium diagonal, either way across the
      // screen. Head (bright end) leads, so rotation == travel angle.
      const goRight = Math.random() < 0.5
      const goDown = Math.random() < 0.62
      const tilt = rand(10, 42) * (Math.PI / 180)
      const ux = (goRight ? 1 : -1) * Math.cos(tilt)
      const uy = (goDown ? 1 : -1) * Math.sin(tilt)
      const rotDeg = (Math.atan2(uy, ux) * 180) / Math.PI

      // A single straight pass fully across the viewport (plus offscreen
      // run-up and run-out so it enters and exits cleanly).
      const dist = Math.hypot(w, h) + margin * 2
      const startX = goRight ? -margin : w + margin
      const bandY = goDown ? rand(-0.15 * h, 0.7 * h) : rand(0.3 * h, 1.05 * h)
      const startY = bandY
      const endX = startX + ux * dist
      const endY = startY + uy * dist

      const speed = rand(opts.speedMin, opts.speedMax)
      const duration = (dist / speed) * 1000

      const from = `translate(${startX}px, ${startY}px) rotate(${rotDeg}deg)`
      const to = `translate(${endX}px, ${endY}px) rotate(${rotDeg}deg)`

      const anim = el.animate(
        [
          { transform: from, opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.06 },
          { opacity: 1, offset: 0.9 },
          { transform: to, opacity: 0, offset: 1 }
        ],
        { duration, easing: 'linear', fill: 'forwards' }
      )
      anims.add(anim)

      anim.onfinish = () => {
        anims.delete(anim)
        if (disposed) return
        const gap = rand(opts.gapMin, opts.gapMax)
        const t = window.setTimeout(() => launch(el, opts), gap)
        timers.add(t)
      }
    }

    // Regular streaks: long idle gaps keep passes rare — at most one or two
    // visible at a time, never a swarm.
    const regularOpts: LaunchOpts = {
      speedMin: 480,
      speedMax: 2200,
      gapMin: 18_000,
      gapMax: 45_000,
      randomColor: true
    }
    const behind = behindRef.current
    if (behind) {
      const streaks = Array.from(
        behind.querySelectorAll<HTMLSpanElement>('.dash-asteroid')
      )
      streaks.forEach((el, i) => {
        const t = window.setTimeout(
          () => launch(el, regularOpts),
          rand(2_000, 8_000) + i * rand(8_000, 15_000)
        )
        timers.add(t)
      })
    }

    // The grazer: one slow, luminous comet that sails OVER the glass,
    // roughly every ten minutes. First pass arrives a few minutes in so a
    // normal session has a chance of catching one.
    const grazerOpts: LaunchOpts = {
      speedMin: 220,
      speedMax: 360,
      gapMin: 8 * 60_000,
      gapMax: 13 * 60_000,
      randomColor: false
    }
    const above = aboveRef.current
    const grazer = above?.querySelector<HTMLSpanElement>('.dash-grazer')
    if (grazer) {
      const t = window.setTimeout(
        () => launch(grazer, grazerOpts),
        rand(2 * 60_000, 6 * 60_000)
      )
      timers.add(t)
    }

    return () => {
      disposed = true
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
      anims.forEach((a) => a.cancel())
      anims.clear()
    }
  }, [])

  return (
    <>
      <div
        ref={behindRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 overflow-hidden z-0"
      >
        {Array.from({ length: ASTEROID_COUNT }).map((_, i) => (
          <span key={i} className="dash-asteroid" />
        ))}
      </div>

      <div
        ref={aboveRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 overflow-hidden z-20"
      >
        <span className="dash-grazer" />
      </div>

      <style jsx global>{`
        /* Trail: colored body burning to neon white at the head, so the
           color reads as a tint around a hot core rather than a pure hue. */
        .dash-asteroid {
          position: absolute;
          top: 0;
          left: 0;
          width: 130px;
          height: 1.5px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgb(var(--ast-rgb, var(--star-rgb)) / 0.06) 30%,
            rgb(var(--ast-rgb, var(--star-rgb)) / 0.5) 72%,
            rgb(255 255 255 / 0.92) 100%
          );
          opacity: 0;
          will-change: transform, opacity;
          transform-origin: right center;
        }

        /* Head: white-hot core wrapped in a colored corona. */
        .dash-asteroid::after {
          content: '';
          position: absolute;
          right: 0;
          top: -1.75px;
          width: 5px;
          height: 5px;
          background: rgb(255 255 255);
          border-radius: 9999px;
          box-shadow:
            0 0 5px rgb(255 255 255 / 0.95),
            0 0 12px rgb(var(--ast-rgb, var(--star-rgb)) / 0.9),
            0 0 26px rgb(var(--ast-rgb, var(--star-rgb)) / 0.45);
        }

        /* Halo: a soft light field around the head. Subtle in open sky;
           the liquid-glass panels blur it into a gentle diffused bloom
           when the streak passes behind them. */
        .dash-asteroid::before {
          content: '';
          position: absolute;
          right: -36px;
          top: -36px;
          width: 72px;
          height: 72px;
          border-radius: 9999px;
          background: radial-gradient(
            circle,
            rgb(255 255 255 / 0.10) 0%,
            rgb(var(--ast-rgb, var(--star-rgb)) / 0.13) 28%,
            rgb(var(--ast-rgb, var(--star-rgb)) / 0.04) 55%,
            transparent 72%
          );
        }

        /* The grazer — rare comet sailing above the glass. Long prismatic
           tail cooling from icy blue through violet into a warm white core. */
        .dash-grazer {
          position: absolute;
          top: 0;
          left: 0;
          width: 280px;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgb(96 165 250 / 0.08) 22%,
            rgb(129 140 248 / 0.2) 48%,
            rgb(196 181 253 / 0.4) 72%,
            rgb(255 255 255 / 0.7) 90%,
            rgb(255 255 255 / 1) 100%
          );
          opacity: 0;
          will-change: transform, opacity;
          transform-origin: right center;
        }
        .dash-grazer::after {
          content: '';
          position: absolute;
          right: 0;
          top: -2.5px;
          width: 7px;
          height: 7px;
          background: rgb(255 255 255);
          border-radius: 9999px;
          box-shadow:
            0 0 6px rgb(255 255 255 / 1),
            0 0 16px rgb(255 255 255 / 0.75),
            0 0 32px rgb(147 197 253 / 0.6),
            0 0 60px rgb(167 139 250 / 0.35);
        }
        .dash-grazer::before {
          content: '';
          position: absolute;
          right: -48px;
          top: -48px;
          width: 96px;
          height: 96px;
          border-radius: 9999px;
          background: radial-gradient(
            circle,
            rgb(255 255 255 / 0.14) 0%,
            rgb(147 197 253 / 0.12) 32%,
            rgb(167 139 250 / 0.05) 58%,
            transparent 75%
          );
        }

        @media (prefers-reduced-motion: reduce) {
          .dash-asteroid,
          .dash-grazer {
            display: none;
          }
        }
      `}</style>
    </>
  )
}
