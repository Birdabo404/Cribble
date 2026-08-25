import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { normalizeInviteCode } from '@/lib/inviteCodes'
import { checkRateLimit, createRateLimitResponse } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// Pre-flight UX check only — does NOT consume a use. The authoritative,
// atomic redemption happens in the OAuth callback on first signup.
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

    // Strict charset gate before touching the DB. Generated codes are
    // CRIB-XXXX-XXXX from an uppercase alphanumeric alphabet, so anything
    // outside [A-Z0-9-] is invalid by construction. This also keeps ilike
    // wildcards (%, _) out entirely — a bare "%" used to match ANY invite.
    if (!code || code.length < 4 || code.length > 32 || !/^[A-Z0-9-]+$/.test(code)) {
      return NextResponse.json({ valid: false })
    }

    // Codes are stored uppercase (see generateInviteCode) and the input is
    // uppercased by normalizeInviteCode, so exact .eq() is a case-normalized
    // equality — mirroring UPPER(code) = UPPER(TRIM(p_code)) in the redeem RPC.
    const { data: invite, error } = await supabase
      .from('invite_codes')
      .select('id, max_uses, use_count, expires_at, revoked_at')
      .eq('code', code)
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
