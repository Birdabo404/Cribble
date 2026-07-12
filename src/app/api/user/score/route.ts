import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { scoreFromEvents, fetchAllUserEvents } from '@/lib/scoring'

// Legacy score endpoint. Kept for compatibility, but now computes through
// the shared scoring library (it previously used a dead formula — 50/visit,
// no sessions — and a hardcoded user_id filter that errors on deployments
// where events_raw.user_id is a UUID, so it always answered 0 there).

const supabase = createServiceClient()

// Helper to validate session and return userId
async function getAuthenticatedUserId(request: NextRequest): Promise<number | null> {
  const sessionToken = request.cookies.get('cribble_session')?.value
  if (!sessionToken) return null

  const { data: session } = await supabase
    .from('user_sessions')
    .select('user_id')
    .eq('session_token', sessionToken)
    .gt('expires_at', new Date().toISOString())
    .single()

  return session?.user_id ?? null
}

async function computeScore(userId: number): Promise<number> {
  const { events } = await fetchAllUserEvents(supabase, userId)
  return scoreFromEvents(events || [])
}

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(request)
    if (!authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId } = await request.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    // Users can only query their own score
    if (userId !== authenticatedUserId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const score = await computeScore(authenticatedUserId)
    return NextResponse.json({ success: true, score })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(request)
    if (!authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = request.nextUrl.searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    const idNum = parseInt(userId)
    if (isNaN(idNum)) return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })

    // Users can only query their own score
    if (idNum !== authenticatedUserId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const score = await computeScore(authenticatedUserId)
    return NextResponse.json({ success: true, score })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
