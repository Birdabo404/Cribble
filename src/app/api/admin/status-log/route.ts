import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import {
  NOTICE_BODY_MAX,
  NOTICE_TITLE_MAX,
  carryForward,
  cleanNoticeText,
  deriveNotices,
  isNoticePhase,
  isNoticeSeverity,
  threadOf,
  toNoticeEntry,
  type NoticeEntryRow
} from '@/lib/status/notices'
import { NOTICE_COLUMNS, readNoticeEntries, readThreadEntries } from '@/lib/status/noticesStore'
import type { NoticePhase, NoticeSeverity } from '@/lib/status/types'
import { createServiceClient } from '@/lib/supabaseServer'

// The operator's status log (migration 070) — what cribble.dev/status
// says in the operator's own words. One write: POST appends a line.
// Without an incidentId the line OPENS a new incident (title +
// severity required, phase defaults to investigating); with one it is
// a FOLLOW-UP on that thread (phase required; title and, unless given,
// severity carry forward — a 'resolved' line defaults to operational).
// Lines are never edited or deleted here: a correction is another
// line. GET hands the console the raw recent log plus the derived
// open / recent view, the same fold the public page runs.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Console read: a quarter of history, generous cap — a low-volume owner tool. */
const CONSOLE_LOOKBACK_DAYS = 90
const CONSOLE_ROW_CAP = 200

export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.admin)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const staff = await getStaffUser(request, 'status.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    const now = new Date()
    const entries = await readNoticeEntries(supabase, now, {
      lookbackDays: CONSOLE_LOOKBACK_DAYS,
      cap: CONSOLE_ROW_CAP
    })
    return NextResponse.json({
      entries,
      // The console shows more history than the public page.
      notices: deriveNotices(entries, now, { recentWindowDays: 90, recentLimit: 20 })
    })
  } catch (error) {
    console.error('[AdminStatusLog] GET error:', error)
    return NextResponse.json({ error: 'Failed to read the status log' }, { status: 500 })
  }
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

    const staff = await getStaffUser(request, 'status.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    const body = await request.json().catch(() => ({}))
    const reason = cleanReason(body.reason)
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason of at least 10 characters is required' },
        { status: 400 }
      )
    }

    const text = cleanNoticeText(body.body)
    if (!text) {
      return NextResponse.json({ error: 'The update text is required' }, { status: 400 })
    }
    if ([...text].length > NOTICE_BODY_MAX) {
      return NextResponse.json(
        { error: `Update text must be at most ${NOTICE_BODY_MAX} characters` },
        { status: 400 }
      )
    }

    if (body.phase !== undefined && body.phase !== null && !isNoticePhase(body.phase)) {
      return NextResponse.json(
        { error: 'phase must be investigating, identified, monitoring, maintenance or resolved' },
        { status: 400 }
      )
    }
    if (
      body.severity !== undefined &&
      body.severity !== null &&
      !isNoticeSeverity(body.severity)
    ) {
      return NextResponse.json(
        { error: 'severity must be operational, degraded or outage' },
        { status: 400 }
      )
    }
    const requestedPhase: NoticePhase | undefined = isNoticePhase(body.phase)
      ? body.phase
      : undefined
    const requestedSeverity: NoticeSeverity | undefined = isNoticeSeverity(body.severity)
      ? body.severity
      : undefined

    const rawIncidentId = body.incidentId
    let incidentId: string | null = null
    if (rawIncidentId !== undefined && rawIncidentId !== null && rawIncidentId !== '') {
      if (typeof rawIncidentId !== 'string' || !UUID_RE.test(rawIncidentId)) {
        return NextResponse.json({ error: 'incidentId must be a UUID' }, { status: 400 })
      }
      incidentId = rawIncidentId.toLowerCase()
    }

    // Resolve what this line says, either as an opener or a follow-up.
    let title: string
    let severity: NoticeSeverity
    let phase: NoticePhase
    let priorEntries: Awaited<ReturnType<typeof readThreadEntries>> = []

    if (incidentId === null) {
      title = cleanNoticeText(body.title)
      if (!title) {
        return NextResponse.json(
          { error: 'A title is required to open an incident' },
          { status: 400 }
        )
      }
      if ([...title].length > NOTICE_TITLE_MAX) {
        return NextResponse.json(
          { error: `Title must be at most ${NOTICE_TITLE_MAX} characters` },
          { status: 400 }
        )
      }
      if (requestedSeverity === undefined) {
        return NextResponse.json(
          { error: 'A severity is required to open an incident' },
          { status: 400 }
        )
      }
      severity = requestedSeverity
      phase = requestedPhase ?? 'investigating'
    } else {
      priorEntries = await readThreadEntries(supabase, incidentId)
      const thread = threadOf(priorEntries)
      if (thread === null) {
        return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
      }
      if (requestedPhase === undefined) {
        return NextResponse.json(
          { error: 'A phase is required for a follow-up' },
          { status: 400 }
        )
      }
      phase = requestedPhase
      const carried = carryForward(thread, phase, requestedSeverity)
      title = carried.title
      severity = carried.severity
    }

    const inserted = await withAudit(
      supabase,
      {
        adminUserId: staff.staff.userId,
        targetUserId: null,
        action: incidentId === null ? 'status.open' : 'status.update',
        newValues: { incidentId, title, severity, phase, body: text },
        reason
      },
      async () => {
        const row: Record<string, unknown> = {
          severity,
          phase,
          title,
          body: text,
          created_by: staff.staff.userId
        }
        // Openers take the table's default uuid; follow-ups join theirs.
        if (incidentId !== null) row.incident_id = incidentId
        const { data, error } = await supabase
          .from('status_log_entries')
          .insert(row)
          .select(NOTICE_COLUMNS)
          .single()
        if (error || !data) {
          throw new Error(`Status log insert failed: ${error?.message ?? 'no row'}`)
        }
        return data as NoticeEntryRow
      }
    )

    const entry = toNoticeEntry(inserted)
    return NextResponse.json({
      entry,
      thread: threadOf([...priorEntries, entry])
    })
  } catch (error) {
    console.error('[AdminStatusLog] POST error:', error)
    return NextResponse.json({ error: 'Failed to post to the status log' }, { status: 500 })
  }
}
