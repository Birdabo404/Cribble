'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminList,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  formatDate,
  useAdmin,
  type AdminChipTone
} from '@/components/admin'
import { TextArea, TextField } from '@/components/settings/Field'
import { Skeleton } from '@/components/settings/Skeleton'
import {
  NOTICE_BODY_MAX,
  NOTICE_PHASES,
  NOTICE_SEVERITIES,
  NOTICE_TITLE_MAX
} from '@/lib/status/notices'
import type {
  IncidentThread,
  NoticeEntry,
  NoticePhase,
  NoticeSeverity,
  StatusNotices
} from '@/lib/status/types'

// The status log console (migration 070) — what cribble.dev/status says
// in the operator's own words. Append-only: opening an incident and
// posting a follow-up are the same write, so this page is two forms
// over one POST. Public visibility is the CDN's minute on /api/status
// plus the page's 60s poll. Owner-only — the API 403s everyone else.

const PHASE_LABEL: Record<NoticePhase, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  maintenance: 'Maintenance',
  resolved: 'Resolved'
}

const SEVERITY_LABEL: Record<NoticeSeverity, string> = {
  operational: 'Operational — informational',
  degraded: 'Degraded',
  outage: 'Outage'
}

function severityTone(severity: NoticeSeverity): AdminChipTone {
  switch (severity) {
    case 'operational':
      return 'good'
    case 'degraded':
      return 'warn'
    case 'outage':
      return 'danger'
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}

function phaseTone(phase: NoticePhase): AdminChipTone {
  switch (phase) {
    case 'resolved':
      return 'good'
    case 'maintenance':
      return 'info'
    case 'investigating':
    case 'identified':
    case 'monitoring':
      return 'warn'
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

function utcClock(iso: string): string {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return '··:··'
  return `${time.toISOString().slice(11, 16)} UTC`
}

function selectClass(): string {
  return 'st-input mt-1.5 block h-11 w-full rounded-lg px-3 text-[16px] md:h-9 md:text-[14px]'
}

type PostResult = string | null

/** One line in a thread's timeline. */
function EntryRow({ entry }: { entry: NoticeEntry }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
      <span className="font-data text-[12px] leading-5 tabular-nums text-[color:var(--st-text-muted)]">
        {utcClock(entry.at)}
      </span>
      <AdminChip tone={phaseTone(entry.phase)}>{PHASE_LABEL[entry.phase]}</AdminChip>
      <AdminChip tone={severityTone(entry.severity)}>{entry.severity}</AdminChip>
      <p className="min-w-0 basis-full text-[13.5px] leading-5 text-[color:var(--st-text)] sm:basis-auto sm:flex-1">
        {entry.body}
      </p>
    </li>
  )
}

/** Follow-up composer pinned under an open thread. */
function FollowUpForm({
  thread,
  onPosted
}: {
  thread: IncidentThread
  onPosted: (message: string) => Promise<void>
}) {
  const [phase, setPhase] = useState<NoticePhase>(
    thread.phase === 'resolved' ? 'monitoring' : thread.phase
  )
  const [severity, setSeverity] = useState<'' | NoticeSeverity>('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<PostResult>(null)

  const resolving = phase === 'resolved'

  const submit = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/status-log', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: thread.incidentId,
          phase,
          severity: severity === '' ? undefined : severity,
          body: body.trim(),
          reason: reason.trim()
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'Failed to post the update.')
        return
      }
      setBody('')
      setReason('')
      setSeverity('')
      await onPosted(resolving ? 'Resolved — the all-clear is public within a minute.' : 'Posted — public within a minute.')
    } finally {
      setPending(false)
    }
  }, [thread.incidentId, phase, severity, body, reason, resolving, onPosted])

  return (
    <div className="border-t border-[color:var(--st-border)] px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
            Phase
          </span>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as NoticePhase)}
            className={selectClass()}
          >
            {NOTICE_PHASES.map((option) => (
              <option key={option} value={option}>
                {PHASE_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
            Severity
          </span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as '' | NoticeSeverity)}
            className={selectClass()}
          >
            <option value="">
              {resolving ? 'Operational (default on resolve)' : `Carry “${thread.severity}”`}
            </option>
            {NOTICE_SEVERITIES.map((option) => (
              <option key={option} value={option}>
                {SEVERITY_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4">
        <TextArea
          label="Update"
          description="Plain words. What changed, what you know, what happens next."
          rows={3}
          value={body}
          maxLength={NOTICE_BODY_MAX}
          onChange={(e) => setBody(e.target.value.slice(0, NOTICE_BODY_MAX))}
          placeholder={
            resolving
              ? 'Rolled back at 14:31 UTC. Error rates nominal since. Marking resolved.'
              : 'Root cause identified: connection pool exhaustion after the 14:00 deploy. Rolling back now.'
          }
        />
      </div>
      <div className="mt-4">
        <TextField
          label="Reason"
          description="Internal — logged to the audit trail, never shown publicly. 10 characters minimum."
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          placeholder="Posting the identified update"
        />
      </div>
      {error && (
        <p className="mt-4 text-[12.5px] leading-5 text-[color:var(--st-danger)]">{error}</p>
      )}
      <div className="mt-4 flex items-center gap-2">
        <AdminButton
          variant={resolving ? 'good' : 'primary'}
          pending={pending}
          disabled={!body.trim() || reason.trim().length < 10}
          onClick={submit}
        >
          {resolving ? 'Post & resolve' : 'Post update'}
        </AdminButton>
      </div>
    </div>
  )
}

/** One open incident: header, timeline, composer. */
function OpenThreadCard({
  thread,
  onPosted
}: {
  thread: IncidentThread
  onPosted: (message: string) => Promise<void>
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] shadow-[var(--st-panel-shadow)]">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
        <span className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
          {thread.title}
        </span>
        <AdminChip tone={severityTone(thread.severity)}>{thread.severity}</AdminChip>
        <AdminChip tone={phaseTone(thread.phase)}>{PHASE_LABEL[thread.phase]}</AdminChip>
        <span className="ml-auto font-data text-[12px] leading-5 text-[color:var(--st-text-muted)]">
          opened {formatDate(thread.openedAt)}
        </span>
      </div>
      <ul className="divide-y divide-[color:var(--st-border)] border-t border-[color:var(--st-border)]">
        {thread.entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
      <FollowUpForm thread={thread} onPosted={onPosted} />
    </div>
  )
}

export default function AdminStatusPage() {
  const me = useAdmin()
  const [notices, setNotices] = useState<StatusNotices | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // open-an-incident form
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<NoticeSeverity>('degraded')
  const [phase, setPhase] = useState<NoticePhase>('investigating')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/status-log', { credentials: 'include' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Failed to load the status log.')
      setNotices({ open: [], recent: [] })
      return
    }
    setNotices(
      data?.notices && Array.isArray(data.notices.open)
        ? (data.notices as StatusNotices)
        : { open: [], recent: [] }
    )
    setError(null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const posted = useCallback(
    async (message: string) => {
      setNotice(message)
      await load()
    },
    [load]
  )

  const openIncident = useCallback(async () => {
    setOpening(true)
    setOpenError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/status-log', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          severity,
          phase,
          body: body.trim(),
          reason: reason.trim()
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setOpenError(data?.error ?? 'Failed to open the incident.')
        return
      }
      setTitle('')
      setBody('')
      setReason('')
      setSeverity('degraded')
      setPhase('investigating')
      await posted('Opened — live on cribble.dev/status within a minute.')
    } finally {
      setOpening(false)
    }
  }, [title, severity, phase, body, reason, posted])

  if (me.role !== 'owner') {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Status"
          description="Post incidents and updates to cribble.dev/status in your own words."
        />
        <AdminNotice tone="warning">
          Owner access required — the status log speaks for Cribble to every visitor.
        </AdminNotice>
      </div>
    )
  }

  const loaded = notices !== null
  const open = notices?.open ?? []
  const recent = notices?.recent ?? []

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Status"
        description="Post incidents and updates to cribble.dev/status in your own words. Append-only: a correction is another line."
        action={
          <a
            href="/status"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--st-text-muted)] underline decoration-[color:var(--st-border-strong)] underline-offset-2 hover:text-[color:var(--st-text)]"
          >
            View /status ↗
          </a>
        }
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

      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
            Open now
            {loaded && (
              <span className="ml-2 font-data text-[11px] font-medium tabular-nums text-[color:var(--st-text-faint)]">
                {open.length}
              </span>
            )}
          </h2>
          <p className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
            Newest line wins. Post “Resolved” to close a thread.
          </p>
        </div>
        {!loaded ? (
          <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] p-4 sm:p-5">
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        ) : open.length === 0 ? (
          <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] p-4 sm:p-5">
            <p className="text-[13.5px] leading-5 text-[color:var(--st-text-muted)]">
              Nothing open — /status is running on probes and vendor feeds alone.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {open.map((thread) => (
              <OpenThreadCard key={thread.incidentId} thread={thread} onPosted={posted} />
            ))}
          </div>
        )}
      </section>

      <AdminSection
        title="Open an incident"
        description="Starts a new thread on /status. The verdict line lifts to this severity while the thread is open."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Title"
            description="Short and specific — this is the headline."
            value={title}
            maxLength={NOTICE_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value.slice(0, NOTICE_TITLE_MAX))}
            placeholder="Elevated API errors"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
                Severity
              </span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as NoticeSeverity)}
                className={selectClass()}
              >
                {NOTICE_SEVERITIES.map((option) => (
                  <option key={option} value={option}>
                    {SEVERITY_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
                Phase
              </span>
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as NoticePhase)}
                className={selectClass()}
              >
                {NOTICE_PHASES.map((option) => (
                  <option key={option} value={option}>
                    {PHASE_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="mt-4">
          <TextArea
            label="First update"
            description="What visitors read under the headline."
            rows={3}
            value={body}
            maxLength={NOTICE_BODY_MAX}
            onChange={(e) => setBody(e.target.value.slice(0, NOTICE_BODY_MAX))}
            placeholder="We’re seeing elevated error rates on the API since 14:02 UTC and are investigating. Scores and sync may lag."
          />
        </div>
        <div className="mt-4">
          <TextField
            label="Reason"
            description="Internal — logged to the audit trail, never shown publicly. 10 characters minimum."
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Alert: 5xx above 5% since 14:02 UTC"
          />
        </div>
        {openError && (
          <p className="mt-4 text-[12.5px] leading-5 text-[color:var(--st-danger)]">{openError}</p>
        )}
        <div className="mt-4">
          <AdminButton
            variant={severity === 'outage' ? 'danger' : 'primary'}
            pending={opening}
            disabled={!title.trim() || !body.trim() || reason.trim().length < 10}
            onClick={openIncident}
          >
            Open incident
          </AdminButton>
        </div>
      </AdminSection>

      <AdminSection
        title="Recent"
        count={loaded ? recent.length : undefined}
        description="Resolved threads. The public page shows the last five from the past two weeks."
        flush
      >
        {!loaded ? (
          <AdminSkeletonList rows={3} />
        ) : recent.length === 0 ? (
          <AdminEmpty title="No resolved incidents" hint="Threads land here once you post Resolved." />
        ) : (
          <AdminList>
            {recent.map((thread) => (
              <li key={thread.incidentId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] leading-5 text-[color:var(--st-text)]">
                    {thread.title}
                  </div>
                  <div className="mt-0.5 font-data text-[12px] leading-5 text-[color:var(--st-text-muted)]">
                    {formatDate(thread.openedAt)} → {formatDate(thread.resolvedAt ?? thread.updatedAt)} ·{' '}
                    {thread.entries.length} {thread.entries.length === 1 ? 'line' : 'lines'}
                  </div>
                </div>
                <AdminChip tone="good">RESOLVED</AdminChip>
              </li>
            ))}
          </AdminList>
        )}
      </AdminSection>
    </div>
  )
}
