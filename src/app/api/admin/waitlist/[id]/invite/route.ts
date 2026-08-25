import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { sendWaitlistInvite } from '@/lib/waitlistInvite'

// Send (or retry) ONE waitlist beta invite. prepare_waitlist_invite
// (migration 039) does all the safety work in a single transaction —
// row lock, duplicate refusal, code mint/reuse, audit row — so this
// route only delivers the email and records the result.

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const staff = await getStaffUser(request, 'invite.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    const { id } = await params
    const result = await sendWaitlistInvite({
      request,
      waitlistId: id,
      adminUserId: staff.staff.userId
    })
    return NextResponse.json(result.payload, { status: result.status })
  } catch (error) {
    console.error('Admin waitlist invite POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
