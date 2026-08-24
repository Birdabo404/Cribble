import { describe, expect, it } from 'vitest'
import {
  isLikelyBot,
  isTrackingDeclined,
  readVisitorPulse,
  visitorHash
} from './siteVisits'

describe('visitorHash', () => {
  it('returns a 64-char hex digest that changes with ip, ua, or salt', () => {
    const a = visitorHash('1.1.1.1', 'Mozilla/5.0', 'salt-a')
    const b = visitorHash('1.1.1.1', 'Mozilla/5.0', 'salt-a')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(visitorHash('1.1.1.2', 'Mozilla/5.0', 'salt-a')).not.toBe(a)
    expect(visitorHash('1.1.1.1', 'Mozilla/5.1', 'salt-a')).not.toBe(a)
    expect(visitorHash('1.1.1.1', 'Mozilla/5.0', 'salt-b')).not.toBe(a)
  })
})

describe('isLikelyBot', () => {
  it('treats empty and crawler user-agents as bots', () => {
    expect(isLikelyBot('')).toBe(true)
    expect(isLikelyBot('Googlebot/2.1')).toBe(true)
    expect(isLikelyBot('curl/8.0')).toBe(true)
    expect(isLikelyBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(
      false
    )
  })
})

describe('isTrackingDeclined', () => {
  it('honors DNT and Global Privacy Control', () => {
    expect(isTrackingDeclined(new Headers({ dnt: '1' }))).toBe(true)
    expect(isTrackingDeclined(new Headers({ 'sec-gpc': '1' }))).toBe(true)
    expect(isTrackingDeclined(new Headers({ dnt: '0' }))).toBe(false)
    expect(isTrackingDeclined(new Headers())).toBe(false)
  })
})

describe('readVisitorPulse', () => {
  it('reads the RPC table envelope', () => {
    expect(readVisitorPulse([{ live: 3, last12h: 41 }])).toEqual({
      live: 3,
      last12h: 41
    })
    expect(readVisitorPulse({ live: 0, last12h: 0 })).toEqual({
      live: 0,
      last12h: 0
    })
  })

  it('rejects missing or negative counts', () => {
    expect(readVisitorPulse(null)).toBeNull()
    expect(readVisitorPulse([])).toBeNull()
    expect(readVisitorPulse({ live: -1, last12h: 4 })).toBeNull()
    expect(readVisitorPulse({ live: 1 })).toBeNull()
  })
})
