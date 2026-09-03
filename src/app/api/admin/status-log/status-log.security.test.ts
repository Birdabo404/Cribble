import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The admin status-log route (migration 070): staff gating surfaces
// getStaffUser's verdict untouched (status.manage's owner floor is
// staffAuth.test.ts's job), every post demands an auditable reason
// before touching the table, an opener needs title + severity, a
// follow-up needs a real thread and a phase and carries title/severity
// forward, and nothing is ever updated or deleted. Staff auth, rate
// limiting and the audit wrapper are mocked; the Supabase client is a
// small stateful fake so assertions run against actual row state.

const { getStaffUserMock, auditMock, state } = vi.hoisted(() => ({
  getStaffUserMock: vi.fn(),
  auditMock: vi.fn(),
  state: {
    rows: [] as Array<Record<string, unknown>>,
    inserts: [] as Array<Record<string, unknown>>,
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
      if (table !== 'status_log_entries') {
        throw new Error(`Unexpected table: ${table}`)
      }
      const filters: Array<[string, 'eq' | 'gte', unknown]> = []
      const matched = () =>
        state.rows
          .filter((row) =>
            filters.every(([column, op, value]) =>
              op === 'eq' ? row[column] === value : String(row[column]) >= String(value)
            )
          )
          .map((row) => ({ ...row }))
      const builder = {
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          filters.push([column, 'eq', value])
          return builder
        },
        gte(column: string, value: unknown) {
          filters.push([column, 'gte', value])
          return builder
        },
        order() {
          return builder
        },
        limit() {
          return Promise.resolve({ data: matched(), error: null })
        },
        then(
          resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown,
          reject: (reason: unknown) => unknown
        ) {
          return Promise.resolve({ data: matched(), error: null }).then(resolve, reject)
        },
        insert: (values: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              const row = {
                id: state.nextId++,
                incident_id: `00000000-0000-4000-8000-${String(state.nextId).padStart(12, '0')}`,
                created_at: new Date().toISOString(),
                ...values
              }
              state.rows.push(row)
              state.inserts.push(row)
              return Promise.resolve({ data: { ...row }, error: null })
            }
          })
        }),
        update: () => {
          throw new Error('status log lines are never updated')
        },
        delete: () => {
          throw new Error('status log lines are never deleted')
        }
      }
      return builder
    }
  })
}))

import { GET, POST } from './route'

const owner = {
  ok: true as const,
  staff: { userId: 7, username: 'owner', role: 'owner' as const }
}

const THREAD = '11111111-2222-4333-8444-555555555555'

const VALID_OPEN = {
  title: 'Elevated API errors',
  severity: 'degraded',
  body: 'We are seeing elevated error rates on the API and are investigating.',
  reason: 'Alert: 5xx above 5% since 14:02 UTC'
}

function listRequest() {
  return new NextRequest('https://cribble.dev/api/admin/status-log')
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('https://cribble.dev/api/admin/status-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function seedLine(overrides: Record<string, unknown> = {}) {
  const row = {
    id: state.nextId++,
    incident_id: THREAD,
    severity: 'outage',
    phase: 'identified',
    title: 'Database unreachable',
    body: 'Connection pool exhausted; rolling back.',
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides
  }
  state.rows.push(row)
  return row
}

describe('admin status-log route', () => {
  beforeEach(() => {
    getStaffUserMock.mockReset()
    getStaffUserMock.mockResolvedValue(owner)
    auditMock.mockReset()
    auditMock.mockImplementation(
      (_client: unknown, _entry: unknown, mutate: () => Promise<unknown>) => mutate()
    )
    state.rows = []
    state.inserts = []
    state.nextId = 1
  })

  describe('staff gate', () => {
    it('401s both routes for unauthenticated requests', async () => {
      getStaffUserMock.mockResolvedValue({
        ok: false as const,
        status: 401,
        error: 'Authentication required'
      })

      expect((await GET(listRequest())).status).toBe(401)
      expect((await POST(postRequest(VALID_OPEN))).status).toBe(401)
      expect(state.inserts).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('403s both routes for moderators — status.manage is an owner action', async () => {
      getStaffUserMock.mockResolvedValue({
        ok: false as const,
        status: 403,
        error: 'Owner access required'
      })

      const list = await GET(listRequest())
      const post = await POST(postRequest(VALID_OPEN))

      expect(list.status).toBe(403)
      expect(post.status).toBe(403)
      await expect(post.json()).resolves.toEqual({ error: 'Owner access required' })
      expect(state.inserts).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('asks getStaffUser for status.manage specifically', async () => {
      await GET(listRequest())
      expect(getStaffUserMock).toHaveBeenLastCalledWith(expect.anything(), 'status.manage')
    })
  })

  describe('reason gate', () => {
    it('400s a post without a reason before any mutation', async () => {
      const noReason: Record<string, unknown> = { ...VALID_OPEN }
      delete noReason.reason
      const response = await POST(postRequest(noReason))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'A reason of at least 10 characters is required'
      })
      expect(state.inserts).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('400s a reason under 10 characters', async () => {
      const response = await POST(postRequest({ ...VALID_OPEN, reason: 'short' }))
      expect(response.status).toBe(400)
      expect(state.inserts).toHaveLength(0)
    })
  })

  describe('opening an incident', () => {
    it('inserts an opener with a minted incident id, defaulting to investigating', async () => {
      const response = await POST(postRequest(VALID_OPEN))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(state.inserts).toHaveLength(1)
      // Openers never send incident_id — the table mints it.
      expect(state.inserts[0]).not.toHaveProperty('incident_id', THREAD)
      expect(state.inserts[0]).toMatchObject({
        severity: 'degraded',
        phase: 'investigating',
        title: VALID_OPEN.title,
        created_by: 7
      })
      expect(data.entry.phase).toBe('investigating')
      expect(data.thread).toMatchObject({
        open: true,
        title: VALID_OPEN.title,
        severity: 'degraded',
        phase: 'investigating'
      })
      expect(data.thread.entries).toHaveLength(1)
      expect(auditMock).toHaveBeenCalledTimes(1)
      expect(auditMock.mock.calls[0][1]).toMatchObject({
        action: 'status.open',
        reason: VALID_OPEN.reason
      })
    })

    it('honours an explicit opening phase', async () => {
      const response = await POST(postRequest({ ...VALID_OPEN, phase: 'maintenance' }))
      expect(response.status).toBe(200)
      expect(state.inserts[0].phase).toBe('maintenance')
    })

    it('400s an opener without a title', async () => {
      const response = await POST(postRequest({ ...VALID_OPEN, title: '   ' }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'A title is required to open an incident'
      })
      expect(state.inserts).toHaveLength(0)
    })

    it('400s an overlong title (> 80 code points)', async () => {
      const response = await POST(postRequest({ ...VALID_OPEN, title: 'T'.repeat(81) }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Title must be at most 80 characters'
      })
    })

    it('400s an opener without a severity', async () => {
      const noSeverity: Record<string, unknown> = { ...VALID_OPEN }
      delete noSeverity.severity
      const response = await POST(postRequest(noSeverity))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'A severity is required to open an incident'
      })
    })

    it('400s the probe word unknown as a severity', async () => {
      const response = await POST(postRequest({ ...VALID_OPEN, severity: 'unknown' }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'severity must be operational, degraded or outage'
      })
    })

    it('400s an unknown phase word', async () => {
      const response = await POST(postRequest({ ...VALID_OPEN, phase: 'fixed' }))
      expect(response.status).toBe(400)
    })

    it('400s missing or overlong update text', async () => {
      expect((await POST(postRequest({ ...VALID_OPEN, body: '' }))).status).toBe(400)
      const long = await POST(postRequest({ ...VALID_OPEN, body: 'x'.repeat(601) }))
      expect(long.status).toBe(400)
      await expect(long.json()).resolves.toEqual({
        error: 'Update text must be at most 600 characters'
      })
      expect(state.inserts).toHaveLength(0)
    })

    it('strips control characters from copy before storing it', async () => {
      const response = await POST(
        postRequest({ ...VALID_OPEN, title: 'API\u0000 errors', body: 'we\tare\non it' })
      )
      expect(response.status).toBe(200)
      expect(state.inserts[0].title).toBe('API errors')
      expect(state.inserts[0].body).toBe('we are on it')
    })
  })

  describe('following up', () => {
    const followUp = {
      incidentId: THREAD,
      phase: 'monitoring',
      body: 'Rollback complete; error rates back to baseline.',
      reason: 'Rollback finished, watching the graphs'
    }

    it('joins the thread and carries title and severity forward', async () => {
      seedLine()
      const response = await POST(postRequest(followUp))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(state.inserts[0]).toMatchObject({
        incident_id: THREAD,
        title: 'Database unreachable',
        severity: 'outage',
        phase: 'monitoring'
      })
      expect(data.thread).toMatchObject({
        incidentId: THREAD,
        open: true,
        phase: 'monitoring',
        severity: 'outage'
      })
      expect(data.thread.entries).toHaveLength(2)
      expect(data.thread.entries[0].phase).toBe('monitoring')
      expect(auditMock.mock.calls[0][1]).toMatchObject({ action: 'status.update' })
    })

    it('defaults a resolution to operational and closes the thread', async () => {
      seedLine()
      const response = await POST(postRequest({ ...followUp, phase: 'resolved' }))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(state.inserts[0].severity).toBe('operational')
      expect(data.thread.open).toBe(false)
      expect(data.thread.resolvedAt).toBe(data.entry.at)
    })

    it('lets an explicit severity override the carried one', async () => {
      seedLine()
      const response = await POST(postRequest({ ...followUp, severity: 'degraded' }))
      expect(response.status).toBe(200)
      expect(state.inserts[0].severity).toBe('degraded')
    })

    it('ignores a title on a follow-up — the thread keeps its name', async () => {
      seedLine()
      await POST(postRequest({ ...followUp, title: 'Something else' }))
      expect(state.inserts[0].title).toBe('Database unreachable')
    })

    it('404s an unknown incident id before any mutation', async () => {
      const response = await POST(postRequest(followUp))
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Incident not found' })
      expect(state.inserts).toHaveLength(0)
      expect(auditMock).not.toHaveBeenCalled()
    })

    it('400s a malformed incident id', async () => {
      const response = await POST(postRequest({ ...followUp, incidentId: '42' }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'incidentId must be a UUID' })
    })

    it('400s a follow-up without a phase', async () => {
      seedLine()
      const noPhase: Record<string, unknown> = { ...followUp }
      delete noPhase.phase
      const response = await POST(postRequest(noPhase))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'A phase is required for a follow-up'
      })
      expect(state.inserts).toHaveLength(0)
    })
  })

  describe('list', () => {
    it('returns the raw lines and the derived open / recent view', async () => {
      seedLine()
      seedLine({
        incident_id: '99999999-8888-4777-8666-555555555555',
        severity: 'operational',
        phase: 'resolved',
        title: 'Brief sync blip',
        created_at: new Date(Date.now() - 7_200_000).toISOString()
      })

      const response = await GET(listRequest())
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.entries).toHaveLength(2)
      expect(data.notices.open.map((thread: { title: string }) => thread.title)).toEqual([
        'Database unreachable'
      ])
      expect(data.notices.recent.map((thread: { title: string }) => thread.title)).toEqual([
        'Brief sync blip'
      ])
    })
  })
})
