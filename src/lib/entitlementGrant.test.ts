import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// grantProEntitlement is the single fulfillment entry point for BOTH the
// Polar webhook and the sync endpoint, and both callers re-fire it on
// every redelivery/sync — so the idempotency contract is what these tests
// pin down: premium_since is stamped once and never moved, and metadata
// is merged (never clobbered).

const { insertMissingNotificationsMock } = vi.hoisted(() => ({
  insertMissingNotificationsMock: vi.fn()
}))

vi.mock('@/lib/notifications', () => ({
  insertMissingNotifications: insertMissingNotificationsMock
}))

import {
  grantBetaTesterPlate,
  grantPlatePurchase,
  grantProEntitlement
} from './entitlementGrant'

interface FakeDb {
  supabase: SupabaseClient
  usersSingle: ReturnType<typeof vi.fn>
  usersUpdate: ReturnType<typeof vi.fn>
  usersUpdateEq: ReturnType<typeof vi.fn>
  cosmeticsUpsert: ReturnType<typeof vi.fn>
  redemptionMaybeSingle: ReturnType<typeof vi.fn>
}

function makeDb(metadata: Record<string, unknown> | null): FakeDb {
  const usersSingle = vi.fn().mockResolvedValue({ data: { metadata }, error: null })
  const usersUpdate = vi.fn()
  const usersUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const cosmeticsUpsert = vi.fn().mockResolvedValue({ error: null })
  // Default: no invite redemption on file (legacy pre-invite signup).
  const redemptionMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

  const supabase = {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ single: usersSingle }) }),
          update: (values: Record<string, unknown>) => {
            usersUpdate(values)
            return { eq: usersUpdateEq }
          }
        }
      }
      if (table === 'user_cosmetics') {
        return { upsert: cosmeticsUpsert }
      }
      if (table === 'invite_redemptions') {
        return {
          select: () => ({
            eq: () => ({ limit: () => ({ maybeSingle: redemptionMaybeSingle }) })
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  } as unknown as SupabaseClient

  return {
    supabase,
    usersSingle,
    usersUpdate,
    usersUpdateEq,
    cosmeticsUpsert,
    redemptionMaybeSingle
  }
}

describe('grantProEntitlement', () => {
  beforeEach(() => {
    insertMissingNotificationsMock.mockReset()
    insertMissingNotificationsMock.mockResolvedValue(undefined)
  })

  it('sets tier PRO and stamps premium_since on the first grant', async () => {
    const db = makeDb({})
    await grantProEntitlement(db.supabase, 9, { productId: 'prod_monthly', sourceId: 'sub_1' })

    expect(db.usersUpdate).toHaveBeenCalledTimes(1)
    const payload = db.usersUpdate.mock.calls[0][0] as {
      subscription_tier: string
      metadata: Record<string, unknown>
    }
    expect(payload.subscription_tier).toBe('PRO')
    expect(typeof payload.metadata.premium_since).toBe('string')
    expect(Number.isNaN(new Date(payload.metadata.premium_since as string).getTime())).toBe(
      false
    )
  })

  it('merges premium_since into existing metadata without dropping other keys', async () => {
    const db = makeDb({ equipped_plate: 'champions-gold', onboarded: true })
    await grantProEntitlement(db.supabase, 9, {})

    const payload = db.usersUpdate.mock.calls[0][0] as { metadata: Record<string, unknown> }
    expect(payload.metadata.equipped_plate).toBe('champions-gold')
    expect(payload.metadata.onboarded).toBe(true)
    expect(typeof payload.metadata.premium_since).toBe('string')
  })

  it('never moves an existing premium_since (redelivery leaves metadata untouched)', async () => {
    const db = makeDb({
      premium_since: '2026-01-01T00:00:00.000Z',
      equipped_plate: 'champions-gold'
    })
    await grantProEntitlement(db.supabase, 9, { productId: 'prod_monthly', sourceId: 'sub_1' })

    // Tier-only update: metadata is not part of the payload at all.
    expect(db.usersUpdate).toHaveBeenCalledWith({ subscription_tier: 'PRO' })
  })

  it('handles null metadata (fresh users) without throwing', async () => {
    const db = makeDb(null)
    await grantProEntitlement(db.supabase, 9, {})

    const payload = db.usersUpdate.mock.calls[0][0] as { metadata: Record<string, unknown> }
    expect(typeof payload.metadata.premium_since).toBe('string')
  })

  it('queues the deduped premium welcome notification on every grant', async () => {
    const db = makeDb({})
    await grantProEntitlement(db.supabase, 9, { productId: 'prod_monthly', sourceId: 'sub_1' })

    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(db.supabase, 9, [
      expect.objectContaining({
        type: 'premium',
        title: 'YOUR BLUE CHECK IS HERE',
        dedupeKey: 'premium_welcome'
      })
    ])
  })

  it('throws when the user read fails, before any write happens', async () => {
    const db = makeDb({})
    db.usersSingle.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

    await expect(grantProEntitlement(db.supabase, 9, {})).rejects.toThrow(
      'Failed to read user 9 for Pro grant'
    )
    expect(db.usersUpdate).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })

  it('throws when the tier update fails, before the notification is queued', async () => {
    const db = makeDb({})
    db.usersUpdateEq.mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(grantProEntitlement(db.supabase, 9, {})).rejects.toThrow(
      'Failed to set subscription_tier=PRO for user 9'
    )
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })
})

// grantPlatePurchase is the shared purchase-fulfillment path (order.paid
// webhook + pull-based order reconciliation). Contract: the ownership
// upsert is the critical path (throws → callers retry), the delivered
// notification rides behind it deduped per order id.
describe('grantPlatePurchase', () => {
  beforeEach(() => {
    insertMissingNotificationsMock.mockReset()
    insertMissingNotificationsMock.mockResolvedValue(undefined)
  })

  it('upserts the purchase row and queues the delivered notification', async () => {
    const db = makeDb({})

    await grantPlatePurchase(db.supabase, 9, { plateId: 'deep-space', orderId: 'order_1' })

    expect(db.cosmeticsUpsert).toHaveBeenCalledWith(
      {
        user_id: 9,
        item_type: 'plate',
        item_id: 'deep-space',
        acquired_via: 'purchase',
        source_order_id: 'order_1'
      },
      { onConflict: 'user_id,item_type,item_id' }
    )
    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(db.supabase, 9, [
      {
        type: 'shop',
        title: 'DELIVERY COMPLETE',
        body: 'Your Deep Space plate has been delivered successfully. Thank you for purchasing.',
        data: { kind: 'purchase_delivered', plateId: 'deep-space', orderId: 'order_1' },
        dedupeKey: 'plate_delivered_order_1'
      }
    ])
  })

  it('falls back to the raw plate id in the body for unknown catalog ids', async () => {
    const db = makeDb({})

    await grantPlatePurchase(db.supabase, 9, { plateId: 'retired-plate', orderId: 'order_2' })

    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(db.supabase, 9, [
      expect.objectContaining({
        body: 'Your retired-plate plate has been delivered successfully. Thank you for purchasing.',
        dedupeKey: 'plate_delivered_order_2'
      })
    ])
  })

  it('throws on upsert failure without queuing the notification', async () => {
    const db = makeDb({})
    db.cosmeticsUpsert.mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(
      grantPlatePurchase(db.supabase, 9, { plateId: 'deep-space', orderId: 'order_1' })
    ).rejects.toThrow('Failed to grant plate deep-space to user 9')
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })
})

// grantBetaTesterPlate runs inside POST /api/user/onboarding, so its
// contract is the inverse of grantProEntitlement's: every failure is
// logged and swallowed — the welcome save must succeed even when the
// gift cannot be delivered.
describe('grantBetaTesterPlate', () => {
  let errorSpy: MockInstance

  beforeEach(() => {
    insertMissingNotificationsMock.mockReset()
    insertMissingNotificationsMock.mockResolvedValue(undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('grants the plate and queues the deduped notification for invite redeemers', async () => {
    const db = makeDb({})
    db.redemptionMaybeSingle.mockResolvedValue({ data: { id: 42 }, error: null })

    await grantBetaTesterPlate(db.supabase, 9)

    expect(db.cosmeticsUpsert).toHaveBeenCalledWith(
      {
        user_id: 9,
        item_type: 'plate',
        item_id: 'beta-tester',
        acquired_via: 'beta_grant'
      },
      { onConflict: 'user_id,item_type,item_id', ignoreDuplicates: true }
    )
    expect(insertMissingNotificationsMock).toHaveBeenCalledWith(db.supabase, 9, [
      {
        type: 'system',
        title: 'TEST PILOT',
        body: 'Beta tester gift minted — thanks for flying the early build. Equip it from your profile editor.',
        data: { plateId: 'beta-tester' },
        dedupeKey: 'plate_beta-tester'
      }
    ])
  })

  it('does nothing for users without an invite redemption', async () => {
    const db = makeDb({})

    await grantBetaTesterPlate(db.supabase, 9)

    expect(db.cosmeticsUpsert).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })

  it('logs and returns when the redemption lookup fails, granting nothing', async () => {
    const db = makeDb({})
    db.redemptionMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection refused' }
    })

    await expect(grantBetaTesterPlate(db.supabase, 9)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    expect(db.cosmeticsUpsert).not.toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })

  it('logs and skips the notification when the cosmetics upsert fails', async () => {
    const db = makeDb({})
    db.redemptionMaybeSingle.mockResolvedValue({ data: { id: 42 }, error: null })
    db.cosmeticsUpsert.mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(grantBetaTesterPlate(db.supabase, 9)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    expect(insertMissingNotificationsMock).not.toHaveBeenCalled()
  })

  it('never throws, even when the notification write rejects', async () => {
    const db = makeDb({})
    db.redemptionMaybeSingle.mockResolvedValue({ data: { id: 42 }, error: null })
    insertMissingNotificationsMock.mockRejectedValue(new Error('socket hang up'))

    await expect(grantBetaTesterPlate(db.supabase, 9)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
  })
})
