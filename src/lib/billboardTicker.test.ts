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
  isAnnouncementOnly
} from './billboard'
import type { BillboardItem } from './billboard'

const hype = (userId: number): BillboardItem => ({
  kind: 'hype',
  userId,
  username: `pilot${userId}`,
  displayName: null,
  avatarUrl: null,
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

const announce = (id: number): BillboardItem => ({
  kind: 'announce',
  id,
  headline: 'Season two is live',
  body: 'Fresh board, fresh ranks — the climb starts now.',
  linkUrl: null
})

describe('isAnnouncementOnly', () => {
  it('is true only when every item is hype', () => {
    expect(isAnnouncementOnly([hype(1)])).toBe(true)
    expect(isAnnouncementOnly([hype(1), hype(2), hype(3)])).toBe(true)
    expect(isAnnouncementOnly([hype(1), ad(10)])).toBe(false)
    expect(isAnnouncementOnly([ad(10)])).toBe(false)
  })

  it('counts operator announcements as announcements, alone or mixed with hype', () => {
    expect(isAnnouncementOnly([announce(1)])).toBe(true)
    expect(isAnnouncementOnly([announce(1), hype(2), hype(3)])).toBe(true)
  })

  it('is false once an ad boards an announce train', () => {
    expect(isAnnouncementOnly([announce(1), ad(10)])).toBe(false)
    expect(isAnnouncementOnly([announce(1), hype(2), ad(10)])).toBe(false)
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

  it('gives an operator announcement the hype beat, solo or not', () => {
    expect(billboardHoldMs(announce(1), true)).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardHoldMs(announce(1), false)).toBe(BILLBOARD_HYPE_HOLD_MS)
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

  it('operator announcements ride the same free-copy math — an ad aboard still buys the loop', () => {
    expect(billboardShowForMs([announce(1)])).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([announce(1), hype(2)])).toBe(2 * BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([announce(1), ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
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

  it('labels an operator announcement as an announcement, never a sponsor', () => {
    expect(billboardChrome(announce(1))).toEqual({
      label: 'ANNOUNCEMENT',
      ariaLabel: 'Announcement'
    })
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

  it('closes announce-only and mixed announce+hype trains after one pass, like hype', () => {
    expect(billboardShouldCloseAfterHold([announce(1)], 0)).toBe(true)
    expect(billboardShouldCloseAfterHold([announce(1), hype(2), hype(3)], 2)).toBe(true)
    expect(billboardShouldCloseAfterHold([announce(1), hype(2), hype(3)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([announce(1), hype(2), hype(3)], 1)).toBe(false)
  })

  it('never closes a train carrying a paid ad — the sponsored loop owns the clock', () => {
    expect(billboardShouldCloseAfterHold([ad(10)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), ad(10)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), ad(10)], 1)).toBe(false)
    expect(billboardShouldCloseAfterHold([ad(10), ad(11)], 1)).toBe(false)
    expect(billboardShouldCloseAfterHold([announce(1), ad(10)], 1)).toBe(false)
  })
})
