import { describe, expect, it } from 'vitest'
import {
  BILLBOARD_AD_HOLD_MS,
  BILLBOARD_AD_SHOW_FOR_MS,
  BILLBOARD_AD_SOLO_REPLAY_MS,
  BILLBOARD_HYPE_HOLD_MS,
  BILLBOARD_HYPE_SHOW_FOR_MS,
  HYPE_LADDER_MAX_RUNGS,
  billboardChrome,
  billboardHoldMs,
  billboardHypeSentence,
  billboardRankClimb,
  billboardShouldCloseAfterHold,
  billboardShowForMs,
  hypeRankLadder,
  isAnnouncementOnly
} from './billboard'
import type { BillboardHypeItem, BillboardItem } from './billboard'

const hype = (userId: number, rank = 2, prevRank = 7): BillboardHypeItem => ({
  kind: 'hype',
  userId,
  username: `pilot${userId}`,
  displayName: null,
  avatarUrl: null,
  rank,
  prevRank,
  movedAt: '2026-08-21T00:00:00.000Z'
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
    // Distinct constants keep the two assertions above discriminating.
    // The beat itself may outlast the solo replay cadence: what keeps
    // free hype short of a sponsor's airtime is the one-pass close, so
    // even a full pass of the API's max train ends inside one
    // sponsored show.
    expect(BILLBOARD_HYPE_HOLD_MS).not.toBe(BILLBOARD_AD_SOLO_REPLAY_MS)
    expect(billboardShowForMs([hype(1), hype(2), hype(3)])).toBeLessThan(BILLBOARD_AD_SHOW_FOR_MS)
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
  it('labels hype as an announcement, not a sponsor', () => {
    expect(billboardChrome(hype(1))).toEqual({
      label: 'ANNOUNCEMENT',
      ariaLabel: 'Announcement'
    })
  })

  it('keeps the sponsor chrome for paid ads', () => {
    expect(billboardChrome(ad(10))).toEqual({ label: 'SPONSOR', ariaLabel: 'Sponsorship' })
  })
})

describe('billboardRankClimb', () => {
  it('derives from/to/places from the item', () => {
    expect(billboardRankClimb(hype(1, 2, 7))).toEqual({ from: 7, to: 2, places: 5 })
    expect(billboardRankClimb(hype(1, 3, 4))).toEqual({ from: 4, to: 3, places: 1 })
    expect(billboardRankClimb(hype(1, 1, 50))).toEqual({ from: 50, to: 1, places: 49 })
  })

  it('clamps a non-climb to zero places instead of going negative', () => {
    expect(billboardRankClimb(hype(1, 3, 3)).places).toBe(0)
    expect(billboardRankClimb(hype(1, 3, 2)).places).toBe(0)
  })
})

describe('hypeRankLadder', () => {
  it('steps every rank on short climbs, from first and to last', () => {
    expect(hypeRankLadder(7, 2)).toEqual([7, 6, 5, 4, 3, 2])
    expect(hypeRankLadder(4, 3)).toEqual([4, 3])
  })

  it('resolves a non-climb straight to the landing', () => {
    expect(hypeRankLadder(2, 2)).toEqual([2])
    expect(hypeRankLadder(1, 3)).toEqual([3])
  })

  it('starts compressing exactly past a full ladder', () => {
    // span 7 still fits the cap uncompressed; span 8 is the first squeeze.
    expect(hypeRankLadder(9, 2)).toEqual([9, 8, 7, 6, 5, 4, 3, 2])
    expect(hypeRankLadder(10, 2)).toHaveLength(HYPE_LADDER_MAX_RUNGS)
  })

  it('compresses freak jumps to the rung cap with exact endpoints, strictly descending', () => {
    for (const [from, to] of [
      [120, 1],
      [50, 3],
      [11, 2]
    ]) {
      const ladder = hypeRankLadder(from, to)
      expect(ladder).toHaveLength(HYPE_LADDER_MAX_RUNGS)
      expect(ladder[0]).toBe(from)
      expect(ladder[ladder.length - 1]).toBe(to)
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i]).toBeLessThan(ladder[i - 1])
      }
    }
  })
})

describe('billboardHypeSentence', () => {
  it('prefers the display name', () => {
    expect(billboardHypeSentence({ ...hype(1, 2, 7), displayName: 'SUI' })).toBe(
      'SUI climbed from rank 7 to rank 2'
    )
  })

  it('falls back to the username', () => {
    expect(billboardHypeSentence(hype(1, 3, 9))).toBe('pilot1 climbed from rank 9 to rank 3')
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
