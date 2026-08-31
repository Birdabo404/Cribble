// Rank-snapshot maintenance for the Burn Board, the burn twin of
// leaderboardSnapshot.ts.
//
// The agent usage sync route calls refreshBurnBoardSnapshot after an
// opted-in ingest (and the sharing toggle after an opt-in/out, so the
// board's composition reshuffles immediately). The database RPC
// (migration 065) performs the canonical burn ranking, diff, stale-row
// cleanup and writes in one advisory-locked transaction; this wrapper
// only resolves the season window and records the billboard events the
// committed movement rows describe.

import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveBurnHypeEvents, recordHypeEvents, type BurnHypeDiffRow } from './hypeEvents'
import { fetchSeasonState } from './seasonServer'
import { exactDecimal, resolveTokenBoardWindow } from './tokenLeaderboard'

interface BurnSnapshotRefreshRow {
  user_id: number | string
  rank: number | string
  burn_usd: number | string | null
  prev_rank: number | string | null
  rank_moved_at: string | null
  first_seen_at: string
  updated_at: string
  refreshed_at: string
}

/**
 * Ask Postgres to recompute and persist the Burn Board rank diff.
 *
 * The window is the same season computation the tokens route serves the
 * board with (resolveTokenBoardWindow), pinned to UTC because this is
 * the canonical server snapshot — no viewer timezone exists here. The
 * exact season bounds ride along as p_since_at/p_until_at for the v2
 * event facts, mirroring how /api/leaderboard/tokens calls
 * agent_token_leaderboard. During intermission season.current stays the
 * completed season, so the window (and therefore the ledger) freezes on
 * the final standings by construction.
 *
 * public.refresh_burn_board_snapshot(...) owns the transaction,
 * advisory lock, canonical ranking and stale-row deletion. It returns
 * only inserted or changed rows, all carrying one refreshed_at, so the
 * burn hype derivation can identify movements from this pass. Never
 * throws and tolerates the migration not being applied — a failed
 * refresh must not break the sync that triggered it, the same stance
 * as refreshLeaderboardSnapshot.
 */
export async function refreshBurnBoardSnapshot(
  supabase: SupabaseClient
): Promise<void> {
  try {
    const season = await fetchSeasonState(supabase)
    const window = resolveTokenBoardWindow('season', season, Date.now(), 'UTC')
    const { data, error } = await supabase.rpc('refresh_burn_board_snapshot', {
      p_since: window.since,
      p_until: window.until,
      p_since_at: season.current?.startsAt ?? null,
      p_until_at: season.current?.endsAt ?? null
    })
    if (error) {
      console.warn('[BurnBoard] Transactional snapshot refresh failed:', error.message)
      return
    }

    const rows = (data || []) as unknown as BurnSnapshotRefreshRow[]
    if (rows.length === 0) return

    const refreshedAtMs = Date.parse(rows[0].refreshed_at)
    if (!Number.isFinite(refreshedAtMs)) {
      console.warn('[BurnBoard] Snapshot refresh returned an invalid timestamp')
      return
    }
    const now = new Date(refreshedAtMs)
    const updates: BurnHypeDiffRow[] = rows.map((row) => ({
      user_id: Number(row.user_id),
      rank: Number(row.rank),
      prev_rank: row.prev_rank === null ? null : Number(row.prev_rank),
      rank_moved_at: row.rank_moved_at
        ? new Date(row.rank_moved_at).toISOString()
        : null,
      burn_usd: exactDecimal(row.burn_usd)
    }))

    // Hype pass, the same signal refreshLeaderboardSnapshot reads: this
    // updates array is the only place a burn climb and the fall it
    // caused exist side by side, so the one-shot billboard events
    // (burn_throne / burn_top3 / burn_top10, victim attached, season
    // burn aboard) are derived and recorded here. recordHypeEvents
    // never throws — hype must not break the sync, same as this whole
    // function.
    await recordHypeEvents(supabase, deriveBurnHypeEvents(updates, now))
  } catch (err) {
    console.warn('[BurnBoard] Snapshot refresh unavailable:', err)
  }
}
