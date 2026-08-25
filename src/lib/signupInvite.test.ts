import { describe, expect, it, vi } from 'vitest'
import {
  logSignupInviteRedemption,
  redeemedInviteId,
  redeemSignupInvite,
  releaseSignupInviteUse,
  signupInviteRedirectError
} from './signupInvite'

type RpcResult = { data: unknown; error: { message?: string } | null }

function mockSupabase(opts: {
  rpc?: RpcResult
  useCount?: number | null
  insertErrors?: Array<{ message: string } | null>
}) {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn()
  for (const result of opts.insertErrors ?? [null]) {
    insert.mockResolvedValueOnce({ error: result })
  }

  return {
    rpc: vi.fn().mockResolvedValue(opts.rpc ?? { data: 99, error: null }),
    update,
    updateEq,
    insert,
    from: (table: string) => {
      if (table === 'invite_codes') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: opts.useCount == null ? null : { use_count: opts.useCount },
                  error: null
                })
            })
          }),
          update
        }
      }
      if (table === 'invite_redemptions') {
        return { insert }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  }
}

describe('redeemSignupInvite', () => {
  it('skips redemption when no invite cookie is present', async () => {
    const db = mockSupabase({})
    await expect(redeemSignupInvite(db as never, undefined)).resolves.toEqual({
      status: 'none'
    })
    await expect(redeemSignupInvite(db as never, '  ')).resolves.toEqual({
      status: 'none'
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('redeems a present code and returns the invite id', async () => {
    const db = mockSupabase({ rpc: { data: 12, error: null } })
    await expect(redeemSignupInvite(db as never, 'CRIB-AAAA-BBBB')).resolves.toEqual({
      status: 'redeemed',
      inviteCodeId: 12
    })
    expect(db.rpc).toHaveBeenCalledWith('redeem_invite_code', {
      p_code: 'CRIB-AAAA-BBBB'
    })
  })

  it('treats a null redeem result as an invalid key', async () => {
    const db = mockSupabase({ rpc: { data: null, error: null } })
    await expect(redeemSignupInvite(db as never, 'CRIB-DEAD-CODE')).resolves.toEqual({
      status: 'invalid'
    })
  })

  it('treats an RPC error as a check failure', async () => {
    const error = console.error
    console.error = vi.fn()
    const db = mockSupabase({ rpc: { data: null, error: { message: 'boom' } } })
    await expect(redeemSignupInvite(db as never, 'CRIB-AAAA-BBBB')).resolves.toEqual({
      status: 'failed'
    })
    console.error = error
  })
})

describe('signupInviteRedirectError / redeemedInviteId', () => {
  it('only redirects when a presented key could not be claimed', () => {
    expect(signupInviteRedirectError({ status: 'none' })).toBeNull()
    expect(signupInviteRedirectError({ status: 'redeemed', inviteCodeId: 1 })).toBeNull()
    expect(signupInviteRedirectError({ status: 'invalid' })).toBe('invite_invalid')
    expect(signupInviteRedirectError({ status: 'failed' })).toBe('invite_check_failed')
    expect(redeemedInviteId({ status: 'none' })).toBeNull()
    expect(redeemedInviteId({ status: 'invalid' })).toBeNull()
    expect(redeemedInviteId({ status: 'redeemed', inviteCodeId: 7 })).toBe(7)
  })
})

describe('releaseSignupInviteUse', () => {
  it('gives a claimed use back after a failed user insert', async () => {
    const db = mockSupabase({ useCount: 3 })
    await releaseSignupInviteUse(db as never, 12)
    expect(db.update).toHaveBeenCalledWith({ use_count: 2 })
    expect(db.updateEq).toHaveBeenCalledWith('id', 12)
  })

  it('does not decrement when the row is already at zero', async () => {
    const db = mockSupabase({ useCount: 0 })
    await releaseSignupInviteUse(db as never, 12)
    expect(db.update).not.toHaveBeenCalled()
  })
})

describe('logSignupInviteRedemption', () => {
  it('retries a failed insert once, then logs and continues', async () => {
    const error = console.error
    console.error = vi.fn()
    const db = mockSupabase({
      insertErrors: [{ message: 'first' }, { message: 'second' }]
    })
    await logSignupInviteRedemption(db as never, 12, 42)
    expect(db.insert).toHaveBeenCalledTimes(2)
    expect(db.insert).toHaveBeenCalledWith({ invite_code_id: 12, user_id: 42 })
    expect(console.error).toHaveBeenCalled()
    console.error = error
  })

  it('stops after a successful retry', async () => {
    const db = mockSupabase({
      insertErrors: [{ message: 'first' }, null]
    })
    await logSignupInviteRedemption(db as never, 12, 42)
    expect(db.insert).toHaveBeenCalledTimes(2)
  })
})
