import { NextRequest, NextResponse } from 'next/server'
import { getOwnedPlateIds, isProTier } from '@/lib/entitlements'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// The signed-in user's cosmetics state — the contract the shop page and
// profile editor consume:
//   { success: true, tier, isPro, ownedPlateIds, equippedPlate, premiumSince }
// equippedPlate is the raw users.metadata.equipped_plate value (string or
// null); ownership/catalog validation happens at equip/render time.
// premiumSince is users.metadata.premium_since (ISO string, stamped on the
// first Pro grant) or null — backs the "Premium since <date>" UI.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('subscription_tier, metadata')
      .eq('id', session.userId)
      .single()

    if (error || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const ownedPlateIds = await getOwnedPlateIds(supabase, session.userId)

    const meta = (user.metadata || {}) as Record<string, unknown>
    const equippedPlate =
      typeof meta.equipped_plate === 'string' && meta.equipped_plate.trim()
        ? meta.equipped_plate
        : null

    const premiumSince =
      typeof meta.premium_since === 'string' && meta.premium_since ? meta.premium_since : null

    const tier =
      typeof user.subscription_tier === 'string' && user.subscription_tier
        ? user.subscription_tier
        : 'FREE'

    return NextResponse.json({
      success: true,
      tier,
      isPro: isProTier(tier),
      ownedPlateIds,
      equippedPlate,
      premiumSince
    })
  } catch (error) {
    console.error('[Cosmetics] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
