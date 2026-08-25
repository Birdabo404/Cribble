import { NextRequest } from 'next/server'
import { resolveAppUrl } from '@/lib/appUrl'
import { generateInviteCode } from '@/lib/inviteCodes'
import { isInviteEmailConfigured, sendWaitlistInviteEmail } from '@/lib/inviteEmail'
import { createServiceClient } from '@/lib/supabaseServer'

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

export interface WaitlistInviteEntry {
  id: string
  email: string
  createdAt: string
  status: QueueRow['queue_status']
  attemptCount: number
  lastAttemptAt: string | null
  sentAt: string | null
  lastError: string | null
  code: string | null
  redeemedBy: string | null
  redeemedAt: string | null
}

interface PrepareRow {
  outcome: 'not_found' | 'redeemed' | 'already_sent' | 'in_progress' | 'ready'
  invite_code: string | null
  invite_code_id: number | null
  attempt: number | null
}

export interface WaitlistInviteResult {
  status: number
  payload: {
    error?: string
    entry?: WaitlistInviteEntry | null
  }
}

function toEntry(row: QueueRow): WaitlistInviteEntry {
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

async function fetchEntry(waitlistId: string): Promise<WaitlistInviteEntry | null> {
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

/**
 * Claim, deliver and record one waitlist invite. Both the single-send and
 * SEND ALL routes use this path so retries retain the same code and Resend
 * idempotency key.
 */
export async function sendWaitlistInvite({
  request,
  waitlistId,
  adminUserId
}: {
  request: NextRequest
  waitlistId: string
  adminUserId: number
}): Promise<WaitlistInviteResult> {
  if (!UUID_RE.test(waitlistId || '')) {
    return { status: 400, payload: { error: 'Invalid waitlist id' } }
  }

  // Fail closed BEFORE any DB write: without provider config the RPC
  // would claim the row and strand it in 'sending' for no reason.
  if (!isInviteEmailConfigured()) {
    return { status: 503, payload: { error: 'Email delivery is not configured' } }
  }

  // Recipient lookup — email only, nothing else leaves the table.
  const { data: signup, error: signupError } = await supabase
    .from('waitlist')
    .select('email')
    .eq('id', waitlistId)
    .maybeSingle()
  if (signupError) {
    console.error('Failed to load waitlist entry:', signupError)
    return { status: 500, payload: { error: 'Internal server error' } }
  }
  if (!signup) {
    return { status: 404, payload: { error: 'Waitlist entry not found' } }
  }

  // Atomic claim. Retry on the (unlikely) code collision, like
  // /api/admin/invites — only a first send can collide, retries reuse
  // the already-minted code and never hit the unique index.
  let prep: PrepareRow | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateInviteCode()
    const { data, error } = await supabase.rpc('prepare_waitlist_invite', {
      p_admin_user_id: adminUserId,
      p_waitlist_id: waitlistId,
      p_code: candidate
    })
    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as PrepareRow | undefined
      if (!row) {
        console.error('Failed to prepare waitlist invite: RPC returned no row')
        return { status: 500, payload: { error: 'Internal server error' } }
      }
      prep = row
      break
    }
    if (error.code !== '23505') {
      console.error('Failed to prepare waitlist invite:', error)
      return { status: 500, payload: { error: 'Internal server error' } }
    }
  }
  if (!prep) {
    return { status: 500, payload: { error: 'Failed to generate a unique code' } }
  }

  switch (prep.outcome) {
    case 'not_found':
      return { status: 404, payload: { error: 'Waitlist entry not found' } }
    case 'already_sent':
      return { status: 409, payload: { error: 'Invite already sent' } }
    case 'redeemed':
      return {
        status: 409,
        payload: { error: 'Already redeemed — this person has an account' }
      }
    case 'in_progress':
      return { status: 409, payload: { error: 'Send already in progress' } }
    case 'ready':
      break
    default:
      console.error('Unexpected prepare_waitlist_invite outcome:', prep.outcome)
      return { status: 500, payload: { error: 'Internal server error' } }
  }

  // Always deliver the code the RPC returned: on a retry it is the
  // originally minted one, not this request's local candidate.
  const code = prep.invite_code
  if (!code) {
    console.error('prepare_waitlist_invite returned ready without a code')
    return { status: 500, payload: { error: 'Internal server error' } }
  }

  const joinUrl = `${resolveAppUrl(request)}/join/${code}`
  const result = await sendWaitlistInviteEmail({
    to: signup.email,
    code,
    joinUrl,
    waitlistId
  })

  const now = new Date().toISOString()

  if (!result.ok) {
    const { error: failError } = await supabase
      .from('waitlist_invites')
      .update({ status: 'failed', last_error: result.error, updated_at: now })
      .eq('waitlist_id', waitlistId)
    if (failError) {
      // Row stays 'sending'; the RPC's staleness window makes it
      // retryable after 5 minutes either way.
      console.error('Failed to record failed send:', failError)
    }
    return {
      status: 502,
      payload: { error: 'Email send failed', entry: await fetchEntry(waitlistId) }
    }
  }

  const { error: sentError } = await supabase
    .from('waitlist_invites')
    .update({
      status: 'sent',
      sent_at: now,
      provider_message_id: result.messageId,
      updated_at: now
    })
    .eq('waitlist_id', waitlistId)
  if (sentError) {
    // The email IS out. A retry after the staleness window is deduped
    // by the per-waitlist Resend idempotency key.
    console.error('Failed to record sent invite:', sentError)
    return { status: 500, payload: { error: 'Internal server error' } }
  }

  const entry = await fetchEntry(waitlistId)
  if (!entry) {
    return { status: 500, payload: { error: 'Internal server error' } }
  }
  return { status: 200, payload: { entry } }
}
