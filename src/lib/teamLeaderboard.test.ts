import { describe, expect, it } from 'vitest'
import {
  buildTeamBoard,
  largestRemainderShares,
  memberSeasonScore,
  type TeamBoardMemberInput,
  type TeamBoardTeamInput
} from './teamLeaderboard'
import type { SeasonState } from './season'

const SEASON_START = '2026-08-01T00:00:00.000Z'

const season = (phase: 'active' | 'intermission'): SeasonState => ({
  phase,
  current: {
    id: 1,
    number: 1,
    name: 'Season 1',
    startsAt: SEASON_START,
    endsAt: '2026-11-01T00:00:00.000Z',
    status: phase === 'active' ? 'active' : 'complete'
  },
  next: null
})

const noCalendar: SeasonState = { phase: 'intermission', current: null, next: null }

const team = (
  id: number,
  username: string | null = `team${id}`
): TeamBoardTeamInput => ({
  id,
  twitter_username: username,
  twitter_name: null,
  twitter_profile_image: null
})

const member = (
  teamUserId: number,
  userId: number,
  score: number,
  lastCalc: string | null = '2026-08-10T00:00:00.000Z'
): TeamBoardMemberInput => ({
  teamUserId,
  userId,
  twitter_username: `user${userId}`,
  twitter_name: null,
  twitter_profile_image: null,
  tier: 'PRO',
  season_score: score,
  last_calculated_at: lastCalc
})

describe('memberSeasonScore', () => {
  it('zeroes a row last recalculated before an active season started', () => {
    expect(memberSeasonScore(500, '2026-07-15T00:00:00.000Z', season('active'))).toBe(0)
    expect(memberSeasonScore(500, null, season('active'))).toBe(0)
    expect(memberSeasonScore(500, '2026-08-10T00:00:00.000Z', season('active'))).toBe(500)
  })

  it('counts stale rows during intermission — the board is never a frozen archive', () => {
    expect(memberSeasonScore(500, '2026-07-15T00:00:00.000Z', season('intermission'))).toBe(500)
  })

  it('counts raw season_score when no calendar exists, rounded', () => {
    expect(memberSeasonScore(10.6, null, noCalendar)).toBe(11)
    expect(memberSeasonScore(null, null, noCalendar)).toBe(0)
  })
})

describe('largestRemainderShares', () => {
  it('splits three equal scores 34/33/33 — shares sum to exactly 100', () => {
    expect(largestRemainderShares([100, 100, 100])).toEqual([34, 33, 33])
  })

  it('hands leftovers to the largest fractional parts', () => {
    // Exact shares 57.14 / 28.57 / 14.29 — the middle one earns the point.
    expect(largestRemainderShares([200, 100, 50])).toEqual([57, 29, 14])
  })

  it('returns all zeros for a zero total', () => {
    expect(largestRemainderShares([0, 0])).toEqual([0, 0])
    expect(largestRemainderShares([])).toEqual([])
  })
})

describe('buildTeamBoard', () => {
  it('scores a team as the sum of its members alone — the team account itself is never an input', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100), member(1, 12, 200)],
      noCalendar
    )

    expect(rows[0].score).toBe(300)
    expect(rows[0].memberCount).toBe(2)
  })

  it('ranks by score, then memberCount, then username', () => {
    const { rows } = buildTeamBoard(
      [team(1, 'alpha'), team(2, 'zulu'), team(3, 'beta')],
      [
        member(1, 11, 300),
        member(2, 21, 150),
        member(2, 22, 150),
        member(3, 31, 300)
      ],
      noCalendar
    )

    // All tied at 300: zulu wins on roster size, alpha beats beta on name.
    expect(rows.map((r) => r.username)).toEqual(['zulu', 'alpha', 'beta'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('keeps empty-roster teams on the board at 0, ranked last', () => {
    const { rows } = buildTeamBoard(
      [team(1, 'alpha'), team(2, 'zulu')],
      [member(2, 21, 10)],
      noCalendar
    )

    expect(rows.map((r) => r.username)).toEqual(['zulu', 'alpha'])
    expect(rows[1]).toMatchObject({ rank: 2, score: 0, memberCount: 0, members: [] })
  })

  it('orders members score desc inside a team and hands out their shares', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 50), member(1, 12, 200), member(1, 13, 100)],
      noCalendar
    )

    expect(rows[0].members.map((m) => m.userId)).toEqual([12, 13, 11])
    expect(rows[0].members.map((m) => m.share)).toEqual([57, 29, 14])
  })

  it('zeroes all shares when the team total is 0', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 0), member(1, 12, 0)],
      noCalendar
    )

    expect(rows[0].score).toBe(0)
    expect(rows[0].members.map((m) => m.share)).toEqual([0, 0])
  })

  it('zeroes stale members under an active season but counts them during intermission', () => {
    const teams = [team(1)]
    const roster = [
      member(1, 11, 100),
      member(1, 12, 400, '2026-07-01T00:00:00.000Z')
    ]

    const live = buildTeamBoard(teams, roster, season('active'))
    expect(live.rows[0].score).toBe(100)
    expect(live.rows[0].members.map((m) => m.score)).toEqual([100, 0])

    const between = buildTeamBoard(teams, roster, season('intermission'))
    expect(between.rows[0].score).toBe(500)
    expect(between.rows[0].members.map((m) => m.score)).toEqual([400, 100])
  })

  it('falls back to User{id} handles for rows without a username', () => {
    const { rows } = buildTeamBoard(
      [team(7, null)],
      [{ ...member(7, 71, 10), twitter_username: null }],
      noCalendar
    )

    expect(rows[0]).toMatchObject({ username: 'User7', display_name: 'User7' })
    expect(rows[0].members[0]).toMatchObject({ username: 'User71', display_name: 'User71' })
  })

  it('computes totals across the board', () => {
    const { totals } = buildTeamBoard(
      [team(1), team(2)],
      [member(1, 11, 100), member(1, 12, 50), member(2, 21, 200)],
      noCalendar
    )

    expect(totals).toEqual({ teams: 2, members: 3, topScore: 200 })
  })

  it('returns an empty board when no teams qualify', () => {
    const board = buildTeamBoard([], [], noCalendar)

    expect(board.rows).toEqual([])
    expect(board.totals).toEqual({ teams: 0, members: 0, topScore: 0 })
  })
})
