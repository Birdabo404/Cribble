'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell, formatDate } from '@/components/admin/AdminShell'

// Beta feedback inbox: everything testers submit through the in-app
// FEEDBACK button, newest first. Filter by triage status and move items
// between NEW / SEEN / DONE without leaving the list.

interface FeedbackItem {
  id: number
  user_id: number
  username: string | null
  category: string
  message: string
  page_path: string | null
  status: string
  created_at: string
}

const FILTERS = ['all', 'new', 'seen', 'done'] as const
type StatusFilter = (typeof FILTERS)[number]

const STATUSES = ['new', 'seen', 'done'] as const

function categoryChip(category: string): { label: string; className: string } {
  if (category === 'bug') {
    return { label: 'BUG', className: 'text-rose-400 border-rose-500/30' }
  }
  if (category === 'idea') {
    return { label: 'IDEA', className: 'text-sky-300 border-sky-400/30' }
  }
  return { label: 'OTHER', className: 'text-zinc-400 border-zinc-500/30' }
}

function feedbackStatusChip(status: string): { label: string; className: string } {
  if (status === 'done') {
    return { label: 'DONE', className: 'text-emerald-400 border-emerald-500/30' }
  }
  if (status === 'seen') {
    return { label: 'SEEN', className: 'text-sky-300 border-sky-400/30' }
  }
  return { label: 'NEW', className: 'text-amber-300 border-amber-400/30' }
}

function FeedbackInbox() {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(async (status: StatusFilter, before: number | null) => {
    const query = new URLSearchParams()
    if (status !== 'all') query.set('status', status)
    if (before !== null) query.set('before', String(before))
    const qs = query.toString()
    const res = await fetch(`/api/admin/feedback${qs ? `?${qs}` : ''}`, {
      credentials: 'include'
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(data?.items)) {
      throw new Error(data?.error ?? 'Failed to load feedback.')
    }
    return {
      items: data.items as FeedbackItem[],
      nextCursor: (data.nextCursor as number | null) ?? null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const page = await fetchPage(filter, null)
        if (cancelled) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load feedback.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [filter, fetchPage])

  const loadMore = async () => {
    if (nextCursor === null) return
    try {
      const page = await fetchPage(filter, nextCursor)
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more feedback.')
    }
  }

  // Optimistic: flip the row immediately, revert if the PATCH fails.
  // Rows that no longer match the active filter stay visible until the
  // next reload, so a mis-click can be undone in place.
  const setStatus = async (id: number, status: string) => {
    const previous = items.find((item) => item.id === id)
    if (!previous || previous.status === status) return
    setError(null)
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item))
    )
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Failed to update status.')
      }
    } catch (err) {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, status: previous.status } : item))
      )
      setError(err instanceof Error ? err.message : 'Failed to update status.')
    }
  }

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
        <p className="text-sm text-gray-400">
          Everything testers send through the in-app FEEDBACK button.
        </p>
      </div>

      <section className="rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-md border px-3 py-1.5 text-[10px] tracking-[0.2em] transition-colors ${
                filter === value
                  ? 'border-accent/50 text-accent'
                  : 'border-white/10 text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {loading ? (
          <p className="text-xs text-zinc-600">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-zinc-600">No feedback here.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map((item) => {
              const category = categoryChip(item.category)
              const status = feedbackStatusChip(item.status)
              return (
                <li key={item.id} className="py-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                    <span
                      className={`rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${category.className}`}
                    >
                      {category.label}
                    </span>
                    <span className="text-zinc-600">#{item.id}</span>
                    <span className="text-zinc-600">{formatDate(item.created_at)}</span>
                    {item.username ? (
                      <Link
                        href={`/admin/users/${item.user_id}`}
                        className="text-zinc-200 hover:underline"
                      >
                        @{item.username}
                      </Link>
                    ) : (
                      <span className="text-zinc-200">#{item.user_id}</span>
                    )}
                    {item.page_path && (
                      <span className="break-all text-zinc-500">{item.page_path}</span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">
                    {item.message}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-2 py-0.5 text-[10px] tracking-[0.2em] ${status.className}`}
                    >
                      {status.label}
                    </span>
                    {STATUSES.filter((value) => value !== item.status).map((value) => (
                      <button
                        key={value}
                        onClick={() => setStatus(item.id, value)}
                        className="rounded-md border border-white/10 px-2.5 py-0.5 text-[10px] tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-200 hover:bg-white/5"
                      >
                        {value.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
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

export default function AdminFeedbackPage() {
  return <AdminShell section="FEEDBACK">{() => <FeedbackInbox />}</AdminShell>
}
