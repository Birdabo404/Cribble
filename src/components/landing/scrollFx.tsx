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
//  · Entrance choreography is progressive enhancement with ONE engine:
//    SSR/no-JS renders the final state; a pre-paint layout effect "arms" a
//    stage (a static CSS rule hides its `.st` children — no CSS animation
//    exists anymore), and a GSAP ScrollTrigger reveal animates everything
//    in with transform + opacity only. The 'still' tier never arms; a
//    watchdog un-hides a stage if the chunk never arrives. SectionHeader
//    headings upgrade to SplitText masked line reveals (see useMaskedLines)
//    and are excluded from the stage reveal via data-split — never both.
//  · Components that animate values (CountUp, DecodeText, live tickers)
//    read the surrounding Stage via context and start when it goes live.
//    They ride gsap's single ticker via the runtime — no private rAF or
//    setInterval loops — and simply render their final value without it.
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

/**
 * The staged GSAP entrance, transform + opacity only (no blur, no
 * clip-path — those repainted every frame on Firefox). Per-element `--d`
 * (ms, set inline by every section) drives the stagger, so each section's
 * choreography vocabulary — the Honors radial wave, the cockpit heatmap
 * ripple — survives unchanged. clearProps hands the elements back to CSS
 * at the end: hover transitions (.id-rack, .rm-item) transition inline-
 * free transforms, and a leftover translate would pin them.
 */
function runStageEntrance(motion: LandingMotion, root: HTMLElement) {
  const { gsap } = motion
  const delayOf = (_i: number, target: unknown) =>
    (parseFloat((target as HTMLElement).style.getPropertyValue('--d')) || 0) /
    1000

  const rises = root.querySelectorAll<HTMLElement>('.st:not([data-split])')
  if (rises.length) {
    gsap.fromTo(
      rises,
      { opacity: 0, y: 16 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: CRIBBLE_EASE_NAME,
        stagger: delayOf,
        clearProps: 'opacity,transform'
      }
    )
  }
  const cells = root.querySelectorAll<HTMLElement>('.st-cell')
  if (cells.length) {
    gsap.fromTo(
      cells,
      { opacity: 0, scale: 0.3 },
      {
        opacity: 1,
        scale: 1,
        duration: 0.52,
        ease: 'back.out(1.7)',
        stagger: delayOf,
        clearProps: 'opacity,transform'
      }
    )
  }
  const grows = root.querySelectorAll<HTMLElement>('.st-grow')
  if (grows.length) {
    gsap.fromTo(
      grows,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: 0.9,
        ease: CRIBBLE_EASE_NAME,
        stagger: delayOf,
        clearProps: 'transform'
      }
    )
  }
  // The old clip-path sweep becomes a scaleX wipe from the left edge —
  // same left-to-right read, compositor-only.
  const sweeps = root.querySelectorAll<HTMLElement>('.st-sweep')
  if (sweeps.length) {
    gsap.fromTo(
      sweeps,
      { opacity: 0, scaleX: 0 },
      {
        opacity: 1,
        scaleX: 1,
        duration: 1.1,
        ease: 'power2.inOut',
        stagger: delayOf,
        clearProps: 'opacity,transform'
      }
    )
  }
}

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

  // Arm before first client paint so the entrance can't flash. The 'still'
  // tier (OS reduced motion or the in-app kill switch) never arms: the
  // runtime never publishes there, so arming would strand content hidden —
  // the page keeps its CSS final state instead, same as no-JS.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || landingTier() === 'still') return
    setPhase('armed')

    let scrubTrigger: ScrollTriggerInstance | null = null
    let revealTrigger: ScrollTriggerInstance | null = null
    let revealed = false

    if (scrub) {
      // Seed --p synchronously — the first painted frame must already sit
      // at the correct scroll pose, not jump into it. If the motion chunk
      // never arrives (network), this static value is the final say and
      // the page stays correct.
      seedScrubProgress(el)
    }

    const reveal = (motion: LandingMotion) => {
      if (revealed) return
      revealed = true
      setPhase('live')
      // One microtask of deferral orders the reveal after sibling runtime
      // subscribers: useMaskedLines claims its headings (data-split) in the
      // same publish pass, and the collection in runStageEntrance must not
      // see them. Still pre-paint — the fromTo inline styles land before
      // React lifts the stage-armed class, so nothing can flash.
      queueMicrotask(() => {
        if (ref.current) runStageEntrance(motion, ref.current)
      })
    }

    // Watchdog: a chunk-load failure must never strand content hidden. If
    // the runtime hasn't produced the reveal trigger ~4s after arming,
    // flip live with no animation — the armed hide lifts and the stage
    // shows its CSS final state. Once the trigger exists the watchdog
    // stands down: the trigger is guaranteed to fire when the stage
    // scrolls in (or immediately, if it already has).
    const watchdog = window.setTimeout(() => {
      if (!revealTrigger && !revealed) {
        revealed = true
        setPhase('live')
      }
    }, 4000)

    const offRuntime = onLandingRuntime(({ motion }) => {
      if (scrub && !scrubTrigger) {
        scrubTrigger = motion.ScrollTrigger.create({
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
        el.style.setProperty('--p', scrubTrigger.progress.toFixed(4))
      }
      if (!revealTrigger && !revealed) {
        window.clearTimeout(watchdog)
        // start 'top 78%': same geometry as the IntersectionObserver this
        // replaces (threshold 0, -22% bottom rootMargin) — fires once the
        // stage's top clears the lower fifth of the viewport.
        revealTrigger = motion.ScrollTrigger.create({
          trigger: el,
          start: 'top 78%',
          once: true,
          onEnter: () => reveal(motion)
        })
      }
    })

    return () => {
      window.clearTimeout(watchdog)
      offRuntime()
      scrubTrigger?.kill()
      revealTrigger?.kill()
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
        /* Armed: children hidden by a static opacity — CSS never animates
           entrances anymore, GSAP is the one engine. The reveal's fromTo
           writes inline opacity/transform in the same tick it fires, and
           inline beats this class rule, so ownership hands over without a
           contested frame; this rule only covers arm → reveal. */
        .stage-armed .st:not([data-split]),
        .stage-armed .st-cell,
        .stage-armed .st-grow,
        .stage-armed .st-sweep {
          opacity: 0;
        }
        /* data-split: SplitText owns that element's entrance (masked line
           reveal, see useMaskedLines) and runStageEntrance skips it. It
           stays visible while armed — its lines hide behind their masks. */
        /* Kerning shifts between the pre-split text and the line-sliced
           spans read as a subtle "wobble" on reveal — pin it off for any
           element SplitText manages (GSAP guidance). */
        [data-split] {
          font-kerning: none;
        }
        /* Static origins for the GSAP scaleX entrances; inline overrides
           (e.g. DescentGate's vertical rule) still win. */
        .st-grow,
        .st-sweep {
          transform-origin: left center;
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DecodeText — terminal scramble that resolves left to right          */
/* ------------------------------------------------------------------ */

// Same glyph set as lib/useDecode (the billboard keeps that hook; the
// landing runs the identical look through ScrambleTextPlugin so the
// scramble rides gsap's ticker instead of a private setInterval).
const DECODE_GLYPHS = '█▓▒░<>/[]{}=+*#'

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
  const ref = useRef<HTMLSpanElement | null>(null)
  const [decoding, setDecoding] = useState(false)

  useEffect(() => {
    if (!live || prefersReducedMotion()) return
    const el = ref.current
    if (!el) return
    let tween: TweenInstance | null = null
    const off = onLandingRuntime(({ motion }) => {
      if (tween) return
      // ~66ms per character mirrors useDecode's cadence (2.2 frames of
      // 30ms per char) — a lock-in, not a slot machine.
      tween = motion.gsap.to(el, {
        duration: Math.max(0.3, text.length * 0.066),
        delay: delay / 1000,
        ease: 'none',
        scrambleText: { text, chars: DECODE_GLYPHS, speed: 0.4 },
        onStart: () => setDecoding(true),
        onComplete: () => setDecoding(false)
      })
    })
    return () => {
      off()
      tween?.kill()
      setDecoding(false)
      el.textContent = text
    }
  }, [live, text, delay])

  // SSR, reduced motion and a missing runtime all render the resolved
  // text — the scramble is strictly additive.
  return (
    <span
      ref={ref}
      className={className}
      data-decoding={decoding ? '' : undefined}
      style={decoding ? { color: 'rgb(var(--accent-rgb) / 0.9)' } : undefined}
    >
      {text}
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
  const [v, setV] = useState(to) // SSR/no-JS/no-runtime shows the final value
  const spanRef = useRef<HTMLSpanElement>(null)
  // Ref'd so an inline `format` prop can't retrigger (and restart) the
  // count-up on unrelated parent re-renders.
  const formatRef = useRef(format)
  formatRef.current = format

  // A gsap tween on a proxy object — driven by gsap's single ticker, no
  // private rAF loop. The reset to 0 happens only once the runtime is in
  // hand, so a failed chunk can never park the value at zero. Mid-flight
  // frames write textContent directly: a React commit per odometer tick
  // is main-thread work the descent scroll can feel, and the DOM string
  // is the only thing that changes. State syncs at the endpoints so any
  // parent-driven re-render paints the right value.
  useEffect(() => {
    if (!live || prefersReducedMotion()) return
    let tween: TweenInstance | null = null
    const off = onLandingRuntime(({ motion }) => {
      if (tween) return
      const proxy = { v: 0 }
      let painted = ''
      setV(0)
      tween = motion.gsap.to(proxy, {
        v: to,
        duration: duration / 1000,
        delay: delay / 1000,
        ease: 'expo.out',
        onUpdate: () => {
          const span = spanRef.current
          if (!span) return
          const text = formatRef.current(Math.round(proxy.v))
          if (text === painted) return
          painted = text
          span.textContent = text
        },
        onComplete: () => setV(to)
      })
    })
    return () => {
      off()
      tween?.kill()
    }
  }, [live, to, duration, delay])

  return (
    <span ref={spanRef} className={className}>
      {format(v)}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* TickerCounter — landing-local stand-in for AnimatedCounter          */
/* ------------------------------------------------------------------ */

/**
 * Retargetable counter for values that keep changing (the arena score
 * duel). Same contract as components/AnimatedCounter — interrupted
 * animations restart from the currently painted value — but tweened on
 * gsap's shared ticker via the runtime instead of a rAF loop per counter
 * (the arena renders dozens at once). No runtime yet, or reduced motion:
 * snap to the value.
 */
export function TickerCounter({
  value,
  duration = 1000,
  formatter = (v: number) => v.toString(),
  className = ''
}: {
  value: number
  duration?: number
  formatter?: (v: number) => string
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const displayRef = useRef(value)
  const spanRef = useRef<HTMLSpanElement>(null)
  const motionRef = useRef<LandingMotion | null>(null)
  // Ref'd for the same reason as CountUp: arena rows pass inline
  // formatters, and their identity must not gate anything.
  const formatterRef = useRef(formatter)
  formatterRef.current = formatter

  useEffect(
    () =>
      onLandingRuntime(({ motion }) => {
        motionRef.current = motion
      }),
    []
  )

  // The arena renders dozens of these and retargets them every shuffle;
  // a React commit per odometer frame across ~20 counters was a periodic
  // main-thread storm. Mid-tween frames now write textContent straight to
  // the span (deduped on the formatted string); state only syncs at the
  // endpoints, so React's picture matches the DOM whenever a shuffle
  // re-renders the board.
  useEffect(() => {
    const from = displayRef.current
    if (from === value) return
    const motion = motionRef.current
    if (!motion || prefersReducedMotion()) {
      displayRef.current = value
      setDisplay(value)
      return
    }
    const proxy = { v: from }
    let painted = ''
    const tween = motion.gsap.to(proxy, {
      v: value,
      duration: duration / 1000,
      ease: 'power2.out',
      onUpdate: () => {
        displayRef.current = proxy.v
        const span = spanRef.current
        if (!span) return
        const text = formatterRef.current(proxy.v)
        if (text === painted) return
        painted = text
        span.textContent = text
      },
      onComplete: () => {
        displayRef.current = value
        setDisplay(value)
      }
    })
    return () => {
      tween.kill()
    }
  }, [value, duration])

  return (
    <span ref={spanRef} className={className}>
      {formatter(display)}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* useMaskedLines — SplitText masked line reveal, CSS-fallback safe    */
/* ------------------------------------------------------------------ */

/**
 * Upgrades an `.st` element's entrance to a SplitText masked line reveal
 * (lines rise from behind their clip edge, staggered). The stage reveal
 * is GSAP-owned now, so the old CSS-vs-SplitText race is gone; two guards
 * remain and both are still load-bearing:
 *
 *  · `data-split`, set in the same synchronous block that hides the lines
 *    behind masks, is what excludes the element from runStageEntrance's
 *    `.st` collection — SplitText and the stage y-rise must never both
 *    animate one element. (The Stage reveal defers its collection one
 *    microtask so this claim always lands first when the runtime
 *    publishes with the stage already in view.)
 *  · `playedRef` latches when the stage goes live. Reaching live without
 *    the chunk (the Stage watchdog after a failed load) means the heading
 *    is already showing statically — a late-arriving runtime must not
 *    split it and re-hide its lines.
 *
 * autoSplit + returning the tween from onSplit handles font-load/resize
 * re-splits (Instrument Serif loads with preload: false, so late reflows
 * are the norm, not the edge case). `delayMs` mirrors the `--d` stagger
 * of the surrounding stage reveal.
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
  // Delays mirror the --d stagger of the stage reveal.
  // Type + spacing ride the shared tokens (--fs-*, --rhythm-*) the hero
  // defines, with fallbacks pinning today's rendered sizes so load order
  // between the two chunks never matters.
  const titleRef = useMaskedLines<HTMLHeadingElement>(90)
  const serifRef = useMaskedLines<HTMLDivElement>(180)
  return (
    <div className={center ? 'flex flex-col items-center text-center' : ''}>
      <div
        className={`st flex items-baseline gap-4 text-[length:var(--fs-label,10px)] tracking-[0.32em] text-zinc-500 ${
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
        className="st mt-[var(--rhythm-2,1.5rem)] font-display text-[length:var(--fs-display,clamp(2.25rem,4.6vw,3.4rem))] font-semibold leading-[0.98] tracking-tight text-zinc-50"
        style={{ '--d': '90ms' } as CSSProperties}
      >
        {title}
      </h2>

      <div
        ref={serifRef}
        className="st mt-[var(--rhythm-1,0.75rem)] font-serif italic text-[length:var(--fs-serif,clamp(1.5rem,2.3vw,1.9rem))] leading-snug text-zinc-400"
        style={{ '--d': '180ms' } as CSSProperties}
      >
        {serif}
      </div>

      <span
        className={`st-grow mt-[var(--rhythm-2,1.5rem)] block h-px w-24 ${center ? 'mx-auto' : ''}`}
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
          className={`st mt-[var(--rhythm-2,1.5rem)] max-w-xl font-sans text-base leading-[1.75] sm:text-[length:var(--fs-body,15px)] sm:leading-[1.8] ${
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
 *    feedback (--vel) and the atmosphere scrub (--alt), then the runtime
 *    publish. The `lx-motion-full` class on <html> is what arms the CSS
 *    consumers (atmosphere layers, hero star layer), so a page without
 *    the chunk renders byte-identical to today.
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
      // No data-speed/data-lag consumers exist (the globe's data-lag="0"
      // was only ever an opt-out), so the effects pipeline is pure
      // per-frame overhead. Flip this back on when a real parallax node
      // lands.
      effects: false,
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
 * lerp-smoothed |velocity| normalized to 0..1 over 0..3000 px/s (the film
 * grain thickens with it). It is written on the grain sheet itself, NOT
 * <html>: a custom-property write on the root dirties style for the whole
 * document every frame while scrolling, while a write on the sole
 * consumer invalidates one fixed element. Consumers keep their var()
 * fallback of 0, so a missing grain node (or the write landing on the
 * html fallback) renders identically. The signed --skew companion is
 * retired with the section shear it fed (see globals.css) — nothing else
 * consumed it.
 */
function startVelocityFeedback(
  motion: LandingMotion,
  smoother: ScrollSmootherInstance
): () => void {
  const { gsap } = motion
  const grain =
    document.querySelector<HTMLElement>('.lx-grain') ?? document.documentElement
  const VELOCITY_RANGE = 3000 // px/s that maps to the full 0..1 band
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
    grain.style.setProperty('--vel', Math.abs(value).toFixed(3))
  }
  gsap.ticker.add(tick)
  return () => {
    gsap.ticker.remove(tick)
    grain.style.removeProperty('--vel')
  }
}

/**
 * One page-spanning scrub writes --alt (0 at orbit, 1 at touchdown).
 * Consumers are pure CSS in globals.css: the fixed .lx-atmo gradient
 * layers cross-fade by opacity (compositor-friendly — no giant background
 * repaints) and the star tiles thin out as atmosphere thickens. The write
 * lands on the .lx-atmo stack root, not <html> — every consumer is a
 * child, inheritance carries the value, and the per-scroll-frame style
 * invalidation stays scoped to five fixed layers instead of the whole
 * document. html.light has zero --alt consumers, so the dossier theme
 * ignores the variable completely.
 */
function startAtmosphereScrub(motion: LandingMotion): () => void {
  const { ScrollTrigger } = motion
  const atmo =
    document.querySelector<HTMLElement>('.lx-atmo') ?? document.documentElement
  const trigger = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      atmo.style.setProperty('--alt', self.progress.toFixed(4))
    }
  })
  atmo.style.setProperty('--alt', trigger.progress.toFixed(4))
  return () => {
    trigger.kill()
    atmo.style.removeProperty('--alt')
  }
}
