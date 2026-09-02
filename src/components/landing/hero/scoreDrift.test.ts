import { describe, expect, it } from 'vitest'
import { SCORE_CEILING, SIM_ROSTER } from '@/components/landing/data'
import {
  createBoardSim,
  DRIFT_PACING,
  type Beat,
  type BoardSimOptions,
  type Rng
} from './scoreDrift'
import { formatGap } from './towerFormat'

/** mulberry32 — a small seeded PRNG so every schedule below is replayable. */
const seeded = (seed: number): Rng => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ROSTER = SIM_ROSTER.slice(0, 6).map((p) => p.score)

/** Play a sim through P1's landing plus `tail` more beats (ranks 2–6 keep
 *  breathing for hours after it), or until nothing can move, capturing
 *  every beat and a snapshot of the board after it. */
function run(
  seed: number,
  initial = ROSTER,
  options: BoardSimOptions = {},
  tail = 40
) {
  const sim = createBoardSim(initial, seeded(seed), options)
  const beats: Beat[] = []
  const boards: number[][] = []
  const ceiling = options.ceiling ?? SCORE_CEILING
  let afterLanding = 0
  let beat = sim.next()
  while (beat) {
    beats.push(beat)
    boards.push(sim.scores.slice())
    if (sim.scores[0] >= ceiling && ++afterLanding > tail) break
    if (beats.length > 20_000) throw new Error('sim never settles')
    beat = sim.next()
  }
  return { sim, beats, boards }
}

const drifts = (beats: Beat[]) => beats.filter((b) => b.kind === 'drift')
const gains = (beats: Beat[]) => beats.filter((b) => b.kind === 'gain')
const inRange = (v: number, [min, max]: readonly [number, number]) =>
  v >= min && v <= max

/** Wall-clock time of every beat, from the sum of the delays before it. */
const clock = (beats: Beat[]) => {
  let t = 0
  return beats.map((b) => (t += b.delayMs))
}

describe('createBoardSim — P1 drift', () => {
  it('only ever moves P1 upward, and lands exactly on the ceiling', () => {
    for (const seed of [1, 2, 3, 42, 1337]) {
      const { sim, beats } = run(seed)
      let last = ROSTER[0]
      for (const d of drifts(beats)) {
        expect(d.row).toBe(0)
        expect(d.from).toBe(last)
        expect(d.to).toBeGreaterThan(d.from)
        expect(d.to).toBeLessThanOrEqual(SCORE_CEILING)
        last = d.to
      }
      expect(last).toBe(SCORE_CEILING)
      expect(sim.scores[0]).toBe(SCORE_CEILING)
    }
  })

  it('steps by an ordinary size or a burst, clamping only the last one', () => {
    const { beats } = run(7)
    const steps = drifts(beats)
    for (const d of steps.slice(0, -1)) {
      const size = d.to - d.from
      const ordinary = inRange(size, DRIFT_PACING.stepPts)
      const burst = inRange(size, DRIFT_PACING.burstPts)
      expect(ordinary || burst, `step of ${size}`).toBe(true)
    }
    const last = steps[steps.length - 1]
    expect(last.to).toBe(SCORE_CEILING)
    expect(last.to - last.from).toBeLessThanOrEqual(DRIFT_PACING.burstPts[1])
    // Bursts happen, but stay the minority.
    const bursts = steps.filter((d) => d.to - d.from >= DRIFT_PACING.burstPts[0])
    expect(bursts.length).toBeGreaterThan(0)
    expect(bursts.length).toBeLessThan(steps.length / 2)
  })

  it('waits the lead before the first step and the drift range between steps', () => {
    for (const seed of [5, 6, 8]) {
      const { beats } = run(seed)
      const at = clock(beats)
      const driftTimes = beats
        .map((b, i) => (b.kind === 'drift' ? at[i] : null))
        .filter((t): t is number => t !== null)
      expect(inRange(driftTimes[0], DRIFT_PACING.leadMs)).toBe(true)
      for (let i = 1; i < driftTimes.length; i++) {
        const gap = driftTimes[i] - driftTimes[i - 1]
        expect(inRange(gap, DRIFT_PACING.driftMs), `interval ${gap}ms`).toBe(true)
      }
      for (const b of beats) expect(b.delayMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('reaches the million in roughly eight to thirteen minutes', () => {
    const minutes: number[] = []
    for (let seed = 100; seed < 300; seed++) {
      const { beats } = run(seed)
      const at = clock(beats)
      const landed = beats.findIndex((b) => b.kind === 'drift' && b.to === SCORE_CEILING)
      minutes.push(at[landed] / 60_000)
    }
    const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length
    expect(mean).toBeGreaterThan(8)
    expect(mean).toBeLessThan(13)
    for (const m of minutes) {
      expect(m).toBeGreaterThan(6)
      expect(m).toBeLessThan(17)
    }
  })

  it('issues no further drift once P1 holds at the ceiling', () => {
    const { beats } = run(9)
    const landed = beats.findIndex((b) => b.kind === 'drift' && b.to === SCORE_CEILING)
    expect(landed).toBeGreaterThan(0)
    expect(drifts(beats.slice(landed + 1))).toHaveLength(0)
  })

  it('never drifts a P1 that already sits at the ceiling', () => {
    const { beats } = run(3, [SCORE_CEILING, 5])
    expect(beats.length).toBeGreaterThan(0)
    expect(drifts(beats)).toHaveLength(0)
    expect(beats.every((b) => b.kind === 'gain' && b.row === 1)).toBe(true)
  })

  it('replays the same schedule for the same seed', () => {
    expect(run(11).beats).toEqual(run(11).beats)
    expect(run(11).beats).not.toEqual(run(12).beats)
  })
})

describe('createBoardSim — ranks 2–6', () => {
  it('keeps every row strictly below the one above it, at every beat', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { boards } = run(seed)
      for (const board of boards) {
        for (let i = 1; i < board.length; i++) {
          expect(board[i]).toBeLessThan(board[i - 1])
        }
      }
    }
  })

  it('never lowers a row, and gains within the pacing range', () => {
    const { beats } = run(21)
    const last = ROSTER.slice()
    for (const g of gains(beats)) {
      expect(g.row).toBeGreaterThanOrEqual(1)
      expect(g.from).toBe(last[g.row])
      const size = g.to - g.from
      expect(size).toBeGreaterThan(0)
      expect(size).toBeLessThanOrEqual(DRIFT_PACING.gainPts[1])
      last[g.row] = g.to
    }
  })

  it('spaces the gains 9–12s apart', () => {
    const { beats } = run(22)
    const at = clock(beats)
    const gainTimes = beats
      .map((b, i) => (b.kind === 'gain' ? at[i] : null))
      .filter((t): t is number => t !== null)
    expect(inRange(gainTimes[0], DRIFT_PACING.gainMs)).toBe(true)
    for (let i = 1; i < gainTimes.length; i++) {
      expect(inRange(gainTimes[i] - gainTimes[i - 1], DRIFT_PACING.gainMs)).toBe(true)
    }
  })

  it('caps a gain so the row lands one point under the row above', () => {
    // 20–140 a gain against a 30-point gap: the first gain must clamp.
    const { beats } = run(2, [1000, 970], { ceiling: 1000 })
    expect(beats).toHaveLength(1)
    expect(beats[0]).toMatchObject({ kind: 'gain', row: 1, from: 970, to: 999 })
  })

  it('skips flush rows while P1 still climbs, then retires when nothing can move', () => {
    // Row 2 is already flush and the gain stream is due first (9–12s vs a
    // 20s lead): it has to sit out until P1's step opens headroom.
    const { sim, beats } = run(4, [100, 99], {
      ceiling: 200,
      pacing: { ...DRIFT_PACING, leadMs: [20_000, 20_000], stepPts: [50, 50], burstOdds: 0 }
    })
    expect(beats[0]).toMatchObject({ kind: 'drift', delayMs: 20_000, from: 100, to: 150 })
    const at = clock(beats)
    const firstGain = beats.findIndex((b) => b.kind === 'gain')
    expect(firstGain).toBeGreaterThan(0)
    expect(at[firstGain]).toBeGreaterThan(20_000)
    for (const g of gains(beats)) expect(g.to).toBeLessThan(200)
    // Drained: P1 holds at 200 and row 2 has crept up flush beneath it.
    expect(sim.scores).toEqual([200, 199])
    expect(sim.next()).toBeNull()
  })

  it('is done immediately when the board is already frozen', () => {
    const sim = createBoardSim([1000, 999, 998], seeded(1), { ceiling: 1000 })
    expect(sim.next()).toBeNull()
  })
})

describe('formatGap against a moving leader', () => {
  it('measures the gap from the leader passed in', () => {
    expect(formatGap(927_929, 929_369)).toBe('−1,440')
    expect(formatGap(927_929, 1_000_000)).toBe('−72,071')
    expect(formatGap(999_999, 1_000_000)).toBe('−1')
  })

  it('prints an em dash for the leader itself', () => {
    expect(formatGap(1_000_000, 1_000_000)).toBe('—')
    expect(formatGap(ROSTER[0])).toBe('—')
  })

  it('agrees with the sim: gap = score − P1 for every row after every beat', () => {
    const { boards } = run(31)
    for (const board of boards) {
      for (let i = 1; i < board.length; i++) {
        const behind = board[0] - board[i]
        expect(formatGap(board[i], board[0])).toBe(
          `−${new Intl.NumberFormat('en-US').format(behind)}`
        )
      }
    }
  })
})
