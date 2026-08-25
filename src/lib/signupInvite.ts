import type { SupabaseClient } from '@supabase/supabase-js'

// Optional invite redemption for first-time OAuth signups.
//
// Sign-in is open: a missing cookie creates the account with no invite.
// A present cookie still has to redeem — staff keys and personal referral
// links both land here, and the referral reward can only find the recruit
// through the invite_redemptions row written after insert.

export type SignupInvite =
  | { status: 'none' }
  | { status: 'redeemed'; inviteCodeId: number }
  | { status: 'invalid' }
  | { status: 'failed' }

export function signupInviteRedirectError(
  invite: SignupInvite
): 'invite_check_failed' | 'invite_invalid' | null {
  if (invite.status === 'failed') return 'invite_check_failed'
  if (invite.status === 'invalid') return 'invite_invalid'
  return null
}

export function redeemedInviteId(invite: SignupInvite): number | null {
  return invite.status === 'redeemed' ? invite.inviteCodeId : null
}

export async function redeemSignupInvite(
  supabase: SupabaseClient,
  inviteCode: string | undefined | null
): Promise<SignupInvite> {
  const code = inviteCode?.trim()
  if (!code) return { status: 'none' }

  const { data: inviteCodeId, error } = await supabase.rpc('redeem_invite_code', {
    p_code: code
  })
  if (error) {
    console.error('Invite redemption failed:', error)
    return { status: 'failed' }
  }
  if (!inviteCodeId) return { status: 'invalid' }
  return { status: 'redeemed', inviteCodeId: Number(inviteCodeId) }
}

export async function releaseSignupInviteUse(
  supabase: SupabaseClient,
  inviteCodeId: number
): Promise<void> {
  const { data: invite } = await supabase
    .from('invite_codes')
    .select('use_count')
    .eq('id', inviteCodeId)
    .single()
  if (invite && invite.use_count > 0) {
    await supabase
      .from('invite_codes')
      .update({ use_count: invite.use_count - 1 })
      .eq('id', inviteCodeId)
  }
}

export async function logSignupInviteRedemption(
  supabase: SupabaseClient,
  inviteCodeId: number,
  userId: number
): Promise<void> {
  const logRedemption = () =>
    supabase.from('invite_redemptions').insert({
      invite_code_id: inviteCodeId,
      user_id: userId
    })
  let { error } = await logRedemption()
  if (error) {
    ;({ error } = await logRedemption())
  }
  if (error) {
    console.error('Failed to log invite redemption after retry:', error)
  }
}
