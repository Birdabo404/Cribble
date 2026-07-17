import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getStaffUserMock } = vi.hoisted(() => ({ getStaffUserMock: vi.fn() }))

vi.mock('@/lib/staffAuth', () => ({
  getStaffUser: getStaffUserMock
}))

import { getDebugStaffUser, hasValidDebugToken } from './debugRouteAuth'

const request = () => new NextRequest('http://localhost:3000/api/debug/scores')

describe('debug route authorization', () => {
  beforeEach(() => {
    getStaffUserMock.mockReset()
    getStaffUserMock.mockResolvedValue({
      ok: true,
      staff: { userId: 1, username: 'owner', role: 'owner' }
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 404 in production even if the opt-in flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_DANGEROUS_DEBUG_ROUTES', 'true')

    await expect(getDebugStaffUser(request())).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Not found'
    })
    expect(getStaffUserMock).not.toHaveBeenCalled()
  })

  it('returns 404 in development unless explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_DANGEROUS_DEBUG_ROUTES', 'false')

    const result = await getDebugStaffUser(request())

    expect(result).toEqual({ ok: false, status: 404, error: 'Not found' })
    expect(getStaffUserMock).not.toHaveBeenCalled()
  })

  it('requires the owner-level debug permission after local opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_DANGEROUS_DEBUG_ROUTES', 'true')

    const result = await getDebugStaffUser(request())

    expect(result.ok).toBe(true)
    expect(getStaffUserMock).toHaveBeenCalledWith(expect.any(NextRequest), 'debug.manage')
  })
})

describe('debug confirmation tokens', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('has no static fallback and rejects short configured tokens', () => {
    vi.stubEnv('DEBUG_RESET_TOKEN', '')
    expect(hasValidDebugToken('RESET_ALL_DATA', 'DEBUG_RESET_TOKEN')).toBe(false)

    vi.stubEnv('DEBUG_RESET_TOKEN', 'too-short')
    expect(hasValidDebugToken('too-short', 'DEBUG_RESET_TOKEN')).toBe(false)
  })

  it('accepts only an exact 32+ character token', () => {
    const token = 'a'.repeat(64)
    vi.stubEnv('DEBUG_CLEANUP_TOKEN', token)

    expect(hasValidDebugToken(token, 'DEBUG_CLEANUP_TOKEN')).toBe(true)
    expect(hasValidDebugToken(`${token.slice(0, -1)}b`, 'DEBUG_CLEANUP_TOKEN')).toBe(false)
    expect(hasValidDebugToken(null, 'DEBUG_CLEANUP_TOKEN')).toBe(false)
  })
})
