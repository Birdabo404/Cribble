'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AdminButton,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  AdminTable,
  formatDate,
  type AdminTableColumn
} from '@/components/admin'
import { TextField } from '@/components/settings/Field'

// The full audit trail — append-only, readable by every staff member.
// Filter by actor or target (user ids; a user page's history section is
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

const COLUMNS: readonly AdminTableColumn[] = [
  { label: 'When' },
  { label: 'Actor' },
  { label: 'Action' },
  { label: 'Target' },
  { label: 'Reason', className: 'w-full min-w-[16rem]' }
]

/** One old/new payload, pretty-printed inside the diff disclosure. */
function DiffBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div>
      <span className="text-[11px] leading-4 text-[color:var(--st-text-faint)]">{label}</span>
      <pre className="mt-0.5 whitespace-pre-wrap break-all rounded-md border border-[color:var(--st-border)] bg-[color:var(--st-canvas)] px-2 py-1.5 font-data text-[11px] leading-4 text-[color:var(--st-text-muted)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

/** old_values / new_values stay collapsed so rows scan as one line each. */
function AuditDiff({ entry }: { entry: AuditEntry }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none font-data text-[11px] leading-4 text-[color:var(--st-text-faint)] transition-colors duration-150 hover:text-[color:var(--st-text)]">
        Diff
      </summary>
      <div className="mt-1.5 max-w-xl space-y-1.5">
        {entry.old_values && <DiffBlock label="From" value={entry.old_values} />}
        {entry.new_values && <DiffBlock label="To" value={entry.new_values} />}
      </div>
    </details>
  )
}

export default function AdminAuditPage() {
  const [adminFilter, setAdminFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [applied, setApplied] = useState<{ admin: string; target: string }>({
    admin: '',
    target: ''
  })
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
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
    void loadFirstPage(applied)
  }, [applied, loadFirstPage])

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(applied, nextCursor)
      setEntries((current) => [...current, ...page.entries])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more entries.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasFilters = Boolean(applied.admin || applied.target)

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Audit log"
        description="Every staff action, permanently. There is no way to edit or delete entries."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <TextField
            label="Actor (user id)"
            inputMode="numeric"
            value={adminFilter}
            onChange={(e) => setAdminFilter(e.target.value.replace(/\D/g, ''))}
            placeholder="Any"
          />
        </div>
        <div className="w-40">
          <TextField
            label="Target (user id)"
            inputMode="numeric"
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value.replace(/\D/g, ''))}
            placeholder="Any"
          />
        </div>
        <div className="flex items-center gap-2">
          <AdminButton onClick={() => setApplied({ admin: adminFilter, target: targetFilter })}>
            Apply
          </AdminButton>
          {hasFilters && (
            <AdminButton
              variant="ghost"
              onClick={() => {
                setAdminFilter('')
                setTargetFilter('')
                setApplied({ admin: '', target: '' })
              }}
            >
              Clear
            </AdminButton>
          )}
        </div>
      </div>

      {error && (
        <AdminNotice tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <AdminButton variant="danger" onClick={() => void loadFirstPage(applied)}>
              Retry
            </AdminButton>
          </div>
        </AdminNotice>
      )}

      <AdminSection flush>
        {loading ? (
          <AdminSkeletonList rows={6} />
        ) : entries.length === 0 ? (
          <AdminEmpty
            title={hasFilters ? 'No entries match.' : 'No audit entries yet.'}
            hint={
              hasFilters
                ? 'Clear the filters to see the full log.'
                : 'Staff actions land here as they happen.'
            }
          />
        ) : (
          <>
            <AdminTable columns={COLUMNS}>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">
                    <span className="font-data text-[12px] leading-4 text-[color:var(--st-text-muted)]">
                      {formatDate(entry.created_at)}
                    </span>
                    <span className="mt-0.5 block font-data text-[11px] leading-4 text-[color:var(--st-text-faint)]">
                      #{entry.id}
                    </span>
                  </td>
                  <td className="whitespace-nowrap font-data text-[12px] text-[color:var(--st-text)]">
                    @{entry.admin_username ?? `#${entry.admin_user_id ?? '?'}`}
                  </td>
                  <td className="whitespace-nowrap font-data text-[12px] text-[color:var(--st-text)]">
                    {entry.action}
                  </td>
                  <td className="whitespace-nowrap font-data text-[12px]">
                    {entry.target_user_id !== null ? (
                      <Link
                        href={`/admin/users/${entry.target_user_id}`}
                        className="text-[color:var(--st-text)] hover:underline"
                      >
                        @{entry.target_username ?? `#${entry.target_user_id}`}
                      </Link>
                    ) : (
                      <span className="text-[color:var(--st-text-faint)]">—</span>
                    )}
                  </td>
                  <td>
                    {entry.reason ? (
                      <span className="text-[color:var(--st-text-muted)]">“{entry.reason}”</span>
                    ) : (
                      <span className="text-[color:var(--st-text-faint)]">—</span>
                    )}
                    {(entry.old_values || entry.new_values) && <AuditDiff entry={entry} />}
                  </td>
                </tr>
              ))}
            </AdminTable>
            {nextCursor !== null && (
              <div className="flex justify-center border-t border-[color:var(--st-border)] p-2">
                <AdminButton variant="ghost" pending={loadingMore} onClick={loadMore}>
                  Load more
                </AdminButton>
              </div>
            )}
          </>
        )}
      </AdminSection>
    </div>
  )
}
