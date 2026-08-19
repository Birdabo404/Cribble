'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
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

// Season calendar management. Automation (season_tick via pg_cron) runs
// the calendar; this page edits the calendar: schedule the next season,
// move dates, extend the active season, or force-end it now. Owner-only —
// the API 403s everyone else, moderators just see the forbidden note.

interface AdminSeason {
  id: number
  number: number
  name: string
  startsAt: string
  endsAt: string
  status: 'upcoming' | 'active' | 'complete' | string
  archivedPlayers: number
}

function seasonChipMeta(status: string): { label: string; tone: AdminChipTone } {
  if (status === 'active') {
    return { label: 'ACTIVE', tone: 'good' }
  }
  if (status === 'complete') {
    return { label: 'COMPLETE', tone: 'neutral' }
  }
  return { label: 'UPCOMING', tone: 'info' }
}

/** ISO → value for <input type="datetime-local"> in the operator's zone. */
function isoToLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Edit dialog for one season: fields depend on status, reason mandatory.
 *  Same surface as ReasonDialog (rounded-2xl panel on --st-panel, plain
 *  0.55 black scrim) — kept separate because the forms differ. */
function EditSeasonDialog({
  season,
  onSubmit,
  onClose
}: {
  season: AdminSeason
  onSubmit: (
    patch: { name?: string; startsAt?: string; endsAt?: string },
    reason: string
  ) => Promise<string | null>
  onClose: () => void
}) {
  const titleId = useId()
  const [name, setName] = useState(season.name)
  const [startsAt, setStartsAt] = useState(isoToLocalInput(season.startsAt))
  const [endsAt, setEndsAt] = useState(isoToLocalInput(season.endsAt))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isUpcoming = season.status === 'upcoming'
  const reasonValid = reason.trim().length >= 10

  const submit = async () => {
    if (!reasonValid || submitting) return
    const patch: { name?: string; startsAt?: string; endsAt?: string } = {}
    if (name.trim() !== season.name) patch.name = name.trim()
    if (isUpcoming) {
      const iso = localInputToIso(startsAt)
      if (iso && iso !== season.startsAt) patch.startsAt = iso
    }
    const endIso = localInputToIso(endsAt)
    if (endIso && endIso !== season.endsAt) patch.endsAt = endIso
    if (Object.keys(patch).length === 0) {
      setError('Nothing changed.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const failure = await onSubmit(patch, reason.trim())
      if (failure) {
        setError(failure)
        return
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 bg-[rgb(0_0_0/0.55)]" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md space-y-4 rounded-2xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] p-5 shadow-[var(--st-panel-shadow)]">
        <div className="space-y-1">
          <h2
            id={titleId}
            className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]"
          >
            Edit {season.name}
          </h2>
          <p className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
            {isUpcoming
              ? 'Upcoming season — name and both dates can move.'
              : 'Active season — rename or move the end (extend or close sooner). The start already happened.'}
          </p>
        </div>

        <TextField
          label="Name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
        />

        {isUpcoming && (
          <TextField
            label="Starts"
            description="Your local time."
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        )}

        <TextField
          label="Ends"
          description="Your local time."
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />

        <TextArea
          label="Reason"
          description="Required and logged to the audit trail — 10 characters minimum."
          rows={2}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          placeholder="Why are you changing the calendar?"
        />

        {error && (
          <p className="text-[12.5px] leading-5 text-[color:var(--st-danger)]">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2">
          <AdminButton variant="ghost" onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton
            variant="primary"
            pending={submitting}
            disabled={!reasonValid}
            onClick={submit}
          >
            Save
          </AdminButton>
        </div>
      </div>
    </div>
  )
}

export default function AdminSeasonsPage() {
  const me = useAdmin()
  const [seasons, setSeasons] = useState<AdminSeason[]>([])
  const [phase, setPhase] = useState<'active' | 'intermission' | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [editTarget, setEditTarget] = useState<AdminSeason | null>(null)
  const [forceEndTarget, setForceEndTarget] = useState<AdminSeason | null>(null)
  const [ticking, setTicking] = useState(false)

  // schedule form
  const [newName, setNewName] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newReason, setNewReason] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/seasons', { credentials: 'include' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Failed to load seasons.')
      setLoaded(true)
      return
    }
    setSeasons(Array.isArray(data?.seasons) ? data.seasons : [])
    setPhase(data?.phase === 'intermission' ? 'intermission' : 'active')
    setError(null)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasUpcoming = useMemo(
    () => seasons.some((s) => s.status === 'upcoming'),
    [seasons]
  )

  const patchSeason = useCallback(
    async (
      id: number,
      patch: { name?: string; startsAt?: string; endsAt?: string },
      reason: string
    ): Promise<string | null> => {
      const res = await fetch(`/api/admin/seasons/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, reason })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        return data?.error ?? 'Failed to update season.'
      }
      setNotice('Season updated.')
      await load()
      return null
    },
    [load]
  )

  const forceEnd = useCallback(
    async (id: number, reason: string): Promise<string | null> => {
      const res = await fetch(`/api/admin/seasons/${id}/force-end`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        return data?.error ?? 'Failed to force-end season.'
      }
      setNotice('Season closed — standings archived, next season scheduled.')
      await load()
      return null
    },
    [load]
  )

  const runTick = useCallback(async () => {
    setTicking(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/seasons/tick', {
        method: 'POST',
        credentials: 'include'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'Tick failed.')
        return
      }
      const actions = Array.isArray(data?.tick?.actions) ? data.tick.actions : []
      setNotice(
        actions.length === 0
          ? 'Tick ran — calendar already up to date.'
          : `Tick ran: ${JSON.stringify(actions)}`
      )
      await load()
    } finally {
      setTicking(false)
    }
  }, [load])

  const createSeason = useCallback(async () => {
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const startsAt = localInputToIso(newStart)
      const endsAt = localInputToIso(newEnd)
      const res = await fetch('/api/admin/seasons', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim() || undefined,
          startsAt,
          endsAt,
          reason: newReason.trim()
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'Failed to schedule season.')
        return
      }
      setNewName('')
      setNewStart('')
      setNewEnd('')
      setNewReason('')
      setNotice('Season scheduled.')
      await load()
    } finally {
      setCreating(false)
    }
  }, [newName, newStart, newEnd, newReason, load])

  if (me.role !== 'owner') {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Seasons"
          description="Automation runs the calendar — the tick closes and starts seasons on schedule (every 15 minutes)."
        />
        <AdminNotice tone="warning">
          Owner access required — the season calendar controls every player&apos;s scores and
          standings.
        </AdminNotice>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Seasons"
        description="Automation runs the calendar — the tick closes and starts seasons on schedule (every 15 minutes). You edit the calendar."
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

      <AdminSection
        title="Phase"
        action={
          <AdminButton
            variant="ghost"
            pending={ticking}
            onClick={runTick}
            title="Run the same idempotent lifecycle pass pg_cron runs every 15 minutes"
          >
            Run tick now
          </AdminButton>
        }
      >
        {!loaded ? (
          <Skeleton className="h-4 w-48 max-w-full" />
        ) : (
          <p className="flex items-center gap-2 text-[13.5px] leading-5 text-[color:var(--st-text)]">
            {phase !== 'intermission' && (
              // The one live signal on this page — the season is on.
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            )}
            {phase === 'intermission' ? 'Intermission — standings locked' : 'Season active'}
          </p>
        )}
      </AdminSection>

      <AdminSection title="Calendar" count={loaded ? seasons.length : undefined} flush>
        {!loaded ? (
          <AdminSkeletonList rows={3} />
        ) : seasons.length === 0 ? (
          <AdminEmpty
            title="No seasons yet"
            hint="Apply migration 025 or schedule one below."
          />
        ) : (
          <AdminList>
            {seasons.map((season) => {
              const chip = seasonChipMeta(season.status)
              return (
                <li key={season.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] leading-5 text-[color:var(--st-text)]">
                      {season.name}
                      <span className="ml-2 font-data text-[11px] text-[color:var(--st-text-faint)]">
                        #{season.number}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                      <span className="font-data text-[12px]">{formatDate(season.startsAt)}</span>
                      {' → '}
                      <span className="font-data text-[12px]">{formatDate(season.endsAt)}</span>
                      {season.status === 'complete' && (
                        <span className="text-[color:var(--st-text-faint)]">
                          {' '}
                          · {season.archivedPlayers} archived
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <AdminChip tone={chip.tone}>{chip.label}</AdminChip>
                    {season.status !== 'complete' && (
                      <AdminButton variant="ghost" onClick={() => setEditTarget(season)}>
                        Edit
                      </AdminButton>
                    )}
                    {season.status === 'active' && (
                      <AdminButton variant="danger" onClick={() => setForceEndTarget(season)}>
                        Force end
                      </AdminButton>
                    )}
                  </div>
                </li>
              )
            })}
          </AdminList>
        )}
      </AdminSection>

      <AdminSection
        title="Schedule a season"
        description={
          hasUpcoming
            ? 'One is already scheduled — the close also auto-schedules if you don’t.'
            : undefined
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            description="Optional — defaults to SEASON NN."
            value={newName}
            maxLength={40}
            onChange={(e) => setNewName(e.target.value.slice(0, 40))}
            placeholder="SEASON 02"
          />
          <div className="hidden sm:block" aria-hidden />
          <TextField
            label="Starts"
            description="Your local time."
            type="datetime-local"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
          />
          <TextField
            label="Ends"
            description="Your local time."
            type="datetime-local"
            value={newEnd}
            onChange={(e) => setNewEnd(e.target.value)}
          />
        </div>
        <div className="mt-4">
          <TextField
            label="Reason"
            description="Required and logged to the audit trail — 10 characters minimum."
            value={newReason}
            maxLength={500}
            onChange={(e) => setNewReason(e.target.value.slice(0, 500))}
            placeholder="Scheduling season 02 for the oct–jan quarter"
          />
        </div>
        <div className="mt-4">
          <AdminButton
            variant="primary"
            pending={creating}
            disabled={!newStart || !newEnd || newReason.trim().length < 10}
            onClick={createSeason}
          >
            Schedule
          </AdminButton>
        </div>
      </AdminSection>

      {editTarget && (
        <EditSeasonDialog
          season={editTarget}
          onSubmit={(patch, reason) => patchSeason(editTarget.id, patch, reason)}
          onClose={() => setEditTarget(null)}
        />
      )}

      {forceEndTarget && (
        <ReasonDialog
          title={`Force end ${forceEndTarget.name}`}
          description="Ends the season immediately: standings are archived exactly as they stand, placement notifications go out, and the next season is scheduled 3 days out. This cannot be undone."
          confirmLabel="End season now"
          danger
          onConfirm={(reason) => forceEnd(forceEndTarget.id, reason)}
          onClose={() => setForceEndTarget(null)}
        />
      )}
    </div>
  )
}
