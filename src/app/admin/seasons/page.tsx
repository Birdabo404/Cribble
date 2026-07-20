'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AdminShell,
  formatDate,
  type StaffMe
} from '@/components/admin/AdminShell'
import { ReasonDialog } from '@/components/admin/ReasonDialog'

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

function seasonChip(status: string): { label: string; className: string } {
  if (status === 'active') {
    return { label: 'ACTIVE', className: 'text-emerald-400 border-emerald-500/30' }
  }
  if (status === 'complete') {
    return { label: 'COMPLETE', className: 'text-zinc-500 border-zinc-600/40' }
  }
  return { label: 'UPCOMING', className: 'text-sky-300 border-sky-400/30' }
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

const inputCls =
  'w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-accent/50 focus:outline-none'
const labelCls = 'block space-y-1 text-xs text-zinc-400'

/** Edit dialog for one season: fields depend on status, reason mandatory. */
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-md border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm tracking-[0.15em] text-zinc-100">
            EDIT {season.name}
          </h2>
          <p className="text-xs leading-relaxed text-zinc-500">
            {isUpcoming
              ? 'Upcoming season — name and both dates can move.'
              : 'Active season — rename or move the end (extend or close sooner). The start already happened.'}
          </p>
        </div>

        <label className={labelCls}>
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className={inputCls} />
        </label>

        {isUpcoming && (
          <label className={labelCls}>
            <span>Starts (your local time)</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} />
          </label>
        )}

        <label className={labelCls}>
          <span>Ends (your local time)</span>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputCls} />
        </label>

        <label className={labelCls}>
          <span>Reason — required, logged to the audit trail (10 char minimum)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="why are you changing the calendar?"
            className={`${inputCls} resize-none`}
          />
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-white/10 px-4 py-2 text-xs tracking-[0.15em] text-zinc-400 transition-colors hover:bg-white/5"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            disabled={!reasonValid || submitting}
            className="rounded-md bg-white px-4 py-2 text-xs tracking-[0.15em] text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'WORKING…' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SeasonsAdmin({ me }: { me: StaffMe }) {
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
      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5">
        <p className="text-sm text-red-400">Owner access required.</p>
        <p className="mt-1 text-xs text-zinc-500">
          The season calendar controls every player&apos;s scores and standings.
        </p>
      </section>
    )
  }

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Seasons</h1>
        <p className="text-sm text-gray-400">
          Automation runs the calendar — the tick closes and starts seasons on
          schedule (every 15 minutes). You edit the calendar.
        </p>
      </div>

      {(notice || error) && (
        <p className={`text-xs ${error ? 'text-red-400' : 'text-emerald-400'}`}>
          {error ?? notice}
        </p>
      )}

      {/* phase + tick */}
      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">PHASE</h2>
          <p className="mt-1 text-sm text-zinc-100">
            {!loaded ? '…' : phase === 'intermission' ? 'INTERMISSION — standings locked' : 'SEASON ACTIVE'}
          </p>
        </div>
        <button
          onClick={runTick}
          disabled={ticking}
          className="rounded-md border border-white/10 px-4 py-2 text-xs tracking-[0.15em] text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-wait disabled:opacity-50"
          title="Run the same idempotent lifecycle pass pg_cron runs every 15 minutes"
        >
          {ticking ? 'RUNNING…' : 'RUN TICK NOW'}
        </button>
      </section>

      {/* calendar */}
      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">CALENDAR</h2>
        {!loaded ? (
          <p className="text-xs text-zinc-600">Loading…</p>
        ) : seasons.length === 0 ? (
          <p className="text-xs text-zinc-600">
            No seasons yet — apply migration 025 or schedule one below.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {seasons.map((season) => {
              const chip = seasonChip(season.status)
              return (
                <li key={season.id} className="flex flex-wrap items-center gap-3 px-1 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-100">
                      {season.name}
                      <span className="ml-2 text-xs text-zinc-600">#{season.number}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {formatDate(season.startsAt)} → {formatDate(season.endsAt)}
                      {season.status === 'complete' && (
                        <span className="ml-2 text-zinc-600">
                          · {season.archivedPlayers} archived
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${chip.className}`}>
                      {chip.label}
                    </span>
                    {season.status !== 'complete' && (
                      <button
                        onClick={() => setEditTarget(season)}
                        className="rounded-md border border-white/10 px-3 py-1 text-[10px] tracking-[0.2em] text-zinc-300 transition-colors hover:bg-white/5"
                      >
                        EDIT
                      </button>
                    )}
                    {season.status === 'active' && (
                      <button
                        onClick={() => setForceEndTarget(season)}
                        className="rounded-md border border-red-500/40 px-3 py-1 text-[10px] tracking-[0.2em] text-red-300 transition-colors hover:bg-red-950/40"
                      >
                        FORCE END
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* schedule next */}
      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">SCHEDULE_SEASON</h2>
          {hasUpcoming && (
            <p className="text-[10px] text-zinc-600">
              One is already scheduled — the close also auto-schedules if you don&apos;t.
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            <span>Name (optional — defaults to SEASON NN)</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value.slice(0, 40))}
              placeholder="SEASON 02"
              className={inputCls}
            />
          </label>
          <div />
          <label className={labelCls}>
            <span>Starts (your local time)</span>
            <input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>
            <span>Ends (your local time)</span>
            <input type="datetime-local" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className={inputCls} />
          </label>
        </div>
        <label className={labelCls}>
          <span>Reason — required, logged to the audit trail (10 char minimum)</span>
          <input
            type="text"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value.slice(0, 500))}
            placeholder="scheduling season 02 for the oct–jan quarter"
            className={inputCls}
          />
        </label>
        <button
          onClick={createSeason}
          disabled={creating || !newStart || !newEnd || newReason.trim().length < 10}
          className="rounded-md bg-white px-4 py-2 text-xs tracking-[0.15em] text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? 'SCHEDULING…' : 'SCHEDULE'}
        </button>
      </section>

      {editTarget && (
        <EditSeasonDialog
          season={editTarget}
          onSubmit={(patch, reason) => patchSeason(editTarget.id, patch, reason)}
          onClose={() => setEditTarget(null)}
        />
      )}

      {forceEndTarget && (
        <ReasonDialog
          title={`FORCE END ${forceEndTarget.name}`}
          description="Ends the season immediately: standings are archived exactly as they stand, placement notifications go out, and the next season is scheduled 3 days out. This cannot be undone."
          confirmLabel="END SEASON NOW"
          danger
          onConfirm={(reason) => forceEnd(forceEndTarget.id, reason)}
          onClose={() => setForceEndTarget(null)}
        />
      )}
    </>
  )
}

export default function AdminSeasonsPage() {
  return <AdminShell section="SEASONS">{(me) => <SeasonsAdmin me={me} />}</AdminShell>
}
