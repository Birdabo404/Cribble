import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    .single()

  if (sessionError || !session) {
    return { ok: false, status: 401, error: 'Invalid or expired session' }
  }

  return { ok: true, userId: Number(session.user_id) }
}

