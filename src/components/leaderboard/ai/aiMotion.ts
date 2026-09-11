// Motion for the AI board, split by what moves. GSAP owns layout: the
// mount cascade (chrome, then rows once data lands), the proxy counters
// on the title bar and the featured score, the Flip re-sort when a
// control changes the row order, and the spec-sheet expand/collapse.
// anime.js owns typography: the prompt typewriter, the block cursor and
// the skeleton flicker — the continuous, character-level texture GSAP
// would be overkill for.
//
// Every entry point checks motionReduced() and lands on the final state
// instead: no cascade, no typing, a static cursor, an instant re-sort.
// Loops go through runLoop() so a hidden tab parks them and unmount
// reverts them (anime's engine already sleeps on document.hidden, but
// the explicit pause keeps the contract visible here, and revert strips
// the inline styles the loops wrote).

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { animate, splitText, stagger, steps } from 'animejs'
import { useRef } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

gsap.registerPlugin(useGSAP, Flip)

/** OS media query + Cribble's in-app data-motion kill switch. */
export function motionReduced(): boolean {
  return (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  )
}

/* ================= loops (anime.js) ================= */

/** Playback surface shared by every anime instance the board keeps. */
export type Loop = {
  pause: () => unknown
  resume: () => unknown
  revert: () => unknown
}

const IDLE: Loop = { pause() {}, resume() {}, revert() {} }

/** Start a loop under the tab-visibility contract. Returns the effect
 *  cleanup: detach the listener, revert the instance. */
export function runLoop(loop: Loop): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') loop.pause()
    else loop.resume()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    loop.revert()
  }
}

/** Prompt tail: split into characters and reveal them one per tick with
 *  a hard step — a terminal writes glyphs, it does not fade them in. The
 *  splitter is reverted with the animation so the element's text node
 *  is whole again for React. */
export function typewriter(el: HTMLElement): Loop {
  if (motionReduced()) return IDLE
  // words wrap chars so a narrow prompt breaks between flags, never inside one
  const split = splitText(el, { chars: true, words: true, lines: false })
  const anim = animate(split.chars, {
    opacity: [0, 1],
    duration: 20,
    delay: stagger(14),
    ease: steps(1)
  })
  return {
    pause: () => anim.pause(),
    resume: () => anim.resume(),
    revert: () => {
      anim.revert()
      split.revert()
    }
  }
}

/** Block cursor: a slow sine breath, full to dark and back over ~1.4s.
 *  Not the stepped terminal blink — next to a pixel name that hard
 *  on/off reads as a glitch; this reads as a pulse. */
export function blinkCursor(el: HTMLElement): Loop {
  if (motionReduced()) return IDLE
  return animate(el, {
    opacity: [1, 0],
    duration: 700,
    ease: 'inOutSine',
    loop: true,
    alternate: true
  })
}

/** Skeleton `░` blocks: stepped flicker with a per-row offset so the
 *  placeholder reads as a feed still printing, not a pulse. */
export function flickerSkeleton(els: ArrayLike<HTMLElement>): Loop {
  if (motionReduced() || els.length === 0) return IDLE
  return animate(Array.from(els), {
    opacity: [0.3, 0.75],
    duration: 900,
    delay: stagger(70),
    ease: steps(3),
    loop: true,
    alternate: true
  })
}

/* ================= mount cascade (GSAP) ================= */

/** Chrome first, before any data: the amber-framed cards settle in, one
 *  after another, then every structural rule draws out from the left.
 *  Runs once on mount so the skeleton already sits inside finished frames. */
export function mountChrome(root: HTMLElement): void {
  if (motionReduced()) return
  const q = gsap.utils.selector(root)
  const tl = gsap
    .timeline({ defaults: { ease: 'power3.out' } })
    .from(q('.aib-slab'), { opacity: 0, y: 6, duration: 0.4, stagger: 0.08 })
  // The only rule element today lives in the AGENTS card, which mounts
  // with the data, so on first paint there is usually nothing here —
  // guard it, or GSAP logs "target not found" on every load.
  const rules = q('.aib-rule-x')
  if (rules.length > 0) {
    tl.from(
      rules,
      { scaleX: 0, transformOrigin: '0% 50%', duration: 0.45, stagger: 0.06 },
      '-=0.25'
    )
  }
}

/** Content, once the first payload lands: featured children rise in,
 *  the AGENTS card (absent until data) settles, the headers fade, the rows
 *  of both lists slide in from the rail, share bars grow from the left.
 *  Returns the timeline so the caller can park it. */
export function mountContent(root: HTMLElement): gsap.core.Timeline | null {
  if (motionReduced()) return null
  const q = gsap.utils.selector(root)
  const rows = q('.aib-row')
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
  tl.from(
    q('.aib-featured > *'),
    { opacity: 0, y: 8, duration: 0.45, stagger: 0.06 },
    0
  )
  tl.from(q('.aib-agents'), { opacity: 0, y: 6, duration: 0.4 }, 0.1)
  // its title-bar rule draws out once the card has settled
  const rules = q('.aib-agents .aib-rule-x')
  if (rules.length > 0) {
    tl.from(rules, { scaleX: 0, transformOrigin: '0% 50%', duration: 0.45 }, 0.3)
  }
  tl.from(q('.aib-thead'), { opacity: 0, duration: 0.3 }, 0.12)
  if (rows.length > 0) {
    tl.from(rows, { opacity: 0, x: -8, duration: 0.34, stagger: 0.026 }, 0.18)
  }
  tl.from(
    q('.aib-sharebar-fill'),
    {
      scaleX: 0,
      transformOrigin: '0% 50%',
      duration: 0.6,
      ease: 'power3.out',
      stagger: 0.02
    },
    0.3
  )
  return tl
}

/* ================= counters (GSAP proxy) ================= */

/** A number that counts to its value. The element renders the formatted
 *  target as text (no-JS and screen readers see the real figure); the
 *  layout effect rewinds it to the last shown value and tweens a proxy up,
 *  snapping to integers. Reduced motion writes the target directly. */
export function useCounter<T extends HTMLElement>(
  value: number,
  format: (n: number) => string
) {
  const ref = useRef<T>(null)
  const shown = useRef(0)
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      const from = shown.current
      if (motionReduced() || from === value) {
        shown.current = value
        el.textContent = format(value)
        return
      }
      el.textContent = format(from)
      const proxy = { value: from }
      gsap.to(proxy, {
        value,
        duration: 0.9,
        ease: 'power2.out',
        snap: { value: 1 },
        onUpdate: () => {
          shown.current = proxy.value
          el.textContent = format(proxy.value)
        }
      })
    },
    { dependencies: [value, format], revertOnUpdate: true }
  )
  return ref
}

/* ================= re-sort (Flip) ================= */

/** What a control handler captures before it commits a new row order:
 *  the rows' positions and the list's height (absolute-positioned rows
 *  leave the <ol> with nothing in flow, so the height is tweened by hand). */
export type RowsSnapshot = { state: Flip.FlipState; height: number }

/* Flip only ever follows the machine table — the AGENTS slab re-renders
   plainly on a window switch, so both selectors are scoped to the machine
   slab (.aib-machines), not to the shared .aib-table class. */
const TABLE_LIST = '.aib-machines .aib-rows'
const TABLE_ROWS = '.aib-machines .aib-rows > .aib-row'

export function snapshotRows(root: HTMLElement): RowsSnapshot | null {
  if (motionReduced()) return null
  const list = root.querySelector<HTMLElement>(TABLE_LIST)
  const rows = root.querySelectorAll<HTMLElement>(TABLE_ROWS)
  if (!list || rows.length === 0) return null
  return { state: Flip.getState(rows), height: list.offsetHeight }
}

/** After the commit: rows glide from where they were to where they are;
 *  newcomers (unfiltered, other window) fade in. Rows React removed are
 *  gone from the DOM before this runs, so there is nothing to fade out —
 *  the height tween covers the list shrinking under them. */
export function flipRows(snap: RowsSnapshot, root: HTMLElement): void {
  const list = root.querySelector<HTMLElement>(TABLE_LIST)
  const rows = root.querySelectorAll<HTMLElement>(TABLE_ROWS)
  if (!list || rows.length === 0) return
  // Pin the list for the whole flip: absolute rows contribute nothing to
  // its flow height, so it is held at the old height, tweened to the new
  // one, and released once the last staggered row has landed.
  const height = list.offsetHeight
  gsap.set(list, { height: snap.height })
  gsap.to(list, { height, duration: 0.45, ease: 'power3.inOut' })
  Flip.from(snap.state, {
    targets: rows,
    duration: 0.45,
    ease: 'power3.inOut',
    stagger: 0.01,
    absolute: true,
    onEnter: (els) =>
      gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' }),
    onLeave: (els) => gsap.to(els, { opacity: 0, duration: 0.2, ease: 'power2.in' }),
    onComplete: () => gsap.set(list, { clearProps: 'height' })
  })
}

/* ================= spec sheet (GSAP) ================= */

export function expandSheet(el: HTMLElement): void {
  gsap.killTweensOf(el)
  if (motionReduced()) {
    gsap.set(el, { clearProps: 'height,opacity' })
    return
  }
  gsap.fromTo(
    el,
    { height: 0, opacity: 0 },
    {
      height: 'auto',
      opacity: 1,
      duration: 0.28,
      ease: 'power3.out',
      clearProps: 'height,opacity'
    }
  )
}

export function collapseSheet(el: HTMLElement, done: () => void): void {
  gsap.killTweensOf(el)
  if (motionReduced()) {
    done()
    return
  }
  gsap.to(el, {
    height: 0,
    opacity: 0,
    duration: 0.2,
    ease: 'power2.in',
    onComplete: done
  })
}
