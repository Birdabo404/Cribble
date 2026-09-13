// Motion for the pilot-license PlayerCard. One entrance gesture: backdrop
// and card land together while the zones cascade in, hairlines draw, bars
// grow, badges settle and the MRZ prints — nested positions so the beats
// overlap into a single ~0.7s reveal. Profile hydration is one cross-fade
// over the `[data-pc-late]` elements not yet stamped `[data-pc-done]`, so
// a follow-toggle re-render never replays. Pointer tilt is a quickTo proxy
// writing the four CSS vars the card's transform (--rx / --ry) and sheen
// (--mx / --my) read.
//
// Every entry point checks motionReduced() first and lands on the final
// state: everything is gsap.from, so React's rendered DOM is the truth.
// Target lists are guarded so GSAP never logs "target not found". Crown
// bob and champion ring spin stay CSS loops in PlayerCard.

import gsap from 'gsap'
import { prefersReducedMotion } from '@/lib/motion'

const PC = {
  backdrop: '[data-pc="backdrop"]',
  card: '[data-pc="card"]',
  tilt: '[data-pc="tilt"]',
  hair: '[data-pc="hair"]',
  hairV: '[data-pc="hair-v"]',
  zone: '[data-pc="zone"]',
  bar: '[data-pc="bar"]',
  badge: '[data-pc="badge"]',
  mrzCh: '[data-pc="mrz-ch"]',
  ghost: '[data-pc="ghost"]'
} as const

const LATE = '[data-pc-late]'
const DONE = 'data-pc-done'
const TILT_VARS = ['--rx', '--ry', '--mx', '--my'] as const

/** OS media query + Cribble's in-app data-motion kill switch. False
 *  during SSR — nothing tweens there anyway. */
export function motionReduced(): boolean {
  if (typeof document === 'undefined') return false
  return prefersReducedMotion() || document.documentElement.dataset.motion === 'reduced'
}

const lateOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(LATE))

const markDone = (els: HTMLElement[]) => {
  for (const el of els) el.setAttribute(DONE, '')
}

/** Mount. Returns the timeline so exitCard can finish it early; null
 *  under reduced motion. Late elements already in the DOM ride this pass
 *  and are stamped so hydrateIn leaves them alone.
 *
 *  The timeline is built paused — the from-states render at once — and
 *  plays on the second frame: the card's first paint is heavy (88 MRZ
 *  glyphs, banner, fonts) and a clock started in the layout effect would
 *  already be a third of the way through by the time anything is on
 *  screen, so the opening read as a pop. */
export function enterCard(
  root: HTMLElement,
  opts: { mobile: boolean }
): gsap.core.Timeline | null {
  markDone(lateOf(root))
  if (motionReduced()) return null

  const q = gsap.utils.selector(root)
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } })

  tl.from(q(PC.backdrop), { opacity: 0, duration: 0.3 }, 0)
  tl.from(
    q(PC.card),
    opts.mobile
      ? { opacity: 0, y: 40, duration: 0.5, ease: 'expo.out' }
      : { opacity: 0, scale: 0.92, y: 20, duration: 0.55, ease: 'back.out(1.4)' },
    0
  )
  // contents: one cascade down the zones, structure drawing alongside
  tl.from(q(PC.zone), { opacity: 0, duration: 0.35, stagger: 0.05 }, 0.1)
  const hair = q(PC.hair)
  if (hair.length > 0) {
    tl.from(hair, { scaleX: 0, transformOrigin: '0% 50%', duration: 0.5, ease: 'expo.out', stagger: 0.04 }, '<')
  }
  const hairV = q(PC.hairV)
  if (hairV.length > 0) {
    tl.from(hairV, { scaleY: 0, transformOrigin: '50% 0%', duration: 0.5, ease: 'expo.out' }, '<')
  }
  const bars = q(PC.bar)
  if (bars.length > 0) {
    tl.from(bars, { scaleX: 0, transformOrigin: '0% 50%', duration: 0.4, ease: 'expo.out', stagger: 0.04 }, '<0.15')
  }
  const badges = q(PC.badge)
  if (badges.length > 0) {
    tl.from(
      badges,
      { opacity: 0, scale: 0.85, duration: 0.3, stagger: { each: 0.012, grid: 'auto', from: 'start' } },
      '<0.05'
    )
  }
  // hard on, one glyph per tick — a printer, not a fade
  tl.from(q(PC.mrzCh), { opacity: 0, duration: 0.01, stagger: 0.003, ease: 'none' }, '<0.1')

  requestAnimationFrame(() => requestAnimationFrame(() => tl.play()))
  return tl
}

/** Profile answered (or failed): the follow-slot ghost fades under
 *  whatever replaced it, and every late element not yet stamped
 *  cross-fades in as one group. Reduced motion lands the final state. */
export function hydrateIn(root: HTMLElement): void {
  const ghost = root.querySelector<HTMLElement>(PC.ghost)
  const pending = lateOf(root).filter((el) => !el.hasAttribute(DONE))
  markDone(pending)

  if (motionReduced()) {
    if (ghost) ghost.style.display = 'none'
    return
  }
  // GSAP applies display:none when the tween completes
  if (ghost) gsap.to(ghost, { opacity: 0, duration: 0.15, ease: 'power2.out', display: 'none' })
  if (pending.length === 0) return
  // amount, not each: a badge grid brings ~20 late nodes, and the group
  // must still read as one 0.3s fade rather than a second cascade
  gsap.from(pending, {
    opacity: 0,
    y: 4,
    duration: 0.3,
    ease: 'power2.out',
    stagger: { amount: 0.15 }
  })
}

/** Close: finish an unfinished entrance, collapse card and backdrop
 *  together, drop the tilt vars so nothing lingers. `onDone` fires exactly
 *  once — after the card tween, or synchronously under reduced motion. */
export function exitCard(
  root: HTMLElement,
  enter: gsap.core.Timeline | null,
  onDone: () => void
): void {
  let fired = false
  const done = () => {
    if (fired) return
    fired = true
    onDone()
  }

  // paused-and-waiting or mid-flight: land it, then leave from the final state
  if (enter) {
    enter.progress(1)
    enter.kill()
  }
  const tilt = root.querySelector<HTMLElement>(PC.tilt)
  if (tilt) for (const name of TILT_VARS) tilt.style.removeProperty(name)

  const card = root.querySelector<HTMLElement>(PC.card)
  const backdrop = root.querySelector<HTMLElement>(PC.backdrop)
  if (!card || motionReduced()) {
    done()
    return
  }

  const targets = backdrop ? [card, backdrop] : [card]
  gsap.killTweensOf(targets)
  const out = { duration: 0.22, ease: 'power2.in' }
  gsap.to(card, { ...out, opacity: 0, scale: 0.94, y: 12, onComplete: done })
  if (backdrop) gsap.to(backdrop, { ...out, opacity: 0 })
}

type TiltState = { rx: number; ry: number; mx: number; my: number }
const TILT_REST: TiltState = { rx: 0, ry: 0, mx: 50, my: 50 }

/** Holographic tilt: the pointer's fraction across the element drives four
 *  quickTo tweens on a proxy; one writer pushes them to `--rx` / `--ry`
 *  (deg) for the card's rotate and `--mx` / `--my` (%) for the sheen
 *  hotspot. Mouse only; leave eases back to rest. Returns the cleanup;
 *  a noop under reduced motion. */
export function bindTilt(el: HTMLElement): () => void {
  if (motionReduced()) return () => {}

  const state: TiltState = { ...TILT_REST }
  const write = () => {
    el.style.setProperty('--rx', `${state.rx.toFixed(2)}deg`)
    el.style.setProperty('--ry', `${state.ry.toFixed(2)}deg`)
    el.style.setProperty('--mx', `${state.mx.toFixed(1)}%`)
    el.style.setProperty('--my', `${state.my.toFixed(1)}%`)
  }
  const to = (key: keyof TiltState) =>
    gsap.quickTo(state, key, { duration: 0.5, ease: 'power3.out', onUpdate: write })
  const rx = to('rx')
  const ry = to('ry')
  const mx = to('mx')
  const my = to('my')

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    rx((0.5 - y) * 5)
    ry((x - 0.5) * 7)
    mx(x * 100)
    my(y * 100)
  }
  const onLeave = () => {
    rx(TILT_REST.rx)
    ry(TILT_REST.ry)
    mx(TILT_REST.mx)
    my(TILT_REST.my)
  }

  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerleave', onLeave)
  return () => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerleave', onLeave)
    for (const fn of [rx, ry, mx, my]) fn.tween.kill()
    for (const name of TILT_VARS) el.style.removeProperty(name)
  }
}
