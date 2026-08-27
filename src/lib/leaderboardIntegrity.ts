import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertMissingNotifications } from './notifications'

export interface IntegrityStanding {
  userId: number
  rank: number
  score: number
}

export type LeaderboardIntegrityIssueCode =
  | 'top_mismatch'
  | 'duplicate_api_ranks'
  | 'duplicate_canonical_ranks'
  | 'duplicate_snapshot_ranks'
  | 'monitor_error'

export interface LeaderboardIntegrityIssue {
  code: LeaderboardIntegrityIssueCode
  message: string
  details: Record<string, unknown>
}

export interface LeaderboardIntegrityReport {
  healthy: boolean
  issues: LeaderboardIntegrityIssue[]
}

function duplicateRanks(rows: readonly IntegrityStanding[]): number[] {
  const counts = new Map<number, number>()
  for (const row of rows) {
    if (!Number.isInteger(row.rank) || row.rank < 1) continue
    counts.set(row.rank, (counts.get(row.rank) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([rank]) => rank)
    .sort((a, b) => a - b)
}

function topDetails(row: IntegrityStanding | null): Record<string, number> | null {
  return row
    ? { userId: row.userId, rank: row.rank, score: row.score }
    : null
}

/** Compare what the API actually returns with the canonical user_scores
 *  ranker, and independently verify that neither the response nor the
 *  persisted movement ledger contains duplicate numeric ranks. */
export function assessLeaderboardIntegrity(
  apiRows: readonly IntegrityStanding[],
  canonicalRows: readonly IntegrityStanding[],
  snapshotRows: readonly IntegrityStanding[]
): LeaderboardIntegrityReport {
  const issues: LeaderboardIntegrityIssue[] = []
  const apiTop = apiRows[0] ?? null
  const canonicalTop = canonicalRows[0] ?? null

  if (
    apiTop?.userId !== canonicalTop?.userId ||
    apiTop?.rank !== canonicalTop?.rank
  ) {
    issues.push({
      code: 'top_mismatch',
      message: 'API top player does not match canonical user_scores ranking',
      details: {
        apiTop: topDetails(apiTop),
        canonicalTop: topDetails(canonicalTop)
      }
    })
  }

  const duplicateApiRanks = duplicateRanks(apiRows)
  if (duplicateApiRanks.length > 0) {
    issues.push({
      code: 'duplicate_api_ranks',
      message: 'API leaderboard contains duplicate ranks',
      details: { ranks: duplicateApiRanks }
    })
  }

  const duplicateCanonicalRanks = duplicateRanks(canonicalRows)
  if (duplicateCanonicalRanks.length > 0) {
    issues.push({
      code: 'duplicate_canonical_ranks',
      message: 'Canonical user_scores ranking contains duplicate ranks',
      details: { ranks: duplicateCanonicalRanks }
    })
  }

  const duplicateSnapshotRanks = duplicateRanks(snapshotRows)
  if (duplicateSnapshotRanks.length > 0) {
    issues.push({
      code: 'duplicate_snapshot_ranks',
      message: 'leaderboard_ranks contains duplicate ranks',
      details: { ranks: duplicateSnapshotRanks }
    })
  }

  return { healthy: issues.length === 0, issues }
}

export function leaderboardMonitorError(error: unknown): LeaderboardIntegrityReport {
  const message = error instanceof Error ? error.message : String(error)
  return {
    healthy: false,
    issues: [
      {
        code: 'monitor_error',
        message: 'Leaderboard integrity monitor could not complete',
        details: { error: message.slice(0, 500) }
      }
    ]
  }
}

/** Persistent, deduped staff alerts. A continuing incident alerts once per
 *  UTC day; a materially different issue gets a different fingerprint and
 *  alerts immediately. The cron also returns 500 so the failed check remains
 *  visible in deployment logs even if staff notification delivery fails. */
export async function alertLeaderboardIntegrity(
  supabase: SupabaseClient,
  report: LeaderboardIntegrityReport,
  now: Date = new Date()
): Promise<void> {
  if (report.healthy || report.issues.length === 0) return

  try {
    const { data: staffRows, error } = await supabase
      .from('users')
      .select('id')
      .not('staff_role', 'is', null)

    if (error) {
      console.error('[LeaderboardIntegrity] Staff lookup failed:', error)
      return
    }

    const fingerprint = createHash('sha256')
      .update(JSON.stringify(report.issues))
      .digest('hex')
      .slice(0, 16)
    const day = now.toISOString().slice(0, 10).replaceAll('-', '')
    const dedupeKey = `leaderboard_integrity_${day}_${fingerprint}`
    const body = report.issues
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join(' · ')
      .slice(0, 1000)

    for (const staff of staffRows ?? []) {
      await insertMissingNotifications(supabase, Number(staff.id), [
        {
          type: 'system',
          title: 'LEADERBOARD INTEGRITY ALERT',
          body,
          data: {
            kind: 'leaderboard_integrity',
            checkedAt: now.toISOString(),
            issues: report.issues
          },
          dedupeKey
        }
      ])
    }
  } catch (error) {
    console.error('[LeaderboardIntegrity] Staff alert failed:', error)
  }
}
