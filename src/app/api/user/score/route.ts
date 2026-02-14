import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    const { data: events } = await supabase
      .from('events_raw')
      .select('active_ms, visits')
      .eq('user_id', userId)

    const eventsScore = events?.reduce((sum, e) => sum + (e.active_ms || 0) * 0.001 + (e.visits || 0) * 50, 0) || 0
    const score = Math.round(eventsScore)
    return NextResponse.json({ success: true, score })
  } catch (e) {
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

    const { data: events } = await supabase
      .from('events_raw')
      .select('active_ms, visits')
      .eq('user_id', idNum)

    const eventsScore = events?.reduce((sum, e) => sum + (e.active_ms || 0) * 0.001 + (e.visits || 0) * 50, 0) || 0
    const score = Math.round(eventsScore)
    return NextResponse.json({ success: true, score })
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
