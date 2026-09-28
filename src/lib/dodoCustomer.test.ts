import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { findUserIdByDodoCustomer, linkDodoCustomer, readDodoCustomerId } from './dodoCustomer'

// The Dodo customer link is exclusive (unique index, migration 072): the
// portal route opens whatever customer is linked to the signed-in user,
// so a customer shared by two accounts would expose one account's
// billing to the other. These tests pin the two refusal paths — a row
// that already carries a different id, and a customer already owned by
// another account — plus the never-throws contract.

interface UpdateCall {
  values: Record<string, unknown>
  filters: Array<[string, string, unknown]>
}

function supabaseWith({
  updateResult,
  selectRow
}: {
  updateResult: { data: unknown; error: { code?: string; message: string } | null }
  selectRow?: { data: unknown; error: { message: string } | null }
}) {
  const updates: UpdateCall[] = []
  const client = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const call: UpdateCall = { values, filters: [] }
        updates.push(call)
        const builder = {
          eq(column: string, value: unknown) {
            call.filters.push(['eq', column, value])
            return builder
          },
          is(column: string, value: unknown) {
            call.filters.push(['is', column, value])
            return builder
          },
          select() {
            return Promise.resolve(updateResult)
          }
        }
        return builder
      },
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve(selectRow ?? { data: null, error: null }),
          limit: () => ({
            maybeSingle: () => Promise.resolve(selectRow ?? { data: null, error: null })
          })
        })
      })
    })
  } as unknown as SupabaseClient
  return { client, updates }
}

describe('linkDodoCustomer', () => {
  let warnSpy: MockInstance
  let errorSpy: MockInstance

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('links an unlinked account, scoped to rows where the column is still null', async () => {
    const { client, updates } = supabaseWith({ updateResult: { data: [{ id: 9 }], error: null } })

    await linkDodoCustomer(client, 9, 'cus_1')

    expect(updates).toHaveLength(1)
    expect(updates[0].values).toEqual({ dodo_customer_id: 'cus_1' })
    expect(updates[0].filters).toEqual([
      ['eq', 'id', 9],
      ['is', 'dodo_customer_id', null]
    ])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('refuses a customer already linked to another account (unique violation) without throwing', async () => {
    const { client } = supabaseWith({
      updateResult: { data: null, error: { code: '23505', message: 'duplicate key' } }
    })

    await expect(linkDodoCustomer(client, 19, 'cus_1')).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('already linked to another account')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('leaves a row that already carries a different id alone and warns', async () => {
    const { client } = supabaseWith({
      updateResult: { data: [], error: null },
      selectRow: { data: { dodo_customer_id: 'cus_existing' }, error: null }
    })

    await linkDodoCustomer(client, 9, 'cus_other')

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('cus_existing')
  })

  it('is silent when the row already carries the same id (idempotent redelivery)', async () => {
    const { client } = supabaseWith({
      updateResult: { data: [], error: null },
      selectRow: { data: { dodo_customer_id: 'cus_1' }, error: null }
    })

    await linkDodoCustomer(client, 9, 'cus_1')

    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs and swallows other database errors', async () => {
    const { client } = supabaseWith({
      updateResult: { data: null, error: { message: 'connection refused' } }
    })

    await expect(linkDodoCustomer(client, 9, 'cus_1')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty customer id', async () => {
    const { client, updates } = supabaseWith({ updateResult: { data: [], error: null } })

    await linkDodoCustomer(client, 9, '')

    expect(updates).toHaveLength(0)
  })
})

describe('readDodoCustomerId / findUserIdByDodoCustomer', () => {
  it('reads the linked id and treats empty or missing as unlinked', async () => {
    const linked = supabaseWith({
      updateResult: { data: [], error: null },
      selectRow: { data: { dodo_customer_id: 'cus_1' }, error: null }
    }).client
    const empty = supabaseWith({
      updateResult: { data: [], error: null },
      selectRow: { data: { dodo_customer_id: '' }, error: null }
    }).client

    expect(await readDodoCustomerId(linked, 9)).toBe('cus_1')
    expect(await readDodoCustomerId(empty, 9)).toBeNull()
  })

  it('resolves the owning account for a customer id, or null', async () => {
    const owned = supabaseWith({
      updateResult: { data: [], error: null },
      selectRow: { data: { id: 13 }, error: null }
    }).client
    const unowned = supabaseWith({
      updateResult: { data: [], error: null },
      selectRow: { data: null, error: null }
    }).client

    expect(await findUserIdByDodoCustomer(owned, 'cus_1')).toBe(13)
    expect(await findUserIdByDodoCustomer(unowned, 'cus_1')).toBeNull()
    expect(await findUserIdByDodoCustomer(unowned, '')).toBeNull()
  })
})
