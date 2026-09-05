import { describe, expect, it } from 'vitest'
import { DECODE_GLYPHS, DECODE_RESOLVE_RATE, scrambleFrame } from './decodeText'

// The boot timeline writes this string every tick, so it must be cheap,
// deterministic, and land on the exact text — a stray glyph at the end
// of the name would be the most visible bug on the page.

const glyphs = new Set(DECODE_GLYPHS)
const isGlyph = (ch: string) => glyphs.has(ch)

describe('scrambleFrame', () => {
  it('at progress 0 every non-space character is a glyph and spaces survive', () => {
    const text = 'UNIT RECORD 2B'
    const out = scrambleFrame(text, 0, 0)
    expect(out).toHaveLength(text.length)
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ') expect(out[i]).toBe(' ')
      else expect(isGlyph(out[i])).toBe(true)
    }
  })

  it('at progress 1 returns the text itself', () => {
    expect(scrambleFrame('Birdabo', 1, 3)).toBe('Birdabo')
    expect(scrambleFrame('Birdabo', 1.5, 3)).toBe('Birdabo')
  })

  it('resolves fully once the rate has covered every character (matches useDecode)', () => {
    const text = 'ABCDEFGHIJ' // 10 chars: resolved = floor(p * 11.2) >= 10 once p >= ~0.893
    expect(scrambleFrame(text, 0.9, 1)).toBe(text)
    expect(scrambleFrame(text, 0.85, 1)).not.toBe(text)
    expect(scrambleFrame(text, 0.85, 1).slice(0, 9)).toBe(text.slice(0, 9))
  })

  it('resolves a growing left-to-right prefix as progress increases', () => {
    const text = 'CRIBBLE PILOT'
    let lastResolved = -1
    for (let step = 0; step <= 20; step++) {
      const p = step / 20
      const out = scrambleFrame(text, p, step)
      const expected = Math.min(text.length, Math.floor(p * text.length * DECODE_RESOLVE_RATE))
      // The first `expected` characters are the real ones …
      expect(out.slice(0, expected)).toBe(text.slice(0, expected))
      // … and everything after is a glyph or a preserved space.
      for (let i = expected; i < text.length; i++) {
        if (text[i] === ' ') expect(out[i]).toBe(' ')
        else expect(isGlyph(out[i])).toBe(true)
      }
      expect(expected).toBeGreaterThanOrEqual(lastResolved)
      lastResolved = expected
    }
  })

  it('never changes the length', () => {
    for (const text of ['', 'x', 'two words', 'a  double  space']) {
      for (let step = 0; step <= 10; step++) {
        expect(scrambleFrame(text, step / 10, step)).toHaveLength(text.length)
      }
    }
  })

  it('is deterministic for the same (text, progress, frame)', () => {
    expect(scrambleFrame('DETERMINISM', 0.3, 7)).toBe(scrambleFrame('DETERMINISM', 0.3, 7))
  })

  it('a different frame picks different glyphs (the flicker)', () => {
    const a = scrambleFrame('FLICKER FLICKER', 0, 1)
    const b = scrambleFrame('FLICKER FLICKER', 0, 2)
    expect(a).not.toBe(b)
  })

  it('uses the useDecode glyph rule: index (i * 31 + frame * 7) mod glyph count', () => {
    const text = 'ABC'
    const frame = 5
    const out = scrambleFrame(text, 0, frame)
    for (let i = 0; i < text.length; i++) {
      expect(out[i]).toBe(DECODE_GLYPHS[(i * 31 + frame * 7) % DECODE_GLYPHS.length])
    }
  })

  it('treats negative progress as 0 and tolerates odd frames', () => {
    expect(scrambleFrame('AB', -1, 0)).toBe(scrambleFrame('AB', 0, 0))
    expect(scrambleFrame('AB', 0, -3)).toBe(scrambleFrame('AB', 0, 3))
    expect(scrambleFrame('AB', 0, NaN)).toBe(scrambleFrame('AB', 0, 0))
    expect(scrambleFrame('AB', 0, 2.9)).toBe(scrambleFrame('AB', 0, 2))
  })

  it('handles the empty string', () => {
    expect(scrambleFrame('', 0, 0)).toBe('')
    expect(scrambleFrame('', 0.5, 4)).toBe('')
  })
})
