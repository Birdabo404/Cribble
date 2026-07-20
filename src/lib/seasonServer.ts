// Server-side season lookups. All reads go through the service-role
// client (the seasons table is RLS-locked with no policies). Every helper
// degrades to a "no calendar" answer when the seasons table is missing
// (migration 025 not applied yet) so routes keep serving instead of 500ing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveSeasonState, type SeasonRow, type SeasonState } from './season'

export const SEASON_COLUMNS = 'id, number, name, starts_at, ends_at, status'

export async function fetchSeasonState(supabase: SupabaseClient): Promise<SeasonState> {
  try {
    // The calendar stays tiny (4 rows/year); the cap just bounds the read.
    const { data, error } = await supabase
      .from('seasons')
      .select(SEASON_COLUMNS)
      .order('number', { ascending: false })
      .limit(12)

    if (error) {
      console.warn('[Season] Calendar read failed:', error.message)
      return deriveSeasonState([])
    }
    return deriveSeasonState((data || []) as SeasonRow[])
  } catch (err) {
    console.warn('[Season] Calendar unavailable:', err)
    return deriveSeasonState([])
  }
}

export interface SeasonWindowMs {
  startMs: number
  endMs: number
}

export interface ActiveSeasonWindowLookup {
  /** False when the seasons table itself is unreachable — callers must
   *  then leave season_score alone (the column may not exist either). */
  available: boolean
  /** The active season's window, or null during intermission. */
  window: SeasonWindowMs | null
}

export async function fetchActiveSeasonWindow(
  supabase: SupabaseClient
): Promise<ActiveSeasonWindowLookup> {
  try {
    const { data, error } = await supabase
      .from('seasons')
      .select('starts_at, ends_at')
      .eq('status', 'active')
      .order('number', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[Season] Active window read failed:', error.message)
      return { available: false, window: null }
    }
    if (!data) return { available: true, window: null }

    const startMs = Date.parse(String(data.starts_at))
    const endMs = Date.parse(String(data.ends_at))
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return { available: true, window: null }
    }
    return { available: true, window: { startMs, endMs } }
  } catch (err) {
    console.warn('[Season] Active window unavailable:', err)
    return { available: false, window: null }
  }
}
