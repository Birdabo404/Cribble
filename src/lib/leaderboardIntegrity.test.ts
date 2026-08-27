import { describe, expect, it } from 'vitest'
import {
  assessLeaderboardIntegrity,
  type IntegrityStanding
} from './leaderboardIntegrity'

const row = (userId: number, rank: number, score: number): IntegrityStanding => ({
  userId,
  rank,
  score
})

describe('assessLeaderboardIntegrity', () => {
  it('accepts matching canonical, API and snapshot standings', () => {
    expect(
      assessLeaderboardIntegrity(
        [row(8, 1, 5000), row(9, 2, 4000)],
        [row(8, 1, 5000), row(9, 2, 4000)],
        [row(8, 1, 5000), row(9, 2, 4000)]
      )
    ).toEqual({ healthy: true, issues: [] })
  })

  it('reports a wrong API leader and duplicate API/snapshot ranks', () => {
    const report = assessLeaderboardIntegrity(
      [row(9, 1, 4000), row(8, 1, 5000)],
      [row(8, 1, 5000), row(9, 2, 4000)],
      [row(8, 1, 5000), row(9, 1, 4000)]
    )

    expect(report.healthy).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'top_mismatch',
      'duplicate_api_ranks',
      'duplicate_snapshot_ranks'
    ])
    expect(report.issues[0].details).toEqual({
      apiTop: { userId: 9, rank: 1, score: 4000 },
      canonicalTop: { userId: 8, rank: 1, score: 5000 }
    })
  })

  it('reports duplicate ranks from the canonical database result', () => {
    const report = assessLeaderboardIntegrity(
      [row(8, 1, 5000)],
      [row(8, 1, 5000), row(9, 1, 4000)],
      []
    )

    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'duplicate_canonical_ranks',
        details: { ranks: [1] }
      })
    ])
  })
})
