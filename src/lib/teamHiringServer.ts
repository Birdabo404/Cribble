import type { SupabaseClient } from '@supabase/supabase-js'
import type { PilotHiringFacts } from '@/lib/teamHiring'

// The I/O half of the hiring bar: batch facts for stamping pilots
// (applicant queue, apply modal). Service-role client required —
// agent_usage_sharing and the burn RPC are service-role only (043/047).
// Failure contract: the score read throws (a wrong MET/BELOW is worse
// than the caller's usual thrown-read 500), while consent and burn
// reads degrade to burnVerified=false — burn stamps are display-only
// and must never sink a route, and UNVERIFIED is the honest fallback.

// Same known-compatibility signal teamBoardServer checks: PostgREST
// resolves functions by argument names, so a not-yet-deployed migration
// 047 answers PGRST202/42883 to the five-argument call.
function missingLeaderboardFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
}

// Row shapes for the reads below (client has no generated DB types).
interface ScoreRow {
  user_id: number | string
  total_score: number | string | null
}

interface SharingRow {
  user_id: number | string
  leaderboard_enabled: boolean
  consent_version: number | string | null
}

interface BurnRpcRow {
  user_id: number | string
  total_tokens: number | string | null
  cost_usd: number | string | null
}

// MIRROR OF THE RPC'S CONSENT GATE — this predicate must stay in
// lockstep with the enabled_users CTE inside the CURRENT definition of
// public.agent_token_leaderboard (migrations/047_agent_usage_integrity.sql,
// which superseded migrations/043_agent_token_leaderboard.sql):
// leaderboard_enabled AND consent_version >= 2. The RPC already filters
// non-consented pilots out of its own result; the mirror exists so those
// pilots stamp UNVERIFIED instead of being mistaken for zero usage. If
// the gate ever moves (say consent v3), change BOTH sides —
// teamHiringServer.test.ts parses the gate out of the migration SQL and
// fails when the two drift.
export const BURN_CONSENT_MIN_VERSION = 2

export function hasBurnBoardConsent(row: {
  leaderboard_enabled: boolean
  consent_version: number | string | null
}): boolean {
  return (
    row.leaderboard_enabled &&
    Number(row.consent_version ?? 0) >= BURN_CONSENT_MIN_VERSION
  )
}

interface BurnFacts {
  totalTokens: number
  burnUsd: number
}

// The all-time aggregate is FULL-POPULATION — the RPC scans every
// opted-in pilot's usage no matter how few ids the caller wants — so
// one successful run is shared across requests for a minute (the
// directory route's REVALIDATE_SECONDS cadence). Trade-off: burn stamps
// may be up to a minute stale (a pilot's fresh usage, or a brand-new
// opt-in, shows within 60s), which is fine for a display-only signal.
// Consent stays live: the per-request agent_usage_sharing read is cheap
// and uncached, so a revoked pilot reads UNVERIFIED immediately even
// while their row lingers in the cached aggregate. Failures are never
// cached — they degrade this request to burnVerified=false and the next
// request retries.
const BURN_AGGREGATE_TTL_MS = 60_000

let burnAggregateCache: { byUser: Map<number, BurnFacts>; expiresAt: number } | null = null

/** Test hook: the cache is module state, so specs clear it between runs. */
export function clearBurnAggregateCache(): void {
  burnAggregateCache = null
}

/** The population-wide all-time burn aggregate, from cache when fresh.
 *  Null means this run is unreadable (RPC missing, failed or threw) —
 *  callers degrade to burnVerified=false and nothing is cached. */
async function loadBurnAggregate(
  supabase: SupabaseClient
): Promise<Map<number, BurnFacts> | null> {
  if (burnAggregateCache && Date.now() < burnAggregateCache.expiresAt) {
    return burnAggregateCache.byUser
  }

  try {
    // Null bounds mean no window (fetchBurnByUser's pattern): all-time.
    const { data, error } = await supabase.rpc('agent_token_leaderboard', {
      p_since: null,
      p_until: null,
      p_timezone: 'UTC',
      p_since_at: null,
      p_until_at: null
    })

    if (error) {
      if (missingLeaderboardFunction(error)) {
        console.warn('[Team Hiring] Burn RPC not deployed yet:', error.message)
      } else {
        console.warn('[Team Hiring] Burn aggregate failed:', error.message)
      }
      return null
    }

    const byUser = new Map<number, BurnFacts>()
    for (const row of (data ?? []) as BurnRpcRow[]) {
      byUser.set(Math.round(Number(row.user_id)), {
        totalTokens: Number(row.total_tokens ?? 0),
        burnUsd: Number(row.cost_usd ?? 0)
      })
    }
    burnAggregateCache = { byUser, expiresAt: Date.now() + BURN_AGGREGATE_TTL_MS }
    return byUser
  } catch (err) {
    console.warn('[Team Hiring] Burn aggregate unavailable:', err)
    return null
  }
}

/**
 * Hiring-bar facts for each requested pilot. Every id gets an entry:
 * totalScore from user_scores (missing row = 0), and burn facts only
 * for pilots who opted into the burn board — leaderboard_enabled AND
 * consent_version >= 2, the same gate the RPC enforces internally,
 * mirrored here so a non-consented pilot reads UNVERIFIED instead of
 * being mistaken for zero usage. A consented pilot absent from the RPC
 * result HAS zero usage (the aggregate only emits rows with facts).
 * Facts are plain numbers: stamps are threshold comparisons against
 * clamped bars (<= 1e15), so exact-string arithmetic buys nothing here.
 */
export async function fetchPilotHiringFacts(
  supabase: SupabaseClient,
  userIds: number[]
): Promise<Map<number, PilotHiringFacts>> {
  const facts = new Map<number, PilotHiringFacts>()
  if (userIds.length === 0) return facts

  const { data: scoreData, error: scoreError } = await supabase
    .from('user_scores')
    .select('user_id, total_score')
    .in('user_id', userIds)

  if (scoreError) {
    throw new Error(`Hiring-facts score read failed: ${scoreError.message}`)
  }

  const scoreByUser = new Map<number, number>()
  for (const row of (scoreData ?? []) as ScoreRow[]) {
    scoreByUser.set(
      Math.round(Number(row.user_id)),
      Math.round(Number(row.total_score ?? 0))
    )
  }

  const consented = new Set<number>()
  let burnReadable = true
  const { data: sharingData, error: sharingError } = await supabase
    .from('agent_usage_sharing')
    .select('user_id, leaderboard_enabled, consent_version')
    .in('user_id', userIds)

  if (sharingError) {
    console.warn('[Team Hiring] Consent read failed:', sharingError.message)
    burnReadable = false
  } else {
    for (const row of (sharingData ?? []) as SharingRow[]) {
      if (hasBurnBoardConsent(row)) {
        consented.add(Math.round(Number(row.user_id)))
      }
    }
  }

  // All-time burn from the same consent-gated RPC the boards read,
  // through the 60s module cache above. Skipped when nobody consented:
  // the aggregate scans every opted-in pilot's usage, so there is no
  // cheap per-id variant to call instead. The cached map is
  // population-wide; the consent set fetched THIS request decides who
  // may read from it below.
  let burnByUser = new Map<number, BurnFacts>()
  if (burnReadable && consented.size > 0) {
    const aggregate = await loadBurnAggregate(supabase)
    if (aggregate) {
      burnByUser = aggregate
    } else {
      burnReadable = false
    }
  }

  for (const userId of userIds) {
    const verified = burnReadable && consented.has(userId)
    const burn = verified ? burnByUser.get(userId) : undefined
    facts.set(userId, {
      totalScore: scoreByUser.get(userId) ?? 0,
      burnVerified: verified,
      totalTokens: verified ? burn?.totalTokens ?? 0 : null,
      burnUsd: verified ? burn?.burnUsd ?? 0 : null
    })
  }

  return facts
}
