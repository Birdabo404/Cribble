// Hero entrance — the GSAP half of the one-engine-per-property rule that
// replaced the old `.hero-item` CSS keyframes. The cascade was previously a
// CSS animation racing heroPin's GSAP exit tweens for `opacity` on the same
// nodes (the invisible-badge bug); now GSAP owns opacity/transform on the
// entrance targets exclusively, and CSS's only job is a static pre-paint
// hide (`.lx-hero[data-hero-arm] [data-hero-enter] { opacity: 0 }`) that is
// relinquished in the same synchronous block the timeline is born in.
//
// Choreography (absolute seconds on one timeline, ease-out only — the site
// curve unless noted; ≈1.3s end to end). The manifest's frame is drawn
// first, then the board fills in top-left → bottom-right:
//  0.00  hairlines [data-hero-line] scaleX 0→1 / [data-hero-vline] scaleY
//        0→1 (0.5s); rail cells and the tower header cells autoAlpha 0→1
//        (0.4s, cells stagger 40ms)
//  0.15  numeral block shown (0.2s) while its digits count 0→P1 over 1.1s
//        (power3.out, integer snap, textContent writes on a tweened object
//        — never React state; the SSR string is restored verbatim at the end)
//  0.25  tower rows autoAlpha 0→1, y 8→0 (0.5s, stagger 50ms) — transform/
//        opacity only, clip-path reveals are retired in this repo (Firefox)
//  0.40  serif line as SplitText masked lines yPercent 100→0 (0.7s); the
//        rotator block (.worldwide-anchor) fades/lifts in whole — never
//        split a node GSAP/React re-renders
//  0.60  CTA block autoAlpha 0→1, y 10→0 (0.5s); brackets x ∓6→0 (0.4s)
//  0.70  the dashed `you` row (0.4s); globe compartment and footer strip
//        (0.5s, footer cells stagger 30ms)
// Any [data-hero-enter] block none of the above claims gets a generic
// autoAlpha/y reveal at 0.40, so nothing is ever stranded invisible.
//
// Lifecycle:
//  1. useHeroEntrance arms the hero before first client paint (skipped on
//     the 'still' tier and when already scrolled past the hero).
//  2. A ~1.5s watchdog disarms if the runtime never shows up (chunk load
//     failure, slow network) — content can never be stranded invisible.
//  3. When onLandingRuntime fires, one timeline takes over: every reveal is
//     a fromTo whose immediate render writes inline autoAlpha 0 (or scaleX
//     0 / a masked yPercent 100) on its target BEFORE the arming attribute
//     is removed, so ownership passes without a flash.
//  4. heroPin.build() waits for the entrance to settle (shared handle
//     below) and force-completes it if it is somehow still playing, so the
//     pin's exit tweens are always built against settled values. The
//     serif's entrance SplitText is reverted at completion, before the
//     settle waiters run — the pin splits the same node for its exit, and
//     nested splits break both.

import { useLayoutEffect, type RefObject } from 'react'
import {
  CRIBBLE_EASE_NAME,
  landingTier,
  onLandingRuntime,
  type LandingMotion
} from '@/lib/landingMotion'

type TimelineInstance = ReturnType<LandingMotion['gsap']['timeline']>
type SplitTextInstance = ReturnType<LandingMotion['SplitText']['create']>

const ARM_ATTR = 'data-hero-arm'
const TARGET_SELECTOR = '[data-hero-enter]'
const WATCHDOG_MS = 1500

const numberFormat = new Intl.NumberFormat('en-US')

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

/** What a [data-hero-enter] block is, read off its contents — the markup
 *  carries the selector contract, this maps it onto the choreography. */
type BlockRole =
  | 'rail'
  | 'numeral'
  | 'serif'
  | 'cta'
  | 'tower'
  | 'globe'
  | 'footer'
  | 'generic'

function roleOf(block: HTMLElement): BlockRole {
  if (block.matches('header')) return 'rail'
  if (block.matches('footer')) return 'footer'
  if (block.querySelector('[data-hero-numeral]')) return 'numeral'
  if (block.querySelector('.lx-hero-tagline')) return 'serif'
  if (block.querySelector('.lx-cta')) return 'cta'
  if (block.querySelector('[data-hero-row]')) return 'tower'
  if (block.querySelector('.globe-instrument')) return 'globe'
  return 'generic'
}

function buildEntrance(
  motion: LandingMotion,
  hero: HTMLElement,
  blocks: HTMLElement[]
): TimelineInstance {
  const { gsap, SplitText } = motion
  const ease = CRIBBLE_EASE_NAME
  let serifSplit: SplitTextInstance | null = null

  const timeline = gsap.timeline({
    // lazy: false — GSAP otherwise defers a tween's first render to the end
    // of the next tick, which would leave the arm→GSAP handoff below
    // depending on the ticker's rAF beating paint. With it off every fromTo
    // stamps its start values inline the moment it is created.
    defaults: { lazy: false },
    onComplete: () => {
      // Revert the serif split BEFORE the waiters run: heroPin builds its
      // exit split on the same node from inside a waiter.
      serifSplit?.revert()
      serifSplit = null
      entranceTimeline = null
      flushWaiters()
    }
  })

  // Hairlines belong to no single block (rail bottom, tower header, the
  // column divider). Each span carries its own transform-origin inline —
  // left edge for horizontals, top edge for verticals — and heroPin's
  // exits collapse them along the same axes.
  const lines = Array.from(
    hero.querySelectorAll<HTMLElement>('[data-hero-line]')
  )
  if (lines.length) {
    timeline.fromTo(lines, { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease }, 0)
  }
  const vlines = Array.from(
    hero.querySelectorAll<HTMLElement>('[data-hero-vline]')
  )
  if (vlines.length) {
    timeline.fromTo(vlines, { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease }, 0)
  }

  const fadeIn = (
    targets: Element | Element[],
    at: number,
    duration: number,
    stagger = 0
  ) => {
    timeline.fromTo(
      targets,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration, stagger, ease },
      at
    )
  }
  const liftIn = (
    targets: Element | Element[],
    y: number,
    at: number,
    duration: number,
    stagger = 0
  ) => {
    timeline.fromTo(
      targets,
      { autoAlpha: 0, y },
      { autoAlpha: 1, y: 0, duration, stagger, ease },
      at
    )
  }

  for (const block of blocks) {
    const role = roleOf(block)
    switch (role) {
      case 'rail': {
        const cells = Array.from(
          block.querySelectorAll<HTMLElement>('[data-hero-cell]')
        )
        // The block itself holds nothing visible besides its cells and its
        // hairline, so those carry the reveal.
        if (cells.length) fadeIn(cells, 0, 0.4, 0.04)
        else fadeIn(block, 0, 0.4)
        break
      }
      case 'numeral': {
        fadeIn(block, 0.15, 0.2)
        const el = block.querySelector<HTMLElement>('[data-hero-numeral]')
        if (!el) break
        const target = Number(el.getAttribute('value'))
        // The SSR string is the contract: the count-up ends on it verbatim
        // (the pin's SplitText slices this text once settled).
        const finalText = el.textContent ?? ''
        if (!Number.isFinite(target)) break
        const counter = { v: 0 }
        timeline.fromTo(
          counter,
          { v: 0 },
          {
            v: target,
            duration: 1.1,
            ease: 'power3.out',
            snap: 'v',
            onUpdate: () => {
              el.textContent = numberFormat.format(counter.v)
            },
            onComplete: () => {
              el.textContent = finalText
            }
          },
          0.15
        )
        break
      }
      case 'tower': {
        // Header cells, not the row group: the pin's cell exit targets the
        // same nodes, and one engine must own each node's opacity.
        const headCells = Array.from(
          block.querySelectorAll<HTMLElement>('thead [data-hero-cell]')
        )
        if (headCells.length) fadeIn(headCells, 0, 0.4, 0.04)
        const rows = Array.from(
          block.querySelectorAll<HTMLElement>('[data-hero-row]')
        )
        const you = rows.filter((row) => row.dataset.heroRow === 'you')
        const ranked = rows.filter((row) => row.dataset.heroRow !== 'you')
        if (ranked.length) liftIn(ranked, 8, 0.25, 0.5, 0.05)
        if (you.length) fadeIn(you, 0.7, 0.4)
        // Rows and header carry the reveal; the table shell (caption is
        // sr-only) has nothing left to hide once disarmed.
        if (!headCells.length && !rows.length) liftIn(block, 16, 0.25, 0.6)
        break
      }
      case 'serif': {
        const tagline = block.querySelector<HTMLElement>('.lx-hero-tagline')
        if (tagline) {
          // Same guard heroPin applies before its split: kerning differences
          // between raw text and line spans read as a wobble at split time.
          tagline.style.fontKerning = 'none'
          serifSplit = SplitText.create(tagline, {
            type: 'lines',
            mask: 'lines',
            aria: 'auto'
          })
          if (serifSplit.lines.length) {
            timeline.fromTo(
              serifSplit.lines,
              { yPercent: 100 },
              { yPercent: 0, duration: 0.7, ease },
              0.4
            )
          }
        }
        const anchor = block.querySelector<HTMLElement>('.worldwide-anchor')
        if (anchor) liftIn(anchor, 12, 0.45, 0.6)
        if (!tagline && !anchor) liftIn(block, 16, 0.4, 0.6)
        break
      }
      case 'cta': {
        liftIn(block, 10, 0.6, 0.5)
        const brackets = Array.from(
          block.querySelectorAll<HTMLElement>('.lx-cta-bracket')
        )
        // Opening bracket slides in from the left, closing from the right.
        brackets.forEach((bracket, i) => {
          timeline.fromTo(
            bracket,
            { x: i === 0 ? -6 : 6 },
            { x: 0, duration: 0.4, ease },
            0.6
          )
        })
        break
      }
      case 'globe': {
        fadeIn(block, 0.7, 0.5)
        break
      }
      case 'footer': {
        // The strip's own top rule fades with the block; its cells stagger
        // inside that.
        fadeIn(block, 0.7, 0.5)
        const cells = Array.from(
          block.querySelectorAll<HTMLElement>('[data-hero-cell]')
        )
        if (cells.length) fadeIn(cells, 0.7, 0.5, 0.03)
        break
      }
      case 'generic': {
        liftIn(block, 16, 0.4, 0.6)
        break
      }
      default: {
        const exhaustive: never = role
        return exhaustive
      }
    }
  }

  return timeline
}

export function useHeroEntrance(heroRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const hero = heroRef.current
    if (!hero) return
    if (landingTier() === 'still') return
    if (window.scrollY > hero.offsetHeight * 0.5) return

    const blocks = Array.from(
      hero.querySelectorAll<HTMLElement>(TARGET_SELECTOR)
    )
    if (blocks.length === 0) return

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
      // Every fromTo's immediate render (lazy: false) stamps its start
      // values inline synchronously, so the disarm below hands ownership to
      // GSAP without a single contested frame.
      entranceTimeline = buildEntrance(motion, hero, blocks)
      disarm()
    })

    return () => {
      off()
      window.clearTimeout(watchdog)
      disarm()
      // Jump to the end first: restores the numeral's text and reverts the
      // serif split before the nodes are handed back.
      settleHeroEntrance()
      flushWaiters()
    }
  }, [heroRef])
}
