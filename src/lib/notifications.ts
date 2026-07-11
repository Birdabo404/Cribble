// Server-side notification creation. All writes go through the service-role
// Supabase client (the notifications table is RLS-locked to it).
//
// One-time events carry a dedupe_key; a partial unique index on
// (user_id, dedupe_key) makes creation idempotent, so callers can
// re-evaluate milestones on every sync without spamming the feed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SEASON } from '@/components/dashboard-v2/format'
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

const DAY_MS = 86_400_000
const SEASON_CLOSING_WINDOW_DAYS = 7

export function pickRankBucket(rank: number): number | null {
  if (!Number.isFinite(rank) || rank < 1) return null
  return RANK_MILESTONES.find((bucket) => rank <= bucket) ?? null
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
 */
async function insertMissingNotifications(
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

/**
 * Lazily creates time-based season notifications when the feed is read.
 * (No cron infra yet — generate-on-read keeps these correct per user
 * without a scheduler.) Never throws.
 */
export async function ensureSeasonNotifications(
  supabase: SupabaseClient,
  userId: number
): Promise<void> {
  try {
    const now = Date.now()
    const start = new Date(SEASON.startISO).getTime()
    const end = new Date(SEASON.endISO).getTime()
    const slug = SEASON.name.toLowerCase().replace(/\s+/g, '_')

    const candidates: (NotificationInput & { dedupeKey: string })[] = []

    if (now >= end) {
      candidates.push({
        type: 'season',
        title: `${SEASON.name} COMPLETE`,
        body: 'The season has ended. Final standings are locked on the leaderboard.',
        data: { season: SEASON.name },
        dedupeKey: `${slug}_complete`
      })
    } else if (now >= start) {
      const daysLeft = Math.ceil((end - now) / DAY_MS)
      if (daysLeft <= SEASON_CLOSING_WINDOW_DAYS) {
        candidates.push({
          type: 'season',
          title: `${SEASON.name} — FINAL WEEK`,
          body: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to climb before standings lock.`,
          data: { season: SEASON.name, daysLeft },
          dedupeKey: `${slug}_final_week`
        })
      }
    }

    await insertMissingNotifications(supabase, userId, candidates)
  } catch (error) {
    console.error('[Notifications] Season evaluation failed:', error)
  }
}
