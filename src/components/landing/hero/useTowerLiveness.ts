'use client'

// Board liveness — the hero at rest still breathes, and everything that
// moves on it comes from one sim (scoreDrift.ts), so the numeral, P1's
// cell and every GAP are always the same number seen from three places:
//  · P1 drifts. Every 3–8s the numeral rolls up by an irregular step (the
//    occasional burst), never down, until it lands on SCORE_CEILING exactly
//    and holds. P1's SCORE cell mirrors the numeral frame for frame and the
//    GAP column is re-derived against the same rolling value. No flash on
//    P1 — the roll is the signal.
//  · Ranks 2–6 gain. Every 9–12s one row picks up 20–140, capped under the
//    row above (no re-sorts, no positive GAP), and its score cell flashes
//    the signal color for a frame before easing back (a CSS transition on
//    [data-hero-score]; the class flip here is the only JS).
//  · The crossing. 1,000,000 is nine glyphs where 929,369 was seven, and
//    .lx-numeral is sized for seven. The last step first eases the font-
//    size down to what Numeral.tsx's nine-glyph rule resolves to (an
//    inline px tween), then rolls the digits over; when the tween lands the
//    inline size is dropped and that rule owns the fit again, so the
//    million stays responsive. One deliberate rollover, never an overflow.
//
// Time-coupled motion, so it rides anime.js on the shared runtime — one
// engine tick, sleeps with the document — gated on the entrance having
// settled (its count-up owns the numeral's text until it lands on the SSR
// string) and paused while the hero is offscreen. The still tier gets the
// same beats on a plain timeout with the text written outright: no rolls,
// no flash, no size tween.
//
// Every write is a DOM write on SSR'd nodes: React never re-renders the
// tower or the numeral, so the initial HTML is always SIM_ROSTER verbatim.
// The numeral's text is written on [data-hero-numeral] itself, which
// heroPin's SplitText leaves as the innermost node of its mask/line
// wrappers — the wrappers survive every tick, and the exit keeps working.

import { useEffect, type RefObject } from 'react'
import type { JSAnimation } from 'animejs'
import {
  CRIBBLE_EASE,
  landingTier,
  onLandingRuntime,
  type LandingMotion
} from '@/lib/landingMotion'
import { whenHeroEntranceSettled } from './heroEntrance'
import { createBoardSim, type Beat } from './scoreDrift'
import { formatGap, formatScore } from './towerFormat'

const TICK_CLASS = 'lx-tick'
/** One digit roll, old value to new. */
const ROLL_MS = 750
/** The crossing's font-size ease. */
const FIT_MS = 600
/** On the crossing the roll starts this far into the fit, so the digits
 *  land after the size has settled and the nine glyphs never overflow. */
const CROSSING_ROLL_DELAY_MS = 250
const [EASE_X1, EASE_Y1, EASE_X2, EASE_Y2] = CRIBBLE_EASE.split(',').map(Number)

type Cells = { score: HTMLElement; gap: HTMLElement | null }

/** The SSR'd nodes the sim draws onto; rows in rank order, 0 is P1. */
type Board = {
  /** The hero's <data data-hero-numeral>; null when the table stands alone. */
  numeral: HTMLElement | null
  rows: Cells[]
}

/** A pending beat that can be frozen while the board is offscreen. */
type Wait = { pause(): void; resume(): void; cancel(): void }
type Waiter = (ms: number, onDone: () => void) => Wait

/** anime.js timer on the shared engine: one tick, sleeps with the document. */
const animeWaiter =
  (motion: LandingMotion): Waiter =>
  (ms, onDone) => {
    const timer = motion.createTimer({ duration: ms, onComplete: onDone })
    return {
      pause: () => {
        timer.pause()
      },
      resume: () => {
        timer.resume()
      },
      cancel: () => {
        timer.cancel()
      }
    }
  }

/** Still tier: a plain timeout that keeps its remaining time across pauses. */
const timeoutWaiter: Waiter = (ms, onDone) => {
  let remaining = ms
  let startedAt = performance.now()
  let done = false
  const fire = () => {
    id = null
    done = true
    onDone()
  }
  let id: number | null = window.setTimeout(fire, ms)
  return {
    pause: () => {
      if (done || id === null) return
      window.clearTimeout(id)
      id = null
      remaining = Math.max(0, remaining - (performance.now() - startedAt))
    },
    resume: () => {
      if (done || id !== null) return
      startedAt = performance.now()
      id = window.setTimeout(fire, remaining)
    },
    cancel: () => {
      if (id !== null) window.clearTimeout(id)
      id = null
    }
  }
}

const glyphs = (value: number): number => formatScore(value).length

function writeScore(cell: HTMLElement, value: number): void {
  cell.dataset.value = String(value)
  cell.setAttribute('value', String(value))
  cell.textContent = formatScore(value)
}

/** Flash: the class pins the signal color with no transition; removing it
 *  two frames later (one painted with it on) lets the 600ms color
 *  transition ease back to ink. */
function flash(cell: HTMLElement): void {
  cell.classList.add(TICK_CLASS)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => cell.classList.remove(TICK_CLASS))
  })
}

function readBoard(table: HTMLTableElement): Board {
  // Ranked rows only (the dashed `you` row has no score); document order
  // is rank order.
  const rows: Cells[] = []
  table
    .querySelectorAll<HTMLElement>('[data-hero-row]:not([data-hero-row="you"])')
    .forEach((tr) => {
      const score = tr.querySelector<HTMLElement>('[data-hero-score]')
      if (!score) return
      rows.push({ score, gap: tr.querySelector<HTMLElement>('[data-hero-gap]') })
    })
  const hero = table.closest<HTMLElement>('.lx-hero')
  return {
    numeral: hero?.querySelector<HTMLElement>('[data-hero-numeral]') ?? null,
    rows
  }
}

/** Draws beats onto the board. `motion` null is the still tier: every
 *  change is written outright. */
function createPainter(board: Board, motion: LandingMotion | null) {
  // What the board currently reads on screen, rank order. This — not the
  // sim's scores — is what every GAP is measured against: the sim commits
  // a beat when it schedules it, a wait ahead of the DOM, and mid-roll P1
  // trails its landing value for 750ms. Drawing from `shown` keeps the
  // column agreeing with the cells beside it for every frame.
  const shown = board.rows.map((row) => Number(row.score.dataset.value))
  let roll: JSAnimation | null = null
  let fit: JSAnimation | null = null

  const drawLeader = (value: number) => {
    shown[0] = value
    if (board.numeral) {
      board.numeral.setAttribute('value', String(value))
      board.numeral.textContent = formatScore(value)
    }
    writeScore(board.rows[0].score, value)
    for (let i = 1; i < board.rows.length; i++) {
      const gap = board.rows[i].gap
      if (gap) gap.textContent = formatGap(shown[i], value)
    }
  }

  /** The crossing: flip the numeral onto Numeral.tsx's rule for the new
   *  glyph count, but hold the old size inline and ease down to what the
   *  rule resolves to. Inline px is only ever a tween; at rest the rule
   *  owns the size, so a resize mid-million still fits. */
  const refit = (numeral: HTMLElement, to: number) => {
    if (!motion) {
      numeral.dataset.glyphs = String(to)
      return
    }
    const fromPx = parseFloat(getComputedStyle(numeral).fontSize)
    numeral.dataset.glyphs = String(to)
    const toPx = parseFloat(getComputedStyle(numeral).fontSize)
    numeral.style.fontSize = `${fromPx}px`
    const size = { px: fromPx }
    fit?.cancel()
    fit = motion.animate(size, {
      px: toPx,
      duration: FIT_MS,
      ease: motion.cubicBezier(EASE_X1, EASE_Y1, EASE_X2, EASE_Y2),
      onUpdate: () => {
        numeral.style.fontSize = `${size.px}px`
      },
      onComplete: () => {
        numeral.style.fontSize = ''
      }
    })
  }

  const drift = (beat: Beat) => {
    const { numeral } = board
    const crossing = numeral !== null && glyphs(beat.to) > glyphs(beat.from)
    if (crossing) refit(numeral, glyphs(beat.to))
    if (!motion) {
      drawLeader(beat.to)
      return
    }
    const counter = { v: shown[0] }
    roll?.cancel()
    roll = motion.animate(counter, {
      v: beat.to,
      duration: ROLL_MS,
      delay: crossing ? CROSSING_ROLL_DELAY_MS : 0,
      ease: 'outCubic',
      modifier: Math.round,
      onUpdate: () => drawLeader(counter.v),
      onComplete: () => drawLeader(beat.to)
    })
  }

  const gain = (beat: Beat) => {
    const cells = board.rows[beat.row]
    if (!cells) return
    shown[beat.row] = beat.to
    writeScore(cells.score, beat.to)
    if (cells.gap) cells.gap.textContent = formatGap(beat.to, shown[0])
    if (motion) flash(cells.score)
  }

  return {
    paint: (beat: Beat) => {
      switch (beat.kind) {
        case 'drift':
          drift(beat)
          break
        case 'gain':
          gain(beat)
          break
        default: {
          const exhaustive: never = beat.kind
          return exhaustive
        }
      }
    },
    dispose: () => {
      roll?.cancel()
      fit?.cancel()
      roll = null
      fit = null
      // Only ever a tween's scratch value; the rule takes over.
      if (board.numeral) board.numeral.style.fontSize = ''
      board.rows.forEach((row) => row.score.classList.remove(TICK_CLASS))
    }
  }
}

export function useTowerLiveness(
  tableRef: RefObject<HTMLTableElement | null>
): void {
  useEffect(() => {
    const table = tableRef.current
    if (!table) return

    const board = readBoard(table)
    if (board.rows.length < 1) return
    const sim = createBoardSim(
      board.rows.map((row) => Number(row.score.dataset.value)),
      Math.random
    )

    let disposed = false
    let started = false
    let wait: Wait | null = null
    let onscreen = true
    let painter: ReturnType<typeof createPainter> | null = null

    // Each beat is its own one-shot wait so the cadence can vary; landing
    // one arms the next. The sim hands back null once nothing can move.
    const start = (waiter: Waiter, motion: LandingMotion | null) => {
      if (disposed || started) return
      started = true
      painter = createPainter(board, motion)
      const arm = () => {
        if (disposed) return
        const beat = sim.next()
        if (!beat) return
        wait = waiter(beat.delayMs, () => {
          wait = null
          if (disposed) return
          painter?.paint(beat)
          arm()
        })
        if (!onscreen) wait.pause()
      }
      arm()
    }

    let off: (() => void) | null = null
    if (landingTier() === 'still') {
      start(timeoutWaiter, null)
    } else {
      // The runtime is published after the entrance timeline is born (the
      // entrance subscribes first), so the settle wait is real: the first
      // beat can never race the count-up for the numeral's text.
      off = onLandingRuntime(({ motion }) => {
        whenHeroEntranceSettled(() => start(animeWaiter(motion), motion))
      })
    }

    // Offscreen pause: a board nobody can see shouldn't tick (or flash
    // into view mid-fade when it scrolls back). The hero root, not the
    // table: below lg the numeral is on screen long before the table is.
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (visible === onscreen) return
        onscreen = visible
        if (!wait) return
        if (visible) wait.resume()
        else wait.pause()
      },
      { threshold: 0 }
    )
    io.observe(table.closest('.lx-hero') ?? table)

    return () => {
      disposed = true
      off?.()
      io.disconnect()
      wait?.cancel()
      wait = null
      painter?.dispose()
      painter = null
    }
  }, [tableRef])
}
