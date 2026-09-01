import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { CursorProfileData } from '@/lib/cursorProfile'
import { CURSOR_VERIFY_CODE_PATTERN } from '@/lib/cursorVerify'

// The ownership-challenge route. Under test: generate mints (and
// regenerating overwrites) a well-formed CRIB code; check flips
// verified_at and clears the code ONLY when the scraped display name
// carries it, and every other outcome surfaces its own machine-readable
// reason. generateCursorVerifyCode and displayNameHasVerifyCode run
// REAL — only the session, the distributed budget and the network
// scrape are faked.

const { getSessionUserIdMock, distributedLimitMock, fetchCursorProfileMock, db } = vi.hoisted(
  () => ({
    getSessionUserIdMock: vi.fn(),
    distributedLimitMock: vi.fn(),
    fetchCursorProfileMock: vi.fn(),
    db: {
      profiles: [] as Array<Record<string, unknown>>
    }
  })
)

vi.mock('@/lib/sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  checkDistributedRateLimit: distributedLimitMock
}))

vi.mock('@/lib/cursorProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cursorProfile')>()),
  fetchCursorProfile: fetchCursorProfileMock
}))

// A one-table stateful fake honoring exactly the chains this route
// issues: the link read (select -> eq -> maybeSingle) and the
// verification writes (update -> eq).
vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'cursor_profiles') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (column: string, value: unknown) => ({
            maybeSingle: async () => {
              const row = db.profiles.find((profile) => profile[column] === value)
              return { data: row ? { ...row } : null, error: null }
            }
          })
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (column: string, value: unknown) => {
            const row = db.profiles.find((profile) => profile[column] === value)
            if (row) Object.assign(row, patch)
            return { error: null }
          }
        })
      }
    }
  })
}))

import { POST } from './route'

function verifyRequest(action: string) {
  return new NextRequest('https://cribble.dev/api/user/cursor-profile/verify', {
    method: 'POST',
    headers: { host: 'cribble.dev', 'content-type': 'application/json' },
    body: JSON.stringify({ action })
  })
}

/** A minimal successful scrape whose display name the tests control. */
function scrapedProfile(displayName: string | null): CursorProfileData {
  return {
    displayName,
    avatarUrl: null,
    joinedDate: null,
    stats: {
      currentStreak: 1,
      longestStreak: 1,
      agentsLocal: 0,
      agentsCloud: 0,
      longestAgentSeconds: 0
    },
    topModels: [],
    tokensOverTime: [],
    agentsOverTime: []
  }
}

describe('POST /api/user/cursor-profile/verify', () => {
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
    db.profiles = [
      {
        user_id: 7,
        cursor_username: 'birdabo',
        verified_at: null,
        verify_code: null
      }
    ]
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('generate mints a well-formed code, stores it, and returns it', async () => {
    const response = await POST(verifyRequest('generate'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      verification: { verifiedAt: string | null; verifyCode: string }
    }
    expect(body.success).toBe(true)
    expect(body.verification.verifiedAt).toBeNull()
    expect(body.verification.verifyCode).toMatch(CURSOR_VERIFY_CODE_PATTERN)
    expect(db.profiles[0].verify_code).toBe(body.verification.verifyCode)
  })

  it('regenerating overwrites the outstanding code', async () => {
    db.profiles[0].verify_code = 'CRIB-AAAA'

    const response = await POST(verifyRequest('generate'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      verification: { verifyCode: string }
    }
    expect(body.verification.verifyCode).toMatch(CURSOR_VERIFY_CODE_PATTERN)
    expect(db.profiles[0].verify_code).toBe(body.verification.verifyCode)
  })

  it('check verifies when the display name carries the code, and clears it', async () => {
    db.profiles[0].verify_code = 'CRIB-7XK2'
    fetchCursorProfileMock.mockResolvedValue({
      status: 'ok',
      profile: scrapedProfile('birdabo · CRIB-7XK2')
    })

    const response = await POST(verifyRequest('check'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      verification: { verifiedAt: string | null; verifyCode: string | null }
    }
    expect(body.success).toBe(true)
    expect(body.verification.verifyCode).toBeNull()
    expect(body.verification.verifiedAt).toBeTruthy()
    expect(db.profiles[0]).toMatchObject({
      verified_at: body.verification.verifiedAt,
      verify_code: null
    })
    expect(fetchCursorProfileMock).toHaveBeenCalledWith('birdabo')
  })

  it('check reports code_not_found when the display name lacks the code, keeping it outstanding', async () => {
    db.profiles[0].verify_code = 'CRIB-7XK2'
    fetchCursorProfileMock.mockResolvedValue({
      status: 'ok',
      profile: scrapedProfile('just birdabo')
    })

    const response = await POST(verifyRequest('check'))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      reason: 'code_not_found'
    })
    // The challenge survives the miss — the user fixes the display name
    // and checks again with the SAME code.
    expect(db.profiles[0]).toMatchObject({ verified_at: null, verify_code: 'CRIB-7XK2' })
  })

  it('check surfaces each non-ok scrape status as its own reason', async () => {
    const cases = [
      { result: { status: 'not_found' }, status: 404, reason: 'not_found' },
      { result: { status: 'private' }, status: 400, reason: 'private' },
      { result: { status: 'fetch_error', message: 'boom' }, status: 502, reason: 'fetch_error' },
      { result: { status: 'parse_error', message: 'odd' }, status: 502, reason: 'parse_error' }
    ] as const

    for (const testCase of cases) {
      db.profiles[0].verify_code = 'CRIB-7XK2'
      db.profiles[0].verified_at = null
      fetchCursorProfileMock.mockResolvedValue(testCase.result)

      const response = await POST(verifyRequest('check'))

      expect(response.status).toBe(testCase.status)
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        reason: testCase.reason
      })
      expect(db.profiles[0].verified_at).toBeNull()
    }
  })

  it('check without an outstanding code is no_code and never fetches', async () => {
    const response = await POST(verifyRequest('check'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      reason: 'no_code'
    })
    expect(fetchCursorProfileMock).not.toHaveBeenCalled()
  })

  it('answers not_linked when no profile is claimed', async () => {
    db.profiles = []

    const response = await POST(verifyRequest('generate'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      reason: 'not_linked'
    })
  })

  it('holds checks to the per-account distributed budget before the scrape', async () => {
    db.profiles[0].verify_code = 'CRIB-7XK2'
    distributedLimitMock.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 15 * 60 * 1000,
      retryAfter: 900
    })

    const response = await POST(verifyRequest('check'))

    expect(response.status).toBe(429)
    expect(distributedLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ windowMs: 15 * 60 * 1000, maxRequests: 5 }),
      'cursor-profile-verify:7'
    )
    expect(fetchCursorProfileMock).not.toHaveBeenCalled()
  })
})
