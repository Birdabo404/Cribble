'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell, formatDate } from '@/components/admin/AdminShell'

// The full audit trail — append-only, readable by every staff member.
// Filter by actor or target (user ids; a user page's HISTORY section is
// the shortcut for one target) and page backwards with the id cursor.

interface AuditEntry {
  id: number
  admin_user_id: number | null
  admin_username: string | null
  target_user_id: number | null
  target_username: string | null
  action: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  reason: string | null
  created_at: string
}

function AuditLog() {
  const [adminFilter, setAdminFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [applied, setApplied] = useState<{ admin: string; target: string }>({
    admin: '',
    target: ''
  })
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(
    async (filters: { admin: string; target: string }, before: number | null) => {
      const query = new URLSearchParams()
      if (/^\d+$/.test(filters.admin)) query.set('admin', filters.admin)
      if (/^\d+$/.test(filters.target)) query.set('target', filters.target)
      if (before !== null) query.set('before', String(before))
      const qs = query.toString()
      const res = await fetch(`/api/admin/audit${qs ? `?${qs}` : ''}`, {
        credentials: 'include'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.entries)) {
        throw new Error(data?.error ?? 'Failed to load audit log.')
      }
      return {
        entries: data.entries as AuditEntry[],
        nextCursor: (data.nextCursor as number | null) ?? null
      }
    },
    []
  )

  const loadFirstPage = useCallback(
    async (filters: { admin: string; target: string }) => {
      setLoading(true)
      setError(null)
      try {
        const page = await fetchPage(filters, null)
        setEntries(page.entries)
        setNextCursor(page.nextCursor)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audit log.')
      } finally {
        setLoading(false)
      }
    },
    [fetchPage]
  )

  useEffect(() => {
    loadFirstPage(applied)
  }, [applied, loadFirstPage])

  const loadMore = async () => {
    if (nextCursor === null) return
    try {
      const page = await fetchPage(applied, nextCursor)
      setEntries((current) => [...current, ...page.entries])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more entries.')
    }
  }

  const inputCls =
    'w-32 rounded-md border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white placeholder:text-zinc-700 focus:border-accent/50 focus:outline-none'

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-gray-400">
          Every staff action, permanently. There is no way to edit or delete entries.
        </p>
      </div>

      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-zinc-400">
            <span>Actor (user id)</span>
            <input
              type="text"
              inputMode="numeric"
              value={adminFilter}
              onChange={(e) => setAdminFilter(e.target.value.replace(/\D/g, ''))}
              placeholder="any"
              className={inputCls}
            />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">
            <span>Target (user id)</span>
            <input
              type="text"
              inputMode="numeric"
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value.replace(/\D/g, ''))}
              placeholder="any"
              className={inputCls}
            />
          </label>
          <button
            onClick={() => setApplied({ admin: adminFilter, target: targetFilter })}
            className="rounded-md border border-white/15 px-4 py-1.5 text-[10px] tracking-[0.2em] text-zinc-300 transition-colors hover:bg-white/5"
          >
            APPLY
          </button>
          {(applied.admin || applied.target) && (
            <button
              onClick={() => {
                setAdminFilter('')
                setTargetFilter('')
                setApplied({ admin: '', target: '' })
              }}
              className="text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              CLEAR
            </button>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {loading ? (
          <p className="text-xs text-zinc-600">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-zinc-600">No entries match.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {entries.map((entry) => (
              <li key={entry.id} className="py-3 text-xs text-zinc-400 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-zinc-600">#{entry.id}</span>
                  <span className="text-zinc-600">{formatDate(entry.created_at)}</span>
                  <span className="text-zinc-200">
                    @{entry.admin_username ?? `#${entry.admin_user_id ?? '?'}`}
                  </span>
                  <span className="text-accent">{entry.action}</span>
                  {entry.target_user_id !== null && (
                    <>
                      <span className="text-zinc-600">→</span>
                      <Link
                        href={`/admin/users/${entry.target_user_id}`}
                        className="text-zinc-200 hover:underline"
                      >
                        @{entry.target_username ?? `#${entry.target_user_id}`}
                      </Link>
                    </>
                  )}
                </div>
                {entry.reason && <div className="text-zinc-500">“{entry.reason}”</div>}
                {(entry.old_values || entry.new_values) && (
                  <div className="break-all text-[10px] text-zinc-600">
                    {entry.old_values ? `from ${JSON.stringify(entry.old_values)} ` : ''}
                    {entry.new_values ? `to ${JSON.stringify(entry.new_values)}` : ''}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {nextCursor !== null && !loading && (
          <button
            onClick={loadMore}
            className="rounded-md border border-white/15 px-4 py-2 text-[10px] tracking-[0.2em] text-zinc-300 transition-colors hover:bg-white/5"
          >
            LOAD MORE
          </button>
        )}
      </section>
    </>
  )
}

export default function AdminAuditPage() {
  return <AdminShell section="AUDIT">{() => <AuditLog />}</AdminShell>
}
