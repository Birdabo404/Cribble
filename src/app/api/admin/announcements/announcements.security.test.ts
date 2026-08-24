import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The admin announcement routes (migration 050): staff gating surfaces
// getStaffUser's verdict untouched (the owner-only floor for
// announcement.manage itself is staffAuth.test.ts's job), every
// mutation demands an auditable reason before touching the table,
// push-copy validation rejects overlong/unsafe input with specific
// messages, a push archives whatever is LIVE inside the audited
// mutation (the one-live invariant), and archive refuses wrong-state
// rows. Staff auth, rate limiting and the audit wrapper are mocked;
// the Supabase client is a small stateful fake so the invariant can be
// asserted against actual row state rather than call counts alone.

const { getStaffUserMock, auditMock, state } = vi.hoisted(() => ({
  getStaffUserMock: vi.fn(),
  auditMock: vi.fn(),
  state: {
    rows: [] as Array<Record<string, unknown>>,
    inserts: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{
      values: Record<string, unknown>
      filters: Array<[string, unknown]>
    }>,
    nextId: 1
  }
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { admin: { windowMs: 60_000, maxRequests: 30 } },
  checkRateLimit: () => ({
    success: true,
    limit: 30,
    remaining: 29,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers()
}))

vi.mock('@/lib/staffAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staffAuth')>()
  return { ...actual, getStaffUser: getStaffUserMock }
})

vi.mock('@/lib/adminAudit', () => ({ withAudit: auditMock }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'billboard_announcements') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return {
        select: () => ({
          // GET's list terminal — insertion order stands in for the
          // created_at sort (ordering is Postgres's job, not the fake's).
          order: () => ({
            limit: () =>
              Promise.resolve({ data: state.rows.map((row) => ({ ...row })), error: null })
          }),
          // The archive route's single-row read.
          eq: (column: string, value: unknown) => ({
            maybeSingle: () => {
              const row = state.rows.find((candidate) => candidate[column] === value)
              return Promise.resolve({ data: row ? { ...row } : null, error: null })
            }
          })
        }),
        update: (values: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = []
          const apply = () => {
            const matched = state.rows.filter((row) =>
              filters.every(([column, value]) => row[column] === value)
            )
            for (const row of matched) Object.assign(row, values)
            state.updates.push({ values, filters: [...filters] })
            return matched
          }
          // Supabase builders are thenables: awaiting the bare chain
          // (push's blanket archive) applies the update, and .select()
          // (archive's guarded update) applies it and returns the rows.
          const builder = {
            eq(column: string, value: unknown) {
              filters.push([column, value])
              return builder
            },
            select: () =>
              Promise.resolve({ data: apply().map((row) => ({ ...row })), error: null }),
            then(
              resolve: (value: { error: null }) => unknown,
              reject: (reason: unknown) => unknown
            ) {
              apply()
              return Promise.resolve({ error: null }).then(resolve, reject)
            }
          }
          return builder
        },
        insert: (values: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              const row = {
                id: state.nextId++,
                created_at: new Date().toISOString(),
                ...values
              }
              state.rows.push(row)
              state.inserts.push(row)
              return Promise.resolve({ data: { ...row }, error: null })
            }
          })
        })
      }
    }
  })
}))

import { GET, POST } from './route'
import { POST as archivePOST } from './[id]/archive/route'

const owner = {
  ok: true as const,
  staff: { userId: 7, username: 'owner', role: 'owner' as const }
}

const VALID_PUSH = {
  headline: 'SEASON 02 STARTS FRIDAY',
  body: 'Standings reset at midnight UTC.',
  reason: 'Announcing the season 02 start date'
}

function listRequest() {
  return new NextRequest('https://cribble.dev/api/admin/announcements')
}

function pushRequest(body: Record<string, unknown>) {
  return new NextRequest('https://cribble.dev/api/admin/announcements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function archiveRequest(id: number | string, body: Record<string, unknown>) {
  return new NextRequest(`https://cribble.dev/api/admin/announcements/${id}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function archiveParams(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) }
}

// Seeds are relative to the real clock — the routes compute `live`
// against Date.now(), so fixed dates would flip verdicts over time.
const DAY_MS = 86_400_000

function seedRow(overrides: Record<string, unknown> = {}) {
  const row = {
    id: state.nextId++,
    headline: 'OLD HEADLINE',
    body: 'Old body copy.',
    link_url: null,
    status: 'LIVE',
    starts_at: new Date(Date.now() - DAY_MS).toISOString(),
    ends_at: null,
    created_at: new Date(Date.now() - DAY_MS).toISOString(),
    ...overrides
  }
  state.rows.push(row)
  return row
}

describe('admin announcement routes', () => {
  beforeEach(() => {
    getStaffUserMock.mockReset()
    getStaffUserMock.mockResolvedValue(owner)
    auditMock.mockReset()
    auditMock.mockImplementation(
      (_client: unknown, _entry: unknown, mutate: () => Promise<unknown>) => mutate()
    )
    state.rows = []
    state.inserts = []
    state.updates = []
    state.nextId = 1
  })

  describe('staff gate', () => {
    const unauthenticated = { ok: false as const, status: 401, error: 'Authentication required' }
    const moderator = { ok: false as const, status: 403, error: 'Owner access required' }

    it('401s every route for unauthenticated requests', async () => {
      getStaffUserMock.mockResolvedValue(unauthenticated)

      expect((await GET(listRequest())).status).toBe(401)
      expect((await POST(pushRequest(VALID_PUSH))).status).toBe(401)
      expect((await archivePOST(archiveRequest(1, VALID_PUSH), archiveParams(1))).status).toBe(401)
      expect(state.inserts).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('403s every route for moderators — announcement.manage is an owner action', async () => {
      getStaffUserMock.mockResolvedValue(moderator)
      seedRow()

      const list = await GET(listRequest())
      const push = await POST(pushRequest(VALID_PUSH))
      const archive = await archivePOST(archiveRequest(1, VALID_PUSH), archiveParams(1))

      expect(list.status).toBe(403)
      expect(push.status).toBe(403)
      expect(archive.status).toBe(403)
      await expect(push.json()).resolves.toEqual({ error: 'Owner access required' })
      expect(state.inserts).toHaveLength(0)
      expect(state.updates).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })
  })

  describe('reason gate', () => {
    it('400s a push without a reason before any mutation', async () => {
      const response = await POST(
        pushRequest({ headline: VALID_PUSH.headline, body: VALID_PUSH.body })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'A reason of at least 10 characters is required'
      })
      expect(state.inserts).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('400s a push whose reason is under 10 characters', async () => {
      const response = await POST(pushRequest({ ...VALID_PUSH, reason: 'too short' }))

      expect(response.status).toBe(400)
      expect(state.inserts).toHaveLength(0)
    })

    it('400s an archive without a reason before any mutation', async () => {
      const row = seedRow()
      const response = await archivePOST(archiveRequest(row.id as number, {}), archiveParams(row.id as number))

      expect(response.status).toBe(400)
      expect(state.updates).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })
  })

  describe('push validation', () => {
    it('400s a missing headline', async () => {
      const response = await POST(pushRequest({ ...VALID_PUSH, headline: '   ' }))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'A headline is required' })
    })

    it('400s an overlong headline (> 40 code points)', async () => {
      const response = await POST(pushRequest({ ...VALID_PUSH, headline: 'H'.repeat(41) }))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Headline must be at most 40 characters'
      })
      expect(state.inserts).toHaveLength(0)
    })

    it('400s overlong body copy (> 80 code points)', async () => {
      const response = await POST(pushRequest({ ...VALID_PUSH, body: 'B'.repeat(81) }))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Body must be at most 80 characters'
      })
      expect(state.inserts).toHaveLength(0)
    })

    it('400s a non-https link', async () => {
      const response = await POST(
        pushRequest({ ...VALID_PUSH, linkUrl: 'http://cribble.dev/leaderboard' })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'linkUrl must use https' })
    })

    it('400s an unparseable link', async () => {
      const response = await POST(pushRequest({ ...VALID_PUSH, linkUrl: 'not a url' }))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'linkUrl must be a valid URL' })
    })

    it('treats a blank link as absent', async () => {
      const response = await POST(pushRequest({ ...VALID_PUSH, linkUrl: '   ' }))

      expect(response.status).toBe(200)
      expect(state.inserts[0].link_url).toBeNull()
    })

    it('400s a duration outside the presets', async () => {
      const response = await POST(pushRequest({ ...VALID_PUSH, durationHours: 2 }))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'durationHours must be 1, 6 or 24 — or null to stay live until cleared'
      })
      expect(state.inserts).toHaveLength(0)
    })

    it('derives ends_at from a preset duration', async () => {
      const before = Date.now()
      const response = await POST(pushRequest({ ...VALID_PUSH, durationHours: 6 }))
      const data = await response.json()

      expect(response.status).toBe(200)
      const endsAt = Date.parse(data.announcement.endsAt)
      expect(endsAt).toBeGreaterThanOrEqual(before + 6 * 3_600_000)
      expect(endsAt).toBeLessThanOrEqual(Date.now() + 6 * 3_600_000)
    })
  })

  describe('push — the one-live invariant', () => {
    it('archives the previous live row inside the audited mutation and goes live itself', async () => {
      const previous = seedRow()

      const response = await POST(pushRequest(VALID_PUSH))
      const data = await response.json()

      expect(response.status).toBe(200)
      // The blanket archive ran, scoped to LIVE rows only.
      expect(state.updates).toEqual([
        expect.objectContaining({
          values: expect.objectContaining({ status: 'ARCHIVED' }),
          filters: [['status', 'LIVE']]
        })
      ])
      expect(previous.status).toBe('ARCHIVED')
      // Exactly one LIVE row remains — the fresh push, pinned (no preset).
      const liveRows = state.rows.filter((row) => row.status === 'LIVE')
      expect(liveRows).toHaveLength(1)
      expect(liveRows[0].headline).toBe(VALID_PUSH.headline)
      expect(data.announcement.live).toBe(true)
      expect(data.announcement.endsAt).toBeNull()
      // Both steps happened inside the audit wrapper, under the push action.
      expect(auditMock).toHaveBeenCalledTimes(1)
      expect(auditMock.mock.calls[0][1]).toMatchObject({
        action: 'announcement.push',
        reason: VALID_PUSH.reason
      })
    })
  })

  describe('archive', () => {
    const reasonBody = { reason: 'Copy is stale — clearing it now' }

    it('archives a live row and reports the new state', async () => {
      const row = seedRow()

      const response = await archivePOST(
        archiveRequest(row.id as number, reasonBody),
        archiveParams(row.id as number)
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(row.status).toBe('ARCHIVED')
      expect(data.announcement.status).toBe('ARCHIVED')
      expect(data.announcement.live).toBe(false)
      expect(auditMock).toHaveBeenCalledTimes(1)
      expect(auditMock.mock.calls[0][1]).toMatchObject({ action: 'announcement.archive' })
    })

    it('404s an unknown id', async () => {
      const response = await archivePOST(archiveRequest(99, reasonBody), archiveParams(99))

      expect(response.status).toBe(404)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('400s an already-archived row without touching it', async () => {
      const row = seedRow({ status: 'ARCHIVED' })

      const response = await archivePOST(
        archiveRequest(row.id as number, reasonBody),
        archiveParams(row.id as number)
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Only live announcements can be archived — this one is ARCHIVED'
      })
      expect(state.updates).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('400s a malformed id', async () => {
      const response = await archivePOST(archiveRequest('abc', reasonBody), archiveParams('abc'))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid announcement id' })
    })
  })

  describe('list', () => {
    it('maps rows to the API shape with live computed per row', async () => {
      seedRow({
        headline: 'PINNED',
        body: 'Live until cleared.'
      })
      seedRow({
        headline: 'EXPIRED',
        body: 'Preset window ran out.',
        ends_at: new Date(Date.now() - 3_600_000).toISOString()
      })
      seedRow({ headline: 'RETIRED', body: 'Cleared earlier.', status: 'ARCHIVED' })

      const response = await GET(listRequest())
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.announcements).toHaveLength(3)
      const [pinned, expired, retired] = data.announcements
      expect(pinned).toMatchObject({ headline: 'PINNED', status: 'LIVE', live: true, endsAt: null })
      // Status LIVE but past ends_at: off-air, so live must read false.
      expect(expired).toMatchObject({ headline: 'EXPIRED', status: 'LIVE', live: false })
      expect(retired).toMatchObject({ headline: 'RETIRED', status: 'ARCHIVED', live: false })
      expect(pinned.linkUrl).toBeNull()
    })
  })
})
