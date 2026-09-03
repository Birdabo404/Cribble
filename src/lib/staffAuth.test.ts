import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The permission matrix and target guardrails are the panel's entire
// anti-abuse story, so they are pinned here action by action: moderator
// floor vs owner floor, no self-targets, owners untouchable, moderators
// actionable only by the owner, and reasons below the minimum rejected.

const { getSessionUserIdMock, usersSingleMock, checkDistributedRateLimitMock } = vi.hoisted(() => ({
  getSessionUserIdMock: vi.fn(),
  usersSingleMock: vi.fn(),
  checkDistributedRateLimitMock: vi.fn()
}))

vi.mock('@/lib/sessionAuth', () => ({
  getSessionUserId: getSessionUserIdMock
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: {
    api: { windowMs: 60_000, maxRequests: 60 },
    admin: { windowMs: 60_000, maxRequests: 10 }
  },
  checkDistributedRateLimit: checkDistributedRateLimitMock
}))

vi.mock('@/lib/supabaseServer', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: usersSingleMock })
      })
    })
  })
}))

import {
  assertCanTarget,
  cleanReason,
  getStaffUser,
  isBreakglassOwner,
  minRoleFor,
  resolveStaffRole,
  roleAtLeast,
  type StaffAction,
  type StaffUser
} from './staffAuth'

const request = () => new NextRequest('https://cribble.dev/api/admin/me')
const mutationRequest = () =>
  new NextRequest('https://cribble.dev/api/admin/users/9/status', { method: 'PATCH' })

const owner: StaffUser = { userId: 1, username: 'boss', role: 'owner' }
const moderator: StaffUser = { userId: 2, username: 'mod', role: 'moderator' }

describe('minRoleFor', () => {
  it('keeps moderation actions at the moderator floor', () => {
    const moderatorActions: StaffAction[] = [
      'user.view',
      'user.set_status',
      'user.moderate_content',
      'user.edit_notes',
      'audit.view',
      'feedback.view',
      'feedback.manage',
      // Sponsorship acceptance and team approval are content review —
      // moderator work; neither path touches billing.
      'billboard.review',
      'team.review'
    ]
    for (const action of moderatorActions) {
      expect(minRoleFor(action)).toBe('moderator')
    }
  })

  it('reserves entitlements, staff and invite management for the owner', () => {
    const ownerActions: StaffAction[] = [
      'entitlement.grant_pro',
      'entitlement.revoke_pro',
      'entitlement.grant_plate',
      'entitlement.revoke_plate',
      'staff.manage',
      'invite.manage',
      // Billboard activation settles real money — owner only, even
      // though the acceptance decision is moderator work.
      'billboard.activate',
      'announcement.manage',
      'status.manage',
      'debug.manage'
    ]
    for (const action of ownerActions) {
      expect(minRoleFor(action)).toBe('owner')
    }
  })
})

describe('roleAtLeast', () => {
  it('owner clears both floors, moderator only the moderator floor', () => {
    expect(roleAtLeast('owner', 'moderator')).toBe(true)
    expect(roleAtLeast('owner', 'owner')).toBe(true)
    expect(roleAtLeast('moderator', 'moderator')).toBe(true)
    expect(roleAtLeast('moderator', 'owner')).toBe(false)
  })
})

describe('resolveStaffRole', () => {
  beforeEach(() => {
    process.env.ADMIN_USERNAMES = ''
  })

  it('reads staff_role verbatim', () => {
    expect(resolveStaffRole({ staff_role: 'owner' })).toBe('owner')
    expect(resolveStaffRole({ staff_role: 'moderator' })).toBe('moderator')
    expect(resolveStaffRole({ staff_role: null })).toBe(null)
  })

  it('treats legacy is_admin as owner (breakglass)', () => {
    expect(resolveStaffRole({ staff_role: null, is_admin: true })).toBe('owner')
  })

  it('treats the env allowlist as owner (breakglass)', () => {
    process.env.ADMIN_USERNAMES = 'boss, other'
    expect(resolveStaffRole({ staff_role: null, twitter_username: 'BOSS' })).toBe('owner')
    expect(resolveStaffRole({ staff_role: null, twitter_username: 'nobody' })).toBe(null)
  })

  it('lets an explicit moderator staff_role override breakglass owner', () => {
    process.env.ADMIN_USERNAMES = 'boss'
    // Containment: an allowlisted/is_admin account pinned to moderator
    // resolves as moderator, not owner.
    expect(resolveStaffRole({ staff_role: 'moderator', is_admin: true })).toBe('moderator')
    expect(
      resolveStaffRole({ staff_role: 'moderator', twitter_username: 'boss' })
    ).toBe('moderator')
  })
})

describe('isBreakglassOwner', () => {
  beforeEach(() => {
    process.env.ADMIN_USERNAMES = ''
  })

  it('is true for is_admin or an allowlisted handle, regardless of staff_role', () => {
    process.env.ADMIN_USERNAMES = 'boss'
    expect(isBreakglassOwner({ is_admin: true })).toBe(true)
    expect(isBreakglassOwner({ staff_role: 'moderator', twitter_username: 'boss' })).toBe(true)
  })

  it('is false for a plain moderator or regular user', () => {
    expect(isBreakglassOwner({ staff_role: 'moderator', is_admin: false })).toBe(false)
    expect(isBreakglassOwner({ staff_role: null, twitter_username: 'nobody' })).toBe(false)
  })
})

describe('assertCanTarget', () => {
  it('blocks self-targeting for every role', () => {
    expect(assertCanTarget(owner, owner.userId, null).ok).toBe(false)
    expect(assertCanTarget(moderator, moderator.userId, null).ok).toBe(false)
  })

  it('blocks owner targets for everyone', () => {
    expect(assertCanTarget(owner, 99, 'owner').ok).toBe(false)
    expect(assertCanTarget(moderator, 99, 'owner').ok).toBe(false)
  })

  it('lets only the owner act on moderators', () => {
    expect(assertCanTarget(owner, 99, 'moderator').ok).toBe(true)
    const denied = assertCanTarget(moderator, 99, 'moderator')
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.status).toBe(403)
  })

  it('lets any staff act on regular users', () => {
    expect(assertCanTarget(owner, 99, null).ok).toBe(true)
    expect(assertCanTarget(moderator, 99, null).ok).toBe(true)
  })
})

describe('cleanReason', () => {
  it('rejects non-strings and reasons below the minimum', () => {
    expect(cleanReason(undefined)).toBe(null)
    expect(cleanReason(42)).toBe(null)
    expect(cleanReason('too short')).toBe(null)
    expect(cleanReason('         padded out          ')).toBe('padded out')
  })

  it('strips control characters and caps the length', () => {
    expect(cleanReason('spam\u0000 in the bio\u0007')).toBe('spam in the bio')
    const long = 'x'.repeat(600)
    expect(cleanReason(long)).toHaveLength(500)
  })
})

describe('getStaffUser', () => {
  beforeEach(() => {
    getSessionUserIdMock.mockReset()
    usersSingleMock.mockReset()
    checkDistributedRateLimitMock.mockReset()
    checkDistributedRateLimitMock.mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 59,
      resetTime: Date.now() + 60_000
    })
    process.env.ADMIN_USERNAMES = ''
  })

  afterEach(() => {
    process.env.ADMIN_USERNAMES = ''
  })

  it('passes the session failure through untouched (401/503 intact)', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: false, status: 503, error: 'Session lookup failed' })
    const result = await getStaffUser(request())
    expect(result).toEqual({ ok: false, status: 503, error: 'Session lookup failed' })
  })

  it('403s a regular user', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 5 })
    usersSingleMock.mockResolvedValue({
      data: { id: 5, twitter_username: 'user', staff_role: null, is_admin: false, status: 'active' },
      error: null
    })
    const result = await getStaffUser(request())
    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('403s staff whose own account is not active', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 5 })
    usersSingleMock.mockResolvedValue({
      data: { id: 5, twitter_username: 'mod', staff_role: 'moderator', is_admin: false, status: 'suspended' },
      error: null
    })
    const result = await getStaffUser(request())
    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('enforces the owner floor on owner-only actions', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 5 })
    usersSingleMock.mockResolvedValue({
      data: { id: 5, twitter_username: 'mod', staff_role: 'moderator', is_admin: false, status: 'active' },
      error: null
    })
    const denied = await getStaffUser(request(), 'entitlement.grant_pro')
    expect(denied).toEqual({ ok: false, status: 403, error: 'Owner access required' })

    const allowed = await getStaffUser(request(), 'user.set_status')
    expect(allowed).toEqual({
      ok: true,
      staff: { userId: 5, username: 'mod', role: 'moderator' }
    })
  })

  it('resolves an allowlisted owner even with a stale DB row', async () => {
    process.env.ADMIN_USERNAMES = 'boss'
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 1 })
    usersSingleMock.mockResolvedValue({
      data: { id: 1, twitter_username: 'boss', staff_role: null, is_admin: false, status: 'active' },
      error: null
    })
    const result = await getStaffUser(request(), 'staff.manage')
    expect(result).toEqual({ ok: true, staff: { userId: 1, username: 'boss', role: 'owner' } })
  })

  it('enforces the distributed per-staff limit after authorization', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 5 })
    usersSingleMock.mockResolvedValue({
      data: {
        id: 5,
        twitter_username: 'mod',
        staff_role: 'moderator',
        is_admin: false,
        status: 'active'
      },
      error: null
    })
    checkDistributedRateLimitMock.mockResolvedValue({
      success: false,
      limit: 60,
      remaining: 0,
      resetTime: Date.now() + 30_000,
      retryAfter: 30
    })

    const result = await getStaffUser(request(), 'user.view')

    expect(result).toEqual({
      ok: false,
      status: 429,
      error: 'Rate limit exceeded. Try again in 30 seconds.'
    })
    expect(checkDistributedRateLimitMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { windowMs: 60_000, maxRequests: 60 },
      'staff:5:read'
    )
  })

  it('uses one strict write bucket across all staff mutation routes', async () => {
    getSessionUserIdMock.mockResolvedValue({ ok: true, userId: 5 })
    usersSingleMock.mockResolvedValue({
      data: {
        id: 5,
        twitter_username: 'mod',
        staff_role: 'moderator',
        is_admin: false,
        status: 'active'
      },
      error: null
    })

    const result = await getStaffUser(mutationRequest(), 'user.set_status')

    expect(result.ok).toBe(true)
    expect(checkDistributedRateLimitMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { windowMs: 60_000, maxRequests: 10 },
      'staff:5:write'
    )
  })
})
