import { describe, expect, it } from 'vitest'
import { BAR_CELLS, barString, pad, shareOf, sparkline } from './crtDossier'

const FULL = '█'
const TRACK = '·'

describe('barString', () => {
  it('always paints exactly BAR_CELLS glyphs', () => {
    expect(BAR_CELLS).toBe(18)
    for (const frac of [0, 0.01, 0.25, 0.5, 0.75, 0.999, 1]) {
      expect(barString(frac)).toHaveLength(BAR_CELLS)
    }
  })

  it('an empty bar is the shaded cursor cell on bare track', () => {
    const empty = barString(0)
    expect(empty).toBe('░' + TRACK.repeat(BAR_CELLS - 1))
    expect(empty).not.toContain(FULL)
  })

  it('a full bar is solid blocks with no cursor cell', () => {
    expect(barString(1)).toBe(FULL.repeat(BAR_CELLS))
  })

  it('half fills nine blocks, then the partial glyph, then track', () => {
    expect(barString(0.5)).toBe(FULL.repeat(9) + '░' + TRACK.repeat(8))
  })

  it('picks the partial glyph from the cell remainder', () => {
    // 9 full cells plus 0.2 / 0.5 / 0.7 of the tenth.
    expect(barString(9.2 / BAR_CELLS).charAt(9)).toBe('░')
    expect(barString(9.5 / BAR_CELLS).charAt(9)).toBe('▒')
    expect(barString(9.7 / BAR_CELLS).charAt(9)).toBe('▓')
  })

  it('clamps out-of-range fractions to the empty and full bars', () => {
    expect(barString(-0.5)).toBe(barString(0))
    expect(barString(-Infinity)).toBe(barString(0))
    expect(barString(1.5)).toBe(barString(1))
    expect(barString(Infinity)).toBe(barString(1))
  })
})

describe('sparkline', () => {
  const GLYPHS = new Set('▁▂▃▄▅▆▇█')

  it('is 22 glyphs drawn from the block ramp', () => {
    for (const seed of [0, 1, 42, 1234, 2 ** 31, 2 ** 32 - 1]) {
      const line = sparkline(seed)
      expect(line).toHaveLength(22)
      for (const glyph of line) expect(GLYPHS.has(glyph)).toBe(true)
    }
  })

  it('is deterministic per seed and differs between seeds', () => {
    expect(sparkline(42)).toBe(sparkline(42))
    expect(sparkline(1234)).toBe(sparkline(1234))
    expect(sparkline(1)).not.toBe(sparkline(2))
    expect(sparkline(42)).not.toBe(sparkline(43))
  })

  it('does not degenerate at seed 0 (the LCG guard reseeds to 1)', () => {
    const zero = sparkline(0)
    expect(new Set(zero).size).toBeGreaterThan(1)
    expect(zero).toBe(sparkline(1))
  })

  it('treats negative seeds through the unsigned view', () => {
    expect(sparkline(-1)).toBe(sparkline(2 ** 32 - 1))
  })
})

describe('pad', () => {
  it('zero-pads to three digits by default', () => {
    expect(pad(0)).toBe('000')
    expect(pad(7)).toBe('007')
    expect(pad(42)).toBe('042')
    expect(pad(387)).toBe('387')
  })

  it('never truncates a wider number', () => {
    expect(pad(1234)).toBe('1234')
  })

  it('floors negatives at zero', () => {
    expect(pad(-3)).toBe('000')
  })

  it('honours a custom width', () => {
    expect(pad(5, 2)).toBe('05')
    expect(pad(5, 5)).toBe('00005')
  })
})

describe('shareOf', () => {
  it('is the plain ratio inside the bar', () => {
    expect(shareOf(50, 100)).toBe(0.5)
    expect(shareOf(100, 100)).toBe(1)
    expect(shareOf(0, 100)).toBe(0)
  })

  it('clamps a value above the leader to a full bar', () => {
    expect(shareOf(150, 100)).toBe(1)
  })

  it('floors a negative value to an empty bar', () => {
    expect(shareOf(-5, 100)).toBe(0)
  })

  it('reads an empty or broken board as an empty bar', () => {
    expect(shareOf(5, 0)).toBe(0)
    expect(shareOf(5, -1)).toBe(0)
    expect(shareOf(5, NaN)).toBe(0)
    expect(shareOf(NaN, 100)).toBe(0)
    expect(shareOf(Infinity, 100)).toBe(0)
    expect(shareOf(5, Infinity)).toBe(0)
  })
})
