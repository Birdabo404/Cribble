import { describe, expect, it } from 'vitest'
import {
  capPercent,
  displayLink,
  inviteText,
  isReferralData,
  REFERRAL_CAP,
  REFERRAL_POINTS,
  referralPhase,
  type ReferralData,
  type ReferralPhase
} from './ReferralPlate'

// The modal's three render branches (link row, stat cells, cap readout)
// all switch on one phase, so the derivation is pinned here rather than
// read off the JSX. The copy constants are pinned too: the plate's
// numeral, the X intent and the footer all print them.

const data: ReferralData = {
  code: 'ACE-01',
  link: 'https://cribble.dev/join/ACE-01',
  stats: { joined: 3, rewarded: 2, pointsEarned: 3_000, capRemaining: 8 }
}

describe('referralPhase', () => {
  it.each<[string, ReferralData | null, boolean, ReferralPhase]>([
    ['nothing yet', null, false, 'loading'],
    ['fetch failed', null, true, 'failed'],
    ['link in hand', data, false, 'ready'],
    ['link in hand beats a stale failure flag', data, true, 'ready']
  ])('%s', (_, d, failed, expected) => {
    expect(referralPhase(d, failed)).toBe(expected)
  })
})

describe('isReferralData', () => {
  it('accepts the route payload', () => {
    expect(isReferralData(data)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'https://cribble.dev/join/ACE-01'],
    ['no link', { code: 'ACE-01', stats: data.stats }],
    ['no code', { link: data.link, stats: data.stats }],
    ['no stats', { code: 'ACE-01', link: data.link }],
    ['stats not an object', { ...data, stats: 4 }],
    ['a numeral missing', { ...data, stats: { joined: 3, rewarded: 2, pointsEarned: 3_000 } }],
    ['a numeral as a string', { ...data, stats: { ...data.stats, joined: '3' } }]
  ])('rejects %s', (_, d) => {
    expect(isReferralData(d)).toBe(false)
  })
})

describe('displayLink', () => {
  it.each<[string, string]>([
    ['https://cribble.dev/join/ACE-01', 'cribble.dev/join/ACE-01'],
    ['http://localhost:3000/join/ACE-01', 'localhost:3000/join/ACE-01'],
    ['HTTPS://CRIBBLE.DEV/join/x', 'CRIBBLE.DEV/join/x'],
    ['cribble.dev/join/ACE-01', 'cribble.dev/join/ACE-01']
  ])('%s -> %s', (link, expected) => {
    expect(displayLink(link)).toBe(expected)
  })
})

describe('capPercent', () => {
  it('maps rewarded recruits onto the cap', () => {
    expect(capPercent(0)).toBe(0)
    expect(capPercent(REFERRAL_CAP / 2)).toBe(50)
    expect(capPercent(REFERRAL_CAP)).toBe(100)
  })

  it('clamps past the cap and below zero', () => {
    expect(capPercent(REFERRAL_CAP + 5)).toBe(100)
    expect(capPercent(-1)).toBe(0)
  })
})

describe('reward copy', () => {
  it('keeps the +1,500 / first-10 mechanics', () => {
    expect(REFERRAL_POINTS).toBe(1_500)
    expect(REFERRAL_CAP).toBe(10)
  })

  it('posts the link itself, on its own line, in the X intent', () => {
    const text = inviteText(data.link)
    expect(text.endsWith(`\n\n${data.link}`)).toBe(true)
    expect(text).toMatch(/leaderboard/i)
    expect(encodeURIComponent(text)).toContain(encodeURIComponent(data.link))
  })
})
