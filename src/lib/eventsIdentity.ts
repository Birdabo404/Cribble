import type { SupabaseClient } from '@supabase/supabase-js'

export type EventsIdentityColumn = 'twitter_user_id' | 'user_id'

let cachedColumn: EventsIdentityColumn | null | undefined
let inflight: Promise<EventsIdentityColumn | null> | null = null
let cachedUserIdUuidMode: boolean | undefined
let userIdUuidInflight: Promise<boolean> | null = null

function isUnsupportedColumnError(message: string) {
  const m = message.toLowerCase()
  return (
    (m.includes('column') && m.includes('does not exist')) ||
    m.includes('invalid input syntax') ||
    m.includes('operator does not exist')
  )
}

async function canFilterColumn(
  supabase: SupabaseClient,
  column: EventsIdentityColumn
) {
  // Use a sentinel ID that should never match a real user row.
  const { error } = await supabase
    .from('events_raw')
    .select('id')
    .eq(column, -1)
    .limit(1)

  if (!error) return true
  if (isUnsupportedColumnError(error.message || '')) return false

  // For unknown errors, be conservative and treat as unsupported.
  console.warn(`[eventsIdentity] Probe failed for ${column}:`, error.message)
  return false
}

async function userIdAcceptsUuidValue(supabase: SupabaseClient) {
  if (cachedUserIdUuidMode !== undefined) return cachedUserIdUuidMode
  if (userIdUuidInflight) return userIdUuidInflight

  userIdUuidInflight = (async () => {
    const { error } = await supabase
      .from('events_raw')
      .select('id')
      .eq('user_id', '00000000-0000-0000-0000-000000000000')
      .limit(1)

    if (!error) return true
    if (isUnsupportedColumnError(error.message || '')) return false

    console.warn('[eventsIdentity] UUID probe failed for user_id:', error.message)
    return false
  })()

  cachedUserIdUuidMode = await userIdUuidInflight
  userIdUuidInflight = null
  return cachedUserIdUuidMode
}

function toCompatUserUuid(userId: number) {
  const normalized = Math.max(0, Math.trunc(userId))
    .toString()
    .padStart(12, '0')
    .slice(-12)
  return `00000000-0000-0000-0000-${normalized}`
}

/**
 * Determine which integer user identity column can be safely used with events_raw.
 *
 * Priority:
 * 1) twitter_user_id (legacy column seen in some Supabase projects)
 * 2) user_id (expected by current migrations)
 */
export async function getEventsIdentityColumn(
  supabase: SupabaseClient
): Promise<EventsIdentityColumn | null> {
  if (cachedColumn !== undefined) return cachedColumn
  if (inflight) return inflight

  inflight = (async () => {
    if (await canFilterColumn(supabase, 'twitter_user_id')) return 'twitter_user_id'
    if (await canFilterColumn(supabase, 'user_id')) return 'user_id'
    return null
  })()

  cachedColumn = await inflight
  inflight = null
  return cachedColumn
}

export async function applyEventsUserEq<T>(
  supabase: SupabaseClient,
  query: T,
  userId: number
): Promise<{ query: T; column: EventsIdentityColumn | null }> {
  const column = await getEventsIdentityColumn(supabase)
  if (!column) return { query, column: null }
  return {
    // Supabase query builder lacks dynamic column typing for schema-compat layer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (query as any).eq(column, userId) as T,
    column
  }
}

export async function buildEventsUserInsertFields(
  supabase: SupabaseClient,
  userId: number
): Promise<Record<string, string | number>> {
  const column = await getEventsIdentityColumn(supabase)
  if (!column) {
    // Fallback to user_id so local dev databases keep working.
    return { user_id: userId }
  }

  if (column === 'twitter_user_id') {
    const payload: Record<string, string | number> = { twitter_user_id: userId }
    // Some Supabase projects keep user_id as UUID + NOT NULL. Populate it with
    // a deterministic compatibility UUID so inserts don't fail.
    if (await userIdAcceptsUuidValue(supabase)) {
      payload.user_id = toCompatUserUuid(userId)
    }
    return payload
  }

  return { user_id: userId }
}

