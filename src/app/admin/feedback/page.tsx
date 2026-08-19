'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminList,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  categoryChipMeta,
  formatDate,
  type AdminChipMeta
} from '@/components/admin'
import { SegmentedControl } from '@/components/settings/SegmentedControl'

// Beta feedback inbox: everything testers submit through the in-app
// feedback button, newest first. Filter by triage status and move items
// between new / seen / done without leaving the list.

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

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'seen', label: 'Seen' },
  { value: 'done', label: 'Done' }
] as const
type StatusFilter = (typeof FILTER_OPTIONS)[number]['value']

const STATUSES = ['new', 'seen', 'done'] as const

/** Triage status → chip. The kit's statusChipMeta maps account status
 *  (active/suspended/banned), so the feedback pipeline keeps its own map:
 *  new = needs attention, seen = informational, done = healthy. */
function feedbackStatusChipMeta(status: string): AdminChipMeta {
  if (status === 'done') return { label: 'DONE', tone: 'good' }
  if (status === 'seen') return { label: 'SEEN', tone: 'info' }
  return { label: 'NEW', tone: 'warn' }
}

/** Message with a 2-line clamp that expands in place. It only becomes a
 *  toggle (with aria-expanded) when the text actually overflows the
 *  clamp — short messages stay plain text instead of advertising a
 *  no-op click. */
function ExpandableMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const paragraphRef = useRef<HTMLParagraphElement | null>(null)

  // clamped is a dependency because flipping it swaps the wrapper
  // (plain p ↔ button > p) and the observer must re-attach to the
  // re-created node. While expanded, the last measurement is kept so
  // the collapse affordance stays visible.
  useEffect(() => {
    const el = paragraphRef.current
    if (!el) return
    const measure = () => {
      if (!expanded) setClamped(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded, clamped])

  const paragraph = (
    <p
      ref={paragraphRef}
      className={`whitespace-pre-wrap break-words text-[13.5px] leading-5 text-[color:var(--st-text)] ${
        expanded ? '' : 'line-clamp-2'
      }`}
    >
      {text}
    </p>
  )

  if (!clamped && !expanded) return paragraph

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
      className="group block w-full rounded-md text-left"
    >
      {paragraph}
      <span className="mt-1 block text-[12px] leading-4 text-[color:var(--st-text-faint)] transition-colors duration-150 group-hover:text-[color:var(--st-text-muted)]">
        {expanded ? 'Show less' : 'Show more'}
      </span>
    </button>
  )
}

export default function AdminFeedbackPage() {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

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

  // The sequence guard drops responses a newer request has superseded
  // (e.g. two quick filter switches resolving out of order).
  const loadFirst = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const page = await fetchPage(filter, null)
      if (seq !== loadSeq.current) return
      setItems(page.items)
      setNextCursor(page.nextCursor)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(err instanceof Error ? err.message : 'Failed to load feedback.')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [fetchPage, filter])

  useEffect(() => {
    void loadFirst()
  }, [loadFirst])

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(filter, nextCursor)
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more feedback.')
    } finally {
      setLoadingMore(false)
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
    <div className="space-y-6">
      <AdminPageHeader
        title="Feedback"
        description="Everything testers send through the in-app feedback button."
      />

      <SegmentedControl
        options={FILTER_OPTIONS}
        value={filter}
        onChange={setFilter}
        aria-label="Filter feedback by status"
      />

      {error && (
        <AdminNotice tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <AdminButton variant="danger" onClick={() => void loadFirst()}>
              Retry
            </AdminButton>
          </div>
        </AdminNotice>
      )}

      <AdminSection flush>
        {loading ? (
          <AdminSkeletonList rows={5} />
        ) : items.length === 0 ? (
          <AdminEmpty
            title={filter === 'all' ? 'No feedback yet.' : `No ${filter} feedback.`}
            hint={
              filter === 'all'
                ? 'Everything testers submit in-app lands here.'
                : 'Nothing holds this status right now.'
            }
          />
        ) : (
          <>
            <AdminList>
              {items.map((item) => {
                const category = categoryChipMeta(item.category)
                const status = feedbackStatusChipMeta(item.status)
                return (
                  <li key={item.id} className="space-y-2 px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <AdminChip tone={category.tone}>{category.label}</AdminChip>
                      <span className="font-data text-[11px] leading-4 text-[color:var(--st-text-faint)]">
                        #{item.id}
                      </span>
                      <span className="font-data text-[11px] leading-4 text-[color:var(--st-text-muted)]">
                        {formatDate(item.created_at)}
                      </span>
                      {item.username ? (
                        <Link
                          href={`/admin/users/${item.user_id}`}
                          className="font-data text-[12px] leading-4 text-[color:var(--st-text)] hover:underline"
                        >
                          @{item.username}
                        </Link>
                      ) : (
                        <span className="font-data text-[12px] leading-4 text-[color:var(--st-text)]">
                          #{item.user_id}
                        </span>
                      )}
                      {item.page_path && (
                        <span className="break-all font-data text-[11px] leading-4 text-[color:var(--st-text-muted)]">
                          {item.page_path}
                        </span>
                      )}
                    </div>
                    <ExpandableMessage text={item.message} />
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminChip tone={status.tone}>{status.label}</AdminChip>
                      {STATUSES.filter((value) => value !== item.status).map((value) => (
                        <AdminButton
                          key={value}
                          variant="ghost"
                          onClick={() => setStatus(item.id, value)}
                        >
                          Mark {value}
                        </AdminButton>
                      ))}
                    </div>
                  </li>
                )
              })}
            </AdminList>
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
