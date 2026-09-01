// Team standings assembly for the TEAMS board (/api/leaderboard/teams).
// A team's board score is the sum of its ACTIVE affiliates' season
// scores — the company account's own score never counts. Pure assembly
// helpers live here so the math (sums, shares, tie-breaks) stays
// unit-testable without a database; the API route owns the queries.

import type { SeasonState } from '@/lib/season'
import { addExactDecimals, exactDecimal } from '@/lib/tokenLeaderboard'

/** Where a member's burnUsd came from. 'cli' is the consent-gated CLI
 *  RPC's reported cost; 'cursor' is verified Cursor tokens × the season
 *  house rate — a read-time estimate the UI must mark as house math. */
export type TeamBurnSource = 'cli' | 'cursor'

/** One roster member inside an expanded team row. */
export interface TeamBoardMember {
  userId: number
  username: string
  display_name: string
  profile_image: string | null
  tier: string | null
  /** The member's season score (staleness-guarded, same rule as the
   *  season board). */
  score: number
  /** Integer share of the team total, 0–100. Largest-remainder rounded
   *  so a team's shares sum to exactly 100; all 0 when the team total
   *  is 0. */
  share: number
  /** Display-only exact-decimal USD burn for this member: opt-in CLI
   *  dollars when they shared token usage, else the Cursor house-rate
   *  estimate when they hold a verified board-enabled cursor.com claim,
   *  else null (absent from both maps). A mapped '0' is a real opted-in
   *  zero, not a null. */
  burnUsd: string | null
  /** Which fuel burnUsd is, or null when burnUsd is null. CLI beats the
   *  estimate — the two are NEVER summed for one member. */
  burnSource: TeamBurnSource | null
}

/** One ranked team on the TEAMS board. */
export interface TeamBoardRow {
  userId: number
  rank: number
  username: string
  display_name: string
  profile_image: string | null
  /** Combined season score of all active members. */
  score: number
  memberCount: number
  /** Display-only exact-decimal USD burn summed over active members
   *  with a burn source — opt-in CLI dollars or verified Cursor
   *  estimates ('0' when neither). NEVER a sort key — the rank stays
   *  score-only. */
  burnUsd: string
  /** How many active members contributed to burnUsd, from either
   *  source. 0 renders as an em dash, not $0. */
  burnPilots: number
  /** True when any counted member's burnUsd is the Cursor house-rate
   *  estimate — the UI marks such values (~ prefix + EST chip) as house
   *  math. False for CLI-only (or zero-pilot) teams, whose dollars
   *  render as today. */
  burnIncludesEstimate: boolean
  /** Active members, season score desc. Seat-limited (≤10), always
   *  embedded so expanding a row never fetches. */
  members: TeamBoardMember[]
}

/** Stat-strip totals for the TEAMS board. */
export interface TeamBoardTotals {
  teams: number
  members: number
  topScore: number
  /** Combined exact-decimal USD burn across every team ('0' when no
   *  member anywhere has a burn source). Display-only, same rule as
   *  the rows. */
  burnUsd: string
  /** Total members contributing to burnUsd across the board, from
   *  either source. */
  burnPilots: number
  /** True when any team's burn includes a Cursor house-rate estimate —
   *  the stat strip marks the board total as house math. */
  burnIncludesEstimate: boolean
}

/** An approved team account, as selected by the route (identity only —
 *  the team's own score is deliberately not an input). */
export interface TeamBoardTeamInput {
  id: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
}

/** One ACTIVE affiliate, flattened from the route's roster join. */
export interface TeamBoardMemberInput {
  teamUserId: number
  userId: number
  twitter_username: string | null
  twitter_name: string | null
  twitter_profile_image: string | null
  tier: string | null
  season_score: number | null
  last_calculated_at: string | null
}

/**
 * A member's board score — the season board's staleness rule verbatim:
 * while a season is ACTIVE, a score row last recalculated before the
 * season started can only be carrying a previous season's value, so it
 * reads as 0. During intermission (or with no calendar at all) the raw
 * season_score counts — this board is never a frozen archive.
 */
export function memberSeasonScore(
  seasonScore: number | null,
  lastCalculatedAt: string | null,
  seasonState: SeasonState
): number {
  const liveSeason = seasonState.phase === 'active' && seasonState.current !== null
  if (liveSeason) {
    const seasonStartMs = Date.parse(seasonState.current!.startsAt)
    const lastCalcMs = lastCalculatedAt ? new Date(lastCalculatedAt).getTime() : 0
    if (!(lastCalcMs >= seasonStartMs)) return 0
  }
  return Math.round(seasonScore || 0)
}

/**
 * Integer percent shares of the summed scores via largest remainder:
 * floor every exact share, then hand the leftover points to the largest
 * fractional parts (earlier index wins ties) so the shares always sum
 * to exactly 100. All 0 when the total is 0.
 */
export function largestRemainderShares(scores: number[]): number[] {
  const total = scores.reduce((sum, score) => sum + score, 0)
  if (total <= 0) return scores.map(() => 0)

  const exact = scores.map((score) => (score / total) * 100)
  const shares = exact.map(Math.floor)
  let leftover = 100 - shares.reduce((sum, share) => sum + share, 0)

  const byRemainder = exact
    .map((value, idx) => ({ idx, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx)
  for (const { idx } of byRemainder) {
    if (leftover <= 0) break
    shares[idx] += 1
    leftover -= 1
  }
  return shares
}

/**
 * Fold approved teams and their active rosters into the ranked board.
 * Team score = sum of member scores (empty rosters stay listed at 0);
 * ties break by memberCount, then username, so equal teams never
 * flip-flop between reads. Members sort score desc inside their team.
 *
 * Burn only decorates — it never touches the sort — and has two fuels:
 * burnByUser (userId -> exact-decimal USD reported through the
 * consent-gated CLI token RPC) and cursorBurnByTeamMember
 * (teamUserId -> userId -> exact-decimal USD estimated from verified
 * Cursor tokens at the season house rate; per (team, member) because
 * the server's day floor depends on when THAT affiliation went
 * active). Per member the fold is CLI ?? estimate — real dollars beat
 * house math and the two are never summed, so double-pay is
 * structurally impossible. Each team sums its members' folded burn
 * with addExactDecimals and raises burnIncludesEstimate when any
 * counted member's source is 'cursor'; the totals fold the teams.
 */
export function buildTeamBoard(
  teams: TeamBoardTeamInput[],
  members: TeamBoardMemberInput[],
  seasonState: SeasonState,
  burnByUser: ReadonlyMap<number, string> = new Map(),
  cursorBurnByTeamMember: ReadonlyMap<number, ReadonlyMap<number, string>> = new Map()
): { rows: TeamBoardRow[]; totals: TeamBoardTotals } {
  const membersByTeam = new Map<number, TeamBoardMemberInput[]>()
  for (const member of members) {
    const roster = membersByTeam.get(member.teamUserId)
    if (roster) roster.push(member)
    else membersByTeam.set(member.teamUserId, [member])
  }

  const unranked = teams.map((team) => {
    const roster = (membersByTeam.get(team.id) ?? [])
      .map((member) => {
        const username = member.twitter_username || `User${member.userId}`
        const cliBurn = burnByUser.get(member.userId)
        const cursorBurn = cursorBurnByTeamMember.get(team.id)?.get(member.userId)
        // The per-member fold: CLI ?? estimate, never both.
        const burnUsd =
          cliBurn !== undefined
            ? exactDecimal(cliBurn)
            : cursorBurn !== undefined
              ? exactDecimal(cursorBurn)
              : null
        const burnSource: TeamBurnSource | null =
          cliBurn !== undefined ? 'cli' : cursorBurn !== undefined ? 'cursor' : null
        return {
          userId: member.userId,
          username,
          display_name: member.twitter_name || username,
          profile_image: member.twitter_profile_image,
          tier: member.tier,
          score: memberSeasonScore(
            member.season_score,
            member.last_calculated_at,
            seasonState
          ),
          burnUsd,
          burnSource
        }
      })
      .sort((a, b) => b.score - a.score || a.userId - b.userId)

    const shares = largestRemainderShares(roster.map((member) => member.score))
    const username = team.twitter_username || `User${team.id}`

    let burnUsd = '0'
    let burnPilots = 0
    let burnIncludesEstimate = false
    for (const member of roster) {
      if (member.burnUsd === null) continue
      burnUsd = addExactDecimals(burnUsd, member.burnUsd)
      burnPilots += 1
      if (member.burnSource === 'cursor') burnIncludesEstimate = true
    }

    return {
      userId: team.id,
      username,
      display_name: team.twitter_name || username,
      profile_image: team.twitter_profile_image,
      score: roster.reduce((sum, member) => sum + member.score, 0),
      memberCount: roster.length,
      burnUsd,
      burnPilots,
      burnIncludesEstimate,
      members: roster.map((member, idx): TeamBoardMember => ({
        ...member,
        share: shares[idx]
      }))
    }
  })

  const rows: TeamBoardRow[] = unranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.memberCount - a.memberCount ||
        a.username.localeCompare(b.username)
    )
    .map((team, idx) => ({ ...team, rank: idx + 1 }))

  return {
    rows,
    totals: {
      teams: rows.length,
      members: rows.reduce((sum, row) => sum + row.memberCount, 0),
      topScore: rows[0]?.score ?? 0,
      burnUsd: rows.reduce((sum, row) => addExactDecimals(sum, row.burnUsd), '0'),
      burnPilots: rows.reduce((sum, row) => sum + row.burnPilots, 0),
      burnIncludesEstimate: rows.some((row) => row.burnIncludesEstimate)
    }
  }
}
