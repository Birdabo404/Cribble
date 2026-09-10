'use client'

// Shop motion. One GSAP entry point for the storefront: plugin
// registration, the two shop curves, the duration / stagger tables, and
// the handful of tweens every shop surface reuses (entrance reveals,
// scroll reveals, rule draws, the stage's two-layer crossfade, the price
// glyph roll). Hover and press stay CSS (CSS_EASE mirrors the curves for
// styled-jsx); everything here is transform + opacity only.
//
// Every tween helper consults motionReduced() itself — GSAP writes inline
// styles that the CSS kill-switch rules can't touch — and degrades to an
// opacity-only 120ms cut, no y, no scale, no stagger. Selectors are the
// caller's business; helpers take targets, not roots.
//
// The module evaluates during SSR ('use client' modules still do), so
// window / document are only read inside functions and the registration
// side effect at the bottom is guarded. 'shopOut' / 'shopDrawer' are
// registered by name, so HMR re-evaluation is harmless.

import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Flip } from 'gsap/Flip'
import { Draggable } from 'gsap/Draggable'
import { InertiaPlugin } from 'gsap/InertiaPlugin'
import { CustomEase } from 'gsap/CustomEase'
import { prefersReducedMotion } from '@/lib/motion'

export { gsap, useGSAP, ScrollTrigger, Flip, Draggable, InertiaPlugin, CustomEase }

/* ================= curves ================= */

/** GSAP ease names registered by registerShopGsap(). `out` is the
 *  storefront's settle (reveals, stage in, glyph roll); `drawer` is the
 *  sheet / side-panel slide, a touch heavier at the start. */
export const EASE = { out: 'shopOut', drawer: 'shopDrawer', linear: 'none' } as const

/** The same two curves as CSS strings for styled-jsx transitions, so CSS
 *  hover / press and GSAP motion read as one system. */
export const CSS_EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)'
} as const

const SHOP_OUT_BEZIER = '0.23,1,0.32,1'
const SHOP_DRAWER_BEZIER = '0.32,0.72,0,1'

/* ================= tables (seconds) ================= */

export const DUR = {
  press: 0.12,
  hover: 0.16,
  cut: 0.12,
  stage: 0.32,
  drawer: 0.28,
  reveal: 0.48,
  veil: 0.2,
  indicator: 0.2
} as const

export const STAGGER = { lines: 0.03, cards: 0.04, glyphs: 0.025, header: 0.06 } as const

/** Reduced-motion fade: every helper collapses to this single opacity cut. */
const REDUCED_FADE = 0.12
/** Outgoing stage layer — shorter than the incoming one so the well never
 *  reads empty; the two overlap by CROSSFADE_OVERLAP. */
const CROSSFADE_OUT = 0.16
const CROSSFADE_OVERLAP = '-=0.06'
const GLYPH_ROLL = 0.34

/* ================= registration ================= */

let registered = false

/** Registers useGSAP + the shop plugins and creates the two curves. Runs
 *  once per page load (module side effect below, client only); explicit
 *  calls are no-ops afterwards, so helpers call it defensively and a
 *  component that imports a plugin from here can rely on it. */
export function registerShopGsap(): void {
  if (registered || typeof window === 'undefined') return
  registered = true
  gsap.registerPlugin(useGSAP, ScrollTrigger, Flip, Draggable, InertiaPlugin, CustomEase)
  if (!CustomEase.get(EASE.out)) CustomEase.create(EASE.out, SHOP_OUT_BEZIER)
  if (!CustomEase.get(EASE.drawer)) CustomEase.create(EASE.drawer, SHOP_DRAWER_BEZIER)
}

/* ================= guards ================= */

/** True when motion should be instant states: the OS query OR Cribble's
 *  in-app Appearance kill switch (html[data-motion='reduced']). False
 *  during SSR — nothing tweens there anyway. */
export function motionReduced(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  return prefersReducedMotion() || document.documentElement.dataset.motion === 'reduced'
}

/* ================= reveals ================= */

/** Entrance reveal: opacity + y 12→0 over DUR.reveal on the shop curve,
 *  transform cleared on completion so the stylesheet owns the element
 *  again. Reduced → opacity-only cut, no y, no stagger. */
export function revealIn(
  targets: gsap.TweenTarget,
  opts: { stagger?: number; y?: number; delay?: number } = {}
): gsap.core.Tween {
  registerShopGsap()
  const { stagger = 0, y = 12, delay = 0 } = opts
  if (motionReduced()) {
    return gsap.fromTo(
      targets,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: REDUCED_FADE, ease: EASE.out, delay }
    )
  }
  return gsap.fromTo(
    targets,
    { autoAlpha: 0, y },
    {
      autoAlpha: 1,
      y: 0,
      duration: DUR.reveal,
      ease: EASE.out,
      stagger,
      delay,
      clearProps: 'transform'
    }
  )
}

/** The same reveal, armed by a ScrollTrigger on `section` (top 85%, once).
 *  Returns the trigger so the caller can kill it; under reduced motion the
 *  targets simply fade in now and the tween is returned instead. */
export function scrollReveal(
  section: Element,
  targets: gsap.TweenTarget,
  opts: { stagger?: number; y?: number } = {}
): ScrollTrigger | gsap.core.Tween {
  registerShopGsap()
  const { stagger = 0, y = 12 } = opts
  if (motionReduced()) {
    return gsap.fromTo(
      targets,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: REDUCED_FADE, ease: EASE.out }
    )
  }
  const tween = gsap.fromTo(
    targets,
    { autoAlpha: 0, y },
    {
      autoAlpha: 1,
      y: 0,
      duration: DUR.reveal,
      ease: EASE.out,
      stagger,
      clearProps: 'transform',
      paused: true
    }
  )
  return ScrollTrigger.create({
    trigger: section,
    start: 'top 85%',
    once: true,
    animation: tween
  })
}

/** Hairline draw: scaleX 0→1 from the left edge. Reduced → fade. */
export function drawRule(el: gsap.TweenTarget): gsap.core.Tween {
  registerShopGsap()
  if (motionReduced()) {
    return gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: REDUCED_FADE, ease: EASE.out })
  }
  return gsap.fromTo(
    el,
    { scaleX: 0, transformOrigin: 'left center' },
    { scaleX: 1, duration: DUR.reveal, ease: EASE.out, clearProps: 'transform' }
  )
}

/* ================= stage swap ================= */

/** Two-layer art crossfade for the Featured Stage. The outgoing layer
 *  fades over CROSSFADE_OUT (onOutComplete fires when it is gone, so the
 *  caller can unmount it); the incoming one lands from a 1.015 scale on
 *  the shop curve, overlapping the tail of the fade. `outEl` is null on
 *  the first paint — then only the in-half runs and onOutComplete fires at
 *  time 0. Reduced → two opacity cuts, no scale. */
export function crossfadeSwap(
  outEl: Element | null,
  inEl: Element,
  opts: { onOutComplete?: () => void } = {}
): gsap.core.Timeline {
  registerShopGsap()
  const reduced = motionReduced()
  const tl = gsap.timeline()

  if (outEl) {
    tl.to(outEl, {
      autoAlpha: 0,
      duration: reduced ? REDUCED_FADE : CROSSFADE_OUT,
      ease: EASE.out,
      onComplete: opts.onOutComplete
    })
  } else if (opts.onOutComplete) {
    tl.call(opts.onOutComplete, [], 0)
  }

  if (reduced) {
    tl.fromTo(
      inEl,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: REDUCED_FADE, ease: EASE.out },
      outEl ? CROSSFADE_OVERLAP : 0
    )
    return tl
  }

  tl.fromTo(
    inEl,
    { autoAlpha: 0, scale: 1.015 },
    {
      autoAlpha: 1,
      scale: 1,
      duration: DUR.drawer,
      ease: EASE.out,
      clearProps: 'transform'
    },
    outEl ? CROSSFADE_OVERLAP : 0
  )
  return tl
}

/** Price glyph roll (the shpp-digit-roll idiom): each glyph rises half an
 *  em and fades in, STAGGER.glyphs apart. Reduced → fade only. */
export function rollGlyphs(targets: gsap.TweenTarget): gsap.core.Tween {
  registerShopGsap()
  if (motionReduced()) {
    return gsap.fromTo(
      targets,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: REDUCED_FADE, ease: EASE.out }
    )
  }
  return gsap.fromTo(
    targets,
    { y: '0.5em', autoAlpha: 0 },
    {
      y: 0,
      autoAlpha: 1,
      duration: GLYPH_ROLL,
      ease: EASE.out,
      stagger: STAGGER.glyphs,
      clearProps: 'transform'
    }
  )
}

/* ================= sheet gesture ================= */

/** Mobile sheet release rule (downward positive): a flick faster than
 *  0.11 px/ms dismisses regardless of distance, otherwise the sheet must
 *  have travelled past 40% of its own height. Anything else snaps back. */
export function shouldDismissSheet(
  travelPx: number,
  heightPx: number,
  velocityPxPerMs: number
): boolean {
  return velocityPxPerMs > 0.11 || travelPx > heightPx * 0.4
}

/* ================= side effect ================= */

if (typeof window !== 'undefined') registerShopGsap()
