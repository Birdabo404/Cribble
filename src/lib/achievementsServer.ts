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
  EMPTY_ACHIEVEMENT_TOKEN_STATS,
  isAchievementUnlocked,
  type AchievementEvent,
  type AchievementStats,
  type AchievementTokenStats
} from './achievements'
import { insertMissingNotifications } from './notifications'
import { fetchAllUserEvents } from './scoring'

/** The trophy plate minted alongside the APEX (#1) achievement. */
const CHAMPION_ACHIEVEMENT_ID = 'rank_1'
const CHAMPION_PLATE_ID = 'champions-gold'

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

/** Mint the Champion's Gold plate for a user whose APEX achievement is
 *  unlocked. Never sold — this grant is the only path to owning it. Runs
 *  on every evaluation where APEX is unlocked (not just the unlocking
 *  pass), so champions from before this feature existed self-heal; the
 *  unique (user_id, item_type, item_id) index makes the upsert a no-op
 *  after the first mint. Like the founder grant, the row is permanent:
 *  losing the throne keeps the trophy. */
async function grantChampionPlate(
  supabase: SupabaseClient,
  userId: number
): Promise<void> {
  const { error } = await supabase.from('user_cosmetics').upsert(
    {
      user_id: userId,
      item_type: 'plate',
      item_id: CHAMPION_PLATE_ID,
      acquired_via: 'champion_grant'
    },
    { onConflict: 'user_id,item_type,item_id', ignoreDuplicates: true }
  )

  if (error) {
    console.error('[Achievements] Champion plate grant failed:', error)
    return
  }

  await insertMissingNotifications(supabase, userId, [
    {
      type: 'system',
      title: "CHAMPION'S GOLD",
      body: 'Trophy plate minted — never sold, taken at #1. Equip it from your profile editor.',
      data: { plateId: CHAMPION_PLATE_ID },
      dedupeKey: `plate_${CHAMPION_PLATE_ID}`
    }
  ])
}

function rpcNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Lifetime BURN stats from the agent token pipeline (migration 053).
 *  The RPC's bigint/numeric aggregates may arrive as strings; they are
 *  converted to plain numbers exactly once here. Degrades to all zeros
 *  on any failure — including the RPC not existing in an un-migrated
 *  environment — so browser achievements always evaluate. */
async function fetchTokenAchievementStats(
  supabase: SupabaseClient,
  userId: number
): Promise<AchievementTokenStats> {
  try {
    const { data, error } = await supabase.rpc(
      'agent_usage_achievement_stats',
      { p_user_id: userId }
    )

    if (error) {
      console.warn('[Achievements] Token stats lookup failed:', error.message)
      return EMPTY_ACHIEVEMENT_TOKEN_STATS
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row) return EMPTY_ACHIEVEMENT_TOKEN_STATS

    const tokenTotal = rpcNumber(row.total_tokens)
    const cacheTokens = rpcNumber(row.cache_tokens)
    return {
      tokenTotal,
      tokenOutput: rpcNumber(row.output_tokens),
      tokenBurnUsd: rpcNumber(row.cost_usd),
      tokenCachePercent: tokenTotal > 0 ? (cacheTokens / tokenTotal) * 100 : 0,
      tokenModels: rpcNumber(row.model_count),
      tokenAgents: rpcNumber(row.agent_count),
      tokenActiveDays: rpcNumber(row.active_days),
      tokenBestDayTokens: rpcNumber(row.best_day_tokens)
    }
  } catch (error) {
    console.warn('[Achievements] Token stats lookup failed:', error)
    return EMPTY_ACHIEVEMENT_TOKEN_STATS
  }
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
    const [events, scoreAndRank, tokens] = await Promise.all([
      fetchUserEvents(supabase, userId),
      fetchScoreAndRank(supabase, userId),
      fetchTokenAchievementStats(supabase, userId)
    ])
    if (events === null) return null

    const stats = computeAchievementStats(events, { ...scoreAndRank, tokens })

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

    if (unlockedAt.has(CHAMPION_ACHIEVEMENT_ID)) {
      await grantChampionPlate(supabase, userId)
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
