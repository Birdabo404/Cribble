import { describe, expect, it } from 'vitest'
import { PIXEL_RAMPS } from '@/components/achievements/palette'
import { PIXEL_GRIDS } from '@/components/achievements/pixelIcons'
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  ACHIEVEMENT_CATEGORIES,
  EMPTY_ACHIEVEMENT_STATS,
  EMPTY_ACHIEVEMENT_TOKEN_STATS,
  computeAchievementStats,
  isAchievementUnlocked,
  longestStreakFromDayKeys,
  unlockedAchievementIds,
  type AchievementEvent,
  type AchievementStats,
  type AchievementTokenStats
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

/** Slot chars per declared ramp: '1'-'4' → ramps[0], '5'-'8' → ramps[1],
 * '9','a','b','c' → ramps[2]. Mirrors the PixelIcon renderer contract. */
const RAMP_SLOT_CHARS = ['1234', '5678', '9abc'] as const

describe('achievement catalog integrity', () => {
  it('has unique ids and positive targets across all 32 achievements', () => {
    expect(ACHIEVEMENTS).toHaveLength(32)
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACHIEVEMENTS) {
      expect(a.target).toBeGreaterThan(0)
      expect(ACHIEVEMENT_CATEGORIES).toContain(a.category)
    }
  })

  it('references only icons that exist in the sprite set', () => {
    for (const a of ACHIEVEMENTS) {
      expect(PIXEL_GRIDS[a.icon], `missing sprite for icon "${a.icon}"`).toBeDefined()
    }
  })

  it('declares 1-3 ramps per sprite, all present in the palette', () => {
    for (const [name, sprite] of Object.entries(PIXEL_GRIDS)) {
      expect(sprite.ramps.length, `"${name}" ramp count`).toBeGreaterThanOrEqual(1)
      expect(sprite.ramps.length, `"${name}" ramp count`).toBeLessThanOrEqual(3)
      for (const ramp of sprite.ramps) {
        expect(PIXEL_RAMPS[ramp], `"${name}" uses unknown ramp "${ramp}"`).toBeDefined()
      }
    }
  })

  it('draws every sprite as a 16x16 grid of slot chars valid for its ramps', () => {
    for (const [name, sprite] of Object.entries(PIXEL_GRIDS)) {
      expect(sprite.grid, `"${name}" row count`).toHaveLength(16)
      const allowed = new Set([
        '.',
        ...sprite.ramps.flatMap((_, i) => RAMP_SLOT_CHARS[i].split(''))
      ])
      sprite.grid.forEach((row, y) => {
        expect(row, `"${name}" row ${y} width`).toHaveLength(16)
        for (const ch of row) {
          expect(
            allowed.has(ch),
            `"${name}" row ${y}: char "${ch}" needs a ramp the sprite does not declare`
          ).toBe(true)
        }
      })
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

describe('burn unlock conditions', () => {
  it('unlocks token volume milestones at their thresholds', () => {
    expect(isAchievementUnlocked(def('tokens_1m'), statsWith({ tokenTotal: 999_999 }))).toBe(false)
    expect(isAchievementUnlocked(def('tokens_1m'), statsWith({ tokenTotal: 1_000_000 }))).toBe(true)
    expect(isAchievementUnlocked(def('tokens_50m'), statsWith({ tokenTotal: 49_999_999 }))).toBe(false)
    expect(isAchievementUnlocked(def('tokens_50m'), statsWith({ tokenTotal: 50_000_000 }))).toBe(true)
  })

  it('unlocks burn_first from the very first token', () => {
    expect(isAchievementUnlocked(def('burn_first'), statsWith({ tokenTotal: 0 }))).toBe(false)
    expect(isAchievementUnlocked(def('burn_first'), statsWith({ tokenTotal: 1 }))).toBe(true)
  })

  it('holds FINANCIAL INCIDENT until the full $500', () => {
    expect(isAchievementUnlocked(def('burn_500'), statsWith({ tokenBurnUsd: 499.99 }))).toBe(false)
    expect(isAchievementUnlocked(def('burn_500'), statsWith({ tokenBurnUsd: 500 }))).toBe(true)
  })

  it('unlocks model_hopper at five distinct models', () => {
    expect(isAchievementUnlocked(def('model_hopper'), statsWith({ tokenModels: 4 }))).toBe(false)
    expect(isAchievementUnlocked(def('model_hopper'), statsWith({ tokenModels: 5 }))).toBe(true)
  })

  it('unlocks output_demon at five million output tokens', () => {
    expect(isAchievementUnlocked(def('output_demon'), statsWith({ tokenOutput: 4_999_999 }))).toBe(false)
    expect(isAchievementUnlocked(def('output_demon'), statsWith({ tokenOutput: 5_000_000 }))).toBe(true)
  })

  it('requires both legs of the cache_goblin composite', () => {
    expect(
      isAchievementUnlocked(
        def('cache_goblin'),
        statsWith({ tokenCachePercent: 90, tokenTotal: 10_000_000 })
      )
    ).toBe(true)
    expect(
      isAchievementUnlocked(
        def('cache_goblin'),
        statsWith({ tokenCachePercent: 90, tokenTotal: 9_900_000 })
      )
    ).toBe(false)
    expect(
      isAchievementUnlocked(
        def('cache_goblin'),
        statsWith({ tokenCachePercent: 89, tokenTotal: 10_000_000 })
      )
    ).toBe(false)
  })

  it('requires both legs of the raw_dog composite', () => {
    expect(
      isAchievementUnlocked(
        def('raw_dog'),
        statsWith({ tokenCachePercent: 10, tokenTotal: 10_000_000 })
      )
    ).toBe(true)
    expect(
      isAchievementUnlocked(
        def('raw_dog'),
        statsWith({ tokenCachePercent: 10, tokenTotal: 9_900_000 })
      )
    ).toBe(false)
    expect(
      isAchievementUnlocked(
        def('raw_dog'),
        statsWith({ tokenCachePercent: 11, tokenTotal: 10_000_000 })
      )
    ).toBe(false)
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

  it('passes the token pipeline aggregates through the tokens context', () => {
    const tokens: AchievementTokenStats = {
      tokenTotal: 12_000_000,
      tokenOutput: 900_000,
      tokenBurnUsd: 42.5,
      tokenCachePercent: 91,
      tokenModels: 3,
      tokenAgents: 2,
      tokenActiveDays: 14,
      tokenBestDayTokens: 2_500_000
    }
    const stats = computeAchievementStats([event({})], {
      totalScore: 100,
      rank: 7,
      tokens
    })
    expect(stats).toMatchObject(tokens)
    expect(stats.totalScore).toBe(100)
    expect(stats.totalEvents).toBe(1)
  })

  it('zeroes token stats when the tokens context is omitted', () => {
    const stats = computeAchievementStats([event({})], { totalScore: 100, rank: 7 })
    expect(stats).toMatchObject(EMPTY_ACHIEVEMENT_TOKEN_STATS)
  })
})
