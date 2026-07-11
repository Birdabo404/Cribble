import { describe, expect, it } from 'vitest'
import {
  formatMilestoneLabel,
  pickRankBucket,
  pickScoreMilestone
} from './notifications'

describe('pickRankBucket', () => {
  it('returns the tightest bucket the rank qualifies for', () => {
    expect(pickRankBucket(1)).toBe(1)
    expect(pickRankBucket(2)).toBe(2)
    expect(pickRankBucket(3)).toBe(3)
    expect(pickRankBucket(4)).toBe(10)
    expect(pickRankBucket(10)).toBe(10)
    expect(pickRankBucket(11)).toBe(25)
    expect(pickRankBucket(26)).toBe(50)
    expect(pickRankBucket(50)).toBe(50)
  })

  it('returns null outside all buckets or for invalid ranks', () => {
    expect(pickRankBucket(51)).toBeNull()
    expect(pickRankBucket(0)).toBeNull()
    expect(pickRankBucket(-3)).toBeNull()
    expect(pickRankBucket(NaN)).toBeNull()
  })
})

describe('pickScoreMilestone', () => {
  it('returns the highest threshold at or below the score', () => {
    expect(pickScoreMilestone(999)).toBeNull()
    expect(pickScoreMilestone(1_000)).toBe(1_000)
    expect(pickScoreMilestone(4_999)).toBe(1_000)
    expect(pickScoreMilestone(60_000)).toBe(50_000)
    expect(pickScoreMilestone(2_000_000)).toBe(1_000_000)
  })

  it('returns null for non-positive or invalid scores', () => {
    expect(pickScoreMilestone(0)).toBeNull()
    expect(pickScoreMilestone(-10)).toBeNull()
    expect(pickScoreMilestone(NaN)).toBeNull()
  })
})

describe('formatMilestoneLabel', () => {
  it('renders compact labels for the milestone tiers', () => {
    expect(formatMilestoneLabel(1_000)).toBe('1K')
    expect(formatMilestoneLabel(25_000)).toBe('25K')
    expect(formatMilestoneLabel(1_000_000)).toBe('1M')
    expect(formatMilestoneLabel(500)).toBe('500')
  })
})
