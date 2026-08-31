import { describe, expect, it } from 'vitest'
import { MOVEMENT_WINDOW_MS } from './leaderboardEngine'
import {
  buildBurnClubHypeEvent,
  buildClubHypeEvent,
  BURN_CLUB_THRESHOLDS,
  burnClubCrossings,
  classifyHypeTier,
  deriveBurnHypeEvents,
  deriveHypeEvents,
  HYPE_KIND_PRIORITY,
  HYPE_MILESTONE_FLOOR,
  hypeBurnClubDedupeKey,
  hypeClubDedupeKey,
  hypeRankDedupeKey,
  type BurnHypeDiffRow,
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

/** The burn twin of moved(): a Burn Board diff row carrying its season
 *  burn (exact decimal string). */
function burnMoved(
  userId: number,
  from: number,
  to: number,
  burnUsd = '100'
): BurnHypeDiffRow {
  return {
    user_id: userId,
    rank: to,
    prev_rank: from,
    rank_moved_at: NOW_ISO,
    burn_usd: burnUsd
  }
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
        burn_usd: null,
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
        burn_usd: null,
        dedupe_key: `hype_throne_${WINDOW}`
      },
      {
        kind: 'top3',
        user_id: 20,
        rank: 2,
        prev_rank: 5,
        victim_user_id: 40,
        threshold: null,
        burn_usd: null,
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

describe('deriveBurnHypeEvents', () => {
  it('classifies through the shared tiers into the burn kinds, season burn aboard', () => {
    const events = deriveBurnHypeEvents(
      [
        burnMoved(1, 15, 1, '412.5'),
        burnMoved(2, 12, 3, '250'),
        burnMoved(3, 20, 10, '99.99'),
        // Fallers making room.
        burnMoved(4, 1, 16),
        burnMoved(5, 3, 13),
        burnMoved(6, 10, 21)
      ],
      NOW
    )
    expect(events.map((e) => [e.kind, e.user_id, e.burn_usd])).toEqual([
      ['burn_throne', 1, '412.5'],
      ['burn_top3', 2, '250'],
      ['burn_top10', 3, '99.99']
    ])
  })

  it('turns a 2 -> 1 burn climb into one burn_throne event naming the outburned', () => {
    const events = deriveBurnHypeEvents(
      [burnMoved(1, 2, 1, '500.25'), burnMoved(2, 1, 2, '499')],
      NOW
    )
    expect(events).toEqual([
      {
        kind: 'burn_throne',
        user_id: 1,
        rank: 1,
        prev_rank: 2,
        victim_user_id: 2,
        threshold: null,
        burn_usd: '500.25',
        dedupe_key: `hype_burn_throne_${WINDOW}`
      }
    ])
  })

  it('claims victims by the score rules, independently of the score pass', () => {
    // The "never names the same victim twice" scenario, run through
    // both boards: pairing must land identically — only the kind family
    // and dedupe prefix differ, and neither pass sees the other's
    // claimed set (the boards derive from separate snapshot diffs).
    const rows: [number, number, number][] = [
      [10, 2, 1],
      [20, 5, 2],
      [30, 1, 4],
      [40, 3, 5]
    ]
    const scoreEvents = deriveHypeEvents(
      rows.map(([u, from, to]) => moved(u, from, to)),
      NOW
    )
    const burnEvents = deriveBurnHypeEvents(
      rows.map(([u, from, to]) => burnMoved(u, from, to)),
      NOW
    )
    expect(burnEvents.map((e) => [e.kind, e.user_id, e.victim_user_id])).toEqual([
      ['burn_throne', 10, 30],
      ['burn_top3', 20, 40]
    ])
    expect(burnEvents.map((e) => [e.user_id, e.victim_user_id])).toEqual(
      scoreEvents.map((e) => [e.user_id, e.victim_user_id])
    )
    expect(burnEvents.map((e) => e.dedupe_key)).toEqual([
      `hype_burn_throne_${WINDOW}`,
      `hype_burn_top3_${WINDOW}`
    ])
  })

  it('airs nothing for new entrants — a first opt-in has no prev_rank', () => {
    const entrant: BurnHypeDiffRow = {
      user_id: 1,
      rank: 1,
      prev_rank: null,
      rank_moved_at: NOW_ISO,
      burn_usd: '900'
    }
    expect(deriveBurnHypeEvents([entrant], NOW)).toEqual([])
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

  it('keys the burn kinds apart from their score twins via the kind prefix', () => {
    expect(hypeRankDedupeKey('burn_throne', NOW)).toBe(`hype_burn_throne_${WINDOW}`)
    expect(hypeRankDedupeKey('burn_throne', NOW)).not.toBe(hypeRankDedupeKey('throne', NOW))
  })
})

describe('burnClubCrossings', () => {
  it('returns the rungs where prev < threshold <= next, ascending', () => {
    expect(burnClubCrossings('0', '99.99')).toEqual([])
    expect(burnClubCrossings('99.99', '100')).toEqual([100])
    expect(burnClubCrossings('0', '2500')).toEqual([100, 500, 2500])
    expect(burnClubCrossings('600', '10000')).toEqual([2500, 10000])
  })

  it('is exclusive of the baseline — sitting exactly on a rung crosses nothing', () => {
    expect(burnClubCrossings('100', '499.99')).toEqual([])
    expect(burnClubCrossings('2500', '2500')).toEqual([])
  })

  it('is inclusive of the new total — landing exactly on a rung crosses it', () => {
    expect(burnClubCrossings('499.999999', '500')).toEqual([500])
  })

  it('compares exactly — a hair below a rung stays below at any precision', () => {
    // Number('99.999999999999999999') rounds to 100; the exact-decimal
    // comparison must still see it below the rung.
    expect(burnClubCrossings('99.999999999999999999', '100')).toEqual([100])
  })

  it('covers the whole persona ladder in one leap', () => {
    expect(BURN_CLUB_THRESHOLDS).toEqual([100, 500, 2_500, 10_000, 25_000])
    expect(burnClubCrossings('0', '25000')).toEqual([...BURN_CLUB_THRESHOLDS])
  })
})

describe('buildBurnClubHypeEvent', () => {
  it('builds a forever-once burn club row — no floor, every rung airs', () => {
    expect(buildBurnClubHypeEvent(7, 100)).toEqual({
      kind: 'burn_club',
      user_id: 7,
      rank: null,
      prev_rank: null,
      victim_user_id: null,
      threshold: 100,
      burn_usd: null,
      dedupe_key: 'hype_burn_club_100'
    })
    expect(buildBurnClubHypeEvent(9, 25_000)?.dedupe_key).toBe('hype_burn_club_25000')
  })
})

describe('hypeBurnClubDedupeKey', () => {
  it('carries the whole-dollar threshold, disjoint from the score club keys', () => {
    expect(hypeBurnClubDedupeKey(2_500)).toBe('hype_burn_club_2500')
    expect(hypeBurnClubDedupeKey(2_500)).not.toBe(hypeClubDedupeKey(2_500))
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
      burn_usd: null,
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

  it('seats each burn twin one notch behind its score tier', () => {
    expect(HYPE_KIND_PRIORITY.throne).toBeLessThan(HYPE_KIND_PRIORITY.burn_throne)
    expect(HYPE_KIND_PRIORITY.burn_throne).toBeLessThan(HYPE_KIND_PRIORITY.top3)
    expect(HYPE_KIND_PRIORITY.top3).toBeLessThan(HYPE_KIND_PRIORITY.burn_top3)
    expect(HYPE_KIND_PRIORITY.burn_top3).toBeLessThan(HYPE_KIND_PRIORITY.top10)
    expect(HYPE_KIND_PRIORITY.top10).toBeLessThan(HYPE_KIND_PRIORITY.burn_top10)
    expect(HYPE_KIND_PRIORITY.burn_top10).toBeLessThan(HYPE_KIND_PRIORITY.club)
    expect(HYPE_KIND_PRIORITY.club).toBeLessThan(HYPE_KIND_PRIORITY.burn_club)
  })
})
