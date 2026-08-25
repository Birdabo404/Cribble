'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  AdminTable,
  formatDate,
  type AdminChipMeta,
  type AdminTableColumn
} from '@/components/admin'
import { SegmentedControl } from '@/components/settings/SegmentedControl'
import { TextField } from '@/components/settings/Field'

// Waitlist invite queue: launch-waitlist signups, invited into the private
// beta one email at a time. The frame gates staff; the API itself is
// owner-only — a moderator reaching the page gets 403 from the queue fetch
// and sees the owner-only notice instead of the list.

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

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
  redeemed: 'Redeemed'
}

interface QueueData {
  entries: WaitlistEntry[]
  total: number
  page: number
  pageSize: number
  pendingTotal: number
  counts: Record<StatusFilter, number>
}

interface BulkSendSummary {
  sent: number
  failed: number
  skipped: number
}

const PAGE_SIZE = 50

// A row can be stuck in 'sending' if the server died mid-send. Matches
// the 5-minute stale-claim window in prepare_waitlist_invite (migration
// 039): any shorter and the retry action would appear while the server
// still answers 409 in_progress for the same row.
const STALE_SENDING_MS = 5 * 60_000

const COLUMNS: readonly AdminTableColumn[] = [
  { label: 'Email', className: 'w-full' },
  { label: 'Joined' },
  { label: 'Status' },
  { label: <span className="sr-only">Action</span>, align: 'right' }
]

/** Queue status → chip (color means state). */
function waitlistChipMeta(status: WaitlistEntry['status']): AdminChipMeta {
  switch (status) {
    case 'pending':
      return { label: 'PENDING', tone: 'neutral' }
    case 'sending':
      return { label: 'SENDING', tone: 'warn' }
    case 'sent':
      return { label: 'SENT', tone: 'good' }
    case 'failed':
      return { label: 'FAILED', tone: 'danger' }
    case 'redeemed':
      return { label: 'REDEEMED', tone: 'info' }
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

function rowAction(entry: WaitlistEntry): 'Send invite' | 'Retry' | null {
  if (entry.status === 'pending') return 'Send invite'
  if (entry.status === 'failed') return 'Retry'
  if (entry.status === 'sending' && staleSending(entry)) return 'Retry'
  return null
}

function emptyLabel(filter: StatusFilter, query: string): string {
  const scope = filter === 'all' ? 'entries' : `${filter} entries`
  if (query) return `No ${scope} match “${query}”.`
  return filter === 'all' ? 'The waitlist is empty.' : `No ${scope}.`
}

/** Per-status trail under the email — sent/code, redeemed, attempts, errors. */
function entryDetail(entry: WaitlistEntry): ReactNode {
  switch (entry.status) {
    case 'pending':
      return null
    case 'sending':
      return (
        <>
          Attempt {entry.attemptCount} started {formatDate(entry.lastAttemptAt)}
        </>
      )
    case 'sent':
      return (
        <>
          Sent {formatDate(entry.sentAt)}
          {entry.code && (
            <>
              {' '}
              · code <span className="text-[color:var(--st-text)]">{entry.code}</span>
            </>
          )}
        </>
      )
    case 'failed':
      return (
        <>
          Attempts {entry.attemptCount}
          {entry.lastError && (
            <>
              {' '}
              · <span className="text-[color:var(--st-danger)]">{entry.lastError}</span>
            </>
          )}
        </>
      )
    case 'redeemed':
      return (
        <>
          Redeemed {formatDate(entry.redeemedAt)}
          {entry.redeemedBy && <> · by @{entry.redeemedBy}</>}
        </>
      )
    default: {
      const exhaustive: never = entry.status
      return exhaustive
    }
  }
}

export default function AdminWaitlistPage() {
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
  const [bulkArmed, setBulkArmed] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<BulkSendSummary | null>(null)
  const [bulkSummary, setBulkSummary] = useState<BulkSendSummary | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const queryRef = useRef('')
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bulkArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  // shows the skeleton. The sequence guard drops responses that a newer
  // request has superseded.
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
    void load()
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
      if (bulkArmTimer.current) clearTimeout(bulkArmTimer.current)
    },
    []
  )

  const clearArmTimer = () => {
    if (armTimer.current) {
      clearTimeout(armTimer.current)
      armTimer.current = null
    }
  }

  const clearBulkArmTimer = () => {
    if (bulkArmTimer.current) {
      clearTimeout(bulkArmTimer.current)
      bulkArmTimer.current = null
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

  const sendAll = async () => {
    setBulkSending(true)
    setBulkError(null)
    setBulkSummary(null)

    let totals: BulkSendSummary = { sent: 0, failed: 0, skipped: 0 }

    try {
      let remaining = data?.pendingTotal ?? 0
      do {
        const res = await fetch('/api/admin/waitlist/invite-all', {
          method: 'POST',
          credentials: 'include'
        })
        if (res.status === 401) {
          router.push('/login')
          return
        }
        if (res.status === 403) {
          setForbidden(true)
          return
        }

        const payload = await res.json().catch(() => null)
        const batch = {
          sent: Number(payload?.sent) || 0,
          failed: Number(payload?.failed) || 0,
          skipped: Number(payload?.skipped) || 0
        }
        totals = {
          sent: totals.sent + batch.sent,
          failed: totals.failed + batch.failed,
          skipped: totals.skipped + batch.skipped
        }
        setBulkProgress(totals)

        if (res.status === 503) {
          setEmailUnconfigured(true)
        }
        if (!res.ok) {
          throw new Error(payload?.error ?? 'Bulk send failed.')
        }
        if (!Number.isInteger(payload?.remaining) || payload.remaining < 0) {
          throw new Error('Bulk send returned an invalid queue count.')
        }
        if (payload.remaining > 0 && (!Number.isInteger(payload?.processed) || payload.processed < 1)) {
          throw new Error('Bulk send made no progress. Try again.')
        }
        remaining = payload.remaining
      } while (remaining > 0)

      setBulkSummary(totals)
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Bulk send failed.')
    } finally {
      setBulkSending(false)
      setBulkProgress(null)
      await load()
    }
  }

  /** SEND ALL uses the same two-click guard as each row action. */
  const onBulkAction = () => {
    if (bulkSending || sendingId !== null || !data?.pendingTotal) return
    if (bulkArmed) {
      clearBulkArmTimer()
      setBulkArmed(false)
      void sendAll()
      return
    }
    clearBulkArmTimer()
    setBulkArmed(true)
    bulkArmTimer.current = setTimeout(() => setBulkArmed(false), 5000)
  }

  /** First click arms Confirm?, second fires; the arm decays after 3s. */
  const onAction = (entry: WaitlistEntry) => {
    if (sendingId !== null || bulkSending) return
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

  const filterOptions = FILTERS.map((value) => ({
    value,
    label: data ? `${FILTER_LABELS[value]} (${data.counts[value]})` : FILTER_LABELS[value]
  }))

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Waitlist queue"
        description="Launch waitlist signups, oldest first — send private beta invites individually or send every pending invite at once."
      />

      {emailUnconfigured && (
        <AdminNotice tone="warning">
          Email delivery is not configured — add RESEND_API_KEY and INVITE_EMAIL_FROM to the
          server env. Sends will fail until then.
        </AdminNotice>
      )}

      {bulkSending && (
        <AdminNotice>
          <span role="status">
            SEND ALL is running. Keep this tab open
            {bulkProgress
              ? ` — ${bulkProgress.sent} sent${bulkProgress.failed ? `, ${bulkProgress.failed} failed` : ''}.`
              : '…'}
          </span>
        </AdminNotice>
      )}

      {bulkSummary && (
        <AdminNotice tone={bulkSummary.failed ? 'warning' : 'info'}>
          Sent {bulkSummary.sent} invite{bulkSummary.sent === 1 ? '' : 's'}.
          {bulkSummary.failed > 0 &&
            ` ${bulkSummary.failed} failed and can be retried from the Failed tab.`}
          {bulkSummary.skipped > 0 &&
            ` ${bulkSummary.skipped} were skipped because another send had already claimed them.`}
        </AdminNotice>
      )}

      {bulkError && <AdminNotice tone="danger">{bulkError}</AdminNotice>}

      {forbidden ? (
        <AdminNotice tone="info">
          Owner only — the waitlist API only answers the owner, so there is nothing to show
          here.
        </AdminNotice>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="st-no-scrollbar min-w-0 max-w-full overflow-x-auto">
                <SegmentedControl
                  options={filterOptions}
                  value={filter}
                  onChange={(value) => {
                    setFilter(value)
                    setPage(1)
                  }}
                  aria-label="Filter the waitlist by status"
                />
              </div>
              {loading && data && (
                <span
                  role="status"
                  className="inline-flex items-center text-[color:var(--st-text-faint)]"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5 animate-spin"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  >
                    <path d="M14.25 8A6.25 6.25 0 1 1 8 1.75" />
                  </svg>
                  <span className="sr-only">Refreshing</span>
                </span>
              )}
              <div className="ml-auto">
                <AdminButton
                  variant={bulkArmed ? 'warn' : 'good'}
                  pending={bulkSending}
                  disabled={
                    !data ||
                    data.pendingTotal === 0 ||
                    sendingId !== null ||
                    (loading && !bulkSending)
                  }
                  onClick={onBulkAction}
                  onBlur={() => {
                    if (!bulkArmed) return
                    clearBulkArmTimer()
                    setBulkArmed(false)
                  }}
                >
                  {bulkSending
                    ? `Sending${bulkProgress ? ` · ${bulkProgress.sent} sent` : '…'}`
                    : bulkArmed
                      ? `Confirm ${data?.pendingTotal ?? 0}?`
                      : `SEND ALL (${data?.pendingTotal ?? 0})`}
                </AdminButton>
              </div>
            </div>
            <div className="max-w-md">
              <TextField
                label="Search by email"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
          </div>

          {error && (
            <AdminNotice tone="danger">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{error}</span>
                <AdminButton variant="danger" onClick={() => void load()}>
                  Retry
                </AdminButton>
              </div>
            </AdminNotice>
          )}

          {(loading || data) && (
            <AdminSection flush>
              {loading && !data ? (
                <AdminSkeletonList rows={6} />
              ) : !data ? null : !loading && data.entries.length === 0 ? (
                <AdminEmpty title={emptyLabel(filter, query)} />
              ) : (
                <AdminTable columns={COLUMNS}>
                  {data.entries.map((entry) => {
                    const chip = waitlistChipMeta(entry.status)
                    const action = rowAction(entry)
                    const inFlight = sendingId === entry.id
                    const armed = armedId === entry.id
                    const rowError = rowErrors[entry.id]
                    const detail = entryDetail(entry)
                    return (
                      <tr key={entry.id}>
                        <td>
                          <div className="break-all font-data text-[13px] leading-5 text-[color:var(--st-text)]">
                            {entry.email}
                          </div>
                          {detail && (
                            <div className="mt-0.5 break-words font-data text-[12px] leading-4 text-[color:var(--st-text-muted)]">
                              {detail}
                            </div>
                          )}
                          {rowError && (
                            <div className="mt-0.5 break-words text-[12px] leading-4 text-[color:var(--st-danger)]">
                              {rowError}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap font-data text-[12px] text-[color:var(--st-text-muted)]">
                          {formatDate(entry.createdAt)}
                        </td>
                        <td>
                          <AdminChip tone={chip.tone}>{chip.label}</AdminChip>
                        </td>
                        <td className="text-right">
                          {action && (
                            <AdminButton
                              variant={armed ? 'warn' : 'good'}
                              pending={inFlight}
                              disabled={sendingId !== null || bulkSending}
                              onClick={() => onAction(entry)}
                              onBlur={() => disarm(entry.id)}
                            >
                              {inFlight ? 'Sending…' : armed ? 'Confirm?' : action}
                            </AdminButton>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </AdminTable>
              )}
              {data && total > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--st-border)] px-4 py-2.5">
                  <AdminButton
                    variant="ghost"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </AdminButton>
                  <AdminButton
                    variant="ghost"
                    disabled={loading || page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </AdminButton>
                  <span className="ml-auto text-[12px] tabular-nums text-[color:var(--st-text-muted)]">
                    Showing {from}–{to} of {total}
                  </span>
                </div>
              )}
            </AdminSection>
          )}
        </>
      )}
    </div>
  )
}
