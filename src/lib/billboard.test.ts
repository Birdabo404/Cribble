import { describe, expect, it } from 'vitest'
import { isAnnouncementOnly } from './billboard'
import type { BillboardItem } from './billboard'

// The train's one membership predicate: every kind aboard is free copy,
// so "announcement-only" is exactly "has anything to announce". The
// cadence/chrome contract built on it lives in billboardTicker.test.ts.

const hype: BillboardItem = {
  kind: 'hype',
  id: 1,
  board: 'score',
  tier: 'top3',
  userId: 1,
  username: 'pilot1',
  displayName: null,
  avatarUrl: null,
  rank: 2,
  prevRank: 7,
  movedAt: '2026-08-21T00:00:00.000Z',
  burnUsd: null
}

const announce: BillboardItem = {
  kind: 'announce',
  id: 1,
  headline: 'Season two is live',
  body: 'Fresh board, fresh ranks — the climb starts now.',
  linkUrl: null
}

describe('isAnnouncementOnly', () => {
  it('is false for an empty train — nothing aboard is nobody\'s announcement', () => {
    expect(isAnnouncementOnly([])).toBe(false)
  })

  it('is true for a mixed hype + announce train', () => {
    expect(isAnnouncementOnly([announce, hype])).toBe(true)
  })
})
