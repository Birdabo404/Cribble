import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, createRateLimitResponse, type RateLimitConfig } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Beta feedback intake. Logged-in testers push a category + free-text
// message from the floating FEEDBACK button; rows land in the feedback
// table (migration 028, service-role only) for triage in the admin panel.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

// Feedback is a manual, typed action — a handful of reports per window is
// plenty for a real tester and keeps a scripted client from flooding the
// triage queue with junk rows.
const feedbackRateLimit: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 10
}

const MESSAGE_MIN = 10
const MESSAGE_MAX = 2000
const PAGE_PATH_MAX = 300

const CATEGORIES = ['bug', 'idea', 'other'] as const
type FeedbackCategory = (typeof CATEGORIES)[number]

function parseCategory(value: unknown): FeedbackCategory | null {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
    ? (value as FeedbackCategory)
    : null
}

/**
 * Same cleaning as staffAuth's cleanReason: strip control characters
 * (tabs/newlines survive so multi-line reports keep their shape), then
 * trim. Length is measured in code points to match the table's
 * char_length CHECK — .length would over-count astral characters and let
 * a "valid" message fail the database constraint.
 */
function cleanMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
  const length = [...cleaned].length
  return length >= MESSAGE_MIN && length <= MESSAGE_MAX ? cleaned : null
}

/**
 * page_path is auto-captured client context, not user prose — keep it only
 * if it still looks like an app path after cleaning, otherwise store null.
 */
function cleanPagePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, PAGE_PATH_MAX)
  return cleaned.startsWith('/') ? cleaned : null
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, feedbackRateLimit)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    let body: { category?: unknown; message?: unknown; pagePath?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const category = parseCategory(body.category)
    if (!category) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    const message = cleanMessage(body.message)
    if (!message) {
      return NextResponse.json(
        { error: `Message must be ${MESSAGE_MIN}-${MESSAGE_MAX} characters` },
        { status: 400 }
      )
    }

    const pagePath = cleanPagePath(body.pagePath)

    const { error: insertError } = await supabase.from('feedback').insert({
      user_id: session.userId,
      category,
      message,
      page_path: pagePath
    })

    if (insertError) {
      console.error('[Feedback] Insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('[Feedback] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
