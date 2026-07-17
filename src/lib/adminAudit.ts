import type { SupabaseClient } from '@supabase/supabase-js'

// Mandatory audit trail for every staff mutation, backed by the
// admin_activity_log table (migration 003). The invariant the panel's
// anti-abuse story rests on: NO staff mutation can succeed without an
// audit row. withAudit enforces it by writing the log entry BEFORE the
// mutation — if the insert fails the action is aborted (fail-closed),
// and if the mutation then fails the orphaned entry is removed so the
// log only describes things that actually happened.
//
// There is deliberately no update/delete API over this table anywhere
// else: staff can read the log (all of it, including each other's
// entries) but never edit it.

export interface AdminAuditEntry {
  adminUserId: number
  targetUserId: number | null
  action: string
  oldValues?: Record<string, unknown> | null
  newValues?: Record<string, unknown> | null
  // Moderation/entitlement routes validate a typed operator reason before
  // logging (see cleanReason). A few staff actions carry their context
  // elsewhere — invite codes record created_by + note on the invite row —
  // so reason is optional here; the route layer decides when it's required.
  reason?: string | null
}

/** Insert one audit row; returns its id. Throws when the write fails. */
export async function logAdminAction(
  supabase: SupabaseClient,
  entry: AdminAuditEntry
): Promise<number> {
  const { data, error } = await supabase
    .from('admin_activity_log')
    .insert({
      admin_user_id: entry.adminUserId,
      target_user_id: entry.targetUserId,
      action: entry.action,
      old_values: entry.oldValues ?? null,
      new_values: entry.newValues ?? null,
      reason: entry.reason ?? null
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Audit log write failed: ${error?.message ?? 'no row returned'}`)
  }
  return Number(data.id)
}

/**
 * Run a staff mutation under the audit invariant. Audit-first ordering:
 * a successful mutation is always preceded by its log row, and an audit
 * outage blocks the mutation entirely rather than letting it run dark.
 */
export async function withAudit<T>(
  supabase: SupabaseClient,
  entry: AdminAuditEntry,
  mutate: () => Promise<T>
): Promise<T> {
  const auditId = await logAdminAction(supabase, entry)

  try {
    return await mutate()
  } catch (error) {
    // The mutation never happened; drop the row describing it. A failed
    // cleanup is logged loudly but doesn't mask the original error.
    const { error: cleanupError } = await supabase
      .from('admin_activity_log')
      .delete()
      .eq('id', auditId)
    if (cleanupError) {
      console.error(
        `[AdminAudit] Failed to remove audit row ${auditId} for failed action ${entry.action}:`,
        cleanupError.message
      )
    }
    throw error
  }
}
