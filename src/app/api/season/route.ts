import { NextResponse } from 'next/server'
import { fetchSeasonState } from '@/lib/seasonServer'
import { createServiceClient } from '@/lib/supabaseServer'

// Public season calendar: current/next season + phase. Consumed by the
// dashboard rail and the leaderboard countdown; nothing sensitive here.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET() {
  try {
    const state = await fetchSeasonState(supabase)
    return NextResponse.json({
      success: true,
      ...state,
      serverTime: new Date().toISOString()
    })
  } catch (error) {
    console.error('[Season] GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to load season' },
      { status: 500 }
    )
  }
}
