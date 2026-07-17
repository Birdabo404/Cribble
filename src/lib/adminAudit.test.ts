import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { logAdminAction, withAudit } from './adminAudit'

// The audit invariant: no staff mutation without a log row. withAudit
// writes the entry FIRST (an audit outage blocks the action outright)
// and removes it again if the mutation then fails, so the log describes
// exactly the set of actions that actually happened.

interface FakeDb {
  supabase: SupabaseClient
  insert: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  deleteEq: ReturnType<typeof vi.fn>
  calls: string[]
}

function makeDb(): FakeDb {
  const insert = vi.fn()
  const single = vi.fn().mockResolvedValue({ data: { id: 77 }, error: null })
  const deleteEq = vi.fn().mockResolvedValue({ error: null })
  const calls: string[] = []

  const supabase = {
    from: (table: string) => {
      if (table !== 'admin_activity_log') throw new Error(`Unexpected table: ${table}`)
      return {
        insert: (row: unknown) => {
          calls.push('insert')
          insert(row)
          return { select: () => ({ single }) }
        },
        delete: () => ({
          eq: (column: string, value: unknown) => {
            calls.push('delete')
            return deleteEq(column, value)
          }
        })
      }
    }
  } as unknown as SupabaseClient

  return { supabase, insert, single, deleteEq, calls }
}

const entry = {
  adminUserId: 1,
  targetUserId: 2,
  action: 'user.status.ban',
  oldValues: { status: 'active' },
  newValues: { status: 'banned' },
  reason: 'spamming the leaderboard'
}

describe('logAdminAction', () => {
  it('writes the full row and returns the new id', async () => {
    const db = makeDb()
    const id = await logAdminAction(db.supabase, entry)

    expect(id).toBe(77)
    expect(db.insert).toHaveBeenCalledWith({
      admin_user_id: 1,
      target_user_id: 2,
      action: 'user.status.ban',
      old_values: { status: 'active' },
      new_values: { status: 'banned' },
      reason: 'spamming the leaderboard'
    })
  })

  it('throws when the insert fails', async () => {
    const db = makeDb()
    db.single.mockResolvedValue({ data: null, error: { message: 'permission denied' } })

    await expect(logAdminAction(db.supabase, entry)).rejects.toThrow('Audit log write failed')
  })
})

describe('withAudit', () => {
  it('writes the audit row before running the mutation', async () => {
    const db = makeDb()
    const mutate = vi.fn(async () => {
      db.calls.push('mutate')
      return 'done'
    })

    const result = await withAudit(db.supabase, entry, mutate)

    expect(result).toBe('done')
    expect(db.calls).toEqual(['insert', 'mutate'])
  })

  it('never runs the mutation when the audit write fails (fail-closed)', async () => {
    const db = makeDb()
    db.single.mockResolvedValue({ data: null, error: { message: 'audit table offline' } })
    const mutate = vi.fn()

    await expect(withAudit(db.supabase, entry, mutate)).rejects.toThrow('Audit log write failed')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('removes the audit row and rethrows when the mutation fails', async () => {
    const db = makeDb()
    const mutate = vi.fn().mockRejectedValue(new Error('users table exploded'))

    await expect(withAudit(db.supabase, entry, mutate)).rejects.toThrow('users table exploded')
    expect(db.deleteEq).toHaveBeenCalledWith('id', 77)
  })
})
