import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SFX_VOLUME,
  SFX_MAX_VOICES,
  SFX_NAMES,
  SFX_THROTTLE_MS,
  canPlaySfx,
  clampSfxVolume,
  isSfxName,
  parseStoredSfxMuted,
  parseStoredSfxVolume
} from './sfx'

// Pure-logic coverage for the SFX engine: pref parsing (what a stored or
// mangled localStorage value means), the throttle/voice-cap gate, and the
// data-sfx name validation. The Web Audio graph itself is exercised by
// the offline render kit in .sfx-audition/, not here.

describe('clampSfxVolume', () => {
  it('passes in-range values through', () => {
    expect(clampSfxVolume(0.4)).toBe(0.4)
    expect(clampSfxVolume(0)).toBe(0)
    expect(clampSfxVolume(1)).toBe(1)
  })

  it('clamps to the 0–1 range', () => {
    expect(clampSfxVolume(1.2)).toBe(1)
    expect(clampSfxVolume(-1)).toBe(0)
  })

  it('rejects non-finite values in favor of the default', () => {
    expect(clampSfxVolume(Number.NaN)).toBe(DEFAULT_SFX_VOLUME)
    expect(clampSfxVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SFX_VOLUME)
    expect(clampSfxVolume(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_SFX_VOLUME)
  })
})

describe('parseStoredSfxVolume', () => {
  const cases: { name: string; raw: string | null; volume: number }[] = [
    { name: 'missing key falls back to the default', raw: null, volume: DEFAULT_SFX_VOLUME },
    { name: 'blank value reads as unset, not silent', raw: '   ', volume: DEFAULT_SFX_VOLUME },
    { name: 'empty string reads as unset, not silent', raw: '', volume: DEFAULT_SFX_VOLUME },
    { name: 'stored float round-trips', raw: '0.75', volume: 0.75 },
    { name: 'zero is a legitimate saved volume', raw: '0', volume: 0 },
    { name: 'full volume round-trips', raw: '1', volume: 1 },
    { name: 'out-of-range high clamps to 1', raw: '3.5', volume: 1 },
    { name: 'out-of-range low clamps to 0', raw: '-0.4', volume: 0 },
    { name: 'garbage falls back to the default', raw: 'loud', volume: DEFAULT_SFX_VOLUME }
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(parseStoredSfxVolume(c.raw)).toBe(c.volume)
    })
  }
})

describe('parseStoredSfxMuted', () => {
  it("only the literal '1' means muted", () => {
    expect(parseStoredSfxMuted('1')).toBe(true)
    expect(parseStoredSfxMuted('0')).toBe(false)
    expect(parseStoredSfxMuted('true')).toBe(false)
    expect(parseStoredSfxMuted(null)).toBe(false)
  })
})

// canPlaySfx is the whole rapid-fire story: the throttle keeps a mashed
// button from stuttering the same blip, the voice cap keeps a click storm
// from stacking into a wall of sound. Pin both edges of each gate.

describe('canPlaySfx', () => {
  it('a sound that has never fired plays', () => {
    expect(canPlaySfx(undefined, 1000, 0)).toBe(true)
  })

  it('re-triggering inside the throttle window is dropped', () => {
    expect(canPlaySfx(1000, 1000 + SFX_THROTTLE_MS - 1, 0)).toBe(false)
  })

  it('exactly at the window boundary plays again', () => {
    expect(canPlaySfx(1000, 1000 + SFX_THROTTLE_MS, 0)).toBe(true)
  })

  it('plays while there is voice headroom', () => {
    expect(canPlaySfx(undefined, 1000, SFX_MAX_VOICES - 1)).toBe(true)
  })

  it('drops the play once the voice cap is reached', () => {
    expect(canPlaySfx(undefined, 1000, SFX_MAX_VOICES)).toBe(false)
  })

  it('the voice cap wins even when the throttle window has long passed', () => {
    expect(canPlaySfx(1000, 999999, SFX_MAX_VOICES)).toBe(false)
  })
})

describe('isSfxName', () => {
  for (const name of SFX_NAMES) {
    it(`accepts the palette sound ${name}`, () => {
      expect(isSfxName(name)).toBe(true)
    })
  }

  it("rejects the data-sfx opt-out value 'off' — it is a directive, not a sound", () => {
    expect(isSfxName('off')).toBe(false)
  })

  it('rejects arbitrary attribute garbage', () => {
    expect(isSfxName('beep')).toBe(false)
    expect(isSfxName('')).toBe(false)
  })
})
