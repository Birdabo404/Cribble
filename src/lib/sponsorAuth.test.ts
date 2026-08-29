import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// The sponsor identity ladder every buyer route stands on: the
// signed-in user wins outright (the guest cookie is never even read),
// a session-lookup outage propagates as its retryable status instead
// of silently downgrading a signed-in buyer, and only a definitive 401
// falls through to the claim cookie — where a failed guest lookup is
// likewise a 503, never quiet anonymity, while a cookie matching no
// row is exactly that.

const { getSessionUserIdMock, guestLookupMock } = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  guestLookupMock: vi.fn()
}))

vi.mock('./sessionAuth', () => ({ getSessionUserId: getSessionUserIdMock }))

vi.mock('./supabaseServer', () => ({
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

import {
  SPONSOR_CLAIM_COOKIE,
  createSponsorGuest,
  getSponsorIdentity,
  setSponsorClaimCookie
} from './sponsorAuth'

const TOKEN = 'ab'.repeat(32)

function request(cookieToken?: string) {
  return new NextRequest('https://cribble.dev/api/billboard/submit', {
    headers: {
      host: 'cribble.dev',
      ...(cookieToken ? { cookie: `${SPONSOR_CLAIM_COOKIE}=${cookieToken}` } : {})
    }
  })
}

describe('getSponsorIdentity', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    guestLookupMock.mockReset()
    guestLookupMock.mockReturnValue({ data: null, error: null })
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('resolves the signed-in user without ever reading the guest cookie — the session outranks it', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 9 })

    await expect(getSponsorIdentity(request(TOKEN))).resolves.toEqual({
      ok: true,
      identity: { kind: 'user', userId: 9 }
    })
    expect(guestLookupMock).not.toHaveBeenCalled()
  })

  it('propagates a session-lookup 503 instead of downgrading the buyer to the cookie', async () => {
    getSessionUserIdMock.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'Session lookup failed'
    })

    await expect(getSponsorIdentity(request(TOKEN))).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'Session lookup failed'
    })
    expect(guestLookupMock).not.toHaveBeenCalled()
  })

  it('resolves nobody when there is neither session nor cookie', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    await expect(getSponsorIdentity(request())).resolves.toEqual({
      ok: true,
      identity: { kind: 'none' }
    })
    expect(guestLookupMock).not.toHaveBeenCalled()
  })

  it('resolves the cookie guest after a definitive 401, coercing the row id to a number', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    guestLookupMock.mockReturnValue({ data: { id: '21' }, error: null })

    await expect(getSponsorIdentity(request(TOKEN))).resolves.toEqual({
      ok: true,
      identity: { kind: 'guest', guestId: 21 }
    })
    expect(guestLookupMock).toHaveBeenCalledWith(TOKEN)
  })

  it('treats a cookie matching no row exactly like no cookie at all', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    guestLookupMock.mockReturnValue({ data: null, error: null })

    await expect(getSponsorIdentity(request(TOKEN))).resolves.toEqual({
      ok: true,
      identity: { kind: 'none' }
    })
  })

  it('503s a failed guest lookup — an outage is not proof the cookie is stale', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    guestLookupMock.mockReturnValue({ data: null, error: { message: 'connection refused' } })

    await expect(getSponsorIdentity(request(TOKEN))).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'Guest lookup failed'
    })
  })
})

describe('createSponsorGuest', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  /** A billboard_guests table honoring insert -> select -> single. */
  function insertClient(result: { data: unknown; error: unknown }, calls: unknown[]) {
    return {
      from: (table: string) => {
        if (table !== 'billboard_guests') throw new Error(`Unexpected table: ${table}`)
        return {
          insert: (values: unknown) => {
            calls.push(values)
            return { select: () => ({ single: async () => result }) }
          }
        }
      }
    } as unknown as SupabaseClient
  }

  it('mints a fresh 64-hex bearer token per guest and stores it with the email', async () => {
    const calls: unknown[] = []
    const supabase = insertClient({ data: { id: 21 }, error: null }, calls)

    const first = await createSponsorGuest(supabase, 'guest@acme.dev')
    const second = await createSponsorGuest(supabase, 'guest@acme.dev')

    expect(first).toEqual({ ok: true, guestId: 21, token: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(calls[0]).toEqual({ token: (first as { token: string }).token, email: 'guest@acme.dev' })
    // Bearer secrets never repeat across mints.
    expect((second as { token: string }).token).not.toBe((first as { token: string }).token)
  })

  it('reports failure without leaking the token when the insert fails', async () => {
    const supabase = insertClient({ data: null, error: { message: 'insert failed' } }, [])

    await expect(createSponsorGuest(supabase, 'guest@acme.dev')).resolves.toEqual({
      ok: false,
      error: 'Failed to create guest identity'
    })
  })
})

describe('setSponsorClaimCookie', () => {
  it('sets the httpOnly lax cookie with the 180-day horizon', () => {
    const response = NextResponse.json({ ok: true })

    setSponsorClaimCookie(response, TOKEN)

    const cookie = response.cookies.get(SPONSOR_CLAIM_COOKIE)
    expect(cookie?.value).toBe(TOKEN)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.maxAge).toBe(180 * 24 * 60 * 60)
  })
})
