import { NextRequest } from 'next/server'
import { createServiceClient } from './supabaseServer'

const supabase = createServiceClient()

export type SessionUserResult =
  | { ok: true; userId: number }
  | { ok: false; status: number; error: string }

export async function getSessionUserId(request: NextRequest): Promise<SessionUserResult> {
  const sessionToken = request.cookies.get('cribble_session')?.value

  if (!sessionToken) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const { data: session, error: sessionError } = await supabase
    .from('user_sessions')
    .select('user_id')
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

  if (!session) {
    return { ok: false, status: 401, error: 'Invalid or expired session' }
  }

  const userId = Number(session.user_id)
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .maybeSingle()

  // As above, a database failure is not proof that the account is banned
  // or missing. Returning 503 keeps clients from treating an outage as a
  // logout. A definitive missing user is invalid because sessions are
  // never valid without their owner row.
  if (userError) {
    console.error('[SessionAuth] Account status lookup failed:', userError.message)
    return { ok: false, status: 503, error: 'Account status lookup failed' }
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Session owner not found' }
  }

  // Bans are hard account locks. This catches sessions missed by the
  // normal ban-time deletion (for example, an out-of-band database ban).
  // Suspension remains a soft visibility penalty and intentionally keeps
  // normal app access.
  if (user.status === 'banned') {
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

