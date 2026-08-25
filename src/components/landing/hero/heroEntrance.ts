// Hero entrance — the GSAP half of the one-engine-per-property rule that
// replaced the old `.hero-item` CSS keyframes. The cascade was previously a
// CSS animation racing heroPin's GSAP exit tweens for `opacity` on the same
// nodes (the invisible-badge bug); now GSAP owns opacity/transform on the
// entrance targets exclusively, and CSS's only job is a static pre-paint
// hide (`.lx-hero[data-hero-arm] [data-hero-enter] { opacity: 0 }`) that is
// relinquished in the same synchronous block the timeline is born in.
//
// Lifecycle:
//  1. useHeroEntrance arms the hero before first client paint (skipped on
//     the 'still' tier and when already scrolled past the hero).
//  2. A ~1.5s watchdog disarms if the runtime never shows up (chunk load
//     failure, slow network) — content can never be stranded invisible.
//  3. When onLandingRuntime fires, one fromTo timeline takes over: its
//     immediate render writes inline autoAlpha 0 on every target BEFORE the
//     arming attribute is removed, so ownership passes without a flash.
//  4. heroPin.build() waits for the entrance to settle (shared handle
//     below) and force-completes it if it is somehow still playing, so the
//     pin's exit tweens are always built against settled values.

import { useLayoutEffect, type RefObject } from 'react'
import {
  CRIBBLE_EASE_NAME,
  landingTier,
  onLandingRuntime,
  type LandingMotion
} from '@/lib/landingMotion'

type TimelineInstance = ReturnType<LandingMotion['gsap']['timeline']>

const ARM_ATTR = 'data-hero-arm'
const TARGET_SELECTOR = '[data-hero-enter]'
const WATCHDOG_MS = 1500

let entranceTimeline: TimelineInstance | null = null
let settleWaiters: Array<() => void> = []

function flushWaiters(): void {
  const waiters = settleWaiters
  settleWaiters = []
  waiters.forEach((cb) => cb())
}

/** Force-complete and kill the entrance if it is still playing. heroPin's
 *  build() calls this first, so exit tweens can never be created over a
 *  live entrance animating the same nodes. No-op once settled. */
export function settleHeroEntrance(): void {
  const timeline = entranceTimeline
  if (!timeline) return
  // progress(1) fires onComplete, which nulls the handle and flushes.
  timeline.progress(1)
  timeline.kill()
}

/** Run `cb` once no entrance is in flight — immediately when none exists
 *  (never armed, watchdog disarmed, or already finished), otherwise at the
 *  timeline's completion. Callers created after the runtime publish (the
 *  only callers there are) can rely on the timeline already existing if it
 *  is ever going to. */
export function whenHeroEntranceSettled(cb: () => void): void {
  if (!entranceTimeline) {
    cb()
    return
  }
  settleWaiters.push(cb)
}

export function useHeroEntrance(heroRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const hero = heroRef.current
    if (!hero) return
    if (landingTier() === 'still') return
    if (window.scrollY > hero.offsetHeight * 0.5) return

    const targets = Array.from(
      hero.querySelectorAll<HTMLElement>(TARGET_SELECTOR)
    )
    if (targets.length === 0) return

    hero.setAttribute(ARM_ATTR, '')
    let armed = true
    const disarm = () => {
      armed = false
      hero.removeAttribute(ARM_ATTR)
    }
    const watchdog = window.setTimeout(disarm, WATCHDOG_MS)

    const off = onLandingRuntime(({ motion }) => {
      // Watchdog already released the content — the entrance moment has
      // passed; playing it now would blink visible copy back out.
      if (!armed) return
      window.clearTimeout(watchdog)
      if (window.scrollY > hero.offsetHeight * 0.5) {
        disarm()
        return
      }
      const { gsap } = motion
      const timeline = gsap.timeline({
        onComplete: () => {
          entranceTimeline = null
          flushWaiters()
        }
      })
      // fromTo's immediate render stamps inline autoAlpha 0 on every target
      // synchronously, so the disarm below hands ownership to GSAP without
      // a single contested frame.
      timeline.fromTo(
        targets,
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.72,
          stagger: 0.08,
          ease: CRIBBLE_EASE_NAME
        }
      )
      entranceTimeline = timeline
      disarm()
    })

    return () => {
      off()
      window.clearTimeout(watchdog)
      disarm()
      entranceTimeline?.kill()
      entranceTimeline = null
      flushWaiters()
    }
  }, [heroRef])
}
