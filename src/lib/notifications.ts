// Server-side notification creation. All writes go through the service-role
// Supabase client (the notifications table is RLS-locked to it).
//
// One-time events carry a dedupe_key; a partial unique index on
// (user_id, dedupe_key) makes creation idempotent, so callers can
// re-evaluate milestones on every sync without spamming the feed.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationType } from '@/types/notifications'

export interface NotificationInput {
  type: NotificationType
  title: string
  body?: string
  data?: Record<string, unknown>
  dedupeKey?: string
}

/** Leaderboard buckets worth celebrating, tightest first. */
const RANK_MILESTONES = [1, 2, 3, 10, 25, 50] as const

const SCORE_MILESTONES = [
  1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000
] as const

/** Cooldown matching MOVEMENT_WINDOW_MS in leaderboardEngine. */
export const DEMOTION_COOLDOWN_MS = 48 * 3_600_000

export function pickRankBucket(rank: number): number | null {
  if (!Number.isFinite(rank) || rank < 1) return null
  return RANK_MILESTONES.find((bucket) => rank <= bucket) ?? null
}

/** Tightest bucket held at fromRank that is no longer held at toRank, or null. */
export function pickLostBucket(fromRank: number, toRank: number): number | null {
  const prevBucket = pickRankBucket(fromRank)
  if (prevBucket === null) return null
  const newBucket = pickRankBucket(toRank)
  if (newBucket !== null && newBucket <= prevBucket) return null
  return prevBucket
}

/** Deterministic across concurrent reads in the same window (race safety). */
export function demotionDedupeKey(bucket: number, now: Date): string {
  return `rank_drop_${bucket}_${Math.floor(now.getTime() / DEMOTION_COOLDOWN_MS)}`
}

export function pickScoreMilestone(totalScore: number): number | null {
  if (!Number.isFinite(totalScore) || totalScore <= 0) return null
  for (let i = SCORE_MILESTONES.length - 1; i >= 0; i--) {
    if (totalScore >= SCORE_MILESTONES[i]) return SCORE_MILESTONES[i]
  }
  return null
}

export function formatMilestoneLabel(threshold: number): string {
  if (threshold >= 1_000_000) return `${threshold / 1_000_000}M`
  if (threshold >= 1_000) return `${threshold / 1_000}K`
  return String(threshold)
}

async function insertNotification(
  supabase: SupabaseClient,
  userId: number,
  input: NotificationInput
): Promise<boolean> {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    data: input.data ?? {},
    dedupe_key: input.dedupeKey ?? null
  })

  if (!error) return true
  // 23505 = unique violation on (user_id, dedupe_key): already delivered.
  if (error.code === '23505') return false
  console.error('[Notifications] Insert failed:', error)
  return false
}

/**
 * Insert only the deduped notifications this user hasn't received yet.
 * The pre-select keeps steady-state calls (every sync / every feed poll)
 * from generating constant unique-violation noise; a lost race still
 * lands on the unique index and is swallowed by insertNotification.
 * Also used by the achievements evaluator to announce unlocks.
 */
export async function insertMissingNotifications(
  supabase: SupabaseClient,
  userId: number,
  candidates: (NotificationInput & { dedupeKey: string })[]
): Promise<void> {
  if (candidates.length === 0) return

  const keys = candidates.map((c) => c.dedupeKey)
  const { data: existing, error } = await supabase
    .from('notifications')
    .select('dedupe_key')
    .eq('user_id', userId)
    .in('dedupe_key', keys)

  if (error) {
    console.error('[Notifications] Dedupe lookup failed:', error)
    return
  }

  const delivered = new Set((existing || []).map((row) => row.dedupe_key))
  for (const candidate of candidates) {
    if (delivered.has(candidate.dedupeKey)) continue
    await insertNotification(supabase, userId, candidate)
  }
}

/**
 * Called after a successful score recalculation. Creates rank-bucket and
 * lifetime-score milestone notifications the user hasn't earned before.
 * Only the tightest newly-reached tier is created, so a user landing at
 * #4 with 60k points gets "TOP 10" and "50K CLUB" — not every bucket
 * below them at once. Never throws.
 */
export async function evaluateScoreNotifications(
  supabase: SupabaseClient,
  userId: number
): Promise<void> {
  try {
    const { data: score, error: scoreError } = await supabase
      .from('user_scores')
      .select('total_score')
      .eq('user_id', userId)
      .maybeSingle()

    if (scoreError) {
      console.error('[Notifications] Score lookup failed:', scoreError)
      return
    }

    const totalScore = Math.round(Number(score?.total_score || 0))
    if (totalScore <= 0) return

    const candidates: (NotificationInput & { dedupeKey: string })[] = []

    const { count, error: rankError } = await supabase
      .from('user_scores')
      .select('user_id', { count: 'exact', head: true })
      .gt('total_score', totalScore)

    if (!rankError && count !== null) {
      const rank = count + 1
      const bucket = pickRankBucket(rank)
      if (bucket !== null) {
        candidates.push(
          bucket === 1
            ? {
                type: 'rank',
                title: '#1 ON THE LEADERBOARD',
                body: 'You hold the top spot. Defend it.',
                data: { rank, bucket },
                dedupeKey: 'rank_top_1'
              }
            : {
                type: 'rank',
                title: `TOP ${bucket}`,
                body: `You broke into the top ${bucket} — currently #${rank}.`,
                data: { rank, bucket },
                dedupeKey: `rank_top_${bucket}`
              }
        )
      }
    } else if (rankError) {
      console.error('[Notifications] Rank lookup failed:', rankError)
    }

    const milestone = pickScoreMilestone(totalScore)
    if (milestone !== null) {
      const label = formatMilestoneLabel(milestone)
      candidates.push({
        type: 'milestone',
        title: `${label} CLUB`,
        body: `Lifetime score crossed ${milestone.toLocaleString('en-US')} points.`,
        data: { threshold: milestone, totalScore },
        dedupeKey: `score_${milestone}`
      })
    }

    await insertMissingNotifications(supabase, userId, candidates)
  } catch (error) {
    console.error('[Notifications] Score evaluation failed:', error)
  }
}

export interface DemotionEvent {
  userId: number
  fromRank: number
  toRank: number
}

/**
 * Called from the leaderboard rank-diff pass with the users who dropped
 * this read. Notifies each user who lost a milestone bucket, at most once
 * per bucket per 48 hours: a rolling pre-check against recent rank_drop_*
 * notifications gives the true cooldown spacing, and the time-windowed
 * dedupe key (unique index on user_id + dedupe_key) backstops races
 * between concurrent leaderboard reads. Never throws.
 */
export async function evaluateDemotionNotifications(
  supabase: SupabaseClient,
  demotions: DemotionEvent[],
  now: Date
): Promise<void> {
  try {
    const losses: (DemotionEvent & { bucket: number })[] = []
    for (const demotion of demotions) {
      const bucket = pickLostBucket(demotion.fromRank, demotion.toRank)
      if (bucket !== null) losses.push({ ...demotion, bucket })
    }
    if (losses.length === 0) return

    const userIds = [...new Set(losses.map((loss) => loss.userId))]
    const windowStart = new Date(now.getTime() - DEMOTION_COOLDOWN_MS)
    const { data: recent, error } = await supabase
      .from('notifications')
      .select('user_id, dedupe_key')
      .in('user_id', userIds)
      .eq('type', 'rank')
      .gte('created_at', windowStart.toISOString())
      .like('dedupe_key', 'rank_drop_%')

    if (error) {
      console.error('[Notifications] Demotion cooldown lookup failed:', error)
      return
    }

    // dedupe_key shape: rank_drop_{bucket}_{window} — parse the bucket out
    // so a fresh drop of the same bucket inside the cooldown is skipped.
    const recentlyNotified = new Set(
      (recent || []).map(
        (row) => `${row.user_id}:${String(row.dedupe_key).split('_')[2]}`
      )
    )

    for (const { userId, fromRank, toRank, bucket } of losses) {
      if (recentlyNotified.has(`${userId}:${bucket}`)) continue
      await insertMissingNotifications(supabase, userId, [
        bucket === 1
          ? {
              type: 'rank',
              title: 'DETHRONED',
              body: `You lost the #1 spot — now #${toRank}. Take it back.`,
              data: { kind: 'demotion', bucket, fromRank, toRank },
              dedupeKey: demotionDedupeKey(bucket, now)
            }
          : {
              type: 'rank',
              title: `KNOCKED OUT OF TOP ${bucket}`,
              body: `You dropped from #${fromRank} to #${toRank}. Reclaim your spot.`,
              data: { kind: 'demotion', bucket, fromRank, toRank },
              dedupeKey: demotionDedupeKey(bucket, now)
            }
      ])
    }
  } catch (error) {
    console.error('[Notifications] Demotion evaluation failed:', error)
  }
}

// Season notifications (ending notices, close, placements, launch) are
// fanned out by season_tick() in the database (migration 025) on the
// pg_cron schedule — no lazy generate-on-read pass is needed anymore.
