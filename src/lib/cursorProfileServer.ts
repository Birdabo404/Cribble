// Database writes shared by the claim route and the sync cron: one
// scrape outcome -> the cursor_profiles stats/health columns plus the
// merged cursor_profile_daily upsert. Expects the service-role client —
// both tables are RLS-locked with no policies (migration 062).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mergeCursorDailySeries,
  type CursorProfileData,
  type CursorSyncStatus
} from '@/lib/cursorProfile'

/** cursor_profiles columns refreshed by every successful scrape. */
export function cursorProfileSnapshotColumns(
  profile: CursorProfileData,
  syncedAtIso: string
): Record<string, unknown> {
  return {
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    joined_date: profile.joinedDate,
    current_streak: profile.stats.currentStreak,
    longest_streak: profile.stats.longestStreak,
    agents_local: profile.stats.agentsLocal,
    agents_cloud: profile.stats.agentsCloud,
    longest_agent_seconds: profile.stats.longestAgentSeconds,
    top_models: profile.topModels,
    last_synced_at: syncedAtIso,
    last_sync_status: 'ok',
    last_sync_error: null,
    updated_at: syncedAtIso
  }
}

/**
 * Upserts the merged daily series. Days already stored from earlier
 * syncs but absent from this fetch (older than cursor.com's rolling
 * window) are left untouched — that retention is the whole point of
 * the table. Returns an error message or null.
 */
export async function upsertCursorProfileDaily(
  supabase: SupabaseClient,
  userId: number,
  profile: CursorProfileData,
  syncedAtIso: string
): Promise<string | null> {
  const rows = mergeCursorDailySeries(profile).map((row) => ({
    user_id: userId,
    day: row.date,
    tokens: row.tokens,
    agents_local: row.agentsLocal,
    agents_cloud: row.agentsCloud,
    updated_at: syncedAtIso
  }))
  if (rows.length === 0) return null

  const { error } = await supabase
    .from('cursor_profile_daily')
    .upsert(rows, { onConflict: 'user_id,day' })
  return error ? error.message : null
}

/**
 * Records a failed scrape on the profile row. The daily history stays;
 * the leaderboard RPC stops ranking the user until a sync succeeds
 * again (last_sync_status = 'ok').
 */
export async function recordCursorProfileSyncFailure(
  supabase: SupabaseClient,
  userId: number,
  status: Exclude<CursorSyncStatus, 'ok'>,
  message: string | null,
  syncedAtIso: string
): Promise<string | null> {
  const { error } = await supabase
    .from('cursor_profiles')
    .update({
      last_synced_at: syncedAtIso,
      last_sync_status: status,
      last_sync_error: message,
      updated_at: syncedAtIso
    })
    .eq('user_id', userId)
  return error ? error.message : null
}
