'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdminShell, formatDate } from '@/components/admin/AdminShell'

// Waitlist invite queue: launch-waitlist signups, invited into the private
// beta one email at a time. AdminShell gates staff; the API itself is
// owner-only — a moderator reaching the page gets 403 from the queue fetch
// and sees the OWNER_ONLY note instead of the list.

interface WaitlistEntry {
  id: string
  email: string
  createdAt: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'redeemed'
  attemptCount: number
  lastAttemptAt: string | null
  sentAt: string | null
  lastError: string | null
  code: string | null
  redeemedBy: string | null
  redeemedAt: string | null
}

const FILTERS = ['all', 'pending', 'sent', 'failed', 'redeemed'] as const
type StatusFilter = (typeof FILTERS)[number]

interface QueueData {
  entries: WaitlistEntry[]
  total: number
  page: number
  pageSize: number
  counts: Record<StatusFilter, number>
}

const PAGE_SIZE = 50

// A row can be stuck in 'sending' if the server died mid-send. Matches
// the 5-minute stale-claim window in prepare_waitlist_invite (migration
// 039): any shorter and RETRY would appear while the server still
// answers 409 in_progress for the same row.
const STALE_SENDING_MS = 5 * 60_000

const chipCls = 'rounded border px-2 py-0.5 text-[10px] tracking-[0.2em]'

function entryChip(status: WaitlistEntry['status']): { label: string; className: string } {
  switch (status) {
    case 'pending':
      return { label: 'PENDING', className: 'text-zinc-400 border-zinc-500/30' }
    case 'sending':
      return { label: 'SENDING', className: 'animate-pulse text-amber-300 border-amber-400/30' }
    case 'sent':
      return { label: 'SENT', className: 'text-emerald-400 border-emerald-500/30' }
    case 'failed':
      return { label: 'FAILED', className: 'text-red-400 border-red-500/30' }
    case 'redeemed':
      return { label: 'REDEEMED', className: 'text-sky-300 border-sky-400/30' }
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

function staleSending(entry: WaitlistEntry): boolean {
  if (!entry.lastAttemptAt) return true
  const age = Date.now() - new Date(entry.lastAttemptAt).getTime()
  return !Number.isFinite(age) || age > STALE_SENDING_MS
}

function rowAction(entry: WaitlistEntry): 'SEND INVITE' | 'RETRY' | null {
  if (entry.status === 'pending') return 'SEND INVITE'
  if (entry.status === 'failed') return 'RETRY'
  if (entry.status === 'sending' && staleSending(entry)) return 'RETRY'
  return null
}

function emptyLabel(filter: StatusFilter, query: string): string {
  const scope = filter === 'all' ? 'entries' : `${filter} entries`
  if (query) return `No ${scope} match “${query}”.`
  return filter === 'all' ? 'The waitlist is empty.' : `No ${scope}.`
}

const filterChipCls = (active: boolean) =>
  `rounded-md border px-3 py-1.5 text-[10px] tracking-[0.2em] transition-colors ${
    active
      ? 'border-accent/50 text-accent'
      : 'border-white/10 text-zinc-500 hover:text-zinc-200'
  }`

const sendBtnCls = (armed: boolean) =>
  `rounded-md border px-3 py-1.5 text-[10px] tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    armed
      ? 'border-amber-400/60 bg-amber-950/40 text-amber-200 hover:bg-amber-950/60'
      : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40'
  }`

const pageBtnCls =
  'rounded-md border border-white/10 px-3 py-1.5 text-[10px] tracking-[0.2em] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40'

function WaitlistQueue() {
  const router = useRouter()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<QueueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [emailUnconfigured, setEmailUnconfigured] = useState(false)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const queryRef = useRef('')
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadSeq = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      const q = searchInput.trim()
      if (q === queryRef.current) return
      queryRef.current = q
      setQuery(q)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Refetches keep the current list on screen (a send updates its row in
  // place, then this refreshes counts quietly); only the very first load
  // shows the LOADING… placeholder. The sequence guard drops responses
  // that a newer request has superseded.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status: filter,
        page: String(page),
        pageSize: String(PAGE_SIZE)
      })
      if (query) params.set('q', query)
      const res = await fetch(`/api/admin/waitlist?${params.toString()}`, {
        credentials: 'include'
      })
      if (seq !== loadSeq.current) return
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      const payload = await res.json().catch(() => null)
      if (seq !== loadSeq.current) return
      if (!res.ok || !Array.isArray(payload?.entries)) {
        throw new Error(payload?.error ?? 'Failed to load the waitlist.')
      }
      setData(payload as QueueData)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(err instanceof Error ? err.message : 'Failed to load the waitlist.')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [filter, page, query, router])

  useEffect(() => {
    load()
  }, [load])

  // Sending the last row of a page can shrink the page count under us.
  useEffect(() => {
    if (!data) return
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
    if (page > pages) setPage(pages)
  }, [data, page])

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current)
    },
    []
  )

  const clearArmTimer = () => {
    if (armTimer.current) {
      clearTimeout(armTimer.current)
      armTimer.current = null
    }
  }

  const send = async (entry: WaitlistEntry) => {
    setSendingId(entry.id)
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[entry.id]
      return next
    })
    try {
      const res = await fetch(`/api/admin/waitlist/${entry.id}/invite`, {
        method: 'POST',
        credentials: 'include'
      })
      if (res.status === 401) {
        router.push('/login')
        return
      }
      const payload = await res.json().catch(() => null)
      if (res.status === 503) {
        setEmailUnconfigured(true)
        return
      }
      if (res.ok || res.status === 502) {
        // Instant row feedback from the response, then a quiet refetch
        // brings the counts (and any filter membership change) along.
        const updated = payload?.entry as WaitlistEntry | undefined
        if (updated) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  entries: prev.entries.map((e) => (e.id === updated.id ? updated : e))
                }
              : prev
          )
        }
        if (res.status === 502) {
          setRowErrors((prev) => ({
            ...prev,
            [entry.id]:
              typeof payload?.error === 'string' ? payload.error : 'Email provider failed.'
          }))
        }
        await load()
        return
      }
      if (res.status === 409) {
        // Already sent / redeemed / in flight — the list was stale.
        await load()
        return
      }
      setRowErrors((prev) => ({
        ...prev,
        [entry.id]: typeof payload?.error === 'string' ? payload.error : 'Send failed.'
      }))
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [entry.id]: err instanceof Error ? err.message : 'Send failed.'
      }))
    } finally {
      setSendingId(null)
    }
  }

  /** First click arms CONFIRM?, second fires; the arm decays after 3s. */
  const onAction = (entry: WaitlistEntry) => {
    if (sendingId !== null) return
    if (armedId === entry.id) {
      clearArmTimer()
      setArmedId(null)
      void send(entry)
      return
    }
    clearArmTimer()
    setArmedId(entry.id)
    armTimer.current = setTimeout(() => setArmedId(null), 3000)
  }

  const disarm = (id: string) => {
    if (armedId === id) {
      clearArmTimer()
      setArmedId(null)
    }
  }

  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Waitlist queue</h1>
        <p className="text-sm text-gray-400">
          Launch waitlist signups, oldest first — send private beta invites one at a time
          and track each one from pending through sent, failed or redeemed.
        </p>
      </div>

      {emailUnconfigured && (
        <p className="rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          Email delivery is not configured — add RESEND_API_KEY and INVITE_EMAIL_FROM to the
          server env. Sends will fail until then.
        </p>
      )}

      {forbidden ? (
        <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-2">
          <h2 className="text-[10px] tracking-[0.25em] text-zinc-500">OWNER_ONLY</h2>
          <p className="text-xs text-zinc-500">
            The waitlist API only answers the owner — there is nothing to show here.
          </p>
        </section>
      ) : (
        <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setFilter(value)
                  setPage(1)
                }}
                className={filterChipCls(filter === value)}
              >
                {value.toUpperCase()}
                {data ? ` (${data.counts[value]})` : ''}
              </button>
            ))}
            {loading && data && (
              <span className="ml-auto text-[10px] tracking-[0.2em] text-zinc-600">
                LOADING…
              </span>
            )}
          </div>

          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="search by email…"
            className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-accent/50 focus:outline-none"
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          {loading && !data ? (
            <p className="text-xs tracking-[0.2em] text-zinc-500">LOADING…</p>
          ) : !data ? null : !loading && data.entries.length === 0 ? (
            <p className="text-xs text-zinc-600">{emptyLabel(filter, query)}</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {data.entries.map((entry) => {
                const chip = entryChip(entry.status)
                const action = rowAction(entry)
                const inFlight = sendingId === entry.id
                const armed = armedId === entry.id
                const rowError = rowErrors[entry.id]
                return (
                  <li key={entry.id} className="py-3 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-zinc-100">{entry.email}</div>
                        <div className="text-xs text-zinc-600">
                          joined {formatDate(entry.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`${chipCls} ${chip.className}`}>{chip.label}</span>
                        {entry.status === 'redeemed' && entry.redeemedBy && (
                          <span className="text-xs text-sky-300/80">
                            by @{entry.redeemedBy}
                          </span>
                        )}
                        {action && (
                          <button
                            disabled={sendingId !== null}
                            onClick={() => onAction(entry)}
                            onBlur={() => disarm(entry.id)}
                            className={sendBtnCls(armed)}
                          >
                            {inFlight ? 'SENDING…' : armed ? 'CONFIRM?' : action}
                          </button>
                        )}
                      </div>
                    </div>
                    {entry.status === 'sent' && (
                      <p className="text-xs text-zinc-500">
                        sent {formatDate(entry.sentAt)}
                        {entry.code && (
                          <>
                            {' '}
                            · code{' '}
                            <span className="tracking-[0.15em] text-accent">{entry.code}</span>
                          </>
                        )}
                      </p>
                    )}
                    {entry.status === 'redeemed' && (
                      <p className="text-xs text-zinc-500">
                        redeemed {formatDate(entry.redeemedAt)}
                      </p>
                    )}
                    {entry.status === 'sending' && (
                      <p className="text-xs text-zinc-500">
                        attempt {entry.attemptCount} started {formatDate(entry.lastAttemptAt)}
                      </p>
                    )}
                    {entry.status === 'failed' && (
                      <p className="truncate text-xs text-zinc-500">
                        attempts {entry.attemptCount}
                        {entry.lastError && (
                          <>
                            {' '}
                            · <span className="text-red-400/90">{entry.lastError}</span>
                          </>
                        )}
                      </p>
                    )}
                    {rowError && <p className="text-xs text-red-400">{rowError}</p>}
                  </li>
                )
              })}
            </ul>
          )}

          {data && total > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
              <button
                disabled={loading || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={pageBtnCls}
              >
                PREV
              </button>
              <button
                disabled={loading || page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className={pageBtnCls}
              >
                NEXT
              </button>
              <span className="ml-auto text-xs text-zinc-600">
                showing {from}–{to} of {total}
              </span>
            </div>
          )}
        </section>
      )}
    </>
  )
}

export default function AdminWaitlistPage() {
  return <AdminShell section="WAITLIST">{() => <WaitlistQueue />}</AdminShell>
}
