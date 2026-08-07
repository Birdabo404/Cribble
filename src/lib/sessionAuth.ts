import { NextRequest } from 'next/server'
import { createServiceClient } from './supabaseServer'

const supabase = createServiceClient()

export type SessionUserResult =
  | { ok: true; userId: number }
  | { ok: false; status: number; error: string }

// Session row joined with its owner's account status. The users embed is
// a LEFT join (not !inner) on purpose: a session whose owner row vanished
// must still be distinguishable from an expired/missing token. The FK
// name disambiguates the embed — the live schema carries two identical
// FKs on user_sessions.user_id → users.id, so a bare `users(...)` is
// ambiguous (PGRST201).
type SessionOwnerRow = {
  user_id: number | string
  users: { status: string | null } | null
}

export async function getSessionUserId(request: NextRequest): Promise<SessionUserResult> {
  const sessionToken = request.cookies.get('cribble_session')?.value

  if (!sessionToken) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  // One round trip for what used to be two sequential queries (session
  // lookup, then owner status): the account status rides the session
  // select via the FK embed, halving the auth tax every authenticated
  // API call pays.
  const { data, error: sessionError } = await supabase
    .from('user_sessions')
    .select('user_id, users!user_sessions_user_id_fkey(status)')
    .eq('session_token', sessionToken)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  // A failed lookup (Supabase outage, network blip) is not proof the
  // session is invalid. Clients treat 401 as "logged out" and bounce to
  // /login, so only a definitive miss may return it; everything else is a
  // retryable 503.
  if (sessionError) {
    console.error('[SessionAuth] Session lookup failed:', sessionError.message)
    return { ok: false, status: 503, error: 'Session lookup failed' }
  }

  const session = data as unknown as SessionOwnerRow | null
  if (!session) {
    return { ok: false, status: 401, error: 'Invalid or expired session' }
  }

  const userId = Number(session.user_id)

  // Sessions are never valid without their owner row.
  if (!session.users) {
    return { ok: false, status: 401, error: 'Session owner not found' }
  }

  // Bans are hard account locks. This catches sessions missed by the
  // normal ban-time deletion (for example, an out-of-band database ban).
  // Suspension remains a soft visibility penalty and intentionally keeps
  // normal app access.
  if (session.users.status === 'banned') {
    const { error: deleteError } = await supabase
      .from('user_sessions')
      .delete()
      .eq('session_token', sessionToken)
    if (deleteError) {
      console.error('[SessionAuth] Failed to invalidate banned session:', deleteError.message)
    }
    return { ok: false, status: 401, error: 'Account banned' }
  }

  return { ok: true, userId }
}
