import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { CursorProfileData } from '@/lib/cursorProfile'

// The claim half of the cursor-profile route. Under test: the
// handle-switch ordering contract — the accumulated daily history is
// deleted only AFTER the cursor_profiles upsert has durably won the
// claim, so losing the 23505 race (someone else claims the handle
// between our pre-check and the write) leaves the user on their old
// handle WITH their history intact — the ownership-proof reset (a
// handle switch nulls verified_at/verify_code, migration 067, while a
// same-handle re-claim keeps them), and the per-account distributed
// rate budget that keeps cursor.com scrapes human-paced across
// serverless instances. upsertCursorProfileDaily and loadLinkedState
// run REAL against the stateful fake, so the op log below is the
// route's actual write order.

const { getSessionUserIdMock, distributedLimitMock, fetchCursorProfileMock, db } = vi.hoisted(
  () => ({
    getSessionUserIdMock: vi.fn(),
    distributedLimitMock: vi.fn(),
    fetchCursorProfileMock: vi.fn(),
    db: {
      profiles: [] as Array<Record<string, unknown>>,
      daily: [] as Array<Record<string, unknown>>,
      profileUpsertError: null as { code?: string; message: string } | null,
      /** Chronological table-write log — the ordering assertions. */
      ops: [] as string[]
    }
  })
)

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

// The cross-instance per-account budget (Postgres-backed in production)
// is faked; the process-local prefilter runs real and stays far under
// its allowance here.
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  checkDistributedRateLimit: distributedLimitMock
}))

// normalizeCursorUsername and the daily-series merge run real — only
// the network scrape is faked.
vi.mock('@/lib/cursorProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cursorProfile')>()),
  fetchCursorProfile: fetchCursorProfileMock
}))

// A stateful two-table fake honoring exactly the chains the route and
// cursorProfileServer issue: the claimant/existing-link/status reads
// (select -> eq -> maybeSingle), the claim upsert, and the daily
// table's delete/upsert/window-read.
vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'cursor_profiles') {
        return {
          select: () => ({
            eq: (column: string, value: unknown) => ({
              maybeSingle: async () => {
                const row = db.profiles.find((profile) => profile[column] === value)
                // Detached copy, like a real PostgREST read — the route
                // must not see later table writes through this result.
                return { data: row ? { ...row } : null, error: null }
              }
            })
          }),
          upsert: async (row: Record<string, unknown>) => {
            db.ops.push('profiles.upsert')
            if (db.profileUpsertError) return { error: db.profileUpsertError }
            const existing = db.profiles.find((profile) => profile.user_id === row.user_id)
            if (existing) Object.assign(existing, row)
            else db.profiles.push({ board_enabled: true, ...row })
            return { error: null }
          }
        }
      }
      if (table === 'cursor_profile_daily') {
        return {
          delete: () => ({
            eq: async (_column: string, value: unknown) => {
              db.ops.push('daily.delete')
              db.daily = db.daily.filter((row) => row.user_id !== value)
              return { error: null }
            }
          }),
          upsert: async (rows: Array<Record<string, unknown>>) => {
            db.ops.push('daily.upsert')
            for (const row of rows) {
              const existing = db.daily.find(
                (daily) => daily.user_id === row.user_id && daily.day === row.day
              )
              if (existing) Object.assign(existing, row)
              else db.daily.push(row)
            }
            return { error: null }
          },
          select: () => ({
            eq: (column: string, value: unknown) => ({
              gte: async (_column: string, since: unknown) => ({
                data: db.daily
                  .filter((row) => row[column] === value && String(row.day) >= String(since))
                  .map((row) => ({ tokens: row.tokens ?? 0 })),
                error: null
              })
            })
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { POST } from './route'

function claimRequest(username: string) {
  return new NextRequest('https://cribble.dev/api/user/cursor-profile', {
    method: 'POST',
    headers: { host: 'cribble.dev', 'content-type': 'application/json' },
    body: JSON.stringify({ username })
  })
}

/** A minimal successful scrape — one fresh daily row dated 2026-08-29. */
function scrapedProfile(displayName: string): CursorProfileData {
  return {
    displayName,
    avatarUrl: 'https://example.com/a.png',
    joinedDate: '2025-01-01T00:00:00.000Z',
    stats: {
      currentStreak: 1,
      longestStreak: 2,
      agentsLocal: 3,
      agentsCloud: 0,
      longestAgentSeconds: 60
    },
    topModels: ['Model A'],
    tokensOverTime: [{ date: '2026-08-29', tokens: 42 }],
    agentsOverTime: [{ date: '2026-08-29', local: 1, cloud: 0 }]
  }
}

describe('POST /api/user/cursor-profile (claim)', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 7 })
    distributedLimitMock.mockReset()
    distributedLimitMock.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      resetTime: Date.now() + 15 * 60 * 1000
    })
    fetchCursorProfileMock.mockReset()
    fetchCursorProfileMock.mockResolvedValue({ status: 'ok', profile: scrapedProfile('New') })
    db.profiles = []
    db.daily = []
    db.profileUpsertError = null
    db.ops = []
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('keeps the old handle and its whole history when the upsert loses the 23505 race on a switch', async () => {
    db.profiles = [{ user_id: 7, cursor_username: 'oldhandle', board_enabled: true }]
    db.daily = [
      { user_id: 7, day: '2026-05-01', tokens: 11 },
      { user_id: 7, day: '2026-08-20', tokens: 22 }
    ]
    // Another account claims @newhandle between our pre-check (which
    // sees it free) and the write.
    db.profileUpsertError = { code: '23505', message: 'duplicate key value' }

    const response = await POST(claimRequest('newhandle'))

    expect(response.status).toBe(409)
    // The user is still linked to their OLD handle, so the accumulated
    // history must be untouched — no delete may run before the upsert.
    expect(db.ops).toEqual(['profiles.upsert'])
    expect(db.profiles[0].cursor_username).toBe('oldhandle')
    expect(db.daily).toHaveLength(2)
  })

  it('on a successful switch deletes the old history only after the upsert, then seeds the new handle', async () => {
    db.profiles = [{ user_id: 7, cursor_username: 'oldhandle', board_enabled: true }]
    db.daily = [{ user_id: 7, day: '2026-05-01', tokens: 11 }]

    const response = await POST(claimRequest('newhandle'))

    expect(response.status).toBe(200)
    // The contract under test: win the claim first, THEN reset the
    // history, THEN write the new handle's first daily rows.
    expect(db.ops).toEqual(['profiles.upsert', 'daily.delete', 'daily.upsert'])
    expect(db.profiles[0].cursor_username).toBe('newhandle')
    expect(db.daily.map((row) => row.day)).toEqual(['2026-08-29'])
    await expect(response.json()).resolves.toMatchObject({ success: true, linked: true })
  })

  it('never touches the accumulated history on a re-claim of the same handle', async () => {
    db.profiles = [{ user_id: 7, cursor_username: 'samehandle', board_enabled: true }]
    db.daily = [{ user_id: 7, day: '2026-05-01', tokens: 11 }]
    fetchCursorProfileMock.mockResolvedValue({ status: 'ok', profile: scrapedProfile('Same') })

    const response = await POST(claimRequest('samehandle'))

    expect(response.status).toBe(200)
    expect(db.ops).toEqual(['profiles.upsert', 'daily.upsert'])
    expect(db.daily.map((row) => row.day).sort()).toEqual(['2026-05-01', '2026-08-29'])
  })

  it('voids the ownership proof when the handle changes — old proof, old profile', async () => {
    // verified_at and verify_code belong to different sub-states
    // (proven vs mid-challenge); the switch must clear whichever is
    // present, so seed both.
    db.profiles = [
      {
        user_id: 7,
        cursor_username: 'oldhandle',
        board_enabled: true,
        verified_at: '2026-08-01T00:00:00.000Z',
        verify_code: 'CRIB-7XK2'
      }
    ]

    const response = await POST(claimRequest('newhandle'))

    expect(response.status).toBe(200)
    expect(db.profiles[0]).toMatchObject({
      cursor_username: 'newhandle',
      verified_at: null,
      verify_code: null
    })
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      linked: true,
      profile: { verification: { verifiedAt: null, verifyCode: null } }
    })
  })

  it('keeps the ownership proof on a re-claim of the same handle', async () => {
    db.profiles = [
      {
        user_id: 7,
        cursor_username: 'samehandle',
        board_enabled: true,
        verified_at: '2026-08-01T00:00:00.000Z',
        verify_code: null
      }
    ]

    const response = await POST(claimRequest('samehandle'))

    expect(response.status).toBe(200)
    expect(db.profiles[0].verified_at).toBe('2026-08-01T00:00:00.000Z')
    await expect(response.json()).resolves.toMatchObject({
      profile: {
        verification: { verifiedAt: '2026-08-01T00:00:00.000Z', verifyCode: null }
      }
    })
  })

  it('holds claims to the per-account distributed budget before anything fetches or writes', async () => {
    distributedLimitMock.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 15 * 60 * 1000,
      retryAfter: 900
    })

    const response = await POST(claimRequest('anyhandle'))

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Too many attempts. Please try again later.'
    })
    expect(response.headers.get('Retry-After')).toBe('900')
    // Keyed on the account, cross-instance — cold-start fan-out must
    // not multiply the cursor.com scrape allowance.
    expect(distributedLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ windowMs: 15 * 60 * 1000, maxRequests: 5 }),
      'cursor-profile-claim:7'
    )
    expect(fetchCursorProfileMock).not.toHaveBeenCalled()
    expect(db.ops).toEqual([])
  })
})
