import { describe, expect, it } from 'vitest'
import {
  CURSOR_VERIFY_CODE_PATTERN,
  displayNameHasVerifyCode,
  generateCursorVerifyCode
} from './cursorVerify'

describe('generateCursorVerifyCode', () => {
  it('always mints CRIB- plus 4 unambiguous uppercase alphanumerics', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCursorVerifyCode()
      expect(code).toMatch(CURSOR_VERIFY_CODE_PATTERN)
      // The pattern already excludes them — spell the lookalikes out so
      // a loosened pattern cannot silently re-admit 0/O/1/I. Only the
      // random suffix: the CRIB- prefix itself carries an I.
      expect(code.slice('CRIB-'.length)).not.toMatch(/[0O1I]/)
    }
  })

  it('varies between mints', () => {
    const codes = new Set(Array.from({ length: 64 }, () => generateCursorVerifyCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('displayNameHasVerifyCode', () => {
  it('finds the code anywhere in the display name', () => {
    expect(displayNameHasVerifyCode('CRIB-7XK2', 'CRIB-7XK2')).toBe(true)
    expect(displayNameHasVerifyCode('sui 🧠 CRIB-7XK2', 'CRIB-7XK2')).toBe(true)
    expect(displayNameHasVerifyCode('[CRIB-7XK2] birdabo', 'CRIB-7XK2')).toBe(true)
  })

  it('matches case-insensitively — editors re-case pasted text', () => {
    expect(displayNameHasVerifyCode('birdabo crib-7xk2', 'CRIB-7XK2')).toBe(true)
  })

  it('rejects a missing, partial, or different code', () => {
    expect(displayNameHasVerifyCode(null, 'CRIB-7XK2')).toBe(false)
    expect(displayNameHasVerifyCode('birdabo', 'CRIB-7XK2')).toBe(false)
    expect(displayNameHasVerifyCode('CRIB-7XK', 'CRIB-7XK2')).toBe(false)
    expect(displayNameHasVerifyCode('CRIB-2222', 'CRIB-7XK2')).toBe(false)
  })

  it('never matches a malformed stored code', () => {
    // An empty code would "contain" into every display name.
    expect(displayNameHasVerifyCode('anything at all', '')).toBe(false)
    // Lookalike glyphs cannot appear in a real code.
    expect(displayNameHasVerifyCode('CRIB-70K2', 'CRIB-70K2')).toBe(false)
    expect(displayNameHasVerifyCode('crib-7xk2 CRIB-7XK2', 'crib-7xk2')).toBe(false)
  })
})
