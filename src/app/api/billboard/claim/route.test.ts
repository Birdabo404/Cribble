import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { SPONSOR_CLAIM_COOKIE } from '@/lib/sponsorAuth'

// The guest magic link's contract: only a real billboard_guests bearer
// token may set the claim cookie, and a prober can never learn whether
// a token exists — malformed, missing and unknown tokens all land on
// the same bare /sponsorship redirect (malformed ones without even a
// database roundtrip). A failed lookup is the one exception: it 503s
// so the emailed link stays retryable instead of silently landing the
// guest on the tracker unclaimed.

const { guestLookupMock } = vi.hoisted(() => ({
  guestLookupMock: vi.fn()
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'billboard_guests') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (_column: string, token: unknown) => ({
            maybeSingle: () => Promise.resolve(guestLookupMock(token))
          })
        })
      }
    }
  })
}))

import { GET } from './route'

/** A well-formed bearer token: exactly 32 random bytes as hex. */
const TOKEN = 'ab'.repeat(32)

/** GET with the explicit host header pinning resolveAppUrl (the
 *  dev/test branch follows Host), so the redirect target holds. */
function claimRequest(token?: string) {
  const url =
    token === undefined
      ? 'https://cribble.dev/api/billboard/claim'
      : `https://cribble.dev/api/billboard/claim?token=${token}`
  return new NextRequest(url, { headers: { host: 'cribble.dev' } })
}

const TRACKER_URL = 'http://cribble.dev/sponsorship'

describe('GET /api/billboard/claim', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    guestLookupMock.mockReset()
    guestLookupMock.mockReturnValue({ data: null, error: null })
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('sets the claim cookie for a valid token and redirects to the tracker', async () => {
    guestLookupMock.mockReturnValue({ data: { id: 21 }, error: null })

    const response = await GET(claimRequest(TOKEN))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(TRACKER_URL)
    // The token was looked up verbatim, and rides back as the cookie
    // with the session cookie's protective flags.
    expect(guestLookupMock).toHaveBeenCalledWith(TOKEN)
    const cookie = response.cookies.get(SPONSOR_CLAIM_COOKIE)
    expect(cookie?.value).toBe(TOKEN)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.maxAge).toBe(180 * 24 * 60 * 60)
  })

  it('redirects without a cookie when the token is missing', async () => {
    const response = await GET(claimRequest())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(TRACKER_URL)
    expect(response.cookies.get(SPONSOR_CLAIM_COOKIE)).toBeUndefined()
    expect(guestLookupMock).not.toHaveBeenCalled()
  })

  it('skips the database entirely for tokens that cannot be minted ones', async () => {
    // Too short, non-hex, and uppercase — all off the 64-lowercase-hex
    // shape randomBytes(32).toString('hex') produces.
    for (const malformed of ['abc123', 'g'.repeat(64), 'AB'.repeat(32)]) {
      const response = await GET(claimRequest(malformed))

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(TRACKER_URL)
      expect(response.cookies.get(SPONSOR_CLAIM_COOKIE)).toBeUndefined()
    }
    expect(guestLookupMock).not.toHaveBeenCalled()
  })

  it('redirects without a cookie for a well-formed token no guest owns — never confirming anything to a prober', async () => {
    guestLookupMock.mockReturnValue({ data: null, error: null })

    const response = await GET(claimRequest(TOKEN))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(TRACKER_URL)
    expect(response.cookies.get(SPONSOR_CLAIM_COOKIE)).toBeUndefined()
  })

  it('503s a failed lookup so the emailed link stays retryable', async () => {
    guestLookupMock.mockReturnValue({ data: null, error: { message: 'connection refused' } })

    const response = await GET(claimRequest(TOKEN))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Claim lookup failed' })
    expect(response.cookies.get(SPONSOR_CLAIM_COOKIE)).toBeUndefined()
  })
})
