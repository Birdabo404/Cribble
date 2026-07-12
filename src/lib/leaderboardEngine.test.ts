import { describe, expect, it } from 'vitest'
import {
  MOVEMENT_WINDOW_MS,
  NEW_ENTRANT_WINDOW_MS,
  diffStandings,
  type RankSnapshotRow,
  type StandingEntry
} from './leaderboardEngine'

const NOW = new Date('2026-07-12T12:00:00.000Z')

const snapshot = (
  userId: number,
  rank: number,
  score: number,
  overrides: Partial<RankSnapshotRow> = {}
): [number, RankSnapshotRow] => [
  userId,
  {
    user_id: userId,
    rank,
    score,
    prev_rank: null,
    rank_moved_at: null,
    first_seen_at: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
    ...overrides
  }
]

const entry = (userId: number, rank: number, score: number): StandingEntry => ({
  userId,
  rank,
  score
})

describe('diffStandings', () => {
  it('marks first-time entrants as new and schedules an insert', () => {
    // Non-empty previous map: this is a genuine mid-season entrant.
    const previous = new Map([snapshot(99, 1, 9000)])
    const diff = diffStandings(
      previous,
      [entry(99, 1, 9000), entry(1, 2, 500)],
      NOW
    )

    expect(diff.movements.get(1)).toEqual({
      rankDelta: 0,
      movedAt: null,
      isNew: true
    })
    expect(diff.inserts).toHaveLength(1)
    expect(diff.inserts[0]).toMatchObject({ user_id: 1, rank: 2, score: 500 })
    expect(diff.inserts[0].first_seen_at).toBeUndefined()
    expect(diff.updates).toHaveLength(0)
  })

  it('suppresses NEW on the bootstrap pass and backdates first_seen_at', () => {
    // Empty previous map = tracking just shipped; long-time players must
    // not all light up as NEW.
    const diff = diffStandings(new Map(), [entry(1, 1, 500), entry(2, 2, 100)], NOW)

    expect(diff.movements.get(1)).toEqual({
      rankDelta: 0,
      movedAt: null,
      isNew: false
    })
    expect(diff.movements.get(2)?.isNew).toBe(false)
    expect(diff.inserts).toHaveLength(2)
    const firstSeen = Date.parse(diff.inserts[0].first_seen_at!)
    expect(NOW.getTime() - firstSeen).toBeGreaterThanOrEqual(NEW_ENTRANT_WINDOW_MS)
  })

  it('detects climbs and drops when ranks change', () => {
    const previous = new Map([
      snapshot(1, 2, 900),
      snapshot(2, 1, 1000)
    ])
    const diff = diffStandings(
      previous,
      [entry(1, 1, 1100), entry(2, 2, 1000)],
      NOW
    )

    // User 1 climbed 2 → 1, user 2 dropped 1 → 2.
    expect(diff.movements.get(1)).toMatchObject({ rankDelta: 1, isNew: false })
    expect(diff.movements.get(2)).toMatchObject({ rankDelta: -1, isNew: false })
    expect(diff.movements.get(1)?.movedAt).toBe(NOW.toISOString())

    expect(diff.inserts).toHaveLength(0)
    expect(diff.updates).toHaveLength(2)
    const update = diff.updates.find((u) => u.user_id === 2)
    expect(update).toMatchObject({ rank: 2, prev_rank: 1 })
  })

  it('keeps a fresh movement visible without rewriting the row', () => {
    const movedAt = new Date(NOW.getTime() - MOVEMENT_WINDOW_MS / 2).toISOString()
    const previous = new Map([
      snapshot(1, 3, 700, { prev_rank: 6, rank_moved_at: movedAt })
    ])
    const diff = diffStandings(previous, [entry(1, 3, 700)], NOW)

    expect(diff.movements.get(1)).toEqual({
      rankDelta: 3,
      movedAt,
      isNew: false
    })
    expect(diff.updates).toHaveLength(0)
    expect(diff.inserts).toHaveLength(0)
  })

  it('expires stale movements past the display window', () => {
    const movedAt = new Date(NOW.getTime() - MOVEMENT_WINDOW_MS - 1000).toISOString()
    const previous = new Map([
      snapshot(1, 3, 700, { prev_rank: 6, rank_moved_at: movedAt })
    ])
    const diff = diffStandings(previous, [entry(1, 3, 700)], NOW)

    expect(diff.movements.get(1)).toEqual({
      rankDelta: 0,
      movedAt: null,
      isNew: false
    })
  })

  it('updates the stored score without inventing a movement', () => {
    const previous = new Map([snapshot(1, 3, 700)])
    const diff = diffStandings(previous, [entry(1, 3, 950)], NOW)

    expect(diff.movements.get(1)).toMatchObject({ rankDelta: 0, movedAt: null })
    expect(diff.updates).toHaveLength(1)
    expect(diff.updates[0]).toMatchObject({
      user_id: 1,
      score: 950,
      prev_rank: null,
      rank_moved_at: null
    })
  })

  it('keeps the NEW chip while inside the entrant window', () => {
    const firstSeen = new Date(
      NOW.getTime() - NEW_ENTRANT_WINDOW_MS / 2
    ).toISOString()
    const previous = new Map([
      snapshot(1, 5, 100, { first_seen_at: firstSeen })
    ])
    const diff = diffStandings(previous, [entry(1, 5, 100)], NOW)

    expect(diff.movements.get(1)?.isNew).toBe(true)
  })

  it('preserves an existing movement when only the score changes', () => {
    const movedAt = new Date(NOW.getTime() - 60_000).toISOString()
    const previous = new Map([
      snapshot(1, 2, 500, { prev_rank: 4, rank_moved_at: movedAt })
    ])
    const diff = diffStandings(previous, [entry(1, 2, 640)], NOW)

    expect(diff.movements.get(1)).toEqual({
      rankDelta: 2,
      movedAt,
      isNew: false
    })
    expect(diff.updates).toHaveLength(1)
    expect(diff.updates[0]).toMatchObject({
      score: 640,
      prev_rank: 4,
      rank_moved_at: movedAt
    })
  })
})
