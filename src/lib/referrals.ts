// Referral invite system (migration 026). Every user can mint one
// personal invite code (kind='referral'); when a recruit's extension
// first syncs real activity the referrer earns REFERRAL_POINTS of
// bonus_score, capped at REFERRAL_CAP point-carrying rewards. All
// writes go through the service-role client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateInviteCode } from './inviteCodes'
import { insertMissingNotifications } from './notifications'

export const REFERRAL_POINTS = 1_500
export const REFERRAL_CAP = 10

/** Effectively unlimited — one code serves every recruit a user lands. */
const REFERRAL_MAX_USES = 1_000_000

export interface ReferralCode {
  id: number
  code: string
}

/**
 * Return the user's personal referral code, minting it on first ask.
 * A lost race on the one-code-per-user partial unique index (or the
 * astronomically unlikely code collision) lands on 23505 and resolves
 * by re-selecting the winner's row.
 */
export async function ensureReferralCode(
  supabase: SupabaseClient,
  userId: number
): Promise<ReferralCode | null> {
  const { data: existing, error: lookupError } = await supabase
    .from('invite_codes')
    .select('id, code')
    .eq('created_by', userId)
    .eq('kind', 'referral')
    .maybeSingle()

  if (lookupError) {
    console.error('[Referrals] Referral code lookup failed:', lookupError)
    return null
  }
  if (existing) return { id: Number(existing.id), code: String(existing.code) }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateInviteCode()
    const { data: minted, error: insertError } = await supabase
      .from('invite_codes')
      .insert({
        code,
        created_by: userId,
        kind: 'referral',
        note: 'personal referral code',
        max_uses: REFERRAL_MAX_USES
      })
      .select('id, code')
      .maybeSingle()

    if (!insertError && minted) {
      return { id: Number(minted.id), code: String(minted.code) }
    }
    if (insertError && insertError.code !== '23505') {
      console.error('[Referrals] Referral code mint failed:', insertError)
      return null
    }

    const { data: raced } = await supabase
      .from('invite_codes')
      .select('id, code')
      .eq('created_by', userId)
      .eq('kind', 'referral')
      .maybeSingle()
    if (raced) return { id: Number(raced.id), code: String(raced.code) }
  }

  console.error(`[Referrals] Could not mint a referral code for user ${userId}`)
  return null
}

type RedeemedInvite = { kind?: string | null; created_by?: number | null }

/**
 * Grant the referral reward for this user's activation if one is due.
 * Called on every successful extension sync: non-referred users cost a
 * single indexed lookup on invite_redemptions(user_id) and bail. Never
 * throws — same convention as evaluateScoreNotifications.
 */
export async function maybeGrantReferralReward(
  supabase: SupabaseClient,
  userId: number
): Promise<void> {
  try {
    const { data: redemption, error: redemptionError } = await supabase
      .from('invite_redemptions')
      .select('invite_codes ( kind, created_by )')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()

    if (redemptionError) {
      console.error('[Referrals] Redemption lookup failed:', redemptionError)
      return
    }

    const invite = (redemption?.invite_codes ?? null) as RedeemedInvite | null
    if (!invite || invite.kind !== 'referral') return
    const referrerId = Number(invite.created_by)
    if (!Number.isInteger(referrerId) || referrerId <= 0 || referrerId === userId) return

    const { data: existingReward, error: rewardLookupError } = await supabase
      .from('referral_rewards')
      .select('id')
      .eq('referred_user_id', userId)
      .maybeSingle()

    if (rewardLookupError) {
      console.error('[Referrals] Reward lookup failed:', rewardLookupError)
      return
    }
    if (existingReward) return

    const { data: awarded, error: grantError } = await supabase.rpc('grant_referral_reward', {
      p_referrer: referrerId,
      p_referred: userId,
      p_points: REFERRAL_POINTS,
      p_cap: REFERRAL_CAP
    })

    if (grantError) {
      console.error('[Referrals] Reward grant failed:', grantError)
      return
    }
    // NULL means another sync already granted this reward — nothing to say.
    if (awarded === null || awarded === undefined) return

    const points = Number(awarded)
    const { data: friend } = await supabase
      .from('users')
      .select('twitter_username')
      .eq('id', userId)
      .maybeSingle()
    const username = friend?.twitter_username ? String(friend.twitter_username) : null
    const handle = username ? `@${username}` : 'A recruit'

    // data.username makes the feed deep-link the row to the recruit's
    // profile; data.kind lets the bell pick the referral glyph treatment.
    const data: Record<string, unknown> = {
      kind: 'referral',
      friendId: userId,
      points,
      ...(username ? { username } : {})
    }

    await insertMissingNotifications(supabase, referrerId, [
      points > 0
        ? {
            type: 'social',
            title: `+${points} PTS — RECRUIT ACTIVATED`,
            body: `${handle} joined through your invite and synced their first activity.`,
            data,
            dedupeKey: `referral_reward_${userId}`
          }
        : {
            type: 'social',
            title: 'RECRUIT ACTIVATED — CAP REACHED',
            body: `${handle} joined through your invite, but your ${REFERRAL_CAP} reward slots are already claimed.`,
            data,
            dedupeKey: `referral_reward_${userId}`
          }
    ])
  } catch (error) {
    console.error('[Referrals] Reward evaluation failed:', error)
  }
}
