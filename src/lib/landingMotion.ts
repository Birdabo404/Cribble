// Landing-page motion runtime — the single entry point for every animation
// library "/" uses. The division of labor, so it doesn't rot: scroll-coupled
// motion is GSAP (ScrollTrigger / ScrollSmoother scrubs), time-coupled motion
// is anime.js (one engine tick driving timers and springs). Nothing here
// lands on the critical path: consumers call loadLandingMotion() from idle
// (see whenIdle), and if the chunk never arrives the page is still complete.

import type { ScrollSmoother } from 'gsap/ScrollSmoother'
import { prefersReducedMotion } from '@/lib/motion'

/** Site-signature ease as raw cubic-bezier parameters — the same
 *  0.22, 1, 0.36, 1 curve that welcomeMotion.ts registers as a GSAP
 *  CustomEase and scrollFx.tsx bakes into its CSS. Kept as a plain string
 *  (not re-exported from welcomeMotion) because importing that module
 *  registers GSAP eagerly, which would drag it into the critical chunk.
 *  Use as `cubic-bezier(${CRIBBLE_EASE})` in CSS or feed it to
 *  CustomEase / anime's cubicBezier for JS motion. */
export const CRIBBLE_EASE = '0.22, 1, 0.36, 1'

/** GSAP ease name for the same curve, registered by loadLandingMotion().
 *  Deliberately not 'cribble' (welcomeMotion's name for the identical
 *  curve): the two chunks register independently and must not rely on
 *  each other having run. */
export const CRIBBLE_EASE_NAME = 'cribble-landing'

/** Capability tier chosen at hydration.
 *  · 'still' — reduced motion (OS media query or Cribble's in-app
 *    html[data-motion='reduced'] kill switch). Nothing arms; the page keeps
 *    its CSS final state.
 *  · 'full'  — desktop-grade: fine pointer, ≥1024px viewport, ≥4 cores.
 *    Gets the smoother, the hero pin, the spine.
 *  · 'lite'  — everything else (touch or low-core). Entrance reveals only.
 *  Switches over this union must keep a `never` default case. */
export type LandingTier = 'full' | 'lite' | 'still'

export function landingTier(): LandingTier {
  if (typeof window === 'undefined') return 'still'
  if (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  ) {
    return 'still'
  }
  const finePointer = window.matchMedia('(pointer: fine)').matches
  const wideViewport = window.matchMedia('(min-width: 1024px)').matches
  // Undefined hardwareConcurrency (older Safari) is treated as capable —
  // the pointer/viewport gates already exclude most weak hardware.
  const cores = navigator.hardwareConcurrency
  const capableCpu = cores === undefined || cores >= 4
  return finePointer && wideViewport && capableCpu ? 'full' : 'lite'
}

/** Run `cb` when the main thread goes idle. The 800ms timeout ceiling
 *  matters: under first-load pressure (globe boot, hydration) the browser
 *  may not go idle for seconds, and the motion chunk arriving that late
 *  means entrances fire visibly after content settled. Safari has no
 *  requestIdleCallback, so it falls back to a 200ms timeout; SSR no-ops. */
export function whenIdle(cb: () => void): void {
  if (typeof window === 'undefined') return
  // typeof check (not `in`): lib.dom types Window with requestIdleCallback
  // unconditionally, so an `in` guard narrows the else branch to `never`.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => cb(), { timeout: 800 })
  } else {
    window.setTimeout(cb, 200)
  }
}

// The dynamic import()s below are the documented exception to the
// imports-at-top rule: deferring them is this module's entire job — they
// keep gsap and anime.js out of the critical chunk.
async function importLandingMotion() {
  const [
    gsapModule,
    scrollTriggerModule,
    scrollSmootherModule,
    splitTextModule,
    drawSvgModule,
    customEaseModule,
    flipModule,
    scrambleTextModule,
    animeModule
  ] = await Promise.all([
    import('gsap'),
    import('gsap/ScrollTrigger'),
    import('gsap/ScrollSmoother'),
    import('gsap/SplitText'),
    import('gsap/DrawSVGPlugin'),
    import('gsap/CustomEase'),
    import('gsap/Flip'),
    import('gsap/ScrambleTextPlugin'),
    import('animejs')
  ])

  const { gsap } = gsapModule
  const { ScrollTrigger } = scrollTriggerModule
  const { ScrollSmoother } = scrollSmootherModule
  const { SplitText } = splitTextModule
  const { DrawSVGPlugin } = drawSvgModule
  const { CustomEase } = customEaseModule
  const { Flip } = flipModule
  const { ScrambleTextPlugin } = scrambleTextModule
  // spring() is v4.5's name for the deprecated createSpring()
  const { createTimer, animate, stagger, spring, createScope, engine } =
    animeModule

  // The memoized module-level promise below guarantees this runs once.
  gsap.registerPlugin(
    ScrollTrigger,
    ScrollSmoother,
    SplitText,
    DrawSVGPlugin,
    CustomEase,
    Flip,
    ScrambleTextPlugin
  )
  CustomEase.create(CRIBBLE_EASE_NAME, CRIBBLE_EASE)

  return {
    gsap,
    ScrollTrigger,
    ScrollSmoother,
    SplitText,
    DrawSVGPlugin,
    Flip,
    ScrambleTextPlugin,
    createTimer,
    animate,
    stagger,
    spring,
    createScope,
    engine
  }
}

/** Everything loadLandingMotion() resolves with: gsap + its registered
 *  scroll/text/SVG/Flip plugins, and the anime.js functions the landing
 *  uses. */
export type LandingMotion = Awaited<ReturnType<typeof importLandingMotion>>

let landingMotionPromise: Promise<LandingMotion> | null = null

/** Memoized lazy loader — every caller shares one import + one plugin
 *  registration, no matter how many components ask. */
export function loadLandingMotion(): Promise<LandingMotion> {
  landingMotionPromise ??= importLandingMotion()
  return landingMotionPromise
}

/* ------------------------------------------------------------------ */
/* Landing runtime — published once by the page orchestrator            */
/* ------------------------------------------------------------------ */

/** The armed motion runtime, published by the landing page's orchestrator
 *  (LandingScrollRuntime in scrollFx.tsx) AFTER global setup — ScrollTrigger
 *  config and, on the full tier, the ScrollSmoother — so every subscriber
 *  can safely create triggers the moment it hears about it. Never published
 *  on the 'still' tier. */
export type LandingRuntime = {
  motion: LandingMotion
  tier: Exclude<LandingTier, 'still'>
  /** Full tier only; null on 'lite' (native scroll). */
  smoother: ScrollSmoother | null
}

let landingRuntime: LandingRuntime | null = null
const runtimeSubscribers = new Set<(runtime: LandingRuntime) => void>()

/** Subscribe to the runtime. Fires immediately if it is already live, and
 *  once when the orchestrator publishes it. Returns an unsubscribe. */
export function onLandingRuntime(
  cb: (runtime: LandingRuntime) => void
): () => void {
  runtimeSubscribers.add(cb)
  if (landingRuntime) cb(landingRuntime)
  return () => {
    runtimeSubscribers.delete(cb)
  }
}

/** Orchestrator-only: announce the armed runtime to every subscriber. */
export function publishLandingRuntime(runtime: LandingRuntime): void {
  landingRuntime = runtime
  runtimeSubscribers.forEach((cb) => cb(runtime))
}

/** Orchestrator-only: clear the runtime on teardown (page unmount), so a
 *  remount republishes fresh instances instead of handing out dead ones. */
export function retractLandingRuntime(): void {
  landingRuntime = null
}

/** The live ScrollSmoother, or null when smoothing isn't active (lite/still
 *  tier, chunk not loaded yet, or page unmounted). Anchor navigation must
 *  route through this when it exists — native scrollTo fights the
 *  transform-based smoothing. */
export function landingSmoother(): ScrollSmoother | null {
  return landingRuntime?.smoother ?? null
}
