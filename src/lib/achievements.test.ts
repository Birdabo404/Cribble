import { describe, expect, it } from 'vitest'
import { PIXEL_GRIDS } from '@/components/achievements/pixelIcons'
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  ACHIEVEMENT_CATEGORIES,
  EMPTY_ACHIEVEMENT_STATS,
  computeAchievementStats,
  isAchievementUnlocked,
  longestStreakFromDayKeys,
  unlockedAchievementIds,
  type AchievementEvent,
  type AchievementStats
} from './achievements'
import { scoreFromEvents } from './scoring'

const statsWith = (overrides: Partial<AchievementStats>): AchievementStats => ({
  ...EMPTY_ACHIEVEMENT_STATS,
  ...overrides
})

const def = (id: string) => {
  const found = ACHIEVEMENTS_BY_ID.get(id)
  if (!found) throw new Error(`Unknown achievement: ${id}`)
  return found
}

describe('achievement catalog integrity', () => {
  it('has unique ids and positive targets', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACHIEVEMENTS) {
      expect(a.target).toBeGreaterThan(0)
      expect(ACHIEVEMENT_CATEGORIES).toContain(a.category)
    }
  })

  it('references only icons that exist as valid 12x12 pixel grids', () => {
    for (const a of ACHIEVEMENTS) {
      const grid = PIXEL_GRIDS[a.icon]
      expect(grid, `missing grid for icon "${a.icon}"`).toBeDefined()
      expect(grid).toHaveLength(12)
      for (const row of grid) {
        expect(row).toHaveLength(12)
        expect(row).toMatch(/^[.Xo]{12}$/)
      }
    }
  })

  it('unlocks nothing on empty stats', () => {
    expect(unlockedAchievementIds(EMPTY_ACHIEVEMENT_STATS)).toEqual([])
  })
})

describe('unlock conditions', () => {
  it('unlocks score milestones at their thresholds', () => {
    expect(isAchievementUnlocked(def('score_1k'), statsWith({ totalScore: 999 }))).toBe(false)
    expect(isAchievementUnlocked(def('score_1k'), statsWith({ totalScore: 1_000 }))).toBe(true)
    expect(isAchievementUnlocked(def('score_1m'), statsWith({ totalScore: 999_999 }))).toBe(false)
    expect(isAchievementUnlocked(def('score_1m'), statsWith({ totalScore: 1_000_000 }))).toBe(true)
  })

  it('uses the longest streak, not the current one', () => {
    expect(isAchievementUnlocked(def('streak_7'), statsWith({ longestStreak: 6 }))).toBe(false)
    expect(isAchievementUnlocked(def('streak_7'), statsWith({ longestStreak: 7 }))).toBe(true)
  })

  it('treats rank achievements as binary and never unlocks them unranked', () => {
    expect(isAchievementUnlocked(def('rank_top10'), statsWith({ rank: null }))).toBe(false)
    expect(isAchievementUnlocked(def('rank_top10'), statsWith({ rank: 11 }))).toBe(false)
    expect(isAchievementUnlocked(def('rank_top10'), statsWith({ rank: 10 }))).toBe(true)
    expect(isAchievementUnlocked(def('rank_1'), statsWith({ rank: 2 }))).toBe(false)
    expect(isAchievementUnlocked(def('rank_1'), statsWith({ rank: 1 }))).toBe(true)
  })

  it('unlocks first_sync from a single event', () => {
    expect(isAchievementUnlocked(def('first_sync'), statsWith({ totalEvents: 1 }))).toBe(true)
  })
})

describe('longestStreakFromDayKeys', () => {
  it('returns 0 for no days and 1 for a single day', () => {
    expect(longestStreakFromDayKeys([])).toBe(0)
    expect(longestStreakFromDayKeys(['2026-07-01'])).toBe(1)
  })

  it('finds the longest consecutive run across gaps', () => {
    expect(
      longestStreakFromDayKeys([
        '2026-07-01',
        '2026-07-02',
        // gap
        '2026-07-04',
        '2026-07-05',
        '2026-07-06'
      ])
    ).toBe(3)
  })

  it('handles unsorted and duplicate keys', () => {
    expect(
      longestStreakFromDayKeys(['2026-07-03', '2026-07-01', '2026-07-02', '2026-07-02'])
    ).toBe(3)
  })

  it('counts month boundaries as consecutive', () => {
    expect(longestStreakFromDayKeys(['2026-06-30', '2026-07-01'])).toBe(2)
  })
})

describe('computeAchievementStats', () => {
  const event = (overrides: Partial<AchievementEvent>): AchievementEvent => ({
    timestamp: '2026-07-01T10:00:00.000Z',
    domain: 'claude.ai',
    active_ms: 60_000,
    total_ms: 60_000,
    visits: 1,
    ...overrides
  })

  it('returns empty stats for no events', () => {
    const stats = computeAchievementStats([], { totalScore: 0, rank: null })
    expect(stats).toEqual(EMPTY_ACHIEVEMENT_STATS)
  })

  it('counts distinct tools by resolved name, merging alias domains', () => {
    const stats = computeAchievementStats(
      [
        event({ domain: 'chat.openai.com' }),
        event({ domain: 'chatgpt.com' }),
        event({ domain: 'claude.ai' }),
        event({ domain: 'cursor.com' })
      ],
      { totalScore: 100, rank: null }
    )
    // chat.openai.com + chatgpt.com both resolve to ChatGPT
    expect(stats.distinctTools).toBe(3)
    expect(stats.totalVisits).toBe(4)
    expect(stats.totalEvents).toBe(4)
  })

  it('counts deep sessions at the 10-minute active threshold', () => {
    // Heartbeat rows (visits: 0) carry the verified active time; distinct
    // domains keep each row its own session.
    const stats = computeAchievementStats(
      [
        event({ domain: 'claude.ai', visits: 0, active_ms: 599_999, total_ms: 599_999 }),
        event({ domain: 'chatgpt.com', visits: 0, active_ms: 600_000, total_ms: 600_000 }),
        event({ domain: 'cursor.com', visits: 0, active_ms: 1_800_000, total_ms: 2_000_000 })
      ],
      { totalScore: 0, rank: null }
    )
    expect(stats.deepSessions).toBe(2)
  })

  it('derives day buckets: active days, longest streak, and best day', () => {
    // Visit rows mark the days; heartbeat rows (visits: 0) carry active time.
    const events = [
      event({ timestamp: '2026-07-01T02:00:00.000Z' }),
      event({ timestamp: '2026-07-02T23:00:00.000Z', visits: 0 }),
      event({ timestamp: '2026-07-02T23:30:00.000Z', visits: 0, active_ms: 120_000, total_ms: 120_000 }),
      // gap on the 3rd
      event({ timestamp: '2026-07-04T12:00:00.000Z' })
    ]
    const stats = computeAchievementStats(events, { totalScore: 500, rank: 4 })

    expect(stats.activeDays).toBe(3)
    expect(stats.longestStreak).toBe(2)
    expect(stats.rank).toBe(4)
    expect(stats.totalScore).toBe(500)

    // Day buckets score with the session engine, mirroring achievements.ts.
    const july2Score = scoreFromEvents([events[1], events[2]])
    expect(july2Score).toBeGreaterThan(0)
    expect(stats.bestDayScore).toBe(july2Score)
    expect(stats.bestDayActiveMs).toBe(60_000 + 120_000)
  })

  it('ignores events with unparseable timestamps for day buckets', () => {
    const stats = computeAchievementStats(
      [event({ timestamp: 'not-a-date' }), event({ timestamp: null })],
      { totalScore: 0, rank: null }
    )
    expect(stats.activeDays).toBe(0)
    expect(stats.bestDayScore).toBe(0)
    // but they still count as synced sessions
    expect(stats.totalEvents).toBe(2)
  })
})
