// Score drift — the pure sim behind the hero board's liveness
// (useTowerLiveness.ts). One board, one clock: P1 climbs from the staged
// roster to SCORE_CEILING in irregular steps at irregular intervals, never
// down, and holds once it lands there exactly; ranks 2–6 keep picking up
// points underneath, each capped under the row above so the order never
// changes. The ticker only asks for the next beat and draws it, so every
// GAP on the board is derived from the same P1 the numeral shows. The RNG
// is injected (Math.random in production) so the schedule is testable.

import { SCORE_CEILING } from '@/components/landing/data'

/** Uniform in [0, 1) — Math.random's contract. */
export type Rng = () => number

type Range = readonly [min: number, max: number]

export interface DriftPacing {
  /** Board settled → P1's first step. */
  leadMs: Range
  /** Between P1 steps. */
  driftMs: Range
  /** An ordinary P1 step, and the occasional burst with its odds. */
  stepPts: Range
  burstPts: Range
  burstOdds: number
  /** Between rank 2–6 gains, and a gain's size before the cap. */
  gainMs: Range
  gainPts: Range
}

/** ~70k to climb. 3–8s between steps, 80–480 ordinarily, 900–1,800 three
 *  beats in ten → ~590 a step, ~120 steps, ~11 minutes of dwell time to
 *  the million. Ranks 2–6 keep the board's old 9–12s / 20–140 breath. */
export const DRIFT_PACING: DriftPacing = {
  leadMs: [4000, 6000],
  driftMs: [3000, 8000],
  stepPts: [80, 480],
  burstPts: [900, 1800],
  burstOdds: 0.3,
  gainMs: [9000, 12000],
  gainPts: [20, 140]
}

export interface Beat {
  /** 'drift' moves P1 (the numeral); 'gain' moves a rank 2–6 row. */
  kind: 'drift' | 'gain'
  /** Index into the board's scores; 0 is P1. */
  row: number
  /** Wait before this change lands, measured from the previous beat. */
  delayMs: number
  from: number
  to: number
}

export interface BoardSim {
  /** Live scores in rank order; index 0 is P1. */
  readonly scores: readonly number[]
  /** The next change and how long to wait for it. null once nothing can
   *  move: P1 at the ceiling, every row flush against the one above. */
  next(): Beat | null
}

export interface BoardSimOptions {
  ceiling?: number
  pacing?: DriftPacing
}

const between = (rng: Rng, [min, max]: Range): number =>
  Math.round(min + rng() * (max - min))

export function createBoardSim(
  initial: readonly number[],
  rng: Rng,
  { ceiling = SCORE_CEILING, pacing = DRIFT_PACING }: BoardSimOptions = {}
): BoardSim {
  const scores = initial.slice()
  // Two streams on one clock, each holding the time its next beat is due;
  // a finished stream is due at Infinity.
  let now = 0
  let driftDue =
    scores.length > 0 && scores[0] < ceiling
      ? between(rng, pacing.leadMs)
      : Infinity
  let gainDue = scores.length > 1 ? between(rng, pacing.gainMs) : Infinity

  const drift = (delayMs: number): Beat => {
    const from = scores[0]
    const size =
      rng() < pacing.burstOdds
        ? between(rng, pacing.burstPts)
        : between(rng, pacing.stepPts)
    // The clamp is what lands the last step on the ceiling exactly.
    const to = Math.min(ceiling, from + size)
    scores[0] = to
    driftDue = to < ceiling ? now + between(rng, pacing.driftMs) : Infinity
    return { kind: 'drift', row: 0, delayMs, from, to }
  }

  /** Rows with headroom under the one above; a flush row sits out. */
  const openRows = (): number[] => {
    const open: number[] = []
    for (let i = 1; i < scores.length; i++) {
      if (scores[i - 1] - scores[i] > 1) open.push(i)
    }
    return open
  }

  const gain = (delayMs: number, open: number[]): Beat => {
    const row = open[Math.floor(rng() * open.length)]
    const from = scores[row]
    const to = Math.min(scores[row - 1] - 1, from + between(rng, pacing.gainPts))
    scores[row] = to
    gainDue = now + between(rng, pacing.gainMs)
    return { kind: 'gain', row, delayMs, from, to }
  }

  const next = (): Beat | null => {
    for (;;) {
      const due = Math.min(driftDue, gainDue)
      if (!Number.isFinite(due)) return null
      // Ties go to P1: the numeral is the board's clock.
      if (driftDue <= gainDue) {
        const delayMs = due - now
        now = due
        return drift(delayMs)
      }
      const open = openRows()
      if (open.length) {
        const delayMs = due - now
        now = due
        return gain(delayMs, open)
      }
      // Every row is flush against the one above. Skip the beat (the clock
      // stays put, so the next delay is still measured from the last beat
      // that landed), and retire the stream once P1 can no longer open
      // headroom above it.
      gainDue = Number.isFinite(driftDue)
        ? due + between(rng, pacing.gainMs)
        : Infinity
    }
  }

  return { scores, next }
}
