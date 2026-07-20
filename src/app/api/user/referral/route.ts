import { NextRequest, NextResponse } from 'next/server'
import { resolveShareOrigin } from '@/lib/appUrl'
import { ensureReferralCode, REFERRAL_CAP } from '@/lib/referrals'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const referral = await ensureReferralCode(supabase, session.userId)
    if (!referral) {
      return NextResponse.json(
        { error: 'Failed to prepare referral code' },
        { status: 500 }
      )
    }

    const [joinedResult, rewardsResult] = await Promise.all([
      supabase
        .from('invite_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('invite_code_id', referral.id),
      supabase
        .from('referral_rewards')
        .select('points')
        .eq('referrer_user_id', session.userId)
    ])

    if (joinedResult.error) {
      console.error('[Referrals] Joined count failed:', joinedResult.error)
    }
    if (rewardsResult.error) {
      console.error('[Referrals] Rewards read failed:', rewardsResult.error)
    }

    const rewards = rewardsResult.data ?? []
    // Capped recruits are recorded with points=0 — they joined, but
    // don't count as rewarded and never earn points.
    const rewarded = rewards.filter((row) => Number(row.points) > 0).length
    const pointsEarned = rewards.reduce((sum, row) => sum + Number(row.points || 0), 0)

    return NextResponse.json({
      code: referral.code,
      // Share origin, not request origin: this link is made to be posted
      // publicly, so it must be the canonical domain even from a dev box.
      link: `${resolveShareOrigin()}/join/${referral.code}`,
      stats: {
        joined: joinedResult.count ?? 0,
        rewarded,
        pointsEarned,
        capRemaining: Math.max(0, REFERRAL_CAP - rewarded)
      }
    })
  } catch (error) {
    console.error('[Referrals] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
