import type { SupabaseClient } from '@supabase/supabase-js'
import { withAudit } from '@/lib/adminAudit'

// Moderation primitives used by the /api/admin/users/[id]/* routes.
// Guardrails (role floor, no self/staff targets, reason validation) run
// in the route BEFORE these are called; everything here executes under
// withAudit, so a successful call always leaves an audit row.

export type StatusAction = 'ban' | 'suspend' | 'unban'

export const STATUS_ACTIONS: readonly StatusAction[] = ['ban', 'suspend', 'unban']

export function isStatusAction(value: unknown): value is StatusAction {
  return typeof value === 'string' && (STATUS_ACTIONS as string[]).includes(value)
}

function statusFor(action: StatusAction): 'banned' | 'suspended' | 'active' {
  switch (action) {
    case 'ban':
      return 'banned'
    case 'suspend':
      return 'suspended'
    case 'unban':
      return 'active'
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

/**
 * Ban / suspend / unban semantics:
 *   banned    — cannot log in (OAuth callbacks refuse), all live sessions
 *               are destroyed here, hidden from every public surface.
 *   suspended — reversible soft state: keeps their session, hidden from
 *               the leaderboard and user search.
 *   active    — restored.
 *
 * Sessions are killed BEFORE the status flips: if the ban then fails the
 * target merely got logged out (they can sign back in), whereas the
 * reverse order could report a "ban" that leaves live sessions working
 * until they expire.
 */
export async function setUserStatus(
  supabase: SupabaseClient,
  opts: {
    actorId: number
    targetId: number
    action: StatusAction
    currentStatus: string | null
    reason: string
  }
): Promise<{ status: string }> {
  const nextStatus = statusFor(opts.action)

  return withAudit(
    supabase,
    {
      adminUserId: opts.actorId,
      targetUserId: opts.targetId,
      action: `user.status.${opts.action}`,
      oldValues: { status: opts.currentStatus },
      newValues: { status: nextStatus },
      reason: opts.reason
    },
    async () => {
      if (opts.action === 'ban') {
        const { error: sessionError } = await supabase
          .from('user_sessions')
          .delete()
          .eq('user_id', opts.targetId)
        if (sessionError) {
          throw new Error(
            `Failed to destroy sessions for user ${opts.targetId}: ${sessionError.message}`
          )
        }
      }

      const { error } = await supabase
        .from('users')
        .update({ status: nextStatus })
        .eq('id', opts.targetId)
      if (error) {
        throw new Error(`Failed to set status=${nextStatus} for user ${opts.targetId}: ${error.message}`)
      }

      return { status: nextStatus }
    }
  )
}

/** Profile surfaces staff can wipe. Maps to users.metadata keys. */
export type ModeratableField = 'bio' | 'location' | 'website' | 'banner' | 'socials'

export const MODERATABLE_FIELDS: readonly ModeratableField[] = [
  'bio',
  'location',
  'website',
  'banner',
  'socials'
]

export function isModeratableField(value: unknown): value is ModeratableField {
  return typeof value === 'string' && (MODERATABLE_FIELDS as string[]).includes(value)
}

/**
 * Clear offensive profile content. The wiped values are preserved in the
 * audit row's old_values, so what was removed (and whether the removal
 * was justified) stays reviewable forever. Unrelated metadata keys
 * (onboarding answers, equipped plate, privacy flag) survive untouched.
 */
export async function clearProfileFields(
  supabase: SupabaseClient,
  opts: {
    actorId: number
    targetId: number
    fields: ModeratableField[]
    currentMeta: Record<string, unknown>
    reason: string
  }
): Promise<{ cleared: ModeratableField[] }> {
  const merged: Record<string, unknown> = { ...opts.currentMeta }
  const oldValues: Record<string, unknown> = {}

  for (const field of opts.fields) {
    switch (field) {
      case 'bio':
      case 'location':
      case 'website':
        oldValues[field] = opts.currentMeta[field] ?? null
        merged[field] = null
        break
      case 'banner':
        oldValues.banner_image = opts.currentMeta.banner_image ?? null
        merged.banner_image = null
        merged.banner_animated = null
        break
      case 'socials':
        oldValues.socials = opts.currentMeta.socials ?? null
        merged.socials = {}
        break
      default: {
        const exhaustive: never = field
        return exhaustive
      }
    }
  }

  return withAudit(
    supabase,
    {
      adminUserId: opts.actorId,
      targetUserId: opts.targetId,
      action: 'user.moderate_content',
      oldValues,
      newValues: { cleared: opts.fields },
      reason: opts.reason
    },
    async () => {
      const { error } = await supabase
        .from('users')
        .update({ metadata: merged })
        .eq('id', opts.targetId)
      if (error) {
        throw new Error(
          `Failed to clear profile fields for user ${opts.targetId}: ${error.message}`
        )
      }
      return { cleared: opts.fields }
    }
  )
}

export const ADMIN_NOTES_MAX = 2000

/** Replace the internal staff notes on a user (empty string clears). */
export async function updateAdminNotes(
  supabase: SupabaseClient,
  opts: {
    actorId: number
    targetId: number
    notes: string
    currentNotes: string | null
    reason: string
  }
): Promise<{ notes: string | null }> {
  const nextNotes = opts.notes.trim().slice(0, ADMIN_NOTES_MAX) || null

  return withAudit(
    supabase,
    {
      adminUserId: opts.actorId,
      targetUserId: opts.targetId,
      action: 'user.edit_notes',
      oldValues: { admin_notes: opts.currentNotes },
      newValues: { admin_notes: nextNotes },
      reason: opts.reason
    },
    async () => {
      const { error } = await supabase
        .from('users')
        .update({ admin_notes: nextNotes })
        .eq('id', opts.targetId)
      if (error) {
        throw new Error(`Failed to update notes for user ${opts.targetId}: ${error.message}`)
      }
      return { notes: nextNotes }
    }
  )
}
