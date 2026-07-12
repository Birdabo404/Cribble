// Paginated reads for events_raw.
//
// Supabase (PostgREST) silently caps any single select at max-rows (1000 on
// hosted projects). Every score/stat computation that reads a user's full
// event history must therefore page through .range() windows — otherwise
// totals silently stop growing once a user crosses 1000 rows, and because
// an un-ordered select returns an arbitrary subset, recalculated scores can
// even fluctuate between syncs.
//
// Callers provide a builder that constructs a FRESH query per page (query
// builders are single-use) with a stable ORDER BY so pages never overlap.

export const EVENTS_PAGE_SIZE = 1000

/** 100 pages x 1000 rows = 100k events (~a year of heavy use post-coalescing). */
export const MAX_EVENT_PAGES = 100

type PageResult<T> = {
  data: T[] | null
  error: { message: string } | null
}

export type FetchAllPagesResult<T> = {
  rows: T[]
  error: string | null
  /** True when maxPages was exhausted before the last page was reached. */
  truncated: boolean
}

export async function fetchAllEventPages<T>(
  buildPageQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options?: { pageSize?: number; maxPages?: number }
): Promise<FetchAllPagesResult<T>> {
  const pageSize = options?.pageSize ?? EVENTS_PAGE_SIZE
  const maxPages = options?.maxPages ?? MAX_EVENT_PAGES
  const rows: T[] = []

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await buildPageQuery(from, from + pageSize - 1)
    if (error) {
      return { rows, error: error.message, truncated: false }
    }
    const batch = data || []
    rows.push(...batch)
    if (batch.length < pageSize) {
      return { rows, error: null, truncated: false }
    }
  }

  return { rows, error: null, truncated: true }
}
