import { NextRequest, NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { generateInviteCode } from '@/lib/inviteCodes'
import { isInviteEmailConfigured, sendWaitlistInviteEmail } from '@/lib/inviteEmail'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Send (or retry) ONE waitlist beta invite. prepare_waitlist_invite
// (migration 039) does all the safety work in a single transaction —
// row lock, duplicate refusal, code mint/reuse, audit row — so this
// route only delivers the email and records the result.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const QUEUE_SELECT =
  'waitlist_id, email, created_at, attempt_count, last_attempt_at, sent_at, last_error, code, redeemed_at, redeemed_by_username, queue_status'

interface QueueRow {
  waitlist_id: string
  email: string
  created_at: string
  attempt_count: number | null
  last_attempt_at: string | null
  sent_at: string | null
  last_error: string | null
  code: string | null
  redeemed_at: string | null
  redeemed_by_username: string | null
  queue_status: 'pending' | 'sending' | 'sent' | 'failed' | 'redeemed'
}

// Same Entry shape as GET /api/admin/waitlist. Kept in sync manually —
// route files cannot export non-handler symbols.
function toEntry(row: QueueRow) {
  return {
    id: row.waitlist_id,
    email: row.email,
    createdAt: row.created_at,
    status: row.queue_status,
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at ?? null,
    sentAt: row.sent_at ?? null,
    lastError: row.last_error ?? null,
    code: row.code ?? null,
    redeemedBy: row.redeemed_by_username ?? null,
    redeemedAt: row.redeemed_at ?? null
  }
}

async function fetchEntry(waitlistId: string) {
  const { data, error } = await supabase
    .from('waitlist_invite_queue')
    .select(QUEUE_SELECT)
    .eq('waitlist_id', waitlistId)
    .maybeSingle()
  if (error || !data) {
    console.error('Failed to reload waitlist queue entry:', error)
    return null
  }
  return toEntry(data as QueueRow)
}

interface PrepareRow {
  outcome: 'not_found' | 'redeemed' | 'already_sent' | 'in_progress' | 'ready'
  invite_code: string | null
  invite_code_id: number | null
  attempt: number | null
}

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
    if (!UUID_RE.test(id || '')) {
      return NextResponse.json({ error: 'Invalid waitlist id' }, { status: 400 })
    }

    // Fail closed BEFORE any DB write: without provider config the RPC
    // would claim the row and strand it in 'sending' for no reason.
    if (!isInviteEmailConfigured()) {
      return NextResponse.json(
        { error: 'Email delivery is not configured' },
        { status: 503 }
      )
    }

    // Recipient lookup — email only, nothing else leaves the table.
    const { data: signup, error: signupError } = await supabase
      .from('waitlist')
      .select('email')
      .eq('id', id)
      .maybeSingle()
    if (signupError) {
      console.error('Failed to load waitlist entry:', signupError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    if (!signup) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    // Atomic claim. Retry on the (unlikely) code collision, like
    // /api/admin/invites — only a first send can collide, retries reuse
    // the already-minted code and never hit the unique index.
    let prep: PrepareRow | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateInviteCode()
      const { data, error } = await supabase.rpc('prepare_waitlist_invite', {
        p_admin_user_id: staff.staff.userId,
        p_waitlist_id: id,
        p_code: candidate
      })
      if (!error) {
        const row = (Array.isArray(data) ? data[0] : data) as PrepareRow | undefined
        if (!row) {
          console.error('Failed to prepare waitlist invite: RPC returned no row')
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        }
        prep = row
        break
      }
      if (error.code !== '23505') {
        console.error('Failed to prepare waitlist invite:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    }
    if (!prep) {
      return NextResponse.json({ error: 'Failed to generate a unique code' }, { status: 500 })
    }

    switch (prep.outcome) {
      case 'not_found':
        return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
      case 'already_sent':
        return NextResponse.json({ error: 'Invite already sent' }, { status: 409 })
      case 'redeemed':
        return NextResponse.json(
          { error: 'Already redeemed — this person has an account' },
          { status: 409 }
        )
      case 'in_progress':
        return NextResponse.json({ error: 'Send already in progress' }, { status: 409 })
      case 'ready':
        break
      default:
        console.error('Unexpected prepare_waitlist_invite outcome:', prep.outcome)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    // Always deliver the code the RPC returned: on a retry it is the
    // originally minted one, not this request's local candidate.
    const code = prep.invite_code
    if (!code) {
      console.error('prepare_waitlist_invite returned ready without a code')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const joinUrl = `${resolveAppUrl(request)}/join/${code}`
    const result = await sendWaitlistInviteEmail({
      to: signup.email,
      code,
      joinUrl,
      waitlistId: id
    })

    const now = new Date().toISOString()

    if (!result.ok) {
      const { error: failError } = await supabase
        .from('waitlist_invites')
        .update({ status: 'failed', last_error: result.error, updated_at: now })
        .eq('waitlist_id', id)
      if (failError) {
        // Row stays 'sending'; the RPC's staleness window makes it
        // retryable after 5 minutes either way.
        console.error('Failed to record failed send:', failError)
      }
      return NextResponse.json(
        { error: 'Email send failed', entry: await fetchEntry(id) },
        { status: 502 }
      )
    }

    const { error: sentError } = await supabase
      .from('waitlist_invites')
      .update({
        status: 'sent',
        sent_at: now,
        provider_message_id: result.messageId,
        updated_at: now
      })
      .eq('waitlist_id', id)
    if (sentError) {
      // The email IS out. Surface the failure — a manual retry after the
      // staleness window is deduped by the Resend idempotency key, so
      // this cannot double-deliver.
      console.error('Failed to record sent invite:', sentError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const entry = await fetchEntry(id)
    if (!entry) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    return NextResponse.json({ entry })
  } catch (error) {
    console.error('Admin waitlist invite POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
