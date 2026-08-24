import { describe, expect, it } from 'vitest'
import { MOVEMENT_WINDOW_MS } from './leaderboardEngine'
import {
  buildClubHypeEvent,
  classifyHypeTier,
  deriveHypeEvents,
  HYPE_KIND_PRIORITY,
  HYPE_MILESTONE_FLOOR,
  hypeClubDedupeKey,
  hypeRankDedupeKey,
  type HypeDiffRow
} from './hypeEvents'

const NOW = new Date('2026-08-24T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const EARLIER_ISO = new Date(NOW.getTime() - 3_600_000).toISOString()
const WINDOW = Math.floor(NOW.getTime() / MOVEMENT_WINDOW_MS)

/** A diff-pass row that moved on THIS pass (rank_moved_at === now),
 *  written from -> to like the climb reads. */
function moved(userId: number, from: number, to: number): HypeDiffRow {
  return { user_id: userId, rank: to, prev_rank: from, rank_moved_at: NOW_ISO }
}

describe('classifyHypeTier', () => {
  it('crowns any climb landing on rank 1, including 2 -> 1', () => {
    expect(classifyHypeTier(1, 2)).toBe('throne')
    expect(classifyHypeTier(1, 3)).toBe('throne')
    expect(classifyHypeTier(1, 12)).toBe('throne')
    expect(classifyHypeTier(1, 100)).toBe('throne')
  })

  it('marks top3 only for climbs breaking in from outside the bucket', () => {
    expect(classifyHypeTier(2, 4)).toBe('top3')
    expect(classifyHypeTier(3, 12)).toBe('top3')
    expect(classifyHypeTier(3, 4)).toBe('top3')
  })

  it('marks top10 only for climbs breaking in from outside the bucket', () => {
    expect(classifyHypeTier(10, 11)).toBe('top10')
    expect(classifyHypeTier(4, 25)).toBe('top10')
    expect(classifyHypeTier(9, 11)).toBe('top10')
  })

  it('tells no story for shuffles inside a bucket or outside all tiers', () => {
    expect(classifyHypeTier(2, 3)).toBeNull() // stayed inside top3
    expect(classifyHypeTier(4, 10)).toBeNull() // stayed inside top10
    expect(classifyHypeTier(5, 9)).toBeNull()
    expect(classifyHypeTier(11, 40)).toBeNull() // landed outside all tiers
  })
})

describe('deriveHypeEvents', () => {
  it('turns a 2 -> 1 climb into a throne event with the dethroned as victim', () => {
    // The old #1 only slid to #2 — still top3, but dethroned: the
    // throne victim rule is prev_rank === 1, not leaving a bucket.
    const events = deriveHypeEvents([moved(1, 2, 1), moved(2, 1, 2)], NOW)
    expect(events).toEqual([
      {
        kind: 'throne',
        user_id: 1,
        rank: 1,
        prev_rank: 2,
        victim_user_id: 2,
        threshold: null,
        dedupe_key: `hype_throne_${WINDOW}`
      }
    ])
  })

  it('collapses a 12 -> 1 jump into a single throne event, not three', () => {
    const events = deriveHypeEvents([moved(7, 12, 1)], NOW)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('throne')
    expect(events[0].prev_rank).toBe(12)
  })

  it('emits one event per climber across tiers in a single pass', () => {
    const events = deriveHypeEvents(
      [
        moved(1, 15, 1),
        moved(2, 12, 3),
        moved(3, 20, 10),
        // Fallers making room.
        moved(4, 1, 16),
        moved(5, 3, 13),
        moved(6, 10, 21)
      ],
      NOW
    )
    expect(events.map((e) => [e.kind, e.user_id])).toEqual([
      ['throne', 1],
      ['top3', 2],
      ['top10', 3]
    ])
  })

  it('skips moves from earlier passes, score-only rows and never-moved rows', () => {
    const staleMove: HypeDiffRow = {
      user_id: 1,
      rank: 1,
      prev_rank: 5,
      rank_moved_at: EARLIER_ISO
    }
    const neverMoved: HypeDiffRow = {
      user_id: 2,
      rank: 2,
      prev_rank: null,
      rank_moved_at: NOW_ISO
    }
    const scoreOnly: HypeDiffRow = {
      user_id: 3,
      rank: 3,
      prev_rank: 8,
      rank_moved_at: null
    }
    expect(deriveHypeEvents([staleMove, neverMoved, scoreOnly], NOW)).toEqual([])
  })

  it('emits nothing for demotions and within-bucket shuffles', () => {
    expect(deriveHypeEvents([moved(1, 5, 4), moved(2, 2, 3)], NOW)).toEqual([])
  })

  it('picks the best prev_rank when several fell out of the bucket', () => {
    const events = deriveHypeEvents(
      [moved(1, 12, 2), moved(2, 2, 4), moved(3, 3, 5)],
      NOW
    )
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('top3')
    expect(events[0].victim_user_id).toBe(2)
  })

  it('never names the same victim twice — the tighter story claims first', () => {
    // A takes the throne, B breaks into top3. The old #1 fell clean out
    // of top3 and qualifies for both; the throne claims them, so the
    // top3 event falls through to the old #3.
    const events = deriveHypeEvents(
      [moved(10, 2, 1), moved(20, 5, 2), moved(30, 1, 4), moved(40, 3, 5)],
      NOW
    )
    expect(events).toEqual([
      {
        kind: 'throne',
        user_id: 10,
        rank: 1,
        prev_rank: 2,
        victim_user_id: 30,
        threshold: null,
        dedupe_key: `hype_throne_${WINDOW}`
      },
      {
        kind: 'top3',
        user_id: 20,
        rank: 2,
        prev_rank: 5,
        victim_user_id: 40,
        threshold: null,
        dedupe_key: `hype_top3_${WINDOW}`
      }
    ])
  })

  it('gives same-tier climbers distinct victims, best landing rank first', () => {
    const events = deriveHypeEvents(
      [moved(1, 15, 4), moved(2, 20, 9), moved(3, 9, 11), moved(4, 10, 12)],
      NOW
    )
    expect(events.map((e) => [e.user_id, e.victim_user_id])).toEqual([
      [1, 3], // rank 4 claims the best faller (prev #9)
      [2, 4]
    ])
  })

  it('stays victimless when nobody fell out of the bucket', () => {
    // The faller was already outside top10 — the board simply grew.
    const events = deriveHypeEvents([moved(1, 15, 9), moved(2, 11, 13)], NOW)
    expect(events).toHaveLength(1)
    expect(events[0].victim_user_id).toBeNull()
  })
})

describe('hypeRankDedupeKey', () => {
  it('is stable for two timestamps inside the same 48h window', () => {
    const windowStart = new Date(10 * MOVEMENT_WINDOW_MS)
    const windowEnd = new Date(11 * MOVEMENT_WINDOW_MS - 1)
    expect(hypeRankDedupeKey('throne', windowStart)).toBe('hype_throne_10')
    expect(hypeRankDedupeKey('throne', windowEnd)).toBe(
      hypeRankDedupeKey('throne', windowStart)
    )
  })

  it('changes across the window boundary', () => {
    const beforeBoundary = new Date(11 * MOVEMENT_WINDOW_MS - 1)
    const afterBoundary = new Date(11 * MOVEMENT_WINDOW_MS)
    expect(hypeRankDedupeKey('top10', afterBoundary)).not.toBe(
      hypeRankDedupeKey('top10', beforeBoundary)
    )
  })

  it('keys each tier separately', () => {
    expect(hypeRankDedupeKey('top3', NOW)).toBe(`hype_top3_${WINDOW}`)
    expect(hypeRankDedupeKey('top3', NOW)).not.toBe(hypeRankDedupeKey('top10', NOW))
  })
})

describe('buildClubHypeEvent', () => {
  it('returns null below the public floor', () => {
    expect(HYPE_MILESTONE_FLOOR).toBe(100_000)
    expect(buildClubHypeEvent(7, 1_000)).toBeNull()
    expect(buildClubHypeEvent(7, 50_000)).toBeNull()
    expect(buildClubHypeEvent(7, 99_999)).toBeNull()
  })

  it('builds a forever-once club event at and above the floor', () => {
    expect(buildClubHypeEvent(7, 100_000)).toEqual({
      kind: 'club',
      user_id: 7,
      rank: null,
      prev_rank: null,
      victim_user_id: null,
      threshold: 100_000,
      dedupe_key: 'hype_club_100000'
    })
    expect(buildClubHypeEvent(9, 1_000_000)?.dedupe_key).toBe('hype_club_1000000')
  })
})

describe('hypeClubDedupeKey', () => {
  it('carries the raw threshold and no time window', () => {
    expect(hypeClubDedupeKey(250_000)).toBe('hype_club_250000')
  })
})

describe('HYPE_KIND_PRIORITY', () => {
  it('orders throne > top3 > top10 > club, tightest first', () => {
    expect(HYPE_KIND_PRIORITY.throne).toBeLessThan(HYPE_KIND_PRIORITY.top3)
    expect(HYPE_KIND_PRIORITY.top3).toBeLessThan(HYPE_KIND_PRIORITY.top10)
    expect(HYPE_KIND_PRIORITY.top10).toBeLessThan(HYPE_KIND_PRIORITY.club)
  })
})
