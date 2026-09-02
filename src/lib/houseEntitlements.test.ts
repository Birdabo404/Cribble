import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const { grantProEntitlementMock, insertMissingNotificationsMock } = vi.hoisted(() => ({
  grantProEntitlementMock: vi.fn(),
  insertMissingNotificationsMock: vi.fn()
}))

vi.mock('@/lib/entitlementGrant', () => ({
  grantProEntitlement: grantProEntitlementMock
}))

vi.mock('@/lib/notifications', () => ({
  insertMissingNotifications: insertMissingNotificationsMock
}))

import {
  ensureHouseEntitlements,
  grantHouseTeamEntitlement,
  houseGrantFor,
  isHouseAccount
} from './houseEntitlements'

describe('houseGrantFor', () => {
  it('matches the house handles case-insensitively', () => {
    expect(houseGrantFor({ twitter_username: 'birdabo' })).toBe('PRO')
    expect(houseGrantFor({ twitter_username: 'BirdAbo' })).toBe('PRO')
    expect(houseGrantFor({ twitter_username: '  cribble_ai  ' })).toBe('TEAM')
  })

  it('matches production user ids when the handle is missing or unknown', () => {
    expect(houseGrantFor({ id: 8 })).toBe('PRO')
    expect(houseGrantFor({ id: 19 })).toBe('TEAM')
    expect(houseGrantFor({ id: 8, twitter_username: 'renamed' })).toBe('PRO')
  })

  it('lets the handle win when it disagrees with the id', () => {
    expect(houseGrantFor({ id: 8, twitter_username: 'cribble_ai' })).toBe('TEAM')
  })

  it('returns null for everyone else', () => {
    expect(houseGrantFor({ id: 9, twitter_username: 'pilot' })).toBeNull()
    expect(houseGrantFor({})).toBeNull()
    expect(houseGrantFor({ id: 0, twitter_username: '' })).toBeNull()
    expect(isHouseAccount({ twitter_username: 'pilot' })).toBe(false)
    expect(isHouseAccount({ twitter_username: 'birdabo' })).toBe(true)
  })
})

interface FakeDb {
  supabase: SupabaseClient
  usersSingle: ReturnType<typeof vi.fn>
  usersUpdate: ReturnType<typeof vi.fn>
}

function makeTeamDb(row: {
  metadata: Record<string, unknown> | null
  team_review_status: string | null
  team_approved_at: string | null
}): FakeDb {
  const usersSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const usersUpdate = vi.fn().mockResolvedValue({ error: null })
  const supabase = {
    from: (table: string) => {
      if (table !== 'users') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({ eq: () => ({ single: usersSingle }) }),
        update: (values: Record<string, unknown>) => {
          usersUpdate(values)
          return { eq: () => Promise.resolve({ error: null }) }
        }
      }
    }
  } as unknown as SupabaseClient
  return { supabase, usersSingle, usersUpdate }
}

describe('grantHouseTeamEntitlement', () => {
  beforeEach(() => {
    insertMissingNotificationsMock.mockReset()
    insertMissingNotificationsMock.mockResolvedValue(undefined)
  })

  it('writes TEAM + approved and stamps team_since / team_approved_at once', async () => {
    const db = makeTeamDb({
      metadata: { equipped_plate: 'gold-mark' },
      team_review_status: null,
      team_approved_at: null
    })

    await grantHouseTeamEntitlement(db.supabase, 19)

    expect(db.usersUpdate).toHaveBeenCalledTimes(1)
    const written = db.usersUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(written.subscription_tier).toBe('TEAM')
    expect(written.team_review_status).toBe('approved')
    expect(typeof written.team_approved_at).toBe('string')
    expect(written.metadata).toEqual(
      expect.objectContaining({
        equipped_plate: 'gold-mark',
        team_since: expect.any(String)
      })
    )
    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(db.supabase, 19, [
      expect.objectContaining({ dedupeKey: 'house_team_welcome' })
    ])
  })

  it('does not move existing team_since or team_approved_at', async () => {
    const db = makeTeamDb({
      metadata: { team_since: '2026-01-01T00:00:00.000Z' },
      team_review_status: 'pending',
      team_approved_at: '2026-01-02T00:00:00.000Z'
    })

    await grantHouseTeamEntitlement(db.supabase, 19)

    const written = db.usersUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(written).toEqual({
      subscription_tier: 'TEAM',
      team_review_status: 'approved'
    })
  })

  it('throws when the user row cannot be read', async () => {
    const db = makeTeamDb({
      metadata: {},
      team_review_status: null,
      team_approved_at: null
    })
    db.usersSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    await expect(grantHouseTeamEntitlement(db.supabase, 19)).rejects.toThrow(
      'Failed to read user 19 for house Team grant'
    )
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })
})

describe('ensureHouseEntitlements', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    grantProEntitlementMock.mockReset()
    grantProEntitlementMock.mockResolvedValue(undefined)
    insertMissingNotificationsMock.mockReset()
    insertMissingNotificationsMock.mockResolvedValue(undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('grants Pro to @birdabo when the row is not already Pro', async () => {
    const db = makeTeamDb({
      metadata: {},
      team_review_status: null,
      team_approved_at: null
    })

    await ensureHouseEntitlements(db.supabase, {
      id: 8,
      twitter_username: 'birdabo',
      subscription_tier: 'FREE'
    })

    expect(grantProEntitlementMock).toHaveBeenCalledWith(db.supabase, 8)
  })

  it('skips Pro when the house account is already Pro', async () => {
    await ensureHouseEntitlements({} as SupabaseClient, {
      id: 8,
      twitter_username: 'birdabo',
      subscription_tier: 'PRO'
    })

    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('does not overwrite an accidental TEAM tier on the Pro house account', async () => {
    await ensureHouseEntitlements({} as SupabaseClient, {
      id: 8,
      twitter_username: 'birdabo',
      subscription_tier: 'TEAM',
      team_review_status: 'approved'
    })

    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('approves Team for @cribble_ai when the row is not already approved', async () => {
    const db = makeTeamDb({
      metadata: {},
      team_review_status: 'pending',
      team_approved_at: null
    })

    await ensureHouseEntitlements(db.supabase, {
      id: 19,
      twitter_username: 'cribble_ai',
      subscription_tier: 'TEAM',
      team_review_status: 'pending'
    })

    expect(db.usersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_tier: 'TEAM',
        team_review_status: 'approved'
      })
    )
  })

  it('skips Team when the house account is already approved', async () => {
    await ensureHouseEntitlements({} as SupabaseClient, {
      id: 19,
      twitter_username: 'cribble_ai',
      subscription_tier: 'TEAM',
      team_review_status: 'approved'
    })

    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })

  it('swallows grant failures so login cannot break', async () => {
    grantProEntitlementMock.mockRejectedValue(new Error('db down'))

    await expect(
      ensureHouseEntitlements({} as SupabaseClient, {
        id: 8,
        twitter_username: 'birdabo',
        subscription_tier: 'FREE'
      })
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
  })

  it('is a no-op for everyone else', async () => {
    await ensureHouseEntitlements({} as SupabaseClient, {
      id: 9,
      twitter_username: 'pilot',
      subscription_tier: 'FREE'
    })

    expect(grantProEntitlementMock).not.toHaveBeenCalled()
  })
})
