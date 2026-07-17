import { describe, expect, it } from 'vitest'
import {
  DEMOTION_COOLDOWN_MS,
  demotionDedupeKey,
  formatMilestoneLabel,
  pickLostBucket,
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

describe('pickLostBucket', () => {
  it('returns the tightest bucket lost when a drop crosses its boundary', () => {
    expect(pickLostBucket(1, 2)).toBe(1)
    expect(pickLostBucket(3, 4)).toBe(3)
    expect(pickLostBucket(10, 11)).toBe(10)
    expect(pickLostBucket(10, 25)).toBe(10)
    expect(pickLostBucket(3, 51)).toBe(3)
    expect(pickLostBucket(11, 26)).toBe(25)
  })

  it('returns null when no bucket was lost', () => {
    expect(pickLostBucket(4, 10)).toBeNull() // same bucket
    expect(pickLostBucket(12, 5)).toBeNull() // promotion
    expect(pickLostBucket(51, 120)).toBeNull() // no bucket held
  })

  it('returns null for invalid ranks', () => {
    expect(pickLostBucket(NaN, 5)).toBeNull()
    expect(pickLostBucket(0, 5)).toBeNull()
    expect(pickLostBucket(-1, 5)).toBeNull()
  })
})

describe('demotionDedupeKey', () => {
  it('is stable for two timestamps inside the same 48h window', () => {
    const windowStart = new Date(10 * DEMOTION_COOLDOWN_MS)
    const windowEnd = new Date(11 * DEMOTION_COOLDOWN_MS - 1)
    expect(demotionDedupeKey(10, windowStart)).toBe('rank_drop_10_10')
    expect(demotionDedupeKey(10, windowEnd)).toBe(demotionDedupeKey(10, windowStart))
  })

  it('changes across the window boundary', () => {
    const beforeBoundary = new Date(11 * DEMOTION_COOLDOWN_MS - 1)
    const afterBoundary = new Date(11 * DEMOTION_COOLDOWN_MS)
    expect(demotionDedupeKey(10, afterBoundary)).not.toBe(
      demotionDedupeKey(10, beforeBoundary)
    )
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
