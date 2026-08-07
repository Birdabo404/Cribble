import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// getSessionUserId's status codes are load-bearing: clients treat 401 as
// "logged out" and bounce to /login, so a transient DB failure must NOT
// surface as 401 or a Supabase blip logs everyone out mid-session.
//
// The lookup is a single joined query (user_sessions with the owner's
// users.status embedded via FK), so session validity and account status
// arrive together: rows carry `users: { status } | null`.

const { sessionMaybeSingle, deleteEq } = vi.hoisted(() => ({
  sessionMaybeSingle: vi.fn(),
  deleteEq: vi.fn()
}))

vi.mock('./supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'user_sessions') {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({ maybeSingle: sessionMaybeSingle })
            })
          }),
          delete: () => ({ eq: deleteEq })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { getSessionUserId } from './sessionAuth'

function requestWithCookie(token?: string): NextRequest {
  return new NextRequest('https://cribble.dev/api/user/me', {
    headers: token ? { cookie: `cribble_session=${token}` } : {}
  })
}

describe('getSessionUserId', () => {
  beforeEach(() => {
    sessionMaybeSingle.mockReset()
    deleteEq.mockReset()
    deleteEq.mockResolvedValue({ error: null })
  })

  it('returns 401 when no session cookie is present', async () => {
    const result = await getSessionUserId(requestWithCookie())
    expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
  })

  it('returns 401 when the session row is missing or expired', async () => {
    sessionMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await getSessionUserId(requestWithCookie('expired-token'))
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: 'Invalid or expired session'
    })
  })

  it('returns 503 (not 401) when the session lookup itself fails', async () => {
    sessionMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection refused' }
    })
    const result = await getSessionUserId(requestWithCookie('valid-token'))
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'Session lookup failed'
    })
  })

  it('resolves the numeric user id for a valid session', async () => {
    sessionMaybeSingle.mockResolvedValue({
      data: { user_id: '9', users: { status: 'active' } },
      error: null
    })
    const result = await getSessionUserId(requestWithCookie('valid-token'))
    expect(result).toEqual({ ok: true, userId: 9 })
  })

  it('allows suspended users because suspension is a soft visibility penalty', async () => {
    sessionMaybeSingle.mockResolvedValue({
      data: { user_id: '9', users: { status: 'suspended' } },
      error: null
    })

    const result = await getSessionUserId(requestWithCookie('valid-token'))

    expect(result).toEqual({ ok: true, userId: 9 })
    expect(deleteEq).not.toHaveBeenCalled()
  })

  it('treats a NULL account status as active (rows predating migration 003)', async () => {
    sessionMaybeSingle.mockResolvedValue({
      data: { user_id: '9', users: { status: null } },
      error: null
    })

    const result = await getSessionUserId(requestWithCookie('valid-token'))

    expect(result).toEqual({ ok: true, userId: 9 })
  })

  it('returns 401 and invalidates a surviving session for a banned user', async () => {
    sessionMaybeSingle.mockResolvedValue({
      data: { user_id: '9', users: { status: 'banned' } },
      error: null
    })

    const result = await getSessionUserId(requestWithCookie('valid-token'))

    expect(result).toEqual({ ok: false, status: 401, error: 'Account banned' })
    expect(deleteEq).toHaveBeenCalledWith('session_token', 'valid-token')
  })

  it('returns 401 when a session points at a missing user', async () => {
    // LEFT embed: the session row survives with users: null when the
    // owner row is gone — must not read as "expired token".
    sessionMaybeSingle.mockResolvedValue({
      data: { user_id: '9', users: null },
      error: null
    })

    const result = await getSessionUserId(requestWithCookie('valid-token'))

    expect(result).toEqual({ ok: false, status: 401, error: 'Session owner not found' })
  })
})
