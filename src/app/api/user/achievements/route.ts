import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { ACHIEVEMENTS } from '@/lib/achievements'
import { evaluateAchievements } from '@/lib/achievementsServer'
import { getSessionUserId } from '@/lib/sessionAuth'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    // Evaluating on read (in addition to the post-sync hook) backfills
    // unlocks for activity that predates the achievements feature and
    // catches rank changes caused by other users syncing.
    const evaluation = await evaluateAchievements(supabase, session.userId)
    if (!evaluation) {
      return NextResponse.json(
        { success: false, error: 'Achievement evaluation failed' },
        { status: 500 }
      )
    }

    const achievements = ACHIEVEMENTS.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      rarity: def.rarity,
      icon: def.icon,
      target: def.target,
      current: def.current(evaluation.stats),
      unit: def.unit,
      unlockedAt: evaluation.unlockedAt.get(def.id) ?? null
    }))

    return NextResponse.json({
      success: true,
      achievements,
      summary: {
        unlocked: achievements.filter((a) => a.unlockedAt !== null).length,
        total: achievements.length
      }
    })
  } catch (error) {
    console.error('[Achievements API] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
