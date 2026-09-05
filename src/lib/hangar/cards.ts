// The link_cards cache (migration 068) and how the profile reads it.
//
// One row per urlKey, shared across every pilot who pins the same URL.
// Rows are written by refreshCards after a resolve; the profile loader
// joins them onto a pilot's pins with loadCards + toHangarCards and
// never resolves anything on the read path. Freshness is pull-based
// (stale-while-revalidate, no cron): a reader that sees stale or
// missing rows serves what it has and refreshes in after(); the PATCH
// route refreshes only the pins that have no fresh row, so reorders
// and removals cost no network.
//
//   ok      github > 24h  · site > 7d   → refresh
//   failed  > 1h                        → retry
//
// Missing-table tolerance is deliberate: until 068 is applied the
// select fails with PGRST205/42P01. loadCards then reports
// available=false, every pin renders as `pending`, refreshes are
// skipped (no fetch stampede against GitHub on every page view), and
// the miss is logged once per process rather than per request.

import type { SupabaseClient } from '@supabase/supabase-js'
import { urlKey } from '@/lib/hangar/normalize'
import { pendingCard, resolveCard, resolverKindFor } from '@/lib/hangar/resolve'
import type {
  HangarCard,
  HangarCardData,
  HangarGithubCard,
  HangarSiteCard,
  HangarStoredKind
} from '@/lib/hangar/types'

export type LinkCardStatus = 'ok' | 'failed'

/** One link_cards row as selected. */
export interface LinkCardRow {
  url_key: string
  url: string
  kind: HangarStoredKind
  card: HangarCardData
  status: LinkCardStatus
  fetched_at: string
}

/** loadCards result: rows by urlKey plus whether the table answered at
 *  all — callers must not refresh when it did not. */
export interface LinkCardSet {
  rows: Map<string, LinkCardRow>
  available: boolean
}

const LINK_CARDS_SELECT = 'url_key, url, kind, card, status, fetched_at'

const HOUR_MS = 3_600_000
const STALE_OK_GITHUB_MS = 24 * HOUR_MS
const STALE_OK_SITE_MS = 7 * 24 * HOUR_MS
const STALE_FAILED_MS = HOUR_MS

/** True when link_cards hasn't been created yet (migration 068 not
 *  applied). PGRST205 = PostgREST schema-cache miss; 42P01 =
 *  undefined_table from Postgres itself. */
export const isMissingLinkCardsTable = (
  error: { code?: string; message?: string } | null | undefined
): boolean => {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /link_cards.*(schema cache|does not exist)/i.test(error.message || '')
}

let warnedMissingTable = false
const noteMissingTable = (): void => {
  if (warnedMissingTable) return
  warnedMissingTable = true
  console.warn(
    '[Hangar] link_cards table missing (migration 068 not applied) — pins render as pending until it lands'
  )
}

/**
 * Whether a cached row is due for a refresh. Unparseable fetched_at
 * reads as stale so a corrupt row heals itself on the next view.
 */
export function isStale(
  row: Pick<LinkCardRow, 'kind' | 'status' | 'fetched_at'>,
  now: number = Date.now()
): boolean {
  const fetched = Date.parse(row.fetched_at)
  if (!Number.isFinite(fetched)) return true
  const age = now - fetched
  switch (row.status) {
    case 'failed':
      return age > STALE_FAILED_MS
    case 'ok':
      switch (row.kind) {
        case 'github':
          return age > STALE_OK_GITHUB_MS
        case 'site':
          return age > STALE_OK_SITE_MS
        default: {
          // A kind we don't know how to age (hand-edited row) is stale.
          const unknownKind: never = row.kind
          void unknownKind
          return true
        }
      }
    default: {
      const unknownStatus: never = row.status
      void unknownStatus
      return true
    }
  }
}

/** The pins in `urls` whose row is missing or stale. Empty when the
 *  table is unavailable — nothing to refresh into. */
export function staleUrls(urls: string[], set: LinkCardSet, now: number = Date.now()): string[] {
  if (!set.available) return []
  return urls.filter((url) => {
    const key = urlKey(url)
    if (!key) return false
    const row = set.rows.get(key)
    return !row || isStale(row, now)
  })
}

/** Load the cached cards for a set of pins in one query. */
export async function loadCards(supabase: SupabaseClient, urls: string[]): Promise<LinkCardSet> {
  const keys = Array.from(
    new Set(urls.map(urlKey).filter((key): key is string => key !== null))
  )
  if (keys.length === 0) return { rows: new Map(), available: true }

  const { data, error } = await supabase
    .from('link_cards')
    .select(LINK_CARDS_SELECT)
    .in('url_key', keys)

  if (error) {
    if (isMissingLinkCardsTable(error)) {
      noteMissingTable()
    } else {
      console.error('[Hangar] link_cards query error:', error)
    }
    // Either way: serve pending and do not fan out fetches on top of a
    // database that just failed.
    return { rows: new Map(), available: false }
  }

  const rows = new Map<string, LinkCardRow>()
  for (const raw of (data ?? []) as LinkCardRow[]) {
    if (typeof raw.url_key === 'string') rows.set(raw.url_key, raw)
  }
  return { rows, available: true }
}

/**
 * Resolve every URL (deduped on urlKey) and upsert the outcome. A
 * `pending` result is stored as status=failed with the pending card so
 * the failed-row cooldown applies. Returns how many rows were written;
 * 0 on any database error (logged, never thrown).
 */
export async function refreshCards(supabase: SupabaseClient, urls: string[]): Promise<number> {
  const targets = new Map<string, string>()
  for (const url of urls) {
    const key = urlKey(url)
    if (key && !targets.has(key)) targets.set(key, url)
  }
  if (targets.size === 0) return 0

  const entries = Array.from(targets.entries())
  const settled = await Promise.allSettled(entries.map(([, url]) => resolveCard(url)))
  const fetchedAt = new Date().toISOString()

  const rows: LinkCardRow[] = entries.map(([key, url], index) => {
    const outcome = settled[index]
    const card = outcome.status === 'fulfilled' ? outcome.value : pendingCard(url)
    return {
      url_key: key,
      url,
      kind: resolverKindFor(url),
      card,
      status: card.kind === 'pending' ? 'failed' : 'ok',
      fetched_at: fetchedAt
    }
  })

  const { error } = await supabase.from('link_cards').upsert(rows, { onConflict: 'url_key' })
  if (error) {
    if (isMissingLinkCardsTable(error)) {
      noteMissingTable()
    } else {
      console.error('[Hangar] link_cards upsert error:', error)
    }
    return 0
  }
  return rows.length
}

/**
 * Refresh only the pins that need it: one select, then resolve + upsert
 * for rows that are missing or stale. Returns the number refreshed so
 * callers can skip the cache bust when nothing changed.
 */
export async function refreshStaleCards(supabase: SupabaseClient, urls: string[]): Promise<number> {
  if (urls.length === 0) return 0
  const set = await loadCards(supabase, urls)
  const due = staleUrls(urls, set)
  if (due.length === 0) return 0
  return refreshCards(supabase, due)
}

/** A stored card we are willing to serve: our own github/site shape
 *  with a string url. JSONB is trusted-ish (only refreshCards writes
 *  it), but a hand-edited row must not crash the profile. */
const isServableCard = (card: unknown): card is HangarGithubCard | HangarSiteCard => {
  if (!card || typeof card !== 'object') return false
  const c = card as { kind?: unknown; url?: unknown }
  return (c.kind === 'github' || c.kind === 'site') && typeof c.url === 'string'
}

/**
 * Join pins onto their cached rows, in pin order. Missing, failed or
 * malformed rows render as `pending`. inFlight marks the pin whose key
 * matches the owner's NOW BUILDING project_url.
 */
export function toHangarCards(
  pins: string[],
  rows: Map<string, LinkCardRow>,
  projectUrl: string | null
): HangarCard[] {
  const inFlightKey = projectUrl ? urlKey(projectUrl) : null
  return pins.map((pin) => {
    const key = urlKey(pin)
    const row = key ? rows.get(key) : undefined
    const data: HangarCardData =
      row && row.status === 'ok' && isServableCard(row.card) ? row.card : pendingCard(pin)
    return { ...data, inFlight: key !== null && key === inFlightKey }
  })
}
