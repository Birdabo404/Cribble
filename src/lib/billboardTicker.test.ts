import { describe, expect, it } from 'vitest'
import {
  BILLBOARD_AD_HOLD_MS,
  BILLBOARD_AD_SHOW_FOR_MS,
  BILLBOARD_AD_SOLO_REPLAY_MS,
  BILLBOARD_HYPE_HOLD_MS,
  BILLBOARD_HYPE_SHOW_FOR_MS,
  billboardChrome,
  billboardHoldMs,
  billboardShouldCloseAfterHold,
  billboardShowForMs,
  classifyHype,
  crownEventKey,
  freshCrownKey,
  hasCrownHype,
  hypeCopy,
  hypeMedalVar,
  isAnnouncementOnly,
  pickDisplacedUserId
} from './billboard'
import type { BillboardHypeItem, BillboardItem } from './billboard'

const hype = (
  userId: number,
  overrides: Partial<Omit<BillboardHypeItem, 'kind' | 'userId'>> = {}
): BillboardHypeItem => ({
  kind: 'hype',
  variant: 'podium',
  userId,
  username: `pilot${userId}`,
  displayName: null,
  avatarUrl: null,
  rank: 3,
  prevRank: 10,
  movedAt: '2026-08-21T00:00:00.000Z',
  displaced: null,
  ...overrides
})

const ad = (id: number): BillboardItem => ({
  kind: 'ad',
  id,
  text: 'Ship faster',
  companyName: 'Acme',
  linkHost: 'acme.dev',
  logoUrl: null,
  accentColor: null
})

describe('isAnnouncementOnly', () => {
  it('is true only when every item is hype', () => {
    expect(isAnnouncementOnly([hype(1)])).toBe(true)
    expect(isAnnouncementOnly([hype(1), hype(2), hype(3)])).toBe(true)
    expect(isAnnouncementOnly([hype(1), ad(10)])).toBe(false)
    expect(isAnnouncementOnly([ad(10)])).toBe(false)
  })

  it('is false for an empty train', () => {
    expect(isAnnouncementOnly([])).toBe(false)
  })
})

describe('billboardHoldMs', () => {
  it('gives hype its announcement beat, solo or not — never the solo-ad replay cadence', () => {
    expect(billboardHoldMs(hype(1), true)).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardHoldMs(hype(1), false)).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(BILLBOARD_HYPE_HOLD_MS).toBeLessThan(BILLBOARD_AD_SOLO_REPLAY_MS)
  })

  it('holds a multi-train ad for the full rotation and a solo ad for the replay cadence', () => {
    expect(billboardHoldMs(ad(10), true)).toBe(BILLBOARD_AD_HOLD_MS)
    expect(billboardHoldMs(ad(10), false)).toBe(BILLBOARD_AD_SOLO_REPLAY_MS)
  })
})

describe('billboardShowForMs', () => {
  it('any paid ad buys the full sponsored show', () => {
    expect(billboardShowForMs([ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
    expect(billboardShowForMs([hype(1), ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
    expect(billboardShowForMs([hype(1), hype(2), ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
  })

  it('announcement-only trains get one hold per item', () => {
    expect(billboardShowForMs([hype(1)])).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([hype(1), hype(2)])).toBe(2 * BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([hype(1), hype(2), hype(3)])).toBe(3 * BILLBOARD_HYPE_HOLD_MS)
  })

  it('caps announcement-only shows at the hype ceiling', () => {
    const six = [hype(1), hype(2), hype(3), hype(4), hype(5), hype(6)]
    expect(billboardShowForMs(six)).toBe(BILLBOARD_HYPE_SHOW_FOR_MS)
    expect(BILLBOARD_HYPE_SHOW_FOR_MS).toBeLessThan(BILLBOARD_AD_SHOW_FOR_MS)
  })

  it('fits a full pass of the API max (3 hype items) inside the ceiling', () => {
    expect(3 * BILLBOARD_HYPE_HOLD_MS).toBeLessThanOrEqual(BILLBOARD_HYPE_SHOW_FOR_MS)
  })
})

describe('billboardChrome', () => {
  it('labels a crown takeover CROWN, not a sponsor', () => {
    expect(billboardChrome(hype(1, { variant: 'crown', rank: 1, prevRank: 2 }))).toEqual({
      label: 'CROWN',
      ariaLabel: 'Crown change'
    })
  })

  it('labels a podium entry PODIUM, not a sponsor', () => {
    expect(billboardChrome(hype(2, { variant: 'podium', rank: 2, prevRank: 8 }))).toEqual({
      label: 'PODIUM',
      ariaLabel: 'Podium announcement'
    })
  })

  it('keeps the sponsor chrome for paid ads', () => {
    expect(billboardChrome(ad(10))).toEqual({ label: 'SPONSOR', ariaLabel: 'Sponsorship' })
  })
})

describe('billboardShouldCloseAfterHold', () => {
  it('closes an announcement-only train after its last item, including solo', () => {
    expect(billboardShouldCloseAfterHold([hype(1)], 0)).toBe(true)
    expect(billboardShouldCloseAfterHold([hype(1), hype(2), hype(3)], 2)).toBe(true)
  })

  it('does not close mid-pass', () => {
    expect(billboardShouldCloseAfterHold([hype(1), hype(2), hype(3)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), hype(2), hype(3)], 1)).toBe(false)
  })

  it('never closes a train carrying a paid ad — the sponsored loop owns the clock', () => {
    expect(billboardShouldCloseAfterHold([ad(10)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), ad(10)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), ad(10)], 1)).toBe(false)
    expect(billboardShouldCloseAfterHold([ad(10), ad(11)], 1)).toBe(false)
  })
})

describe('classifyHype', () => {
  it('marks a new #1 from anywhere as crown, including #2→#1', () => {
    expect(classifyHype(1, 2)).toBe('crown')
    expect(classifyHype(1, 8)).toBe('crown')
  })

  it('marks #2/#3 from outside the top 3 as podium', () => {
    expect(classifyHype(2, 8)).toBe('podium')
    expect(classifyHype(3, 12)).toBe('podium')
  })

  it('ignores intra-podium swaps, drops, and never-moved rows', () => {
    expect(classifyHype(2, 3)).toBeNull()
    expect(classifyHype(3, 2)).toBeNull()
    expect(classifyHype(1, 1)).toBeNull()
    expect(classifyHype(4, 10)).toBeNull()
    expect(classifyHype(2, 1)).toBeNull()
    expect(classifyHype(1, null)).toBeNull()
  })
})

describe('hypeCopy', () => {
  it('names the fallen #1 on a crown card', () => {
    expect(
      hypeCopy(
        hype(7, {
          variant: 'crown',
          rank: 1,
          prevRank: 2,
          username: 'challenger',
          displayName: 'Challenger',
          displaced: { username: 'birdabo404', displayName: 'Birdabo', avatarUrl: null }
        })
      )
    ).toEqual({
      title: 'Challenger',
      prefix: 'dethroned @birdabo404 — now ',
      emphasis: '#1',
      suffix: ''
    })
  })

  it('falls back to seized-the-crown copy when no victim is known', () => {
    expect(
      hypeCopy(
        hype(7, {
          variant: 'crown',
          rank: 1,
          prevRank: 4,
          username: 'challenger',
          displayName: null,
          displaced: null
        })
      )
    ).toEqual({
      title: 'challenger',
      prefix: 'seized the crown — now ',
      emphasis: '#1',
      suffix: ''
    })
  })

  it('claims #2 and storms #3 on podium entries', () => {
    expect(hypeCopy(hype(2, { variant: 'podium', rank: 2, prevRank: 8, displayName: 'Silver' }))).toEqual({
      title: 'Silver',
      prefix: 'claimed ',
      emphasis: '#2',
      suffix: ''
    })
    expect(hypeCopy(hype(3, { variant: 'podium', rank: 3, prevRank: 11 }))).toEqual({
      title: 'pilot3',
      prefix: 'stormed the podium at ',
      emphasis: '#3',
      suffix: ''
    })
  })
})

describe('hypeMedalVar', () => {
  it('maps podium ranks to the board medal tokens', () => {
    expect(hypeMedalVar(1)).toBe('--lb-gold')
    expect(hypeMedalVar(2)).toBe('--lb-silver')
    expect(hypeMedalVar(3)).toBe('--lb-bronze')
  })
})

describe('pickDisplacedUserId', () => {
  it('picks the fallen #1 closest in time to the takeover, never the challenger', () => {
    expect(
      pickDisplacedUserId(7, '2026-08-21T12:00:00.000Z', [
        { userId: 7, movedAt: '2026-08-21T12:00:00.000Z' },
        { userId: 3, movedAt: '2026-08-21T11:59:00.000Z' },
        { userId: 9, movedAt: '2026-08-20T08:00:00.000Z' }
      ])
    ).toBe(3)
  })

  it('returns null when no other fallen #1 exists', () => {
    expect(pickDisplacedUserId(7, '2026-08-21T12:00:00.000Z', [])).toBeNull()
    expect(
      pickDisplacedUserId(7, '2026-08-21T12:00:00.000Z', [
        { userId: 7, movedAt: '2026-08-21T12:00:00.000Z' }
      ])
    ).toBeNull()
  })
})

describe('freshCrownKey', () => {
  const crown = hype(7, { variant: 'crown', rank: 1, prevRank: 2, movedAt: '2026-08-21T12:00:00.000Z' })

  it('is true only when the train names a new #1', () => {
    expect(hasCrownHype([crown])).toBe(true)
    expect(hasCrownHype([hype(2), ad(10)])).toBe(false)
    expect(hasCrownHype([])).toBe(false)
  })

  it('returns a new takeover key and ignores one this visitor already aired', () => {
    expect(freshCrownKey([crown, ad(10)], null)).toBe(crownEventKey(crown))
    expect(freshCrownKey([crown], crownEventKey(crown))).toBeNull()
    expect(freshCrownKey([hype(2)], null)).toBeNull()
  })
})
