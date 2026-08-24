'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminList,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  ReasonDialog,
  formatDate,
  useAdmin,
  type AdminChipTone
} from '@/components/admin'
import { TextArea, TextField } from '@/components/settings/Field'
import { Skeleton } from '@/components/settings/Skeleton'
import {
  BILLBOARD_ANNOUNCE_BODY_MAX,
  BILLBOARD_ANNOUNCE_HEADLINE_MAX
} from '@/lib/billboard'

// Ticker announcements (migration 051) — freeform ANNOUNCEMENT copy on
// the dashboard/leaderboard Billboard, distinct from paid ads (the
// sponsorship queue) and the automatic top-3 hype. One live at a time:
// a push auto-archives the previous copy server-side. There is no
// interrupt — visitors pick a push up on their next ticker cycle (the
// banner shows at most once per 20 minutes per visitor, and the public
// feed is cached ~60s). Owner-only — the API 403s everyone else,
// moderators just see the forbidden note.

interface AdminAnnouncement {
  id: number
  headline: string
  body: string
  linkUrl: string | null
  status: 'LIVE' | 'ARCHIVED'
  startsAt: string
  endsAt: string | null
  createdAt: string
  /** Computed by the API at response time: LIVE status AND inside the
   *  starts/ends window. A preset-duration push keeps status LIVE after
   *  it expires — status alone doesn't mean on-air. */
  live: boolean
}

/** '' = until cleared; otherwise the preset hour count as a string
 *  (select values are strings — parsed back to a number on submit). */
const DURATION_CHOICES = [
  { value: '1', label: '1 hour' },
  { value: '6', label: '6 hours' },
  { value: '24', label: '24 hours' },
  { value: '', label: 'Until cleared' }
] as const

function announcementChipMeta(a: AdminAnnouncement): { label: string; tone: AdminChipTone } {
  if (a.live) return { label: 'LIVE', tone: 'good' }
  // Status LIVE but off-air: the preset window ran out before anyone
  // archived or replaced it. Still clearable, hence worth flagging.
  if (a.status === 'LIVE') return { label: 'ENDED', tone: 'warn' }
  return { label: 'ARCHIVED', tone: 'neutral' }
}

/** "starts → ends" line; a NULL end reads as the pinned mode it is. */
function windowLabel(a: AdminAnnouncement): string {
  const end = a.endsAt ? formatDate(a.endsAt) : 'until cleared'
  return `${formatDate(a.startsAt)} → ${end}`
}

export default function AdminAnnouncementsPage() {
  const me = useAdmin()
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [clearTarget, setClearTarget] = useState<AdminAnnouncement | null>(null)

  // compose form
  const [headline, setHeadline] = useState('')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [duration, setDuration] = useState<string>('')
  const [reason, setReason] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/announcements', { credentials: 'include' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Failed to load announcements.')
      setLoaded(true)
      return
    }
    setAnnouncements(Array.isArray(data?.announcements) ? data.announcements : [])
    setError(null)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const liveAnnouncement = useMemo(
    () => announcements.find((a) => a.live) ?? null,
    [announcements]
  )
  const history = useMemo(
    () => announcements.filter((a) => !a.live),
    [announcements]
  )

  const push = useCallback(async () => {
    setPushing(true)
    setPushError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: headline.trim(),
          body: body.trim(),
          linkUrl: linkUrl.trim() || undefined,
          durationHours: duration === '' ? null : Number(duration),
          reason: reason.trim()
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setPushError(data?.error ?? 'Failed to push announcement.')
        return
      }
      setHeadline('')
      setBody('')
      setLinkUrl('')
      setDuration('')
      setReason('')
      setNotice('Pushed — visitors see it on their next ticker cycle.')
      await load()
    } finally {
      setPushing(false)
    }
  }, [headline, body, linkUrl, duration, reason, load])

  const clear = useCallback(
    async (id: number, clearReason: string): Promise<string | null> => {
      const res = await fetch(`/api/admin/announcements/${id}/archive`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: clearReason })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        return data?.error ?? 'Failed to clear announcement.'
      }
      setNotice('Announcement cleared.')
      await load()
      return null
    },
    [load]
  )

  if (me.role !== 'owner') {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Announcements"
          description="Push freeform copy into the dashboard/leaderboard ticker — labeled ANNOUNCEMENT, never dressed as a sponsor."
        />
        <AdminNotice tone="warning">
          Owner access required — announcements broadcast to every visitor on the dashboard
          and leaderboard.
        </AdminNotice>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Announcements"
        description="Push freeform copy into the dashboard/leaderboard ticker — labeled ANNOUNCEMENT, never dressed as a sponsor."
      />

      {error && (
        <AdminNotice tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <AdminButton variant="ghost" onClick={() => void load()}>
              Retry
            </AdminButton>
          </div>
        </AdminNotice>
      )}
      {notice && !error && <AdminNotice tone="info">{notice}</AdminNotice>}

      <AdminSection title="Live now">
        {!loaded ? (
          <Skeleton className="h-4 w-64 max-w-full" />
        ) : liveAnnouncement ? (
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-semibold uppercase leading-5 tracking-[0.08em] text-[color:var(--st-text)]">
                  {liveAnnouncement.headline}
                </span>
                <AdminChip tone="good">LIVE</AdminChip>
              </div>
              <p className="mt-0.5 text-[13.5px] leading-5 text-[color:var(--st-text)]">
                {liveAnnouncement.body}
              </p>
              <p className="mt-1.5 font-data text-[12px] leading-5 text-[color:var(--st-text-muted)]">
                {windowLabel(liveAnnouncement)}
              </p>
              {liveAnnouncement.linkUrl && (
                <a
                  href={liveAnnouncement.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 block truncate font-data text-[12px] leading-5 text-[color:var(--st-text-muted)] underline decoration-[color:var(--st-border-strong)] underline-offset-2 hover:text-[color:var(--st-text)]"
                >
                  {liveAnnouncement.linkUrl}
                </a>
              )}
            </div>
            <AdminButton variant="ghost" onClick={() => setClearTarget(liveAnnouncement)}>
              Clear
            </AdminButton>
          </div>
        ) : (
          <p className="text-[13.5px] leading-5 text-[color:var(--st-text-muted)]">
            Nothing live — the ticker runs paid ads and top-3 hype only.
          </p>
        )}
      </AdminSection>

      <AdminSection
        title="Push an announcement"
        description="Replaces whatever is live — one announcement at a time. No interrupt: visitors see it on their next ticker cycle (the banner shows at most once per 20 minutes per visitor, plus ~60s of feed cache)."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Headline"
            description="The strip's title line."
            value={headline}
            maxLength={BILLBOARD_ANNOUNCE_HEADLINE_MAX}
            onChange={(e) => setHeadline(e.target.value.slice(0, BILLBOARD_ANNOUNCE_HEADLINE_MAX))}
            placeholder="SEASON 02 STARTS FRIDAY"
          />
          <TextField
            label="Link"
            description="Optional — https only. The strip becomes clickable."
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://cribble.dev/leaderboard"
          />
        </div>
        <div className="mt-4">
          <TextArea
            label="Body"
            description="The strip's text line."
            rows={2}
            value={body}
            maxLength={BILLBOARD_ANNOUNCE_BODY_MAX}
            onChange={(e) => setBody(e.target.value.slice(0, BILLBOARD_ANNOUNCE_BODY_MAX))}
            placeholder="Standings reset at midnight UTC — finish your runs."
          />
        </div>
        <div className="mt-4">
          <label className="block">
            <span className="block text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
              Duration
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              Presets only — “until cleared” stays up until you clear it here.
            </span>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="st-input mt-1.5 block h-11 w-full rounded-lg px-3 text-[16px] sm:w-56 md:h-9 md:text-[14px]"
            >
              {DURATION_CHOICES.map((choice) => (
                <option key={choice.label} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4">
          <TextField
            label="Reason"
            description="Required and logged to the audit trail — 10 characters minimum."
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Announcing the season 02 start date"
          />
        </div>
        {pushError && (
          <p className="mt-4 text-[12.5px] leading-5 text-[color:var(--st-danger)]">
            {pushError}
          </p>
        )}
        <div className="mt-4">
          <AdminButton
            variant="primary"
            pending={pushing}
            disabled={!headline.trim() || !body.trim() || reason.trim().length < 10}
            onClick={push}
          >
            Push
          </AdminButton>
        </div>
      </AdminSection>

      <AdminSection
        title="History"
        count={loaded ? history.length : undefined}
        description="Most recent pushes — archived copy plus preset windows that ran out."
        flush
      >
        {!loaded ? (
          <AdminSkeletonList rows={3} />
        ) : history.length === 0 ? (
          <AdminEmpty
            title="No past announcements"
            hint="Pushes land here once cleared, replaced or expired."
          />
        ) : (
          <AdminList>
            {history.map((a) => {
              const chip = announcementChipMeta(a)
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] leading-5 text-[color:var(--st-text)]">
                      {a.headline}
                      <span className="ml-2 text-[color:var(--st-text-muted)]">{a.body}</span>
                    </div>
                    <div className="mt-0.5 font-data text-[12px] leading-5 text-[color:var(--st-text-muted)]">
                      {windowLabel(a)}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <AdminChip tone={chip.tone}>{chip.label}</AdminChip>
                    {a.status === 'LIVE' && (
                      <AdminButton variant="ghost" onClick={() => setClearTarget(a)}>
                        Clear
                      </AdminButton>
                    )}
                  </div>
                </li>
              )
            })}
          </AdminList>
        )}
      </AdminSection>

      {clearTarget && (
        <ReasonDialog
          title={`Clear “${clearTarget.headline}”`}
          description={
            clearTarget.live
              ? 'Takes the announcement off the ticker. Visitors mid-cycle finish their pass; nobody new sees it once the ~60s feed cache turns over.'
              : 'This one already ran out its window and is off-air — clearing just archives the row.'
          }
          confirmLabel="Clear announcement"
          onConfirm={(clearReason) => clear(clearTarget.id, clearReason)}
          onClose={() => setClearTarget(null)}
        />
      )}
    </div>
  )
}
