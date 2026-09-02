import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The TEAM guard on the owner's Pro actions: grant_pro must not
// overwrite a paying team's tier (leaving team_review_status behind),
// and revoke_pro must not FREE a TEAM row — the team tier is only ever
// reverted by the review queue's reject or the Polar webhook. Both
// refuse TEAM targets with a 400 before any audit row or mutation, and
// the normal FREE→PRO / PRO→FREE paths stay intact. Staff auth, rate
// limiting, the audit wrapper and the grant helper are mocked; the
// guard ordering is what's under test.

const { staffMock, grantMock, auditMock, state } = vi.hoisted(() => ({
  staffMock: vi.fn(),
  grantMock: vi.fn(),
  auditMock: vi.fn(),
  state: {
    target: null as Record<string, unknown> | null,
    tierWrites: [] as Record<string, unknown>[]
  }
}))

vi.mock('@/lib/staffAuth', () => ({
  getStaffUser: staffMock,
  assertCanTarget: () => ({ ok: true }),
  resolveStaffRole: () => null,
  cleanReason: (value: unknown) =>
    typeof value === 'string' && value.trim().length >= 10 ? value.trim() : null
}))

vi.mock('@/lib/adminAudit', () => ({ withAudit: auditMock }))

vi.mock('@/lib/entitlementGrant', () => ({ grantProEntitlement: grantMock }))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({
    success: true,
    limit: 30,
    remaining: 29,
    resetTime: Date.now() + 60_000
  }),
  createRateLimitResponse: () => new Headers(),
  rateLimitConfigs: { admin: { windowMs: 60_000, maxRequests: 30 } }
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          // Target lookup terminal.
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.target, error: null })
            })
          }),
          // revoke_pro's tier write.
          update: (values: Record<string, unknown>) => {
            state.tierWrites.push(values)
            return { eq: () => Promise.resolve({ error: null }) }
          }
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  })
}))

import { POST } from './route'

const TEAM_TARGET = {
  id: 42,
  twitter_username: 'acme',
  staff_role: null,
  is_admin: false,
  subscription_tier: 'TEAM'
}

function entitlementRequest(action: string) {
  return new NextRequest('https://cribble.dev/api/admin/users/42/entitlements', {
    method: 'POST',
    body: JSON.stringify({ action, reason: 'manual correction per support thread' }),
    headers: { 'Content-Type': 'application/json' }
  })
}

const params = { params: Promise.resolve({ id: '42' }) }

describe('POST /api/admin/users/[id]/entitlements — TEAM targets are off-limits to Pro actions', () => {
  beforeEach(() => {
    staffMock.mockReset()
    staffMock.mockResolvedValue({
      ok: true,
      staff: { userId: 1, username: 'operator', role: 'owner' }
    })
    grantMock.mockReset()
    grantMock.mockResolvedValue(undefined)
    auditMock.mockReset()
    auditMock.mockImplementation(
      (_client: unknown, _entry: unknown, mutate: () => Promise<unknown>) => mutate()
    )
    state.target = { ...TEAM_TARGET }
    state.tierWrites = []
  })

  it('400s grant_pro on a TEAM target — fulfillment never runs', async () => {
    const response = await POST(entitlementRequest('grant_pro'), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'This account is on the Team plan — manage it from the team review queue'
    })
    expect(grantMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('400s revoke_pro on a TEAM target — the tier write never happens', async () => {
    const response = await POST(entitlementRequest('revoke_pro'), params)

    expect(response.status).toBe(400)
    expect(state.tierWrites).toHaveLength(0)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('still grants Pro to a FREE target', async () => {
    state.target = { ...TEAM_TARGET, subscription_tier: 'FREE' }

    const response = await POST(entitlementRequest('grant_pro'), params)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(grantMock).toHaveBeenCalledWith(expect.anything(), 42)
  })

  it('still revokes Pro from a PRO target', async () => {
    state.target = { ...TEAM_TARGET, subscription_tier: 'PRO' }

    const response = await POST(entitlementRequest('revoke_pro'), params)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(state.tierWrites).toEqual([{ subscription_tier: 'FREE' }])
  })

  it('400s revoke_pro on the house complimentary Pro handle', async () => {
    state.target = { ...TEAM_TARGET, twitter_username: 'birdabo', subscription_tier: 'PRO' }

    const response = await POST(entitlementRequest('revoke_pro'), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'House complimentary Pro cannot be revoked'
    })
    expect(state.tierWrites).toHaveLength(0)
    expect(auditMock).not.toHaveBeenCalled()
  })
})
