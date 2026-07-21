import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock plumbing ─────────────────────────────────────────────────────────
// The route builds its Supabase client at module load, so the fake client
// must exist before the import. Both handlers issue exactly one query: a
// user_devices select terminated by .single(), so the stub only models
// that shape. `queryError` injects a real DB failure; `device: null`
// resolves as PostgREST's PGRST116 "no rows" single() error.

interface DeviceRow {
  id: number
  user_id: number
  device_uuid: string
  device_name: string
  is_active: boolean
  last_sync_at: string | null
  created_at: string
}

interface MockState {
  device: DeviceRow | null
  queryError: { code?: string; message: string } | null
}

const { state, supabaseMock } = vi.hoisted(() => {
  const state: MockState = {
    device: null,
    queryError: null
  }

  function from() {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      single: async () => {
        if (state.queryError) return { data: null, error: state.queryError }
        if (!state.device) {
          return {
            data: null,
            error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
          }
        }
        return { data: state.device, error: null }
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return builder
  }

  return { state, supabaseMock: { from } }
})

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => supabaseMock
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { deviceVerify: { windowMs: 60_000, maxRequests: 100 } },
  checkRateLimit: () => ({
    success: true,
    limit: 100,
    remaining: 99,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers()
}))

import { GET, POST } from './route'

const DEVICE_UUID = '5b0d4a52-7f6e-4c2a-9a1c-3f9e8d7c6b5a'

function makeGetRequest(deviceUuid?: string) {
  const url = new URL('https://cribble.dev/api/device/verify')
  if (deviceUuid) url.searchParams.set('deviceUuid', deviceUuid)
  return new NextRequest(url)
}

function makePostRequest(deviceUuid: string) {
  return new NextRequest('https://cribble.dev/api/device/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceUuid })
  })
}

function activeDevice(): DeviceRow {
  return {
    id: 1,
    user_id: 42,
    device_uuid: DEVICE_UUID,
    device_name: 'Chrome 126.0 on Mac',
    is_active: true,
    last_sync_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  }
}

beforeEach(() => {
  state.device = null
  state.queryError = null
})

describe('GET /api/device/verify — DB error vs not-registered discrimination', () => {
  it('returns 500 (NOT 200 verified:false) when the device query fails', async () => {
    // A transient DB failure must not read as "not registered": the
    // extension treats 200 verified:false as authoritative and responds by
    // self-unlinking and dropping its sync token.
    state.queryError = { code: '57014', message: 'canceling statement due to statement timeout' }

    const response = await GET(makeGetRequest(DEVICE_UUID))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.verified).toBe(false)
    expect(body.isActive).toBe(false)
    expect(body.error).toBe('Database query failed')
  })

  it('returns 200 verified:false for a genuinely unregistered device (PGRST116)', async () => {
    state.device = null

    const response = await GET(makeGetRequest(DEVICE_UUID))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.verified).toBe(false)
    expect(body.isActive).toBe(false)
  })

  it('returns 200 verified:true for a registered active device', async () => {
    state.device = activeDevice()

    const response = await GET(makeGetRequest(DEVICE_UUID))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.verified).toBe(true)
    expect(body.isActive).toBe(true)
  })

  it('returns 400 when deviceUuid is missing', async () => {
    const response = await GET(makeGetRequest())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
  })
})

describe('POST /api/device/verify — same discrimination as GET', () => {
  it('returns 500 when the device query fails', async () => {
    state.queryError = { code: '57014', message: 'canceling statement due to statement timeout' }

    const response = await POST(makePostRequest(DEVICE_UUID))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Database query failed')
  })

  it('returns 200 verified:false for an unregistered device (PGRST116)', async () => {
    state.device = null

    const response = await POST(makePostRequest(DEVICE_UUID))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.verified).toBe(false)
  })
})
