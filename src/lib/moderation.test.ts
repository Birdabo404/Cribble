import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { clearProfileFields, setUserStatus, updateAdminNotes } from './moderation'

// The ban flow is the highest-stakes moderation path: a "success" must
// mean sessions are dead AND the status stuck AND an audit row exists.
// These tests pin the ordering (sessions die before the status flips,
// audit row precedes everything) and the metadata-preserving semantics
// of content clearing.

interface FakeDb {
  supabase: SupabaseClient
  auditInsert: ReturnType<typeof vi.fn>
  auditSingle: ReturnType<typeof vi.fn>
  auditDeleteEq: ReturnType<typeof vi.fn>
  sessionsDeleteEq: ReturnType<typeof vi.fn>
  usersUpdate: ReturnType<typeof vi.fn>
  usersUpdateEq: ReturnType<typeof vi.fn>
  calls: string[]
}

function makeDb(): FakeDb {
  const auditInsert = vi.fn()
  const auditSingle = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null })
  const auditDeleteEq = vi.fn().mockResolvedValue({ error: null })
  const sessionsDeleteEq = vi.fn().mockResolvedValue({ error: null })
  const usersUpdate = vi.fn()
  const usersUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const calls: string[] = []

  const supabase = {
    from: (table: string) => {
      if (table === 'admin_activity_log') {
        return {
          insert: (row: unknown) => {
            calls.push('audit.insert')
            auditInsert(row)
            return { select: () => ({ single: auditSingle }) }
          },
          delete: () => ({
            eq: (column: string, value: unknown) => {
              calls.push('audit.delete')
              return auditDeleteEq(column, value)
            }
          })
        }
      }
      if (table === 'user_sessions') {
        return {
          delete: () => ({
            eq: (column: string, value: unknown) => {
              calls.push('sessions.delete')
              return sessionsDeleteEq(column, value)
            }
          })
        }
      }
      if (table === 'users') {
        return {
          update: (values: Record<string, unknown>) => {
            usersUpdate(values)
            return {
              eq: (column: string, value: unknown) => {
                calls.push('users.update')
                return usersUpdateEq(column, value)
              }
            }
          }
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }
  } as unknown as SupabaseClient

  return {
    supabase,
    auditInsert,
    auditSingle,
    auditDeleteEq,
    sessionsDeleteEq,
    usersUpdate,
    usersUpdateEq,
    calls
  }
}

describe('setUserStatus', () => {
  it('ban: audit row first, then sessions destroyed, then status flipped', async () => {
    const db = makeDb()
    const result = await setUserStatus(db.supabase, {
      actorId: 1,
      targetId: 9,
      action: 'ban',
      currentStatus: 'active',
      reason: 'hate speech in bio'
    })

    expect(result).toEqual({ status: 'banned' })
    expect(db.calls).toEqual(['audit.insert', 'sessions.delete', 'users.update'])
    expect(db.sessionsDeleteEq).toHaveBeenCalledWith('user_id', 9)
    expect(db.usersUpdate).toHaveBeenCalledWith({ status: 'banned' })
    expect(db.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_user_id: 1,
        target_user_id: 9,
        action: 'user.status.ban',
        old_values: { status: 'active' },
        new_values: { status: 'banned' },
        reason: 'hate speech in bio'
      })
    )
  })

  it('suspend and unban leave sessions alone', async () => {
    for (const [action, status] of [
      ['suspend', 'suspended'],
      ['unban', 'active']
    ] as const) {
      const db = makeDb()
      const result = await setUserStatus(db.supabase, {
        actorId: 1,
        targetId: 9,
        action,
        currentStatus: action === 'unban' ? 'banned' : 'active',
        reason: 'a valid staff reason'
      })
      expect(result).toEqual({ status })
      expect(db.sessionsDeleteEq).not.toHaveBeenCalled()
      expect(db.usersUpdate).toHaveBeenCalledWith({ status })
    }
  })

  it('aborts without touching anything when the audit write fails', async () => {
    const db = makeDb()
    db.auditSingle.mockResolvedValue({ data: null, error: { message: 'audit offline' } })

    await expect(
      setUserStatus(db.supabase, {
        actorId: 1,
        targetId: 9,
        action: 'ban',
        currentStatus: 'active',
        reason: 'a valid staff reason'
      })
    ).rejects.toThrow('Audit log write failed')
    expect(db.sessionsDeleteEq).not.toHaveBeenCalled()
    expect(db.usersUpdate).not.toHaveBeenCalled()
  })

  it('cleans up the audit row when the status update fails', async () => {
    const db = makeDb()
    db.usersUpdateEq.mockResolvedValue({ error: { message: 'row locked' } })

    await expect(
      setUserStatus(db.supabase, {
        actorId: 1,
        targetId: 9,
        action: 'unban',
        currentStatus: 'banned',
        reason: 'appeal accepted, restoring'
      })
    ).rejects.toThrow('Failed to set status=active')
    expect(db.auditDeleteEq).toHaveBeenCalledWith('id', 42)
  })
})

describe('clearProfileFields', () => {
  it('wipes only the selected fields and preserves everything else', async () => {
    const db = makeDb()
    const currentMeta = {
      bio: 'offensive text',
      location: 'somewhere',
      website: 'https://spam.example',
      banner_image: 'https://cdn.example/banner.gif',
      banner_animated: true,
      banner_frame: { x: 20, y: 80, zoom: 2 },
      socials: { x: 'spammer', github: 'fine' },
      equipped_plate: 'deep-space',
      is_private: true,
      onboarding: { goal: 'learn' }
    }

    const result = await clearProfileFields(db.supabase, {
      actorId: 1,
      targetId: 9,
      fields: ['bio', 'banner', 'socials'],
      currentMeta,
      reason: 'reported: slurs in bio and banner'
    })

    expect(result).toEqual({ cleared: ['bio', 'banner', 'socials'] })
    const written = db.usersUpdate.mock.calls[0][0] as { metadata: Record<string, unknown> }
    expect(written.metadata.bio).toBe(null)
    expect(written.metadata.banner_image).toBe(null)
    expect(written.metadata.banner_animated).toBe(null)
    expect(written.metadata.banner_frame).toBe(null)
    expect(written.metadata.socials).toEqual({})
    // untouched keys survive
    expect(written.metadata.location).toBe('somewhere')
    expect(written.metadata.website).toBe('https://spam.example')
    expect(written.metadata.equipped_plate).toBe('deep-space')
    expect(written.metadata.is_private).toBe(true)
    expect(written.metadata.onboarding).toEqual({ goal: 'learn' })
  })

  it('preserves the removed content in the audit old_values', async () => {
    const db = makeDb()
    await clearProfileFields(db.supabase, {
      actorId: 1,
      targetId: 9,
      fields: ['bio', 'banner'],
      currentMeta: { bio: 'bad words', banner_image: 'https://cdn.example/x.gif' },
      reason: 'reported by three users'
    })

    expect(db.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.moderate_content',
        old_values: { bio: 'bad words', banner_image: 'https://cdn.example/x.gif' },
        new_values: { cleared: ['bio', 'banner'] }
      })
    )
  })
})

describe('updateAdminNotes', () => {
  it('trims, stores and audits the new notes', async () => {
    const db = makeDb()
    const result = await updateAdminNotes(db.supabase, {
      actorId: 1,
      targetId: 9,
      notes: '  second warning issued  ',
      currentNotes: 'first warning',
      reason: 'tracking repeat behavior'
    })

    expect(result).toEqual({ notes: 'second warning issued' })
    expect(db.usersUpdate).toHaveBeenCalledWith({ admin_notes: 'second warning issued' })
    expect(db.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.edit_notes',
        old_values: { admin_notes: 'first warning' },
        new_values: { admin_notes: 'second warning issued' }
      })
    )
  })

  it('stores empty notes as null', async () => {
    const db = makeDb()
    const result = await updateAdminNotes(db.supabase, {
      actorId: 1,
      targetId: 9,
      notes: '   ',
      currentNotes: 'old note',
      reason: 'clearing resolved warning'
    })

    expect(result).toEqual({ notes: null })
    expect(db.usersUpdate).toHaveBeenCalledWith({ admin_notes: null })
  })
})
