import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({ from: fromMock })
}))

import { GET, POST } from './route'

function postRequest(body: string, ip = '203.0.113.1') {
  return new NextRequest('https://cribble.dev/api/waitlist', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': ip
    }
  })
}

function unavailableStorage() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://placeholder.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'placeholder-service-role-key')
}

function configuredStorage() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
}

function mockConfiguredInsert(result: { data: unknown; error: unknown }) {
  const insertSelect = vi.fn().mockResolvedValue(result)
  const insert = vi.fn(() => ({ select: insertSelect }))
  const ipLookup = {
    eq: vi.fn(() => ({
      gte: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }))
    }))
  }
  fromMock.mockReturnValue({
    select: vi.fn(() => ipLookup),
    insert
  })
  return { insert }
}

describe('public waitlist route', () => {
  let logSpy: MockInstance
  let errorSpy: MockInstance

  beforeEach(() => {
    fromMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  it('rejects malformed JSON as a bad request', async () => {
    unavailableStorage()

    const response = await POST(postRequest('{'))

    expect(response.status).toBe(400)
  })

  it('validates email before checking unavailable storage', async () => {
    unavailableStorage()
    const email = 'not-an-email'

    const response = await POST(postRequest(JSON.stringify({ email })))

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).not.toContain(email)
    expect(JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls])).not.toContain(email)
  })

  it('fails closed without logging or returning a submitted email when storage is unavailable', async () => {
    unavailableStorage()
    const email = 'private@example.com'

    const response = await POST(postRequest(JSON.stringify({ email })))

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ error: 'Service unavailable' })
    expect(JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls])).not.toContain(email)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('does not fabricate a GET count when storage is unavailable', async () => {
    unavailableStorage()

    const response = await GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ error: 'Service unavailable' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('preserves configured-storage signup success', async () => {
    configuredStorage()
    const { insert } = mockConfiguredInsert({
      data: [{ email: 'member@example.com' }],
      error: null
    })

    const response = await POST(postRequest(
      JSON.stringify({ email: 'member@example.com' }),
      '203.0.113.2'
    ))

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toEqual({
      message: 'Successfully added to waitlist',
      data: [{ email: 'member@example.com' }]
    })
  })

  it('preserves duplicate-email handling', async () => {
    configuredStorage()
    mockConfiguredInsert({ data: null, error: { code: '23505' } })

    const response = await POST(postRequest(
      JSON.stringify({ email: 'duplicate@example.com' }),
      '203.0.113.3'
    ))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Email already registered' })
  })

  it('preserves disposable-email rejection before database access', async () => {
    configuredStorage()

    const response = await POST(postRequest(
      JSON.stringify({ email: 'throwaway@mailinator.com' }),
      '203.0.113.4'
    ))

    expect(response.status).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('preserves the per-IP rate limit', async () => {
    configuredStorage()
    mockConfiguredInsert({ data: [{ email: 'member@example.com' }], error: null })
    const ip = '203.0.113.5'

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await POST(postRequest(
        JSON.stringify({ email: `member${attempt}@example.com` }),
        ip
      ))
      expect(response.status).toBe(201)
    }
    const limited = await POST(postRequest(JSON.stringify({ email: 'fourth@example.com' }), ip))

    expect(limited.status).toBe(429)
  })
})
