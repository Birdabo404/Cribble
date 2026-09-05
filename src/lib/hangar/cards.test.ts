import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HangarCardData } from './types'

// cards.ts against a hand-rolled Supabase stand-in: staleness rules,
// the pin → card join (order, pending fallbacks, inFlight), and the
// refresh path (dedupe, failed-row shape, missing-table tolerance).
// resolveCard is mocked — the resolvers have their own suite.

const resolveCardMock = vi.fn<[string], Promise<HangarCardData>>()

vi.mock('./resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolve')>()
  return { ...actual, resolveCard: (url: string) => resolveCardMock(url) }
})

import {
  isMissingLinkCardsTable,
  isStale,
  loadCards,
  refreshCards,
  refreshStaleCards,
  staleUrls,
  toHangarCards,
  type LinkCardRow
} from './cards'

interface FakeDb {
  client: SupabaseClient
  selects: string[][]
  upserts: Array<{ rows: LinkCardRow[]; options: unknown }>
}

interface FakeDbOptions {
  select?: () => { data: unknown[] | null; error: { code?: string; message?: string } | null }
  upsert?: () => { error: { code?: string; message?: string } | null }
}

const fakeDb = (options: FakeDbOptions = {}): FakeDb => {
  const selects: string[][] = []
  const upserts: FakeDb['upserts'] = []
  const client = {
    from: (table: string) => {
      expect(table).toBe('link_cards')
      return {
        select: () => ({
          in: async (_column: string, keys: string[]) => {
            selects.push(keys)
            return options.select?.() ?? { data: [], error: null }
          }
        }),
        upsert: async (rows: LinkCardRow[], upsertOptions: unknown) => {
          upserts.push({ rows, options: upsertOptions })
          return options.upsert?.() ?? { error: null }
        }
      }
    }
  }
  return { client: client as unknown as SupabaseClient, selects, upserts }
}

const NOW = Date.parse('2026-09-03T12:00:00Z')
const HOUR = 3_600_000
const agoIso = (ms: number) => new Date(NOW - ms).toISOString()

const githubRow = (overrides: Partial<LinkCardRow> = {}): LinkCardRow => ({
  url_key: 'https://github.com/birdabo404/cribble',
  url: 'https://github.com/Birdabo404/Cribble',
  kind: 'github',
  status: 'ok',
  fetched_at: agoIso(HOUR),
  card: {
    kind: 'github',
    url: 'https://github.com/Birdabo404/Cribble',
    owner: 'Birdabo404',
    repo: 'Cribble',
    description: null,
    stars: 10,
    forks: 1,
    language: 'TypeScript',
    languageColor: '#3178c6',
    pushedAt: null,
    archived: false,
    homepage: null
  },
  ...overrides
})

const siteRow = (overrides: Partial<LinkCardRow> = {}): LinkCardRow => ({
  url_key: 'https://cribble.dev',
  url: 'https://cribble.dev/',
  kind: 'site',
  status: 'ok',
  fetched_at: agoIso(HOUR),
  card: {
    kind: 'site',
    url: 'https://cribble.dev/',
    host: 'cribble.dev',
    title: 'Cribble',
    description: null,
    icon: 'https://cribble.dev/favicon.ico'
  },
  ...overrides
})

beforeEach(() => {
  resolveCardMock.mockReset()
  // isStale/staleUrls take an explicit now; refreshStaleCards uses Date.now().
  // Pin the clock to NOW so a github row fetched an hour ago stays fresh.
  vi.useFakeTimers({ now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('isStale', () => {
  it('ages ok rows by kind and failed rows by the retry cooldown', () => {
    expect(isStale(githubRow({ fetched_at: agoIso(23 * HOUR) }), NOW)).toBe(false)
    expect(isStale(githubRow({ fetched_at: agoIso(25 * HOUR) }), NOW)).toBe(true)

    expect(isStale(siteRow({ fetched_at: agoIso(6 * 24 * HOUR) }), NOW)).toBe(false)
    expect(isStale(siteRow({ fetched_at: agoIso(8 * 24 * HOUR) }), NOW)).toBe(true)

    expect(isStale(githubRow({ status: 'failed', fetched_at: agoIso(HOUR / 2) }), NOW)).toBe(false)
    expect(isStale(githubRow({ status: 'failed', fetched_at: agoIso(2 * HOUR) }), NOW)).toBe(true)
    expect(isStale(siteRow({ status: 'failed', fetched_at: agoIso(2 * HOUR) }), NOW)).toBe(true)
  })

  it('treats an unparseable fetched_at as stale', () => {
    expect(isStale(githubRow({ fetched_at: 'never' }), NOW)).toBe(true)
  })
})

describe('staleUrls', () => {
  it('lists missing and stale pins, nothing when the table is unavailable', () => {
    const rows = new Map<string, LinkCardRow>([
      [githubRow().url_key, githubRow()],
      [siteRow().url_key, siteRow({ fetched_at: agoIso(30 * 24 * HOUR) })]
    ])
    const pins = [
      'https://github.com/Birdabo404/Cribble',
      'https://cribble.dev/',
      'https://example.com/new'
    ]
    expect(staleUrls(pins, { rows, available: true }, NOW)).toEqual([
      'https://cribble.dev/',
      'https://example.com/new'
    ])
    expect(staleUrls(pins, { rows, available: false }, NOW)).toEqual([])
  })
})

describe('toHangarCards', () => {
  it('joins in pin order, renders missing/failed/malformed rows as pending, marks inFlight', () => {
    const rows = new Map<string, LinkCardRow>([
      [githubRow().url_key, githubRow()],
      [siteRow().url_key, siteRow()],
      [
        'https://example.com/failed',
        siteRow({
          url_key: 'https://example.com/failed',
          url: 'https://example.com/failed',
          status: 'failed',
          card: { kind: 'pending', url: 'https://example.com/failed', host: 'example.com' }
        })
      ],
      [
        'https://example.com/garbage',
        siteRow({
          url_key: 'https://example.com/garbage',
          card: { nope: true } as unknown as HangarCardData
        })
      ]
    ])

    const cards = toHangarCards(
      [
        'https://example.com/missing',
        'https://www.cribble.dev/?utm_source=x',
        'https://github.com/Birdabo404/Cribble',
        'https://example.com/failed',
        'https://example.com/garbage'
      ],
      rows,
      'https://GITHUB.com/birdabo404/cribble.git'
    )

    expect(cards.map((c) => c.kind)).toEqual(['pending', 'site', 'github', 'pending', 'pending'])
    expect(cards[0]).toEqual({
      kind: 'pending',
      url: 'https://example.com/missing',
      host: 'example.com',
      inFlight: false
    })
    expect(cards[1]).toMatchObject({ kind: 'site', title: 'Cribble', inFlight: false })
    expect(cards[2]).toMatchObject({ kind: 'github', repo: 'Cribble', stars: 10, inFlight: true })
    expect(cards[3]).toMatchObject({ kind: 'pending', url: 'https://example.com/failed' })
    expect(cards[4]).toMatchObject({ kind: 'pending', url: 'https://example.com/garbage' })
  })

  it('never marks inFlight without a project_url', () => {
    const cards = toHangarCards(['https://github.com/a/b'], new Map(), null)
    expect(cards).toEqual([
      { kind: 'pending', url: 'https://github.com/a/b', host: 'github.com', inFlight: false }
    ])
  })
})

describe('loadCards', () => {
  it('selects by deduped urlKey and maps rows by key', async () => {
    const db = fakeDb({ select: () => ({ data: [githubRow(), siteRow()], error: null }) })

    const set = await loadCards(db.client, [
      'https://github.com/Birdabo404/Cribble',
      'https://www.github.com/birdabo404/cribble/',
      'https://cribble.dev/',
      'garbage'
    ])

    expect(db.selects).toEqual([['https://github.com/birdabo404/cribble', 'https://cribble.dev']])
    expect(set.available).toBe(true)
    expect(Array.from(set.rows.keys())).toEqual([
      'https://github.com/birdabo404/cribble',
      'https://cribble.dev'
    ])
  })

  it('skips the query entirely for no pins', async () => {
    const db = fakeDb()
    const set = await loadCards(db.client, [])
    expect(db.selects).toEqual([])
    expect(set).toEqual({ rows: new Map(), available: true })
  })

  it('degrades to unavailable when the table is missing, warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const db = fakeDb({
      select: () => ({
        data: null,
        error: { code: 'PGRST205', message: "Could not find the table 'public.link_cards'" }
      })
    })

    const first = await loadCards(db.client, ['https://cribble.dev/'])
    const second = await loadCards(db.client, ['https://cribble.dev/'])

    expect(first).toEqual({ rows: new Map(), available: false })
    expect(second.available).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('degrades to unavailable on any other query error, logging it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = fakeDb({ select: () => ({ data: null, error: { code: '57014', message: 'timeout' } }) })

    const set = await loadCards(db.client, ['https://cribble.dev/'])

    expect(set.available).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('isMissingLinkCardsTable', () => {
  it('recognises the PostgREST and Postgres flavours of undefined table', () => {
    expect(isMissingLinkCardsTable({ code: 'PGRST205' })).toBe(true)
    expect(isMissingLinkCardsTable({ code: '42P01' })).toBe(true)
    expect(
      isMissingLinkCardsTable({ message: 'relation "public.link_cards" does not exist' })
    ).toBe(true)
    expect(isMissingLinkCardsTable({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingLinkCardsTable(null)).toBe(false)
  })
})

describe('refreshCards', () => {
  it('resolves each deduped URL and upserts ok/failed rows keyed on urlKey', async () => {
    const db = fakeDb()
    resolveCardMock.mockImplementation(async (url) =>
      url.includes('github')
        ? (githubRow().card as HangarCardData)
        : { kind: 'pending', url, host: 'example.com' }
    )

    const written = await refreshCards(db.client, [
      'https://github.com/Birdabo404/Cribble',
      'https://github.com/birdabo404/cribble.git',
      'https://example.com/down'
    ])

    expect(written).toBe(2)
    expect(resolveCardMock).toHaveBeenCalledTimes(2)
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0].options).toEqual({ onConflict: 'url_key' })
    const [github, site] = db.upserts[0].rows
    expect(github).toMatchObject({
      url_key: 'https://github.com/birdabo404/cribble',
      url: 'https://github.com/Birdabo404/Cribble',
      kind: 'github',
      status: 'ok'
    })
    expect(github.card.kind).toBe('github')
    expect(Number.isFinite(Date.parse(github.fetched_at))).toBe(true)
    expect(site).toMatchObject({
      url_key: 'https://example.com/down',
      kind: 'site',
      status: 'failed',
      card: { kind: 'pending', url: 'https://example.com/down', host: 'example.com' }
    })
  })

  it('stores a rejected resolver as a failed pending row instead of throwing', async () => {
    const db = fakeDb()
    resolveCardMock.mockRejectedValue(new Error('boom'))

    const written = await refreshCards(db.client, ['https://example.com/x'])

    expect(written).toBe(1)
    expect(db.upserts[0].rows[0]).toMatchObject({
      status: 'failed',
      card: { kind: 'pending', url: 'https://example.com/x', host: 'example.com' }
    })
  })

  it('returns 0 and stays quiet when the table is missing or there is nothing to do', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const db = fakeDb({ upsert: () => ({ error: { code: '42P01', message: 'no table' } }) })
    resolveCardMock.mockResolvedValue({ kind: 'pending', url: 'u', host: 'h' })

    expect(await refreshCards(db.client, ['https://example.com/x'])).toBe(0)
    expect(await refreshCards(db.client, [])).toBe(0)
    expect(await refreshCards(db.client, ['garbage'])).toBe(0)
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
  })
})

describe('refreshStaleCards', () => {
  it('only resolves pins whose row is missing or stale', async () => {
    const db = fakeDb({
      select: () => ({
        data: [githubRow(), siteRow({ fetched_at: agoIso(30 * 24 * HOUR) })],
        error: null
      })
    })
    resolveCardMock.mockResolvedValue({ kind: 'pending', url: 'x', host: 'h' })

    const refreshed = await refreshStaleCards(db.client, [
      'https://github.com/Birdabo404/Cribble',
      'https://cribble.dev/',
      'https://example.com/new'
    ])

    expect(refreshed).toBe(2)
    expect(resolveCardMock.mock.calls.map(([url]) => url)).toEqual([
      'https://cribble.dev/',
      'https://example.com/new'
    ])
  })

  it('does nothing when every card is fresh, or when the table is unavailable', async () => {
    const fresh = fakeDb({ select: () => ({ data: [githubRow()], error: null }) })
    expect(await refreshStaleCards(fresh.client, ['https://github.com/Birdabo404/Cribble'])).toBe(0)
    expect(fresh.upserts).toEqual([])

    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const missing = fakeDb({ select: () => ({ data: null, error: { code: 'PGRST205' } }) })
    expect(await refreshStaleCards(missing.client, ['https://example.com/x'])).toBe(0)
    expect(resolveCardMock).not.toHaveBeenCalled()
    expect(missing.upserts).toEqual([])

    expect(await refreshStaleCards(fresh.client, [])).toBe(0)
  })
})
