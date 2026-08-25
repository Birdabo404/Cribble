'use client'

// Shared scroll machinery for the landing page's below-the-fold "descent".
//
// Design constraints:
//  · Scroll-coupled motion is GSAP (idle-loaded via lib/landingMotion —
//    zero bytes on the critical path). Each scrub Stage gets a
//    ScrollTrigger that writes progress into the element's `--p` custom
//    property, so all scrub math stays in CSS (clamp/calc on transform +
//    opacity only). A synchronous seed at mount keeps the first paint at
//    the right pose before (or without) the chunk.
//  · Entrance choreography is progressive enhancement: SSR/no-JS renders
//    the final state; a pre-paint layout effect "arms" a stage (hides its
//    `.st` children), and an IntersectionObserver flips it "live", firing
//    the staggered entrance. prefers-reduced-motion never arms anything.
//    When the motion chunk is ready in time, SectionHeader headings trade
//    the `.st` CSS rise for SplitText masked line reveals (see
//    useMaskedLines) — never both.
//  · Components that animate values (CountUp, DecodeText, live tickers)
//    read the surrounding Stage via context and start when it goes live.
//  · LandingScrollRuntime (bottom of file) is the page-level orchestrator:
//    it picks the capability tier, idle-loads the chunk, arms the full-tier
//    extras (ScrollSmoother, hero pin, velocity + atmosphere feedback) and
//    publishes the runtime every other consumer subscribes to.

import {
  createContext,
  CSSProperties,
  ReactNode,
  RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import type { GlobeHandle } from '@/components/Globe'
import {
  CRIBBLE_EASE_NAME,
  landingTier,
  loadLandingMotion,
  onLandingRuntime,
  publishLandingRuntime,
  retractLandingRuntime,
  whenIdle,
  type LandingMotion
} from '@/lib/landingMotion'
import { prefersReducedMotion } from '@/lib/motion'
import { useDecode } from '@/lib/useDecode'
import { createHeroPin } from './hero/heroPin'

// Instance types derived from the lazy bundle, so nothing here imports
// gsap's runtime into the critical chunk.
type ScrollTriggerInstance = ReturnType<LandingMotion['ScrollTrigger']['create']>
type ScrollSmootherInstance = ReturnType<LandingMotion['ScrollSmoother']['create']>
type TweenInstance = ReturnType<LandingMotion['gsap']['from']>
type SplitTextInstance = ReturnType<LandingMotion['SplitText']['create']>

/* ------------------------------------------------------------------ */
/* Scroll-scrub seed                                                   */
/* ------------------------------------------------------------------ */

// The one-off synchronous version of the scrub geometry: progress 0 as the
// element's top enters the viewport bottom, 1 as its bottom leaves the top
// (denominator vh + height). The live ScrollTrigger created in Stage uses
// the exact same geometry (start 'top bottom' → end 'bottom top'), so the
// seeded value and the first scrubbed value agree to the pixel.
function seedScrubProgress(el: HTMLElement) {
  const vh = window.innerHeight
  const r = el.getBoundingClientRect()
  const total = vh + r.height
  const raw = total > 0 ? (vh - r.top) / total : 1
  const p = raw < 0 ? 0 : raw > 1 ? 1 : raw
  el.style.setProperty('--p', p.toFixed(4))
}

/* ------------------------------------------------------------------ */
/* Stage — arms/reveals a subtree, optionally scroll-scrubbed          */
/* ------------------------------------------------------------------ */

const StageCtx = createContext(false)

/** True once the nearest Stage has entered the viewport (and motion is
 * allowed). Value components use it as their "go" signal. */
export const useStageLive = () => useContext(StageCtx)

export function Stage({
  id,
  className = '',
  scrub = false,
  children,
  style
}: {
  id?: string
  className?: string
  /** Also feed scroll progress into this element's `--p` (0..1). */
  scrub?: boolean
  children: ReactNode
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<'idle' | 'armed' | 'live'>('idle')

  // Arm before first client paint so the entrance can't flash.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    setPhase('armed')

    let trigger: ScrollTriggerInstance | null = null
    let offRuntime: (() => void) | null = null
    if (scrub) {
      // Seed --p synchronously — the first painted frame must already sit
      // at the correct scroll pose, not jump into it. If the motion chunk
      // never arrives (still tier, network), this static value is the
      // final say and the page stays correct.
      seedScrubProgress(el)
      offRuntime = onLandingRuntime(({ motion }) => {
        if (trigger) return
        trigger = motion.ScrollTrigger.create({
          trigger: el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
          onUpdate: (self) => {
            el.style.setProperty('--p', self.progress.toFixed(4))
          }
        })
        // hand-off write: onUpdate only fires on change, so align --p with
        // the trigger's own reading the moment it takes over from the seed
        el.style.setProperty('--p', trigger.progress.toFixed(4))
      })
    }

    // threshold 0 + a negative bottom rootMargin: fires once ~22% of the
    // viewport height of the section has scrolled in. A fractional
    // threshold would never fire for sections taller than the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase('live')
          io.disconnect()
        }
      },
      { threshold: 0, rootMargin: '0px 0px -22% 0px' }
    )
    io.observe(el)

    return () => {
      io.disconnect()
      offRuntime?.()
      trigger?.kill()
    }
  }, [scrub])

  return (
    <div
      ref={ref}
      id={id}
      style={style}
      className={`${className} ${
        phase === 'armed' ? 'stage-armed' : phase === 'live' ? 'stage-live' : ''
      }`}
    >
      <StageCtx.Provider value={phase === 'live'}>{children}</StageCtx.Provider>

      {/* Entrance vocabulary — shared by every section. styled-jsx dedupes
          identical global blocks, so many Stages cost one stylesheet. */}
      <style jsx global>{`
        .stage-armed .st:not([data-split]),
        .stage-armed .st-cell,
        .stage-armed .st-grow,
        .stage-armed .st-sweep {
          opacity: 0;
        }
        /* data-split: SplitText owns this element's entrance (masked line
           reveal, see useMaskedLines). The attribute is set in the same
           synchronous block that hides the lines behind their masks, so
           excluding it here can't flash — and it guarantees the CSS rise
           and the GSAP reveal never both fire on one element. */
        .stage-live .st:not([data-split]) {
          animation: st-rise 700ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        /* Kerning shifts between the pre-split text and the line-sliced
           spans read as a subtle "wobble" on reveal — pin it off for any
           element SplitText manages (GSAP guidance). */
        [data-split] {
          font-kerning: none;
        }
        @keyframes st-rise {
          from {
            opacity: 0;
            transform: translateY(var(--st-rise, 16px));
            filter: blur(var(--st-blur, 6px));
          }
        }
        /* Phones: dozens of staggered blur animations per stage overwhelm
           mobile GPUs mid-scroll — keep the rise, shrink the blur. */
        @media (max-width: 639px) {
          .stage-live .st {
            --st-blur: 3px;
            --st-rise: 12px;
          }
        }
        .stage-live .st-cell {
          animation: st-cell 520ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes st-cell {
          from {
            opacity: 0;
            transform: scale(0.3);
          }
        }
        .stage-live .st-grow {
          transform-origin: left center;
          animation: st-grow 900ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes st-grow {
          from {
            transform: scaleX(0);
          }
        }
        .stage-live .st-sweep {
          animation: st-sweep 1100ms cubic-bezier(0.65, 0, 0.35, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes st-sweep {
          from {
            clip-path: inset(0 100% 0 0);
          }
          to {
            clip-path: inset(0 0 0 0);
          }
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DecodeText — terminal scramble that resolves left to right          */
/* ------------------------------------------------------------------ */

export function DecodeText({
  text,
  delay = 0,
  className = ''
}: {
  text: string
  delay?: number
  className?: string
}) {
  const live = useStageLive()
  // The scramble loop lives in lib/useDecode (shared with the billboard's
  // hype announcement); here the Stage going live is the arm signal.
  const { out, decoding } = useDecode(text, live && !prefersReducedMotion(), delay)

  return (
    <span
      className={className}
      data-decoding={decoding ? '' : undefined}
      style={decoding ? { color: 'rgb(var(--accent-rgb) / 0.9)' } : undefined}
    >
      {out}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* CountUp — value odometer, fires when the stage goes live            */
/* ------------------------------------------------------------------ */

export function CountUp({
  to,
  duration = 1500,
  delay = 0,
  format = (n: number) => n.toLocaleString('en-US'),
  className = ''
}: {
  to: number
  duration?: number
  delay?: number
  format?: (n: number) => string
  className?: string
}) {
  const live = useStageLive()
  const [v, setV] = useState(to) // SSR/no-JS shows the final value
  const rafRef = useRef(0)

  useEffect(() => {
    if (!live || prefersReducedMotion()) return
    setV(0)
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(2, -10 * t) // easeOutExpo
      setV(Math.round(to * (t === 1 ? 1 : eased)))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    const timer = setTimeout(() => {
      rafRef.current = requestAnimationFrame(step)
    }, delay)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(rafRef.current)
    }
  }, [live, to, duration, delay])

  return <span className={className}>{format(v)}</span>
}

/* ------------------------------------------------------------------ */
/* useMaskedLines — SplitText masked line reveal, CSS-fallback safe    */
/* ------------------------------------------------------------------ */

/**
 * Upgrades an `.st` element's entrance to a SplitText masked line reveal
 * (lines rise from behind their clip edge, staggered) when the motion
 * chunk is ready in time. The double-animation guard, in order:
 *
 *  1. The stage goes live BEFORE the chunk lands → `playedRef` latches,
 *     the runtime subscription refuses to split, and the `.st` CSS
 *     entrance fires exactly as today. Nothing regresses without JS/GSAP.
 *  2. The chunk lands first → the element gets `data-split` (which the
 *     Stage CSS excludes from the `.st` animation) in the same synchronous
 *     block that hides its lines behind masks; the paused reveal tween
 *     then plays when the stage flips live. Only GSAP animates it.
 *
 * autoSplit + returning the tween from onSplit handles font-load/resize
 * re-splits (Instrument Serif loads with preload: false, so late reflows
 * are the norm, not the edge case). `delayMs` mirrors the `--d` stagger
 * the CSS fallback uses.
 */
export function useMaskedLines<T extends HTMLElement>(
  delayMs = 0
): RefObject<T> {
  const live = useStageLive()
  const ref = useRef<T>(null)
  const playedRef = useRef(false)
  const tweenRef = useRef<TweenInstance | null>(null)

  useEffect(() => {
    if (!live || playedRef.current) return
    playedRef.current = true
    tweenRef.current?.play()
  }, [live])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let split: SplitTextInstance | null = null
    const off = onLandingRuntime(({ motion }) => {
      if (split || playedRef.current || prefersReducedMotion()) return
      const { gsap, SplitText } = motion
      el.setAttribute('data-split', '')
      split = SplitText.create(el, {
        type: 'lines',
        mask: 'lines',
        autoSplit: true,
        aria: 'auto',
        onSplit(self) {
          // Re-runs on every re-split (fonts, element width changes — and
          // splitting a shrink-to-fit heading changes its own width, so
          // re-splits can fire even without a resize). Two regimes:
          //  · not played yet — build the paused reveal; from() immediate-
          //    renders, so the fresh lines are hidden the instant they
          //    exist and the stage-live effect plays the current tween.
          //  · played (or mid-play) — the re-split must land on the FINAL
          //    state, so skip the tween entirely: unmanaged lines keep
          //    their natural, visible pose. (Re-arming a paused from()
          //    here is what used to strand re-split headings hidden at
          //    yPercent 110 — verified against the Finale wordmark.)
          if (playedRef.current) {
            tweenRef.current = null
            return
          }
          const tween = gsap.from(self.lines, {
            yPercent: 110,
            duration: 0.8,
            stagger: 0.09,
            delay: delayMs / 1000,
            ease: CRIBBLE_EASE_NAME,
            paused: true
          })
          tweenRef.current = tween
          return tween
        }
      })
    })
    return () => {
      off()
      tweenRef.current?.kill()
      tweenRef.current = null
      split?.revert()
      el.removeAttribute('data-split')
    }
  }, [delayMs])

  return ref
}

/* ------------------------------------------------------------------ */
/* Section grammar — header, seams, corner ticks                       */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  index,
  code,
  title,
  serif,
  body,
  annotation,
  align = 'left'
}: {
  index: string
  code: string
  title: ReactNode
  serif: ReactNode
  body?: ReactNode
  annotation?: string
  align?: 'left' | 'center'
}) {
  const center = align === 'center'
  // Masked line reveals for the display pair only; the label row, rule and
  // body keep the plain .st rise (they're one-liners — a mask buys nothing).
  // Delays mirror the --d stagger of the CSS fallback path.
  const titleRef = useMaskedLines<HTMLHeadingElement>(90)
  const serifRef = useMaskedLines<HTMLDivElement>(180)
  return (
    <div className={center ? 'flex flex-col items-center text-center' : ''}>
      <div
        className={`st flex items-baseline gap-4 text-[10px] tracking-[0.32em] text-zinc-500 ${
          center ? 'justify-center' : 'justify-between'
        }`}
        style={{ '--d': '0ms' } as CSSProperties}
      >
        <span className="whitespace-nowrap">
          <span style={{ color: 'var(--accent)' }}>{index}</span>
          <span className="text-zinc-700">{' // '}</span>
          <DecodeText text={code} delay={120} />
        </span>
        {annotation && !center && (
          <span className="hidden text-[9px] tracking-[0.3em] text-zinc-700 md:block">
            {annotation}
          </span>
        )}
      </div>

      <h2
        ref={titleRef}
        className="st mt-5 font-display text-4xl font-semibold leading-[0.98] tracking-tight text-zinc-50 md:text-[3.4rem]"
        style={{ '--d': '90ms' } as CSSProperties}
      >
        {title}
      </h2>

      <div
        ref={serifRef}
        className="st mt-3 font-serif italic text-2xl leading-snug text-zinc-400 md:text-[1.9rem]"
        style={{ '--d': '180ms' } as CSSProperties}
      >
        {serif}
      </div>

      <span
        className={`st-grow mt-6 block h-px w-24 ${center ? 'mx-auto' : ''}`}
        style={
          {
            '--d': '240ms',
            background:
              'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.9), rgb(var(--accent-rgb) / 0.05))'
          } as CSSProperties
        }
      />

      {body && (
        <p
          className={`st mt-6 max-w-xl font-sans text-base leading-[1.75] text-zinc-400 sm:text-[15px] sm:leading-[1.8] ${
            center ? 'mx-auto' : ''
          }`}
          style={{ '--d': '280ms' } as CSSProperties}
        >
          {body}
        </p>
      )}
    </div>
  )
}

/** Telemetry seam — the thin HUD chatter line that opens each section and
 * keeps score of the descent (altitude falls section by section). The
 * readout may wrap on narrow phones (nowrap used to push it past the
 * viewport edge and give the whole page a horizontal wobble). */
export function Seam({ alt, note }: { alt: string; note: string }) {
  return (
    <div
      className="st flex items-center gap-3 sm:gap-4 text-[9px] tracking-[0.3em] text-zinc-600"
      style={{ '--d': '0ms' } as CSSProperties}
    >
      <span className="lx-seamline h-px flex-1 bg-zinc-800/70" />
      <span className="flex min-w-0 items-center gap-3">
        <span style={{ color: 'rgb(var(--accent-rgb) / 0.65)' }}>+</span>
        <span className="text-center leading-relaxed sm:whitespace-nowrap">
          ALT {alt} · {note}
        </span>
        <span style={{ color: 'rgb(var(--accent-rgb) / 0.65)' }}>+</span>
      </span>
      <span className="lx-seamline h-px flex-1 bg-zinc-800/70" />
    </div>
  )
}

/** Blueprint corner ticks — mount inside any `relative` panel. */
export function CornerTicks({ className = '' }: { className?: string }) {
  const tick = 'absolute text-[11px] leading-none text-zinc-700 select-none'
  return (
    <span aria-hidden className={className}>
      <span className={`${tick} -left-1.5 -top-2`}>+</span>
      <span className={`${tick} -right-1.5 -top-2`}>+</span>
      <span className={`${tick} -left-1.5 -bottom-2`}>+</span>
      <span className={`${tick} -right-1.5 -bottom-2`}>+</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* LandingScrollRuntime — the page-level motion orchestrator           */
/* ------------------------------------------------------------------ */

/**
 * Headless component mounted once from page.tsx. Chooses the capability
 * tier at hydration and arms the motion layer accordingly:
 *
 *  · still — returns immediately; the chunk never loads and nothing arms
 *    beyond the existing Stage CSS.
 *  · lite  — idle-loads the chunk, applies the ScrollTrigger config, and
 *    publishes the runtime (Stage --p scrubs + SplitText reveals arm; no
 *    smoother, no pin, no spine, no velocity/atmosphere feedback).
 *  · full  — everything: ScrollSmoother, the pinned hero entry, velocity
 *    feedback (--vel/--skew) and the atmosphere scrub (--alt), then the
 *    runtime publish. The `lx-motion-full` class on <html> is what arms
 *    the CSS consumers (atmosphere layers, hero star layer, skew), so a
 *    page without the chunk renders byte-identical to today.
 *
 * The runtime is published only AFTER the global config and (on full) the
 * smoother + pin exist, so subscriber-created ScrollTriggers are born with
 * correct geometry.
 */
export function LandingScrollRuntime({
  wrapperRef,
  contentRef,
  heroRef,
  globeHandleRef
}: {
  wrapperRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  heroRef: RefObject<HTMLDivElement>
  globeHandleRef: RefObject<GlobeHandle | null>
}) {
  useEffect(() => {
    const tier = landingTier()
    switch (tier) {
      case 'still':
        return
      case 'lite':
      case 'full':
        break
      default: {
        const exhaustive: never = tier
        return exhaustive
      }
    }

    let disposed = false
    let cleanup: (() => void) | null = null
    whenIdle(() => {
      if (disposed) return
      void loadLandingMotion().then((motion) => {
        if (disposed) return
        cleanup = armLandingRuntime(motion, tier, {
          wrapper: wrapperRef.current,
          content: contentRef.current,
          hero: heroRef.current,
          globeHandleRef
        })
      })
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [wrapperRef, contentRef, heroRef, globeHandleRef])

  return null
}

function armLandingRuntime(
  motion: LandingMotion,
  tier: 'full' | 'lite',
  els: {
    wrapper: HTMLDivElement | null
    content: HTMLDivElement | null
    hero: HTMLDivElement | null
    globeHandleRef: RefObject<GlobeHandle | null>
  }
): () => void {
  const { ScrollTrigger, ScrollSmoother } = motion
  const html = document.documentElement
  const cleanups: (() => void)[] = []

  // ignoreMobileResize stops iOS URL-bar collapses from forcing full
  // refreshes; dropping 'resize' from autoRefreshEvents removes the
  // remaining per-event refresh storm. Real reflows (desktop resize,
  // rotation) are covered by the trailing width-change refresh below —
  // height-only changes are exactly the mobile chrome noise we're muting.
  ScrollTrigger.config({
    ignoreMobileResize: true,
    autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load'
  })

  let lastWidth = window.innerWidth
  let resizeTimer = 0
  const onResize = () => {
    if (window.innerWidth === lastWidth) return
    lastWidth = window.innerWidth
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => ScrollTrigger.refresh(), 250)
  }
  window.addEventListener('resize', onResize)
  cleanups.push(() => {
    window.removeEventListener('resize', onResize)
    window.clearTimeout(resizeTimer)
  })

  let smoother: ScrollSmootherInstance | null = null
  if (tier === 'full' && els.wrapper && els.content) {
    smoother = ScrollSmoother.create({
      wrapper: els.wrapper,
      content: els.content,
      smooth: 1.15,
      effects: true,
      // native scroll on touch: better perf, no iOS URL-bar fights
      smoothTouch: 0,
      ignoreMobileResize: true,
      // normalizeScroll swallows pointer events → breaks globe drag-to-spin
      normalizeScroll: false
    })
    const liveSmoother = smoother
    cleanups.push(() => liveSmoother.kill())

    // Arms the pure-CSS consumers: .lx-atmo layers, .lx-hero-stars, skew.
    html.classList.add('lx-motion-full')
    cleanups.push(() => html.classList.remove('lx-motion-full'))

    cleanups.push(startVelocityFeedback(motion, liveSmoother))
    cleanups.push(startAtmosphereScrub(motion))

    if (els.hero) {
      cleanups.push(
        createHeroPin(motion, {
          hero: els.hero,
          globeHandle: () => els.globeHandleRef.current
        })
      )
    }
  }

  publishLandingRuntime({ motion, tier, smoother })
  cleanups.push(retractLandingRuntime)

  return () => {
    // reverse order: consumers detach before the smoother/ticker die
    for (const dispose of cleanups.reverse()) dispose()
  }
}

/**
 * The one velocity write per frame everything else reads. --vel is the
 * lerp-smoothed |velocity| normalized to 0..1 over 0..3000 px/s (film
 * grain thickens with it, star streaks ride it); --skew keeps the sign,
 * capped at ±1.2 (consumed as skewY(calc(var(--skew) * 1deg)) on descent
 * section content — transform-only). Both live on <html> and default to 0
 * for every consumer via var() fallbacks.
 */
function startVelocityFeedback(
  motion: LandingMotion,
  smoother: ScrollSmootherInstance
): () => void {
  const { gsap } = motion
  const html = document.documentElement
  const VELOCITY_RANGE = 3000 // px/s that maps to the full 0..1 band
  const MAX_SKEW = 1.2 // degrees
  const FOLLOW = 0.12 // per-frame lerp factor
  let value = 0
  let settled = true
  const tick = () => {
    const target = Math.max(
      -1,
      Math.min(1, smoother.getVelocity() / VELOCITY_RANGE)
    )
    value += (target - value) * FOLLOW
    if (target === 0 && Math.abs(value) < 0.002) value = 0
    if (value === 0 && settled) return // idle — skip redundant style writes
    settled = value === 0
    html.style.setProperty('--vel', Math.abs(value).toFixed(3))
    html.style.setProperty('--skew', (value * MAX_SKEW).toFixed(2))
  }
  gsap.ticker.add(tick)
  return () => {
    gsap.ticker.remove(tick)
    html.style.removeProperty('--vel')
    html.style.removeProperty('--skew')
  }
}

/**
 * One page-spanning scrub writes --alt (0 at orbit, 1 at touchdown) on
 * <html>. Consumers are pure CSS in globals.css: the fixed .lx-atmo
 * gradient layers cross-fade by opacity (compositor-friendly — no giant
 * background repaints) and the star tiles thin out as atmosphere thickens.
 * html.light has zero --alt consumers, so the dossier theme ignores the
 * variable completely.
 */
function startAtmosphereScrub(motion: LandingMotion): () => void {
  const { ScrollTrigger } = motion
  const html = document.documentElement
  const trigger = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      html.style.setProperty('--alt', self.progress.toFixed(4))
    }
  })
  html.style.setProperty('--alt', trigger.progress.toFixed(4))
  return () => {
    trigger.kill()
    html.style.removeProperty('--alt')
  }
}
