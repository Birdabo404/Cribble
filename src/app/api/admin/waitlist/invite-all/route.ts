import { NextRequest, NextResponse } from 'next/server'
import { isInviteEmailConfigured } from '@/lib/inviteEmail'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import { sendWaitlistInvite } from '@/lib/waitlistInvite'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const supabase = createServiceClient()

// Keep each server invocation bounded. The client repeats this endpoint
// until remaining reaches zero, so large queues still drain completely.
const SENDS_PER_REQUEST = 100

// Resend's default team limit is 10 requests/second. The individual-send
// API is intentional: every recipient keeps their own idempotency key.
const SEND_INTERVAL_MS = 125

interface PendingRow {
  waitlist_id: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function countPending(): Promise<number | null> {
  const { count, error } = await supabase
    .from('waitlist_invite_queue')
    .select('*', { count: 'exact', head: true })
    .eq('queue_status', 'pending')
  if (error) {
    console.error('Failed to count pending waitlist invites:', error)
    return null
  }
  return count ?? 0
}

export async function POST(request: NextRequest) {
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

    // Check before selecting or claiming any rows. sendWaitlistInvite
    // repeats this guard so the shared single-send path is safe alone.
    if (!isInviteEmailConfigured()) {
      return NextResponse.json(
        { error: 'Email delivery is not configured' },
        { status: 503 }
      )
    }

    const { data, error } = await supabase
      .from('waitlist_invite_queue')
      .select('waitlist_id')
      .eq('queue_status', 'pending')
      .order('created_at', { ascending: true })
      .range(0, SENDS_PER_REQUEST - 1)

    if (error) {
      console.error('Failed to load pending waitlist invites:', error)
      return NextResponse.json({ error: 'Failed to load pending invites' }, { status: 500 })
    }

    const pending = (data ?? []) as PendingRow[]
    let sent = 0
    let failed = 0
    let skipped = 0

    for (let index = 0; index < pending.length; index++) {
      const result = await sendWaitlistInvite({
        request,
        waitlistId: pending[index].waitlist_id,
        adminUserId: staff.staff.userId
      })

      if (result.status === 200) {
        sent++
      } else if (result.status === 502) {
        // Provider failures are persisted as 'failed' and remain
        // individually retryable from the queue.
        failed++
      } else if (result.status === 404 || result.status === 409) {
        // A concurrent single/bulk send may have claimed the row after
        // this request selected it. The atomic RPC safely refuses it.
        skipped++
      } else {
        const remaining = await countPending()
        return NextResponse.json(
          {
            error: result.payload.error ?? 'Bulk send stopped unexpectedly.',
            processed: sent + failed + skipped,
            sent,
            failed,
            skipped,
            remaining
          },
          { status: result.status }
        )
      }

      if (index < pending.length - 1) {
        await sleep(SEND_INTERVAL_MS)
      }
    }

    const remaining = await countPending()
    if (remaining === null) {
      return NextResponse.json(
        {
          error: 'Invites were processed, but the remaining queue could not be counted.',
          processed: pending.length,
          sent,
          failed,
          skipped,
          remaining: null
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      processed: pending.length,
      sent,
      failed,
      skipped,
      remaining
    })
  } catch (error) {
    console.error('Admin waitlist invite-all POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
