import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Clear one ticker announcement (migration 051) — owner only, same
// structure as the seasons/billboard admin routes (rate limit, staff
// gate, audit-first, status-guarded update). Archiving is the manual
// takedown for pinned (ends_at NULL) or still-running copy; a
// preset-duration push that already expired keeps status LIVE — it has
// dropped off the public train via the window check but can still be
// cleared here. Archiving an ARCHIVED row is a 400, matching the
// billboard activate route's stance on wrong-state rows.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const ANNOUNCEMENT_COLUMNS =
  'id, headline, body, link_url, status, starts_at, ends_at, created_at'

type AnnouncementRow = {
  id: number
  headline: string
  body: string
  link_url: string | null
  status: string
  starts_at: string
  ends_at: string | null
  created_at: string
}

type Announcement = {
  id: number
  headline: string
  body: string
  linkUrl: string | null
  status: 'LIVE' | 'ARCHIVED'
  startsAt: string
  endsAt: string | null
  createdAt: string
  live: boolean
}

/**
 * Row -> API shape, with `live` computed at response time: LIVE status
 * alone isn't enough — a preset-duration push keeps status LIVE after
 * ends_at passes and simply drops off the public train. Kept in
 * copy-sync with the list/push route (no shared module for two users).
 */
function toAnnouncement(row: AnnouncementRow, now: Date): Announcement {
  const status = row.status === 'ARCHIVED' ? 'ARCHIVED' : 'LIVE'
  const startsAt = new Date(String(row.starts_at)).toISOString()
  const endsAt = row.ends_at === null ? null : new Date(String(row.ends_at)).toISOString()
  const live =
    status === 'LIVE' &&
    Date.parse(startsAt) <= now.getTime() &&
    (endsAt === null || Date.parse(endsAt) >= now.getTime())
  return {
    id: Number(row.id),
    headline: String(row.headline),
    body: String(row.body),
    linkUrl: row.link_url ?? null,
    status,
    startsAt,
    endsAt,
    createdAt: new Date(String(row.created_at)).toISOString(),
    live
  }
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

    const staff = await getStaffUser(request, 'announcement.manage')
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status })
    }

    const { id } = await params
    const announcementId = Number(id)
    if (!Number.isInteger(announcementId) || announcementId <= 0) {
      return NextResponse.json({ error: 'Invalid announcement id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const reason = cleanReason(body.reason)
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason of at least 10 characters is required' },
        { status: 400 }
      )
    }

    const { data: announcement, error: loadError } = await supabase
      .from('billboard_announcements')
      .select(ANNOUNCEMENT_COLUMNS)
      .eq('id', announcementId)
      .maybeSingle()

    if (loadError) {
      console.error('[AdminAnnouncementArchive] Load failed:', loadError)
      return NextResponse.json({ error: 'Failed to load announcement' }, { status: 500 })
    }
    if (!announcement) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    }
    if (announcement.status === 'ARCHIVED') {
      return NextResponse.json(
        { error: 'Only live announcements can be archived — this one is ARCHIVED' },
        { status: 400 }
      )
    }

    const nowIso = new Date().toISOString()

    const updated = await withAudit(
      supabase,
      {
        adminUserId: staff.staff.userId,
        targetUserId: null,
        action: 'announcement.archive',
        oldValues: { announcementId, status: 'LIVE' },
        newValues: { announcementId, status: 'ARCHIVED' },
        reason
      },
      async () => {
        // Guarded on the status we read: a concurrent archive (or a push
        // that auto-archived this row) matches zero rows and aborts
        // instead of double-logging a takedown that already happened.
        const { data, error } = await supabase
          .from('billboard_announcements')
          .update({ status: 'ARCHIVED', updated_at: nowIso })
          .eq('id', announcementId)
          .eq('status', 'LIVE')
          .select(ANNOUNCEMENT_COLUMNS)
        if (error) {
          throw new Error(
            `Failed to archive announcement ${announcementId}: ${error.message}`
          )
        }
        if (!data || data.length === 0) {
          throw new Error(
            `Announcement ${announcementId} changed concurrently; archive aborted`
          )
        }
        return data[0] as AnnouncementRow
      }
    )

    return NextResponse.json({ announcement: toAnnouncement(updated, new Date()) })
  } catch (error) {
    console.error('[AdminAnnouncementArchive] POST error:', error)
    return NextResponse.json({ error: 'Failed to archive announcement' }, { status: 500 })
  }
}
