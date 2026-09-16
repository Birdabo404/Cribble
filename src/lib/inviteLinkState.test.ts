import { describe, expect, it, vi } from 'vitest'
import { loadInviteLinkState } from './inviteLinkState'

function client(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const ilike = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ ilike }))
  const from = vi.fn(() => ({ select }))
  return { from, select, ilike, maybeSingle } as const
}

describe('loadInviteLinkState', () => {
  it('rejects malformed codes without querying storage', async () => {
    const db = client(null)
    await expect(loadInviteLinkState(db as never, 'not-a-code')).resolves.toEqual({ status: 'invalid' })
    expect(db.from).not.toHaveBeenCalled()
  })

  it.each([
    [null, null, 'invalid'],
    [{ code: 'CRIB-ABCD-EFGH', max_uses: 1, use_count: 0, expires_at: null, revoked_at: '2026-01-01' }, null, 'invalid'],
    [{ code: 'CRIB-ABCD-EFGH', max_uses: 1, use_count: 0, expires_at: '2020-01-01', revoked_at: null }, null, 'expired'],
    [{ code: 'CRIB-ABCD-EFGH', max_uses: 1, use_count: 1, expires_at: null, revoked_at: null }, null, 'used'],
    [null, { message: 'offline' }, 'error']
  ])('maps storage result %# to %s', async (data, error, status) => {
    await expect(loadInviteLinkState(client(data, error) as never, 'CRIB-ABCD-EFGH')).resolves.toEqual({ status })
  })

  it('returns the canonical code only for a usable invite', async () => {
    const row = { code: 'crib-abcd-efgh', max_uses: 2, use_count: 1, expires_at: null, revoked_at: null }
    await expect(loadInviteLinkState(client(row) as never, 'CRIB-ABCD-EFGH')).resolves.toEqual({ status: 'valid', code: 'CRIB-ABCD-EFGH' })
  })
})
