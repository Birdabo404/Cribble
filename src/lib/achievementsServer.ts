// Server-side achievement evaluation. Runs after every score recalculation
// in the extension sync route (write-time, same hook as score notifications)
// and lazily when the achievements page is read, which backfills users whose
// history predates this feature. All writes go through the service-role
// Supabase client; the unique index on (user_id, achievement_id) makes
// re-evaluation idempotent.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACHIEVEMENTS,
  computeAchievementStats,
  isAchievementUnlocked,
  type AchievementEvent,
  type AchievementStats
} from './achievements'
import { insertMissingNotifications } from './notifications'
import { fetchAllUserEvents } from './scoring'

export interface AchievementEvaluation {
  stats: AchievementStats
  /** achievement id -> unlocked_at ISO, including unlocks from this pass. */
  unlockedAt: Map<string, string>
  newlyUnlockedIds: string[]
}

async function fetchUserEvents(
  supabase: SupabaseClient,
  userId: number
): Promise<AchievementEvent[] | null> {
  const { events, column } = await fetchAllUserEvents(
    supabase,
    userId,
    'timestamp, domain, active_ms, total_ms, visits'
  )

  if (!column) {
    console.warn(
      `[Achievements] No compatible events_raw user column (user ${userId})`
    )
    return []
  }
  if (events === null) {
    console.error('[Achievements] Events query failed')
    return null
  }
  return events as AchievementEvent[]
}

async function fetchScoreAndRank(
  supabase: SupabaseClient,
  userId: number
): Promise<{ totalScore: number; rank: number | null }> {
  const { data: score, error: scoreError } = await supabase
    .from('user_scores')
    .select('total_score')
    .eq('user_id', userId)
    .maybeSingle()

  if (scoreError) {
    console.error('[Achievements] Score lookup failed:', scoreError)
    return { totalScore: 0, rank: null }
  }

  const totalScore = Math.round(Number(score?.total_score || 0))
  if (totalScore <= 0) return { totalScore: 0, rank: null }

  const { count, error: rankError } = await supabase
    .from('user_scores')
    .select('user_id', { count: 'exact', head: true })
    .gt('total_score', totalScore)

  if (rankError || count === null) {
    if (rankError) console.error('[Achievements] Rank lookup failed:', rankError)
    return { totalScore, rank: null }
  }

  return { totalScore, rank: count + 1 }
}

/**
 * Evaluate the full catalog for a user: compute stats from raw events,
 * persist any newly-earned unlocks, and announce them through the
 * notification feed. Returns null only when stats could not be gathered.
 * Never throws.
 */
export async function evaluateAchievements(
  supabase: SupabaseClient,
  userId: number
): Promise<AchievementEvaluation | null> {
  try {
    const [events, scoreAndRank] = await Promise.all([
      fetchUserEvents(supabase, userId),
      fetchScoreAndRank(supabase, userId)
    ])
    if (events === null) return null

    const stats = computeAchievementStats(events, scoreAndRank)

    const { data: existingRows, error: existingError } = await supabase
      .from('user_achievements')
      .select('achievement_id, unlocked_at')
      .eq('user_id', userId)

    if (existingError) {
      console.error('[Achievements] Unlock lookup failed:', existingError)
      return null
    }

    const unlockedAt = new Map<string, string>(
      (existingRows || []).map((row) => [
        String(row.achievement_id),
        String(row.unlocked_at)
      ])
    )

    const newlyEarned = ACHIEVEMENTS.filter(
      (def) => !unlockedAt.has(def.id) && isAchievementUnlocked(def, stats)
    )

    if (newlyEarned.length > 0) {
      const nowIso = new Date().toISOString()
      const { error: insertError } = await supabase
        .from('user_achievements')
        .upsert(
          newlyEarned.map((def) => ({
            user_id: userId,
            achievement_id: def.id,
            unlocked_at: nowIso
          })),
          { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
        )

      if (insertError) {
        console.error('[Achievements] Unlock insert failed:', insertError)
      } else {
        for (const def of newlyEarned) unlockedAt.set(def.id, nowIso)
        await insertMissingNotifications(
          supabase,
          userId,
          newlyEarned.map((def) => ({
            type: 'achievement' as const,
            title: def.name,
            body: `Achievement unlocked — ${def.description}`,
            data: { achievementId: def.id, rarity: def.rarity, category: def.category },
            dedupeKey: `achievement_${def.id}`
          }))
        )
      }
    }

    return {
      stats,
      unlockedAt,
      newlyUnlockedIds: newlyEarned.map((def) => def.id)
    }
  } catch (error) {
    console.error('[Achievements] Evaluation failed:', error)
    return null
  }
}
