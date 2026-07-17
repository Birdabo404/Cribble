import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getStaffUserMock, rpcMock } = vi.hoisted(() => ({
  getStaffUserMock: vi.fn(),
  rpcMock: vi.fn()
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { admin: { windowMs: 60_000, maxRequests: 10 } },
  checkRateLimit: () => ({
    success: true,
    limit: 10,
    remaining: 9,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers()
}))

vi.mock('@/lib/staffAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staffAuth')>()
  return { ...actual, getStaffUser: getStaffUserMock }
})

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({ rpc: rpcMock })
}))

vi.mock('@/lib/inviteCodes', () => ({
  generateInviteCode: () => 'CRIB-TEST-CODE'
}))

import { POST } from './route'
import { DELETE } from './[id]/route'

const owner = {
  ok: true as const,
  staff: { userId: 7, username: 'owner', role: 'owner' as const }
}

describe('atomic admin invite routes', () => {
  beforeEach(() => {
    getStaffUserMock.mockReset()
    getStaffUserMock.mockResolvedValue(owner)
    rpcMock.mockReset()
  })

  it('creates the invite through the atomic create+audit RPC', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: 12,
          code: 'CRIB-TEST-CODE',
          note: 'Invite for test pilot',
          max_uses: 2,
          use_count: 0,
          expires_at: null,
          revoked_at: null,
          created_at: '2026-07-14T00:00:00.000Z'
        }
      ],
      error: null
    })
    const request = new NextRequest('https://cribble.dev/api/admin/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maxUses: 2,
        note: 'Invite for test pilot'
      })
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(rpcMock).toHaveBeenCalledWith('create_staff_invite', {
      p_admin_user_id: 7,
      p_code: 'CRIB-TEST-CODE',
      p_note: 'Invite for test pilot',
      p_max_uses: 2,
      p_expires_at: null
    })
  })

  it('rejects invite creation without an auditable reason', async () => {
    const request = new NextRequest('https://cribble.dev/api/admin/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'short' })
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('revokes the invite through the atomic revoke+audit RPC', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 12, code: 'CRIB-TEST-CODE', revoked_at: '2026-07-14T00:00:00.000Z' }],
      error: null
    })
    const request = new NextRequest('https://cribble.dev/api/admin/invites/12', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Recipient no longer needs access' })
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '12' }) })

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('revoke_staff_invite', {
      p_admin_user_id: 7,
      p_invite_id: 12,
      p_reason: 'Recipient no longer needs access'
    })
  })

  it('rejects invite revocation without an auditable reason', async () => {
    const request = new NextRequest('https://cribble.dev/api/admin/invites/12', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '12' }) })

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
