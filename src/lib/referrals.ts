// Referral invite system (migration 026). Every user can mint one
// personal invite code (kind='referral'); when a recruit's extension
// first syncs real activity the referrer earns REFERRAL_POINTS of
// bonus_score, capped at REFERRAL_CAP point-carrying rewards. All
// writes go through the service-role client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { applyEventsUserEq } from './eventsIdentity'
import { generateInviteCode } from './inviteCodes'
import { insertMissingNotifications } from './notifications'

export const REFERRAL_POINTS = 1_500
export const REFERRAL_CAP = 10

/** Effectively unlimited — one code serves every recruit a user lands. */
const REFERRAL_MAX_USES = 1_000_000

export interface ReferralCode {
  id: number
  code: string
  /** Lifetime redemptions — atomically bumped by redeem_invite_code (migration 008). */
  useCount: number
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
    .select('id, code, use_count')
    .eq('created_by', userId)
    .eq('kind', 'referral')
    .maybeSingle()

  if (lookupError) {
    console.error('[Referrals] Referral code lookup failed:', lookupError)
    return null
  }
  if (existing) {
    return {
      id: Number(existing.id),
      code: String(existing.code),
      useCount: Number(existing.use_count)
    }
  }

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
      .select('id, code, use_count')
      .maybeSingle()

    if (!insertError && minted) {
      return {
        id: Number(minted.id),
        code: String(minted.code),
        useCount: Number(minted.use_count)
      }
    }
    if (insertError && insertError.code !== '23505') {
      console.error('[Referrals] Referral code mint failed:', insertError)
      return null
    }

    const { data: raced } = await supabase
      .from('invite_codes')
      .select('id, code, use_count')
      .eq('created_by', userId)
      .eq('kind', 'referral')
      .maybeSingle()
    if (raced) {
      return {
        id: Number(raced.id),
        code: String(raced.code),
        useCount: Number(raced.use_count)
      }
    }
  }

  console.error(`[Referrals] Could not mint a referral code for user ${userId}`)
  return null
}

type RedeemedInvite = { kind?: string | null; created_by?: number | null }

/**
 * PostgREST embeds a joined resource as an object when it can prove the
 * relationship is to-one, and as a one-element array otherwise (the shape
 * depends on how the FK metadata is reported, which has differed across
 * environments). Treating the array shape as "no invite" silently failed
 * the kind check and skipped every grant, so accept both.
 */
function unwrapInviteEmbed(embed: unknown): RedeemedInvite | null {
  if (Array.isArray(embed)) return (embed[0] as RedeemedInvite | undefined) ?? null
  if (embed && typeof embed === 'object') return embed as RedeemedInvite
  return null
}

export interface MaybeGrantReferralRewardOptions {
  /**
   * Whether the sync that triggered this call stored new events_raw rows.
   * When false, the grant first requires activity to already exist — that
   * is the retry path for a grant a previous sync missed, while a bare
   * handshake (no stored events at all) stays unrewarded.
   */
  ingestedNewEvents: boolean
}

/**
 * Grant the referral reward for this user's activation if one is due.
 * Called on EVERY extension sync response (including duplicate and empty
 * batches), so cost ordering matters: non-referred users cost a single
 * indexed lookup on invite_redemptions(user_id) and bail. Only referred,
 * not-yet-rewarded users on a no-ingest sync pay for the events_raw
 * existence probe. Returns the points recorded by a grant that happened
 * NOW (0 when the referrer's cap ate the reward), or null when nothing
 * was newly granted. Never throws — same convention as
 * evaluateScoreNotifications.
 */
export async function maybeGrantReferralReward(
  supabase: SupabaseClient,
  userId: number,
  options: MaybeGrantReferralRewardOptions
): Promise<number | null> {
  try {
    const { data: redemption, error: redemptionError } = await supabase
      .from('invite_redemptions')
      .select('invite_codes ( kind, created_by )')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()

    if (redemptionError) {
      console.error('[Referrals] Redemption lookup failed:', redemptionError)
      return null
    }

    const invite = unwrapInviteEmbed(redemption?.invite_codes ?? null)
    if (!invite || invite.kind !== 'referral') return null
    const referrerId = Number(invite.created_by)
    if (!Number.isInteger(referrerId) || referrerId <= 0 || referrerId === userId) return null

    const { data: existingReward, error: rewardLookupError } = await supabase
      .from('referral_rewards')
      .select('id')
      .eq('referred_user_id', userId)
      .maybeSingle()

    if (rewardLookupError) {
      console.error('[Referrals] Reward lookup failed:', rewardLookupError)
      return null
    }
    if (existingReward) return null

    if (!options.ingestedNewEvents) {
      // This sync stored nothing, so activation hinges on whether a past
      // sync did. The probe goes through the schema-compat layer: some
      // deployments key events_raw on the legacy twitter_user_id integer
      // column with user_id as a UUID, so a hardcoded .eq('user_id', …)
      // would silently match nothing (or error) there.
      const probe = supabase.from('events_raw').select('id').limit(1)
      const { query: scopedProbe, column } = await applyEventsUserEq(supabase, probe, userId)
      // No usable identity column means we cannot prove activity — treat
      // as no events rather than granting blind.
      if (!column) return null
      const { data: activityRows, error: activityError } = await scopedProbe
      if (activityError) {
        console.error('[Referrals] Activity probe failed:', activityError)
        return null
      }
      if (!activityRows || activityRows.length === 0) return null
    }

    const { data: awarded, error: grantError } = await supabase.rpc('grant_referral_reward', {
      p_referrer: referrerId,
      p_referred: userId,
      p_points: REFERRAL_POINTS,
      p_cap: REFERRAL_CAP
    })

    if (grantError) {
      console.error('[Referrals] Reward grant failed:', grantError)
      return null
    }
    // NULL means another sync already granted this reward — nothing to say.
    if (awarded === null || awarded === undefined) return null

    const points = Number(awarded)
    // The reward is recorded at this point: a notification hiccup must not
    // hide the grant from the caller (the leaderboard snapshot keys on a
    // positive return), so the notify step gets its own guard.
    try {
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
      console.error('[Referrals] Reward notification failed:', error)
    }
    return points
  } catch (error) {
    console.error('[Referrals] Reward evaluation failed:', error)
    return null
  }
}
