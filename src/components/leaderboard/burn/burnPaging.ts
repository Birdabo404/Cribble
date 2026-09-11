// Paging for the burn board — 25 rows a page, the GLOBAL board's size.
// The API already returns the whole board (the CRT feed above needs every
// row), so this is a client-side slice: pure helpers for the arithmetic
// and the pager's page list, and one hook that owns the page number.
//
// The hook's contract with a board: the requested page is clamped to
// whatever the rows allow on every render, so a refetch that shrinks the
// board never strands the viewer on a page that no longer exists, and a
// retune (rows set to null while the next window loads) reopens on page
// one — an empty board has one page, and the clamp lands there.

import { useEffect, useMemo, useState } from 'react'
import { padRank } from '@/components/leaderboard/ai/aiBoardState'

export const PAGE_SIZE = 25

/** The pager shows at most this many slots (numbers + ellipses). */
const PAGER_SLOTS = 7

/** 1-based page holding the 0-based row index. */
export function pageOf(index: number, size = PAGE_SIZE): number {
  return Math.floor(Math.max(0, index) / size) + 1
}

/** At least one page, even for an empty board. */
export function totalPagesFor(count: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / size))
}

export function clampPage(page: number, totalPages: number): number {
  const last = Math.max(1, Math.floor(totalPages))
  const wanted = Number.isFinite(page) ? Math.floor(page) : 1
  return Math.min(Math.max(1, wanted), last)
}

/** 1-based inclusive rank bounds of a page; both 0 on an empty board. */
export function pageBounds(
  page: number,
  size: number,
  total: number
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 }
  const from = (page - 1) * size + 1
  return { from: Math.min(from, total), to: Math.min(page * size, total) }
}

/** `01–25 / 74` — the title bar's range, bounds padded like the `[01]`
 *  indices so the two read as one system. */
export function rangeLabel(page: number, size: number, total: number): string {
  const { from, to } = pageBounds(page, size, total)
  return `${padRank(from)}\u2013${padRank(to)} / ${total}`
}

/** Pager slots: every page up to seven, then always the first and last
 *  with a window around the current page and `…` for the folds. Fixed at
 *  seven slots so the footer never changes width between pages. */
export function pageItems(page: number, totalPages: number): (number | '…')[] {
  const n = Math.max(1, totalPages)
  if (n <= PAGER_SLOTS) return Array.from({ length: n }, (_, i) => i + 1)
  const p = clampPage(page, n)
  if (p <= 4) return [1, 2, 3, 4, 5, '…', n]
  if (p >= n - 3) return [1, '…', n - 4, n - 3, n - 2, n - 1, n]
  return [1, '…', p - 1, p, p + 1, '…', n]
}

export type PagedRows<T> = {
  /** Clamped, 1-based. */
  page: number
  setPage: (page: number) => void
  totalPages: number
  /** The current page's slice; empty while rows are null. */
  paged: T[]
}

export function usePagedRows<T>(rows: T[] | null, size = PAGE_SIZE): PagedRows<T> {
  const [requested, setPage] = useState(1)
  const totalPages = totalPagesFor(rows?.length ?? 0, size)
  const page = clampPage(requested, totalPages)

  // Write the clamp back so a later refetch that regrows the board does
  // not spring the viewer forward to a page they left by shrinkage.
  useEffect(() => {
    if (requested !== page) setPage(page)
  }, [requested, page])

  const paged = useMemo(
    () => (rows ? rows.slice((page - 1) * size, page * size) : []),
    [rows, page, size]
  )

  return { page, setPage, totalPages, paged }
}
