import { NextRequest, NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { normalizeInviteCode } from '@/lib/inviteCodes'

// Pretty shareable referral URL: /join/CODE lands on /login with the
// code pre-applied. No validation here — the login page pre-checks and
// the OAuth callback atomically consumes the code.

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const normalized = normalizeInviteCode(code || '')
  const appUrl = resolveAppUrl(request)
  const target = normalized
    ? `${appUrl}/login?invite=${encodeURIComponent(normalized)}`
    : `${appUrl}/login`
  return NextResponse.redirect(target)
}
