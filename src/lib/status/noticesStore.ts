import type { SupabaseClient } from '@supabase/supabase-js'
import type { NoticeEntry } from './types'
import { toNoticeEntry, type NoticeEntryRow } from './notices'

// The one read over status_log_entries (migration 070), shared by the
// public /api/status merge and the staff console. Bounded two ways —
// a lookback window and a row cap — so the public payload can never
// balloon; the derivation (notices.ts) does the rest in memory.

export const NOTICE_COLUMNS = 'id, incident_id, severity, phase, title, body, created_at'

/** How far back the public read looks. Generous next to the 14-day
 *  recent window so a long-running open thread keeps its opening line. */
const LOOKBACK_DAYS = 30
const ROW_CAP = 300
const DAY_MS = 86_400_000

/** Recent log lines, newest first. Throws on a database error — callers
 *  decide whether that means "omit notices" (public) or a 500 (staff). */
export async function readNoticeEntries(
  supabase: SupabaseClient,
  now: Date,
  options: { lookbackDays?: number; cap?: number } = {}
): Promise<NoticeEntry[]> {
  const since = new Date(
    now.getTime() - (options.lookbackDays ?? LOOKBACK_DAYS) * DAY_MS
  ).toISOString()
  const { data, error } = await supabase
    .from('status_log_entries')
    .select(NOTICE_COLUMNS)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(options.cap ?? ROW_CAP)
  if (error) throw new Error(`status log read failed: ${error.message}`)
  return ((data ?? []) as NoticeEntryRow[]).map(toNoticeEntry)
}

/** Every line of one thread, any order. Empty when the id is unknown. */
export async function readThreadEntries(
  supabase: SupabaseClient,
  incidentId: string
): Promise<NoticeEntry[]> {
  const { data, error } = await supabase
    .from('status_log_entries')
    .select(NOTICE_COLUMNS)
    .eq('incident_id', incidentId)
  if (error) throw new Error(`status thread read failed: ${error.message}`)
  return ((data ?? []) as NoticeEntryRow[]).map(toNoticeEntry)
}
