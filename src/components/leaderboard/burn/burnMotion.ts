// Motion for the burn board, modelled on ai/aiMotion's mount cascade.
// GSAP owns everything here: the chrome settling and its rules drawing
// out like a fuse, the rows sliding in from the rail once data lands,
// the page turn, and the ember ignition on the viewer's row. The
// skeleton flicker stays anime (see BurnSkeleton, which reuses the AI
// board's flickerSkeleton + runLoop).
//
// Plain functions, not hooks: the board wraps them in useGSAP so the
// context reverts them on unmount. Every entry checks motionReduced()
// and lands on the final state — nothing to undo, nothing half-drawn.
// Row tweens are fromTo with clearProps so a page turn that lands mid-
// cascade takes the rows to opacity 1 / x 0 rather than freezing them at
// whatever the interrupted tween had reached.

import gsap from 'gsap'
import { motionReduced } from '@/components/leaderboard/ai/aiMotion'

/** Chrome first, before any data: every framed card under `root` settles
 *  in, one after another, then the structural rules (title bar, thead)
 *  draw left → right in sequence. Runs once on mount so the skeleton
 *  already sits inside finished frames. */
export function mountChrome(root: HTMLElement): void {
  if (motionReduced()) return
  const q = gsap.utils.selector(root)
  const tl = gsap
    .timeline({ defaults: { ease: 'power3.out' } })
    .from(q('.bb-slab'), {
      opacity: 0,
      y: 6,
      duration: 0.4,
      stagger: 0.08,
      clearProps: 'opacity,transform'
    })
  const rules = q('.bb-rule-x')
  if (rules.length > 0) {
    tl.from(
      rules,
      {
        scaleX: 0,
        transformOrigin: '0% 50%',
        duration: 0.45,
        stagger: 0.12,
        clearProps: 'transform,transformOrigin'
      },
      '-=0.25'
    )
  }
}

/** Rows, once the first payload lands: the header fades in, the rows
 *  slide in from the rail. One-shot — the caller latches it. */
export function mountRows(root: HTMLElement): void {
  if (motionReduced()) return
  const q = gsap.utils.selector(root)
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
  tl.fromTo(
    q('.bb-thead'),
    { opacity: 0 },
    { opacity: 1, duration: 0.3, clearProps: 'opacity' },
    0
  )
  const rows = q('.bb-row')
  if (rows.length > 0) {
    tl.fromTo(
      rows,
      { opacity: 0, x: -8 },
      { opacity: 1, x: 0, duration: 0.34, stagger: 0.026, clearProps: 'opacity,transform' },
      0.06
    )
    popCrown(tl, q('.bb-crown'), 0.3)
  }
}

/** The crown lands last: a single short pop as its row (the first in)
 *  settles. Page 1 only — every other page has no crown to find. */
function popCrown(tl: gsap.core.Timeline, crowns: Element[], at: number): void {
  if (crowns.length === 0) return
  tl.fromTo(
    crowns,
    { scale: 0.6, opacity: 0 },
    {
      scale: 1,
      opacity: 1,
      duration: 0.3,
      ease: 'back.out(2.5)',
      clearProps: 'opacity,transform'
    },
    at
  )
}

/** After a page commit: the new rows enter from the direction of travel
 *  (NEXT slides them in from the right, PREV from the left). Rows are
 *  keyed by player, so the previous page's elements are already gone. */
export function turnPage(root: HTMLElement, dir: 1 | -1): void {
  if (motionReduced()) return
  const q = gsap.utils.selector(root)
  const rows = q('.bb-row')
  if (rows.length === 0) return
  const tl = gsap.timeline()
  tl.fromTo(
    rows,
    { opacity: 0, x: dir * 10 },
    {
      opacity: 1,
      x: 0,
      duration: 0.3,
      stagger: 0.018,
      ease: 'power2.out',
      overwrite: 'auto',
      clearProps: 'opacity,transform'
    },
    0
  )
  popCrown(tl, q('.bb-crown'), 0.2)
}

/** Ignition — the welcome / JUMP flash on the viewer's row: flare in the
 *  board's ember, then decay. clearProps hands the row back to its
 *  class-based rail at the end. The 0.35s delay lets the scroll land
 *  first. The hue is read off the element so the flash follows the
 *  theme (neon ember on dark, rust on white). */
export function igniteRow(el: HTMLElement): void {
  if (motionReduced()) return
  const ember = getComputedStyle(el).getPropertyValue('--lb-ember').trim() || '255 106 26'
  const rgba = (alpha: number) => `rgba(${ember.split(/\s+/).join(',')},${alpha})`
  const idle = `0 0 0 0px ${rgba(0)}, inset 0 0 0 0px ${rgba(0)}`
  gsap
    .timeline({ delay: 0.35 })
    .fromTo(
      el,
      { backgroundColor: rgba(0), boxShadow: idle },
      {
        backgroundColor: rgba(0.16),
        boxShadow: `0 0 36px 2px ${rgba(0.3)}, inset 0 0 0 1px ${rgba(0.65)}`,
        duration: 0.35,
        ease: 'power2.out'
      }
    )
    .to(el, {
      backgroundColor: rgba(0),
      boxShadow: idle,
      duration: 1.25,
      ease: 'power2.inOut',
      clearProps: 'backgroundColor,boxShadow'
    })
}
