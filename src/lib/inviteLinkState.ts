import type { SupabaseClient } from '@supabase/supabase-js'
import { inviteKeyCells, normalizeInviteCode } from './inviteCodes'

export type InviteLinkState =
  | { status: 'valid'; code: string }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'error' }

interface InviteRow {
  code: string
  max_uses: number
  use_count: number
  expires_at: string | null
  revoked_at: string | null
}

/**
 * Read-only link check. Redemption remains atomic in redeem_invite_code during
 * signup; this result is presentation only and must never reserve a use.
 */
export async function loadInviteLinkState(
  supabase: SupabaseClient,
  rawCode: string
): Promise<InviteLinkState> {
  const code = normalizeInviteCode(rawCode)
  if (!inviteKeyCells(code)) return { status: 'invalid' }

  const { data, error } = await supabase
    .from('invite_codes')
    .select('code, max_uses, use_count, expires_at, revoked_at')
    .ilike('code', code)
    .maybeSingle()

  if (error) return { status: 'error' }
  if (!data) return { status: 'invalid' }

  const invite = data as InviteRow
  // Revocation is intentionally folded into invalid instead of revealing it.
  if (invite.revoked_at) return { status: 'invalid' }
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    return { status: 'expired' }
  }
  if (invite.use_count >= invite.max_uses) return { status: 'used' }
  return { status: 'valid', code: normalizeInviteCode(invite.code) }
}
