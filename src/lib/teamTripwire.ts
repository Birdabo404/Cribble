import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAdminAction } from '@/lib/adminAudit'
import { isApprovedTeam } from '@/lib/entitlements'
import { houseGrantFor } from '@/lib/houseEntitlements'
import { insertMissingNotifications } from '@/lib/notifications'

// Identity-change tripwire for approved TEAM accounts — the defence
// against the hijack-and-rebrand attack: buy a team plan on a throwaway
// account, pass review, then rename the account to impersonate a real
// company. Every code path that re-syncs an existing user's handle,
// display name or avatar (today: the GitHub and X OAuth callbacks)
// calls runTeamIdentityTripwire AFTER writing the new values. When the
// account was an approved team and something genuinely changed, the
// approval flips back to 'pending' (re-queueing it in /admin/teams),
// the old→new values land in admin_activity_log, and every staff
// account gets a deduped in-app notification.
//
// Contract with the call sites: NEVER throws and never blocks — a
// tripwire outage must not break login. The status flip is the one
// security-critical write and runs first; the audit trail and staff
// alerts are best-effort after it.

/** The three identity fields the review decision was based on. */
export interface TeamIdentityFields {
  /** users.twitter_username — the login handle (GitHub login / X handle). */
  username: string | null
  /** users.twitter_name — the display name. */
  name: string | null
  /** users.twitter_profile_image — the avatar URL. */
  avatar: string | null
}

export type TeamIdentityField = keyof TeamIdentityFields

export interface TeamIdentityChange {
  field: TeamIdentityField
  from: string | null
  to: string | null
}

/** Everything the tripwire needs from the PRE-update user row. The OAuth
 *  callbacks already hold this row (they select it to decide between
 *  update and insert), so no extra read is needed. */
export interface TeamTripwireBeforeRow {
  id: number
  subscription_tier?: string | null
  team_review_status?: string | null
  twitter_username?: string | null
  twitter_name?: string | null
  twitter_profile_image?: string | null
}

const IDENTITY_COLUMNS: Record<TeamIdentityField, string> = {
  username: 'twitter_username',
  name: 'twitter_name',
  avatar: 'twitter_profile_image'
}

/** Comparison-normalised view of a raw column value: null/undefined and
 *  whitespace-only collapse to '', so a NULL avatar becoming '' (the
 *  callbacks store empty strings) is not a "change". */
const norm = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * The identity fields that GENUINELY differ between two snapshots, with
 * their old and new values ('' surfaces as null for readability). Exact
 * string comparison after trimming — a case-only handle change still
 * counts, which is the right bias for an anti-impersonation control.
 */
export function diffTeamIdentity(
  before: TeamIdentityFields,
  after: TeamIdentityFields
): TeamIdentityChange[] {
  const changes: TeamIdentityChange[] = []
  for (const field of Object.keys(IDENTITY_COLUMNS) as TeamIdentityField[]) {
    const from = norm(before[field])
    const to = norm(after[field])
    if (from !== to) {
      changes.push({ field, from: from || null, to: to || null })
    }
  }
  return changes
}

/**
 * Deterministic dedupe key for the staff alerts: the same change event
 * observed twice (e.g. two racing logins syncing identical new values)
 * hashes to the same key and the notifications unique index swallows
 * the duplicate, while a later change to yet another identity produces
 * a fresh key and re-alerts.
 */
export function tripwireDedupeKey(
  teamUserId: number,
  changes: TeamIdentityChange[]
): string {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(changes.map((c) => [c.field, c.from, c.to])))
    .digest('hex')
    .slice(0, 16)
  return `team_tripwire_${teamUserId}_${fingerprint}`
}

/** Human-readable summary for the staff alert body. */
export function describeTripwireChanges(changes: TeamIdentityChange[]): string {
  return changes
    .map((c) => `${c.field}: ${c.from ?? '(empty)'} → ${c.to ?? '(empty)'}`)
    .join(' · ')
}

/**
 * Re-flag an approved TEAM account whose identity fields just changed.
 * Call AFTER the new values were written, passing the pre-update row and
 * the values that were just stored. No-op for everyone who is not an
 * approved team or whose fields did not genuinely change. Never throws.
 */
export async function runTeamIdentityTripwire(
  supabase: SupabaseClient,
  before: TeamTripwireBeforeRow,
  after: TeamIdentityFields
): Promise<void> {
  try {
    // House Team is complimentary and permanent — a display-name or
    // avatar refresh must not drop @cribble_ai back into the queue.
    if (houseGrantFor({ id: before.id, twitter_username: before.twitter_username }) === 'TEAM') {
      return
    }

    if (!isApprovedTeam(before)) return

    const changes = diffTeamIdentity(
      {
        username: before.twitter_username ?? null,
        name: before.twitter_name ?? null,
        avatar: before.twitter_profile_image ?? null
      },
      after
    )
    if (changes.length === 0) return

    // The security-critical write, guarded on the status we observed:
    // if an admin rejected (or another login already re-flagged) the
    // account in the meantime, zero rows update and we stop — the
    // tripwire must never overwrite a fresher decision.
    const { data: flipped, error: flipError } = await supabase
      .from('users')
      .update({ team_review_status: 'pending' })
      .eq('id', before.id)
      .eq('team_review_status', 'approved')
      .select('id')

    if (flipError) {
      console.error('[TeamTripwire] Failed to re-flag team review status:', flipError)
      return
    }
    if (!flipped || flipped.length === 0) return

    // Trail + alerts are best-effort from here: the approval is already
    // withdrawn, which is the part that matters.
    const oldValues: Record<string, unknown> = { team_review_status: 'approved' }
    const newValues: Record<string, unknown> = { team_review_status: 'pending' }
    for (const change of changes) {
      oldValues[IDENTITY_COLUMNS[change.field]] = change.from
      newValues[IDENTITY_COLUMNS[change.field]] = change.to
    }

    try {
      // The account holder triggered this themselves, so their id sits in
      // the actor column — the log reads "@team team_identity_tripwire".
      await logAdminAction(supabase, {
        adminUserId: before.id,
        targetUserId: before.id,
        action: 'team_identity_tripwire',
        oldValues,
        newValues,
        reason: 'Automatic: approved TEAM account changed identity fields'
      })
    } catch (auditError) {
      console.error('[TeamTripwire] Audit write failed:', auditError)
    }

    const { data: staff, error: staffError } = await supabase
      .from('users')
      .select('id')
      .not('staff_role', 'is', null)

    if (staffError) {
      console.error('[TeamTripwire] Staff lookup failed:', staffError)
      return
    }

    const handle = norm(before.twitter_username) || `User${before.id}`
    const dedupeKey = tripwireDedupeKey(before.id, changes)
    for (const member of staff ?? []) {
      await insertMissingNotifications(supabase, Number(member.id), [
        {
          type: 'system',
          title: 'TEAM IDENTITY TRIPWIRE',
          body: `Approved team @${handle} changed its identity and is back in the review queue — ${describeTripwireChanges(changes)}`,
          data: { kind: 'team_tripwire', teamUserId: before.id, changes },
          dedupeKey
        }
      ])
    }
  } catch (error) {
    console.error('[TeamTripwire] Tripwire run failed:', error)
  }
}
