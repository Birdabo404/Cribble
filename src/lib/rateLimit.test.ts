import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({ rpc: rpcMock })
}))

import { checkDistributedRateLimit } from './rateLimit'

const request = () => new NextRequest('https://cribble.dev/api/admin/users/9/status')
const config = { windowMs: 60_000, maxRequests: 10 }

describe('checkDistributedRateLimit', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('uses the atomic Postgres counter and maps its result', async () => {
    rpcMock.mockResolvedValue({
      data: [{ success: true, remaining: 7, reset_at: '2026-07-14T13:00:00.000Z' }],
      error: null
    })

    const result = await checkDistributedRateLimit(request(), config, 'staff:4:POST:/status')

    expect(result).toEqual({
      success: true,
      limit: 10,
      remaining: 7,
      resetTime: new Date('2026-07-14T13:00:00.000Z').getTime()
    })
    expect(rpcMock).toHaveBeenCalledWith('consume_staff_rate_limit', {
      p_key: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
      p_window_seconds: 60,
      p_limit: 10
    })
  })

  it('returns retry timing when the shared limit is exhausted', async () => {
    const resetAt = new Date(Date.now() + 25_000).toISOString()
    rpcMock.mockResolvedValue({
      data: [{ success: false, remaining: 0, reset_at: resetAt }],
      error: null
    })

    const result = await checkDistributedRateLimit(request(), config, 'staff:4:POST:/status')

    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBeGreaterThanOrEqual(24)
    expect(result.retryAfter).toBeLessThanOrEqual(25)
  })

  it('falls back to the process-local limiter when the RPC is unavailable', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function unavailable' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await checkDistributedRateLimit(
      request(),
      config,
      `staff:fallback:${Math.random()}`
    )

    expect(result.success).toBe(true)
    expect(result.limit).toBe(10)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
