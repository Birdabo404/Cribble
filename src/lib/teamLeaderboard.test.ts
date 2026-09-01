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

    expect(totals).toEqual({
      teams: 2,
      members: 3,
      topScore: 200,
      burnUsd: '0',
      burnPilots: 0,
      burnIncludesEstimate: false
    })
  })

  it('returns an empty board when no teams qualify', () => {
    const board = buildTeamBoard([], [], noCalendar)

    expect(board.rows).toEqual([])
    expect(board.totals).toEqual({
      teams: 0,
      members: 0,
      topScore: 0,
      burnUsd: '0',
      burnPilots: 0,
      burnIncludesEstimate: false
    })
  })
})

describe('buildTeamBoard burn column', () => {
  it('never lets burn overtake score — the higher-score team stays #1', () => {
    const { rows } = buildTeamBoard(
      [team(1, 'grinders'), team(2, 'spenders')],
      [member(1, 11, 500), member(2, 21, 100)],
      noCalendar,
      new Map([
        [11, '1'],
        [21, '9999.99']
      ])
    )

    expect(rows.map((r) => r.username)).toEqual(['grinders', 'spenders'])
    expect(rows[0]).toMatchObject({ rank: 1, burnUsd: '1' })
    expect(rows[1]).toMatchObject({ rank: 2, burnUsd: '9999.99' })
  })

  it('sums burn only over opted-in (mapped) active members', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100), member(1, 12, 100), member(1, 13, 100)],
      noCalendar,
      // user 13 never opted into token sharing — no map entry, no burn.
      new Map([
        [11, '10.5'],
        [12, '2'],
        [99, '500']
      ])
    )

    expect(rows[0].burnUsd).toBe('12.5')
    expect(rows[0].burnPilots).toBe(2)
  })

  it('sums exact decimals — 0.1 + 0.2 is 0.3, not 0.30000000000000004', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 10), member(1, 12, 10)],
      noCalendar,
      new Map([
        [11, '0.1'],
        [12, '0.2']
      ])
    )

    expect(rows[0].burnUsd).toBe('0.3')
    expect(rows[0].burnPilots).toBe(2)
  })

  it('defaults to zero burn and zero pilots when the map is empty or absent', () => {
    const withEmptyMap = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100)],
      noCalendar,
      new Map()
    )
    expect(withEmptyMap.rows[0]).toMatchObject({ burnUsd: '0', burnPilots: 0 })
    expect(withEmptyMap.rows[0].members[0].burnUsd).toBeNull()

    const withoutMap = buildTeamBoard([team(1)], [member(1, 11, 100)], noCalendar)
    expect(withoutMap.rows[0]).toMatchObject({ burnUsd: '0', burnPilots: 0 })
    expect(withoutMap.rows[0].members[0].burnUsd).toBeNull()
  })

  it('exposes per-member burn — mapped members carry exact values, unmapped read null', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 200), member(1, 12, 100)],
      noCalendar,
      // Trailing zeros normalize away: '3.50' is stored as '3.5'.
      new Map([[11, '3.50']])
    )

    expect(rows[0].members.map((m) => m.burnUsd)).toEqual(['3.5', null])
    expect(rows[0]).toMatchObject({ burnUsd: '3.5', burnPilots: 1 })
  })

  it('keeps an opted-in zero burner visible — a mapped $0 is not the same as unmapped', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100)],
      noCalendar,
      new Map([[11, '0']])
    )

    expect(rows[0].members[0].burnUsd).toBe('0')
    expect(rows[0].burnPilots).toBe(1)
  })

  it('totals burn across the whole board — exact sums and pilot counts', () => {
    const { totals } = buildTeamBoard(
      [team(1), team(2)],
      [member(1, 11, 100), member(1, 12, 100), member(2, 21, 50)],
      noCalendar,
      new Map([
        [11, '0.1'],
        [12, '0.2'],
        [21, '5']
      ])
    )

    expect(totals.burnUsd).toBe('5.3')
    expect(totals.burnPilots).toBe(3)
  })
})

describe('buildTeamBoard cursor estimate fold', () => {
  const cursorMap = (
    entries: [teamId: number, userId: number, usd: string][]
  ): Map<number, Map<number, string>> => {
    const map = new Map<number, Map<number, string>>()
    for (const [teamId, userId, usd] of entries) {
      const teamMap = map.get(teamId) ?? new Map<number, string>()
      teamMap.set(userId, usd)
      map.set(teamId, teamMap)
    }
    return map
  }

  it('folds a cursor-only member as the estimate, tagged and flagged as house math', () => {
    const { rows, totals } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100)],
      noCalendar,
      new Map(),
      cursorMap([[1, 11, '4.2']])
    )

    expect(rows[0].members[0]).toMatchObject({ burnUsd: '4.2', burnSource: 'cursor' })
    expect(rows[0]).toMatchObject({
      burnUsd: '4.2',
      burnPilots: 1,
      burnIncludesEstimate: true
    })
    expect(totals).toMatchObject({
      burnUsd: '4.2',
      burnPilots: 1,
      burnIncludesEstimate: true
    })
  })

  it('lets CLI beat the estimate for a mixed member — never summed', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100)],
      noCalendar,
      new Map([[11, '5']]),
      cursorMap([[1, 11, '3']])
    )

    // '5', not '8' — real dollars win and the estimate is discarded.
    expect(rows[0].members[0]).toMatchObject({ burnUsd: '5', burnSource: 'cli' })
    expect(rows[0]).toMatchObject({
      burnUsd: '5',
      burnPilots: 1,
      burnIncludesEstimate: false
    })
  })

  it('tags CLI-only members cli and untracked members null', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100), member(1, 12, 50)],
      noCalendar,
      new Map([[11, '2']])
    )

    expect(rows[0].members.map((m) => m.burnSource)).toEqual(['cli', null])
    expect(rows[0].burnIncludesEstimate).toBe(false)
  })

  it('sums mixed-roster burn across sources and raises the estimate flag', () => {
    const { rows, totals } = buildTeamBoard(
      [team(1, 'mixed'), team(2, 'cliOnly')],
      [member(1, 11, 300), member(1, 12, 100), member(2, 21, 50)],
      noCalendar,
      new Map([
        [11, '0.1'],
        [21, '7']
      ]),
      cursorMap([[1, 12, '0.2']])
    )

    const mixed = rows.find((row) => row.username === 'mixed')!
    const cliOnly = rows.find((row) => row.username === 'cliOnly')!

    expect(mixed).toMatchObject({
      burnUsd: '0.3',
      burnPilots: 2,
      burnIncludesEstimate: true
    })
    expect(cliOnly).toMatchObject({
      burnUsd: '7',
      burnPilots: 1,
      burnIncludesEstimate: false
    })
    // One estimated team is enough to mark the board total as house math.
    expect(totals).toMatchObject({
      burnUsd: '7.3',
      burnPilots: 3,
      burnIncludesEstimate: true
    })
  })

  it('keys estimates per (team, member) — one team\'s floor never leaks to another', () => {
    const { rows } = buildTeamBoard(
      [team(1, 'alpha'), team(2, 'beta')],
      [member(1, 11, 100), member(2, 11, 100)],
      noCalendar,
      new Map(),
      // The same member carries different post-floor sums on each team.
      cursorMap([
        [1, 11, '9'],
        [2, 11, '1.5']
      ])
    )

    const alpha = rows.find((row) => row.username === 'alpha')!
    const beta = rows.find((row) => row.username === 'beta')!
    expect(alpha.members[0].burnUsd).toBe('9')
    expect(beta.members[0].burnUsd).toBe('1.5')
  })

  it('keeps a verified zero-token member visible — a mapped $0 estimate is a pilot', () => {
    const { rows } = buildTeamBoard(
      [team(1)],
      [member(1, 11, 100)],
      noCalendar,
      new Map(),
      cursorMap([[1, 11, '0']])
    )

    expect(rows[0].members[0]).toMatchObject({ burnUsd: '0', burnSource: 'cursor' })
    expect(rows[0]).toMatchObject({ burnPilots: 1, burnIncludesEstimate: true })
  })

  it('never lets an estimate rank score — a cursor-only whale team stays below on points', () => {
    const { rows } = buildTeamBoard(
      [team(1, 'grinders'), team(2, 'cursorWhales')],
      [member(1, 11, 500), member(2, 21, 100)],
      noCalendar,
      new Map(),
      cursorMap([[2, 21, '9999.99']])
    )

    expect(rows.map((row) => row.username)).toEqual(['grinders', 'cursorWhales'])
    expect(rows[1]).toMatchObject({ rank: 2, burnUsd: '9999.99' })
  })
})
