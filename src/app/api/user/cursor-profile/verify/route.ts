import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fetchCursorProfile } from '@/lib/cursorProfile'
import { displayNameHasVerifyCode, generateCursorVerifyCode } from '@/lib/cursorVerify'
import {
  checkDistributedRateLimit,
  checkRateLimit,
  createRateLimitResponse,
  rateLimitConfigs
} from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Ownership verification for the claimed cursor.com profile — the
// display-name challenge that upgrades a trust-based claim (../route.ts)
// into a proven one. The personal CURSOR board ignores this; team burn
// only counts claims with verified_at set (migration 067).
//
//   POST {action:'generate'} -> mint (or overwrite) a CRIB-XXXX code in
//                               verify_code; the user puts it in their
//                               cursor.com display name. No expiry —
//                               the code is only useful in the owner's
//                               own display name.
//   POST {action:'check'}    -> live-fetch the claimed handle; if the
//                               display name carries the code, set
//                               verified_at = NOW() and clear the code.
//
// Success returns { success:true, verification:{verifiedAt, verifyCode} }
// — the same object the main route's GET nests under profile. Verify-
// specific failures add a machine-readable `reason` beside the human
// `error` so the settings UI can message each outcome distinctly:
// not_linked | no_code | code_not_found | not_found | private |
// parse_error | fetch_error.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0'
}

const actionSchema = z.object({ action: z.enum(['generate', 'check']) }).strict()

type VerifyFailureReason =
  | 'not_linked'
  | 'no_code'
  | 'code_not_found'
  | 'not_found'
  | 'private'
  | 'parse_error'
  | 'fetch_error'

interface VerifyRow {
  cursor_username: string
  verified_at: string | null
  verify_code: string | null
}

function failure(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: NO_STORE_HEADERS }
  )
}

function verifyFailure(reason: VerifyFailureReason, message: string, status: number) {
  return NextResponse.json(
    { success: false, reason, error: message },
    { status, headers: NO_STORE_HEADERS }
  )
}

function verified(verifiedAt: string | null, verifyCode: string | null) {
  return NextResponse.json(
    { success: true, verification: { verifiedAt, verifyCode } },
    { headers: NO_STORE_HEADERS }
  )
}

async function generate(userId: number, row: VerifyRow) {
  // Already proven — never mint a pointless code over a good state.
  if (row.verified_at !== null) return verified(row.verified_at, null)

  const code = generateCursorVerifyCode()
  const { error } = await supabase
    .from('cursor_profiles')
    .update({ verify_code: code, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) {
    console.error('[CursorProfileVerify] Code write failed:', error.message)
    return failure('Failed to create a verification code', 500)
  }
  return verified(null, code)
}

async function check(request: NextRequest, userId: number, row: VerifyRow) {
  // Idempotent: a second check (another tab, a retry) reports the win.
  if (row.verified_at !== null) return verified(row.verified_at, null)
  if (row.verify_code === null) {
    return verifyFailure('no_code', 'Generate a verification code first', 400)
  }

  // The durable budget: every allowed check live-fetches cursor.com —
  // same cross-instance, per-account allowance as the claim route.
  const distributedLimit = await checkDistributedRateLimit(
    request,
    rateLimitConfigs.auth,
    `cursor-profile-verify:${userId}`
  )
  if (!distributedLimit.success) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: createRateLimitResponse(distributedLimit) }
    )
  }

  const result = await fetchCursorProfile(row.cursor_username)
  switch (result.status) {
    case 'ok':
      break
    case 'not_found':
      return verifyFailure(
        'not_found',
        `No public cursor.com profile found for @${row.cursor_username} anymore. Make sure it is still public, then check again.`,
        404
      )
    case 'private':
      return verifyFailure(
        'private',
        'That cursor.com profile is not public right now. Set it to public on cursor.com and check again.',
        400
      )
    case 'parse_error':
    case 'fetch_error':
      console.error(
        `[CursorProfileVerify] Check fetch failed for @${row.cursor_username}:`,
        result.message
      )
      return verifyFailure(
        result.status,
        'Could not read the cursor.com profile page. Try again later.',
        502
      )
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }

  if (!displayNameHasVerifyCode(result.profile.displayName, row.verify_code)) {
    return verifyFailure(
      'code_not_found',
      `The code is not in @${row.cursor_username}'s display name yet. Save it on cursor.com, then check again.`,
      409
    )
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('cursor_profiles')
    .update({ verified_at: now, verify_code: null, updated_at: now })
    .eq('user_id', userId)
  if (error) {
    console.error('[CursorProfileVerify] Verified write failed:', error.message)
    return failure('Failed to record the verification', 500)
  }
  return verified(now, null)
}

export async function POST(request: NextRequest) {
  try {
    // Process-local prefilter on the general allowance — same cheap
    // first line as the claim route.
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.api)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) return failure(session.error, session.status)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure('Invalid JSON body', 400)
    }
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) return failure('Invalid payload', 400)

    const { data, error } = await supabase
      .from('cursor_profiles')
      .select('cursor_username, verified_at, verify_code')
      .eq('user_id', session.userId)
      .maybeSingle()
    if (error) {
      console.error('[CursorProfileVerify] Link read failed:', error.message)
      return failure('Failed to load cursor profile', 500)
    }
    if (!data) {
      return verifyFailure('not_linked', 'No cursor.com profile linked', 404)
    }
    const row = data as unknown as VerifyRow

    switch (parsed.data.action) {
      case 'generate':
        return await generate(session.userId, row)
      case 'check':
        return await check(request, session.userId, row)
      default: {
        const exhaustive: never = parsed.data.action
        return exhaustive
      }
    }
  } catch (error) {
    console.error('[CursorProfileVerify] POST error:', error)
    return failure('Internal server error', 500)
  }
}
