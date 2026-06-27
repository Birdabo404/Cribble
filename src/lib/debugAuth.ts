import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function requireDevSession(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return { ok: false as const, status: 404, error: 'Not found' }
  }

  const sessionToken = request.cookies.get('cribble_session')?.value
  if (!sessionToken) {
    return { ok: false as const, status: 401, error: 'Unauthorized' }
  }

  const { data: session } = await supabase
    .from('user_sessions')
    .select('user_id')
    .eq('session_token', sessionToken)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (!session) {
    return { ok: false as const, status: 401, error: 'Invalid session' }
  }

  return { ok: true as const, userId: Number(session.user_id) }
}
