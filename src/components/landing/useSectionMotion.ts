'use client'

// Section-scoped anime.js runtime for the landing descent. One hook call
// per consumer replaces the section's setInterval/setTimeout bookkeeping
// with anime `createTimer`s riding the single engine tick, and adds the
// two lifecycles raw timers never had:
//
//  · Off-stage pause. The Stage IntersectionObserver in scrollFx fires once
//    and disconnects, so this hook runs its own observer on the section
//    root ([data-sec]) with a generous rootMargin — timers freeze when the
//    section scrolls well out of view and resume just before re-entry.
//    (document.hidden is already covered: anime v4 ships with
//    engine.pauseOnDocumentHidden = true, so the whole engine sleeps in
//    background tabs — no per-timer visibility handling here.)
//  · Live reduced-motion. Everything builds inside an anime Scope keyed to
//    the prefers-reduced-motion media query, plus a MutationObserver on
//    <html data-motion> for Cribble's in-app kill switch. Flipping either
//    mid-session reverts the build (running the section's cleanup so React
//    state lands on its resolved SSR shape) and rebuilds when allowed again.
//
// Tier 'still' (reduced at arm time) never loads or builds anything — the
// page keeps its CSS final state, exactly like the no-JS path.

import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Scope, Timer, TimerParams } from 'animejs'
import {
  landingTier,
  loadLandingMotion,
  type LandingMotion
} from '@/lib/landingMotion'
import { useStageLive } from './scrollFx'

const REDUCED_MQ = '(prefers-reduced-motion: reduce)'

/** Resume timers a beat before the section scrolls back in, so feeds and
 *  score ticks are already moving when the visitor arrives. */
const OFFSTAGE_ROOT_MARGIN = '30% 0px 30% 0px'

export type SectionMotionHandle = {
  /** The full lazy bundle (animate, stagger, spring, gsap, …). */
  motion: LandingMotion
  /** createTimer that enrolls the timer in this section's off-stage
   *  pause/resume set and cancels it on revert. Safe to call later from
   *  timer callbacks (chained beats register the same way). */
  timer: (params: TimerParams) => Timer
}

type SectionMotionBuild = (
  handle: SectionMotionHandle
) => void | (() => void)

/**
 * Runs `build` once the surrounding Stage goes live (and motion is
 * allowed), inside an anime Scope that reverts/rebuilds on reduced-motion
 * flips. `deps` re-run the build like effect deps. Returns a ref to the
 * live handle — null until built and while motion is reverted — for event
 * handlers that want to spring things ad hoc.
 */
export function useSectionMotion(
  sec: string,
  build: SectionMotionBuild,
  deps: readonly unknown[] = []
): MutableRefObject<SectionMotionHandle | null> {
  const live = useStageLive()
  const handleRef = useRef<SectionMotionHandle | null>(null)
  // Latest-render closure, so a Scope rebuild (reduced flipped back off)
  // sees current React state without re-arming the effect every render.
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    if (!live || landingTier() === 'still') return

    let disposed = false
    let scope: Scope | null = null
    let io: IntersectionObserver | null = null
    let mo: MutationObserver | null = null

    // Shared across Scope rebuilds within this effect run.
    const tracked = new Set<Timer>()
    const pausedOffstage = new Set<Timer>()
    let onstage = true

    // The catch keeps a failed chunk load silent: the page's CSS final
    // state is already complete without any of this.
    loadLandingMotion().then((motion) => {
      if (disposed) return

      const timer: SectionMotionHandle['timer'] = (params) => {
        const t = motion.createTimer(params)
        tracked.add(t)
        if (!onstage) {
          pausedOffstage.add(t)
          t.pause()
        }
        return t
      }

      scope = motion.createScope({ mediaQueries: { reduced: REDUCED_MQ } })
      scope.add((self) => {
        const reduced =
          Boolean(self?.matches.reduced) ||
          document.documentElement.dataset.motion === 'reduced'
        if (reduced) return
        const handle: SectionMotionHandle = { motion, timer }
        handleRef.current = handle
        const cleanup = buildRef.current(handle)
        return () => {
          handleRef.current = null
          tracked.forEach((t) => t.cancel())
          tracked.clear()
          pausedOffstage.clear()
          cleanup?.()
        }
      })

      // The Scope's media query already refreshes on OS-level flips; the
      // in-app kill switch is a DOM attribute, so it needs its own watcher.
      mo = new MutationObserver(() => scope?.refresh())
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-motion']
      })

      const sectionEl = document.querySelector(`[data-sec="${sec}"]`)
      if (sectionEl) {
        io = new IntersectionObserver(
          (entries) => {
            const visible = entries.some((e) => e.isIntersecting)
            if (visible === onstage) return
            onstage = visible
            if (!visible) {
              tracked.forEach((t) => {
                if (!t.paused) {
                  pausedOffstage.add(t)
                  t.pause()
                }
              })
            } else {
              pausedOffstage.forEach((t) => {
                if (!t.cancelled && !t.completed) t.resume()
              })
              pausedOffstage.clear()
            }
          },
          { threshold: 0, rootMargin: OFFSTAGE_ROOT_MARGIN }
        )
        io.observe(sectionEl)
      }
    }, () => {})

    return () => {
      disposed = true
      io?.disconnect()
      mo?.disconnect()
      // Runs the constructor cleanup above — timers cancel, state resolves.
      scope?.revert()
      handleRef.current = null
    }
    // The caller-supplied deps array is the contract, like useEffect's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, sec, ...deps])

  return handleRef
}
