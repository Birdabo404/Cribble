import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Triage: move a feedback item between new / seen / done. Status is the
// only mutable field — the message itself is never editable by staff.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const STATUSES = ['new', 'seen', 'done'] as const
type FeedbackStatus = (typeof STATUSES)[number]

function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(rateLimitResult) }
    )
  }

  const staff = await getStaffUser(request, 'feedback.manage')
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: staff.status })
  }

  const { id } = await params
  const feedbackId = Number(id)
  if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
    return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  if (!isFeedbackStatus(body.status)) {
    return NextResponse.json({ error: 'status must be new, seen or done' }, { status: 400 })
  }

  try {
    const { data, error } = await supabase
      .from('feedback')
      .update({ status: body.status })
      .eq('id', feedbackId)
      .select('id')

    if (error) {
      console.error('[AdminFeedback] Update failed:', error)
      return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[AdminFeedback] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
