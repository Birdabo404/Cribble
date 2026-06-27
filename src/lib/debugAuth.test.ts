import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockSingle = vi.fn()
const mockGt = vi.fn(() => ({ single: mockSingle }))
const mockEq = vi.fn(() => ({ gt: mockGt }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom
  }))
}))

describe('requireDevSession', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFrom.mockClear()
    mockSelect.mockClear()
    mockEq.mockClear()
    mockGt.mockClear()
    mockSingle.mockClear()
  })

  it('returns 404 outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { requireDevSession } = await import('./debugAuth')
    const request = new NextRequest('http://localhost/api/debug/scores')

    const result = await requireDevSession(request)

    expect(result).toEqual({ ok: false, status: 404, error: 'Not found' })
    vi.unstubAllEnvs()
  })

  it('returns 401 when session cookie is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { requireDevSession } = await import('./debugAuth')
    const request = new NextRequest('http://localhost/api/debug/scores')

    const result = await requireDevSession(request)

    expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
    vi.unstubAllEnvs()
  })

  it('returns userId when session is valid', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    mockSingle.mockResolvedValue({ data: { user_id: 42 }, error: null })

    const { requireDevSession } = await import('./debugAuth')
    const request = new NextRequest('http://localhost/api/debug/scores', {
      headers: { cookie: 'cribble_session=test-token' }
    })

    const result = await requireDevSession(request)

    expect(result).toEqual({ ok: true, userId: 42 })
    expect(mockFrom).toHaveBeenCalledWith('user_sessions')
    vi.unstubAllEnvs()
  })
})
