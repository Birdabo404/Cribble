import { NextRequest, NextResponse } from 'next/server'
import { withAudit } from '@/lib/adminAudit'
import {
  BILLBOARD_ANNOUNCE_BODY_MAX,
  BILLBOARD_ANNOUNCE_HEADLINE_MAX
} from '@/lib/billboard'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { cleanReason, getStaffUser } from '@/lib/staffAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Owner-pushed ticker announcements (migration 051) — the freeform
// ANNOUNCEMENT copy on the dashboard/leaderboard Billboard, distinct
// from paid ads (review queue) and the automatic top-3 hype. GET lists
// recent pushes for the console; POST publishes new copy. At most one
// announcement is live at a time: a push auto-archives whatever is
// currently LIVE inside the same audited mutation, so "push anytime"
// stays one click. No interrupt or cooldown bypass — visitors pick the
// copy up on the next ticker cycle through the cached public train.

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
 * copy-sync with the archive route (no shared module for two users).
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

/**
 * Same sanitize pipeline as buyer ad copy (control-strip + whitespace
 * collapse + trim). Callers measure length in code points to match the
 * table's char_length CHECK — .length would over-count astral
 * characters and let "valid" copy fail the database constraint.
 */
function cleanCopy(value: unknown): string {
  if (typeof value !== 'string') return ''
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export async function GET(request: NextRequest) {
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

    // Newest first; 20 covers the live card plus a useful archive tail —
    // this is a low-volume owner tool, not a paginated feed.
    const { data: rows, error } = await supabase
      .from('billboard_announcements')
      .select(ANNOUNCEMENT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[AdminAnnouncements] List failed:', error)
      return NextResponse.json({ error: 'Failed to list announcements' }, { status: 500 })
    }

    const now = new Date()
    return NextResponse.json({
      announcements: ((rows ?? []) as AnnouncementRow[]).map((row) =>
        toAnnouncement(row, now)
      )
    })
  } catch (error) {
    console.error('[AdminAnnouncements] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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

    const staff = await getStaffUser(request, 'announcement.manage')
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

    const headline = cleanCopy(body.headline)
    if (!headline) {
      return NextResponse.json({ error: 'A headline is required' }, { status: 400 })
    }
    if ([...headline].length > BILLBOARD_ANNOUNCE_HEADLINE_MAX) {
      return NextResponse.json(
        { error: `Headline must be at most ${BILLBOARD_ANNOUNCE_HEADLINE_MAX} characters` },
        { status: 400 }
      )
    }

    const bodyText = cleanCopy(body.body)
    if (!bodyText) {
      return NextResponse.json({ error: 'Body copy is required' }, { status: 400 })
    }
    if ([...bodyText].length > BILLBOARD_ANNOUNCE_BODY_MAX) {
      return NextResponse.json(
        { error: `Body must be at most ${BILLBOARD_ANNOUNCE_BODY_MAX} characters` },
        { status: 400 }
      )
    }

    // Optional link. Blank counts as absent (an empty form field);
    // anything else must be a parseable https URL — the ticker renders
    // it as a raw <a href>, so nothing weaker gets stored.
    const rawLink = body.linkUrl
    let linkUrl: string | null = null
    if (rawLink !== undefined && rawLink !== null) {
      if (typeof rawLink !== 'string') {
        return NextResponse.json({ error: 'linkUrl must be a string' }, { status: 400 })
      }
      const trimmed = rawLink.trim()
      if (trimmed) {
        let parsed: URL
        try {
          parsed = new URL(trimmed)
        } catch {
          return NextResponse.json({ error: 'linkUrl must be a valid URL' }, { status: 400 })
        }
        if (parsed.protocol !== 'https:') {
          return NextResponse.json({ error: 'linkUrl must use https' }, { status: 400 })
        }
        linkUrl = trimmed
      }
    }

    // Duration presets only — freeform windows invite typo'd year-long
    // pins. null/undefined = live until cleared through archive.
    const rawDuration = body.durationHours
    const now = new Date()
    const nowIso = now.toISOString()
    let endsAt: string | null = null
    if (rawDuration !== undefined && rawDuration !== null) {
      if (rawDuration !== 1 && rawDuration !== 6 && rawDuration !== 24) {
        return NextResponse.json(
          { error: 'durationHours must be 1, 6 or 24 — or null to stay live until cleared' },
          { status: 400 }
        )
      }
      endsAt = new Date(now.getTime() + rawDuration * 3_600_000).toISOString()
    }

    const inserted = await withAudit(
      supabase,
      {
        adminUserId: staff.staff.userId,
        targetUserId: null,
        action: 'announcement.push',
        newValues: { headline, body: bodyText, linkUrl, endsAt },
        reason
      },
      async () => {
        // One live at a time: the push retires every currently-LIVE row
        // (expired-but-unarchived ones included) before the new copy
        // lands, so the ticker never has to arbitrate between two.
        const { error: archiveError } = await supabase
          .from('billboard_announcements')
          .update({ status: 'ARCHIVED', updated_at: nowIso })
          .eq('status', 'LIVE')
        if (archiveError) {
          throw new Error(`Failed to archive live announcements: ${archiveError.message}`)
        }

        const { data, error } = await supabase
          .from('billboard_announcements')
          .insert({
            headline,
            body: bodyText,
            link_url: linkUrl,
            status: 'LIVE',
            starts_at: nowIso,
            ends_at: endsAt,
            created_by: staff.staff.userId
          })
          .select(ANNOUNCEMENT_COLUMNS)
          .single()
        if (error || !data) {
          throw new Error(`Announcement insert failed: ${error?.message ?? 'no row'}`)
        }
        return data as AnnouncementRow
      }
    )

    return NextResponse.json({ announcement: toAnnouncement(inserted, new Date()) })
  } catch (error) {
    console.error('[AdminAnnouncements] POST error:', error)
    return NextResponse.json({ error: 'Failed to push announcement' }, { status: 500 })
  }
}
