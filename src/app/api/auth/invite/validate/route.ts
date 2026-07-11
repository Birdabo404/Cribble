import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeInviteCode } from '@/lib/inviteCodes'
import { checkRateLimit, createRateLimitResponse } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Pre-flight UX check only — does NOT consume a use. The authoritative,
// atomic redemption happens in the GitHub OAuth callback.
export async function POST(request: NextRequest) {
  // Tight limit so this endpoint can't be used to brute-force codes.
  const rateLimit = checkRateLimit(request, { windowMs: 60 * 1000, maxRequests: 10 })
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.' },
      { status: 429, headers: createRateLimitResponse(rateLimit) }
    )
  }

  try {
    const body = await request.json().catch(() => null)
    const rawCode = typeof body?.code === 'string' ? body.code : ''
    const code = normalizeInviteCode(rawCode)

    if (!code || code.length < 4 || code.length > 32) {
      return NextResponse.json({ valid: false })
    }

    const { data: invite, error } = await supabase
      .from('invite_codes')
      .select('id, max_uses, use_count, expires_at, revoked_at')
      .ilike('code', code)
      .maybeSingle()

    if (error) {
      console.error('Invite validation query failed:', error)
      return NextResponse.json({ error: 'Validation unavailable' }, { status: 500 })
    }

    const valid =
      !!invite &&
      invite.revoked_at === null &&
      (invite.expires_at === null || new Date(invite.expires_at) > new Date()) &&
      invite.use_count < invite.max_uses

    return NextResponse.json({ valid })
  } catch (error) {
    console.error('Invite validation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
