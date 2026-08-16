import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureReferralCode } from './referrals'

// The referral route reads stats.joined straight from the row returned
// here — invite_codes.use_count, atomically bumped by redeem_invite_code
// (migration 008) — instead of counting invite_redemptions. These tests
// pin that every return path selects use_count and maps it to useCount.

type Row = { id: number; code: string; use_count: number }
type QueryResult = { data: Row | null; error: { code?: string; message?: string } | null }

function makeDb(opts: { lookups: QueryResult[]; insert?: QueryResult }) {
  const lookupSelects: string[] = []
  const insertSelects: string[] = []
  const insertedValues: Record<string, unknown>[] = []
  let lookupCall = 0

  const supabase = {
    from: (table: string) => {
      if (table !== 'invite_codes') throw new Error(`Unexpected table: ${table}`)
      return {
        select: (cols: string) => {
          lookupSelects.push(cols)
          return {
            eq: () => ({
              eq: () => ({
                maybeSingle: () => {
                  const result = opts.lookups[lookupCall] ?? { data: null, error: null }
                  lookupCall += 1
                  return Promise.resolve(result)
                }
              })
            })
          }
        },
        insert: (values: Record<string, unknown>) => {
          insertedValues.push(values)
          return {
            select: (cols: string) => {
              insertSelects.push(cols)
              return {
                maybeSingle: () => Promise.resolve(opts.insert ?? { data: null, error: null })
              }
            }
          }
        }
      }
    }
  } as unknown as SupabaseClient

  return { supabase, lookupSelects, insertSelects, insertedValues }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ensureReferralCode', () => {
  it('returns the existing code with its use_count as useCount', async () => {
    const db = makeDb({
      lookups: [{ data: { id: 12, code: 'CRIB-AAAA-BBBB', use_count: 7 }, error: null }]
    })

    const referral = await ensureReferralCode(db.supabase, 42)

    expect(referral).toEqual({ id: 12, code: 'CRIB-AAAA-BBBB', useCount: 7 })
    expect(db.lookupSelects[0]).toContain('use_count')
    expect(db.insertedValues).toHaveLength(0)
  })

  it('mints a fresh code with useCount 0 when none exists', async () => {
    const db = makeDb({
      lookups: [{ data: null, error: null }],
      insert: { data: { id: 3, code: 'CRIB-CCCC-DDDD', use_count: 0 }, error: null }
    })

    const referral = await ensureReferralCode(db.supabase, 42)

    expect(referral).toEqual({ id: 3, code: 'CRIB-CCCC-DDDD', useCount: 0 })
    expect(db.insertSelects[0]).toContain('use_count')
    expect(db.insertedValues[0]).toMatchObject({ created_by: 42, kind: 'referral' })
  })

  it('resolves a lost mint race by re-selecting the winner row', async () => {
    const db = makeDb({
      lookups: [
        { data: null, error: null },
        { data: { id: 9, code: 'CRIB-EEEE-FFFF', use_count: 2 }, error: null }
      ],
      insert: { data: null, error: { code: '23505', message: 'duplicate key' } }
    })

    const referral = await ensureReferralCode(db.supabase, 42)

    expect(referral).toEqual({ id: 9, code: 'CRIB-EEEE-FFFF', useCount: 2 })
    expect(db.lookupSelects[1]).toContain('use_count')
  })

  it('returns null when the lookup errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeDb({
      lookups: [{ data: null, error: { message: 'connection reset' } }]
    })

    expect(await ensureReferralCode(db.supabase, 42)).toBeNull()
  })
})
