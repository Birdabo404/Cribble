import { createHash } from 'node:crypto'
import { normalizeLegacyEventValues, type ScoreEventWithTimestamp } from './scoring'

// ============================================================================
// Cribble fraud detection engine — leaderboard & token abuse
//
// The ingest routes already enforce HARD bounds (per-event duration caps, a
// rolling 24h active-time/visit ceiling, a domain allowlist, per-record token
// caps, and freshness windows — see src/app/api/extension/sync/route.ts and
// src/app/api/agent/usage/route.ts). Those stop the crudest inflation, but a
// patient scripted client can still sit *just under* every hard cap and climb
// the board on fabricated activity, or backfill impossible token totals onto
// the Burn Board.
//
// This module is the DETECTION layer that runs over what actually landed in
// the database and looks for the behavioural signatures those hard caps can't
// express: pinning the daily ceiling day after day, physically impossible
// concurrency, visit padding, scripted uniform durations, and token totals
// that no real agent workload produces. Every function here is PURE and
// deterministic so the whole engine is unit-testable without a database — the
// service layer (fraudDetectionServer.ts) does the fetching, persistence and
// staff alerting.
//
// Design bias: favour precision over recall. A false positive drags an
// innocent user into a staff review queue and erodes trust in the board, so
// each detector keys on evidence that is hard to produce accidentally and
// carries the raw numbers it fired on in `details` for a human to audit.
// ============================================================================

/** Which leaderboard surface a signal is defending. */
export type FraudCategory = 'activity' | 'token'

/** Per-signal confidence, independent of the aggregate risk level. */
export type FraudSeverity = 'low' | 'medium' | 'high'

/** Aggregate risk band for a category's combined signals. */
export type FraudLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

export type FraudSignalCode =
  | 'activity_ceiling_pinning'
  | 'impossible_concurrency'
  | 'visit_flooding'
  | 'uniform_duration_padding'
  | 'token_impossible_rate'
  | 'token_spike'
  | 'token_cost_mismatch'

export interface FraudSignal {
  code: FraudSignalCode
  category: FraudCategory
  severity: FraudSeverity
  /** Points this signal contributes to the category's risk score (0-100). */
  score: number
  /** One-line human summary for the staff queue. */
  message: string
  /** Raw evidence the signal fired on, for a human to audit. */
  details: Record<string, unknown>
}

export interface FraudCategoryAssessment {
  category: FraudCategory
  /** Combined risk score for this category, 0-100. */
  riskScore: number
  level: FraudLevel
  signals: FraudSignal[]
  /** Stable dedupe key over the signal set — see fraudFingerprint. */
  fingerprint: string
}

export interface FraudAssessment {
  /** Every signal that fired, across all categories. */
  signals: FraudSignal[]
  /** One entry per category that produced at least one signal. */
  categories: FraudCategoryAssessment[]
}

/** A single day of self-reported agent token usage (agent_usage_daily-shaped). */
export interface TokenDay {
  /** Calendar date, "YYYY-MM-DD". */
  date: string
  totalTokens: number
  costUsd: number
}

export interface FraudAssessmentInput {
  /** events_raw rows for the user (heartbeat + visit rows). */
  activity: ScoreEventWithTimestamp[]
  /** agent_usage_daily rows for the user. */
  tokenDays: TokenDay[]
  now?: Date
  policy?: FraudPolicy
}

// The hard ceilings the ingest route enforces per rolling 24h window. Mirrored
// here (not imported — the route is a server entrypoint that constructs a
// Supabase client at module load) so the detectors can reason in the same
// units. Keep these in sync with MAX_CUMULATIVE_* in
// src/app/api/extension/sync/route.ts.
export const ACTIVITY_DAILY_ACTIVE_MS_CEILING = 16 * 60 * 60 * 1000
export const ACTIVITY_DAILY_VISIT_CEILING = 600

export interface FraudPolicy {
  /** A day at >= this fraction of the active-ms ceiling counts as "pinned". */
  ceilingPinRatio: number
  /** This many pinned days within the window trips the ceiling signal. */
  ceilingPinMinDays: number
  /** Per-day active_ms:wall-span ratio above which concurrency is impossible. */
  concurrencyRatio: number
  /** Ignore concurrency on days with less than this much active time (noise). */
  concurrencyMinActiveMs: number
  /** A day's visits at >= this fraction of the visit ceiling counts as a flood. */
  visitFloodRatio: number
  /** ...only when active_ms per visit is below this (the visit is empty padding). */
  visitFloodMaxActiveMsPerVisit: number
  /** This many flooded days trips the visit signal. */
  visitFloodMinDays: number
  /** Need at least this many active_time events before judging uniformity. */
  uniformMinEvents: number
  /** A single duration value covering >= this fraction of events is scripted. */
  uniformDominantRatio: number
  /** ...only counts when that repeated duration is at least this long (ms). */
  uniformMinDurationMs: number
  /** Sustained tokens/day above this ceiling is not a real agent workload. */
  tokenDailyCeiling: number
  /** This many days over the ceiling trips the impossible-rate signal. */
  tokenRateMinDays: number
  /** Need at least this many active token-days before judging a spike. */
  tokenSpikeMinDays: number
  /** A day >= this multiple of the median active day is a fabricated spike. */
  tokenSpikeMultiplier: number
  /** Ignore spikes below this absolute token count (noise). */
  tokenSpikeMinTokens: number
  /** Below this cost-per-million-tokens, huge token totals look fabricated. */
  tokenMinCostPerMillion: number
  /** ...only evaluated once total tokens exceed this (avoid tiny accounts). */
  tokenCostMismatchMinTokens: number
}

export const DEFAULT_FRAUD_POLICY: FraudPolicy = {
  ceilingPinRatio: 0.9,
  ceilingPinMinDays: 3,
  concurrencyRatio: 1.5,
  concurrencyMinActiveMs: 2 * 60 * 60 * 1000,
  visitFloodRatio: 0.8,
  visitFloodMaxActiveMsPerVisit: 2_000,
  visitFloodMinDays: 2,
  uniformMinEvents: 40,
  uniformDominantRatio: 0.8,
  uniformMinDurationMs: 60_000,
  tokenDailyCeiling: 2_000_000_000,
  tokenRateMinDays: 2,
  tokenSpikeMinDays: 5,
  tokenSpikeMultiplier: 25,
  tokenSpikeMinTokens: 50_000_000,
  tokenMinCostPerMillion: 0.01,
  tokenCostMismatchMinTokens: 500_000_000
}

/** Risk-score band thresholds, evaluated high to low. */
function levelForScore(score: number): FraudLevel {
  if (score >= 80) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 30) return 'medium'
  if (score >= 1) return 'low'
  return 'none'
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

interface ActivityDay {
  key: string
  activeMs: number
  visits: number
  firstTs: number
  lastTs: number
}

/**
 * Bucket heartbeat/visit rows into UTC calendar days. active_ms comes only
 * from heartbeat rows (visit rows carry unverified wall-clock time — see
 * normalizeLegacyEventValues), which is exactly what the score rewards, so
 * it is the honest unit to reason about.
 */
export function bucketActivityByDay(events: ScoreEventWithTimestamp[]): ActivityDay[] {
  const byDay = new Map<string, ActivityDay>()
  for (const event of events) {
    const ts = Date.parse(String(event.timestamp || ''))
    if (!Number.isFinite(ts)) continue
    const { activeMs, visits } = normalizeLegacyEventValues(event)
    if (activeMs === 0 && visits === 0) continue
    const key = utcDayKey(ts)
    const day = byDay.get(key)
    if (day) {
      day.activeMs += activeMs
      day.visits += visits
      day.firstTs = Math.min(day.firstTs, ts)
      day.lastTs = Math.max(day.lastTs, ts)
    } else {
      byDay.set(key, { key, activeMs, visits, firstTs: ts, lastTs: ts })
    }
  }
  return [...byDay.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
}

/**
 * Repeatedly banking at (or just under) the hard 24h active-time ceiling.
 * A genuine user does not log ~16 hours of VERIFIED active AI-tool time day
 * after day; a scripted client parked below the cap does. The more pinned
 * days, the higher the score.
 */
function detectCeilingPinning(days: ActivityDay[], policy: FraudPolicy): FraudSignal | null {
  const threshold = policy.ceilingPinRatio * ACTIVITY_DAILY_ACTIVE_MS_CEILING
  const pinnedDays = days.filter((day) => day.activeMs >= threshold)
  if (pinnedDays.length < policy.ceilingPinMinDays) return null

  const excess = pinnedDays.length - policy.ceilingPinMinDays
  const score = Math.min(60, 40 + excess * 6)
  const severity: FraudSeverity = pinnedDays.length >= policy.ceilingPinMinDays + 3 ? 'high' : 'medium'
  return {
    code: 'activity_ceiling_pinning',
    category: 'activity',
    severity,
    score,
    message: `Banked >=${Math.round(policy.ceilingPinRatio * 100)}% of the 16h/day active-time ceiling on ${pinnedDays.length} day(s)`,
    details: {
      pinnedDays: pinnedDays.length,
      thresholdMs: Math.round(threshold),
      ceilingMs: ACTIVITY_DAILY_ACTIVE_MS_CEILING,
      sampleDays: pinnedDays.slice(0, 5).map((day) => ({ day: day.key, activeMs: day.activeMs }))
    }
  }
}

/**
 * Physically impossible concurrency: within a single day the sum of VERIFIED
 * active time across tools exceeds the wall-clock span those events cover by
 * a large ratio. One person cannot be actively using tools for 20 hours
 * inside an 8-hour window — that is parallel forged heartbeat streams.
 */
function detectImpossibleConcurrency(days: ActivityDay[], policy: FraudPolicy): FraudSignal | null {
  let worst: { day: string; ratio: number; activeMs: number; wallMs: number } | null = null
  for (const day of days) {
    if (day.activeMs < policy.concurrencyMinActiveMs) continue
    const wallMs = Math.max(day.lastTs - day.firstTs, 1)
    const ratio = day.activeMs / wallMs
    if (ratio >= policy.concurrencyRatio && (!worst || ratio > worst.ratio)) {
      worst = { day: day.key, ratio, activeMs: day.activeMs, wallMs }
    }
  }
  if (!worst) return null

  // Ratio 1.5 -> 45, scaling up toward 60 as the impossibility grows.
  const score = Math.min(60, 45 + Math.round((worst.ratio - policy.concurrencyRatio) * 10))
  const severity: FraudSeverity = worst.ratio >= policy.concurrencyRatio + 1 ? 'high' : 'medium'
  return {
    code: 'impossible_concurrency',
    category: 'activity',
    severity,
    score,
    message: `Active time exceeded the wall-clock window ${worst.ratio.toFixed(2)}x on ${worst.day} — parallel activity streams`,
    details: {
      day: worst.day,
      ratio: Number(worst.ratio.toFixed(3)),
      activeMs: worst.activeMs,
      wallMs: worst.wallMs
    }
  }
}

/**
 * Visit padding: a visit scores a flat 40 points regardless of activity, so
 * spamming near-empty visits (near the daily visit ceiling, with almost no
 * active time behind them) inflates score without genuine usage.
 */
function detectVisitFlooding(days: ActivityDay[], policy: FraudPolicy): FraudSignal | null {
  const floodThreshold = policy.visitFloodRatio * ACTIVITY_DAILY_VISIT_CEILING
  const floodedDays = days.filter((day) => {
    if (day.visits < floodThreshold) return false
    const activeMsPerVisit = day.activeMs / day.visits
    return activeMsPerVisit < policy.visitFloodMaxActiveMsPerVisit
  })
  if (floodedDays.length < policy.visitFloodMinDays) return null

  const score = Math.min(45, 30 + (floodedDays.length - policy.visitFloodMinDays) * 5)
  return {
    code: 'visit_flooding',
    category: 'activity',
    severity: floodedDays.length >= policy.visitFloodMinDays + 2 ? 'high' : 'medium',
    score,
    message: `Flooded near-empty visits on ${floodedDays.length} day(s) — visit-bonus padding`,
    details: {
      floodedDays: floodedDays.length,
      visitCeiling: ACTIVITY_DAILY_VISIT_CEILING,
      sampleDays: floodedDays.slice(0, 5).map((day) => ({
        day: day.key,
        visits: day.visits,
        activeMs: day.activeMs
      }))
    }
  }
}

/**
 * Scripted uniform durations: a real coalesced heartbeat stream carries
 * varied active_ms values; a forged client tends to emit the same duration
 * over and over. When one duration value dominates a large sample of
 * substantial heartbeats, the stream is almost certainly generated.
 */
function detectUniformDurationPadding(
  events: ScoreEventWithTimestamp[],
  policy: FraudPolicy
): FraudSignal | null {
  const durations: number[] = []
  for (const event of events) {
    const { activeMs, visits } = normalizeLegacyEventValues(event)
    if (visits > 0 || activeMs <= 0) continue
    durations.push(activeMs)
  }
  if (durations.length < policy.uniformMinEvents) return null

  const counts = new Map<number, number>()
  for (const duration of durations) {
    counts.set(duration, (counts.get(duration) ?? 0) + 1)
  }
  let dominantValue = 0
  let dominantCount = 0
  for (const [value, count] of counts) {
    if (count > dominantCount) {
      dominantCount = count
      dominantValue = value
    }
  }

  const dominantRatio = dominantCount / durations.length
  if (dominantRatio < policy.uniformDominantRatio || dominantValue < policy.uniformMinDurationMs) {
    return null
  }

  const score = Math.min(40, 25 + Math.round((dominantRatio - policy.uniformDominantRatio) * 50))
  return {
    code: 'uniform_duration_padding',
    category: 'activity',
    severity: dominantRatio >= 0.95 ? 'high' : 'medium',
    score,
    message: `${Math.round(dominantRatio * 100)}% of active-time events share one duration (${dominantValue}ms) — scripted stream`,
    details: {
      events: durations.length,
      dominantValueMs: dominantValue,
      dominantCount,
      dominantRatio: Number(dominantRatio.toFixed(3)),
      distinctValues: counts.size
    }
  }
}

function activeTokenDays(tokenDays: TokenDay[]): TokenDay[] {
  return tokenDays.filter((day) => day.totalTokens > 0)
}

/**
 * Impossible token throughput: sustaining billions of tokens per day is not a
 * real coding-agent workload — it is a fabricated Burn Board total. The
 * ingest RPC caps a single record, but a client can still submit many capped
 * records; this looks at the daily aggregate that actually landed.
 */
function detectTokenImpossibleRate(days: TokenDay[], policy: FraudPolicy): FraudSignal | null {
  const overCeiling = days.filter((day) => day.totalTokens >= policy.tokenDailyCeiling)
  if (overCeiling.length < policy.tokenRateMinDays) return null

  const score = Math.min(60, 50 + (overCeiling.length - policy.tokenRateMinDays) * 4)
  return {
    code: 'token_impossible_rate',
    category: 'token',
    severity: 'high',
    score,
    message: `Reported >=${policy.tokenDailyCeiling.toLocaleString('en-US')} tokens/day on ${overCeiling.length} day(s)`,
    details: {
      days: overCeiling.length,
      ceiling: policy.tokenDailyCeiling,
      sampleDays: overCeiling
        .slice(0, 5)
        .map((day) => ({ day: day.date, totalTokens: day.totalTokens }))
    }
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Fabricated backfill spike: one day dwarfs the user's own typical day by a
 * huge multiple. Real usage grows and dips; a single day 25x the median is a
 * backdated dump engineered to jump the board.
 */
function detectTokenSpike(days: TokenDay[], policy: FraudPolicy): FraudSignal | null {
  if (days.length < policy.tokenSpikeMinDays) return null
  const totals = days.map((day) => day.totalTokens)
  const baseline = median(totals)
  if (baseline <= 0) return null

  let worst: { day: string; tokens: number; multiple: number } | null = null
  for (const day of days) {
    if (day.totalTokens < policy.tokenSpikeMinTokens) continue
    const multiple = day.totalTokens / baseline
    if (multiple >= policy.tokenSpikeMultiplier && (!worst || multiple > worst.multiple)) {
      worst = { day: day.date, tokens: day.totalTokens, multiple }
    }
  }
  if (!worst) return null

  const score = Math.min(35, 25 + Math.round((worst.multiple - policy.tokenSpikeMultiplier) / 10))
  return {
    code: 'token_spike',
    category: 'token',
    severity: worst.multiple >= policy.tokenSpikeMultiplier * 2 ? 'high' : 'medium',
    score,
    message: `One day reported ${worst.multiple.toFixed(0)}x the median token day — backfilled spike`,
    details: {
      day: worst.day,
      tokens: worst.tokens,
      medianTokens: Math.round(baseline),
      multiple: Number(worst.multiple.toFixed(2))
    }
  }
}

/**
 * Cost/token mismatch: the Burn Board orders by self-reported cost_usd, so a
 * cheater can post enormous token totals with near-zero cost (or vice versa)
 * to top the money ranking. A cost-per-million far below any real provider
 * price on a large total is fabricated.
 */
function detectTokenCostMismatch(days: TokenDay[], policy: FraudPolicy): FraudSignal | null {
  const totalTokens = days.reduce((sum, day) => sum + day.totalTokens, 0)
  const totalCost = days.reduce((sum, day) => sum + day.costUsd, 0)
  if (totalTokens < policy.tokenCostMismatchMinTokens) return null

  const costPerMillion = totalCost / (totalTokens / 1_000_000)
  if (costPerMillion >= policy.tokenMinCostPerMillion) return null

  return {
    code: 'token_cost_mismatch',
    category: 'token',
    severity: 'medium',
    score: 20,
    message: `Reported ${totalTokens.toLocaleString('en-US')} tokens for $${totalCost.toFixed(2)} — implausible cost/token`,
    details: {
      totalTokens,
      totalCostUsd: Number(totalCost.toFixed(6)),
      costPerMillion: Number(costPerMillion.toFixed(6)),
      minCostPerMillion: policy.tokenMinCostPerMillion
    }
  }
}

/** Run every detector and return the signals that fired, in a stable order. */
export function evaluateFraudSignals(input: FraudAssessmentInput): FraudSignal[] {
  const policy = input.policy ?? DEFAULT_FRAUD_POLICY
  const days = bucketActivityByDay(input.activity)
  const tokenDays = activeTokenDays(input.tokenDays)

  const signals: (FraudSignal | null)[] = [
    detectCeilingPinning(days, policy),
    detectImpossibleConcurrency(days, policy),
    detectVisitFlooding(days, policy),
    detectUniformDurationPadding(input.activity, policy),
    detectTokenImpossibleRate(tokenDays, policy),
    detectTokenSpike(tokenDays, policy),
    detectTokenCostMismatch(tokenDays, policy)
  ]
  return signals.filter((signal): signal is FraudSignal => signal !== null)
}

/**
 * Stable dedupe key for a category's signal set: the same set of signal codes
 * fingerprints identically so a recurring pattern updates one flag instead of
 * spawning duplicates, while a materially different set (a new code appears)
 * produces a fresh fingerprint. Mirrors the leaderboard-integrity and
 * team-tripwire dedupe approach.
 */
export function fraudFingerprint(category: FraudCategory, signals: FraudSignal[]): string {
  const codes = signals
    .map((signal) => signal.code)
    .sort()
    .join(',')
  const hash = createHash('sha256').update(`${category}:${codes}`).digest('hex').slice(0, 16)
  return `fraud_${category}_${hash}`
}

function summarizeCategory(
  category: FraudCategory,
  signals: FraudSignal[]
): FraudCategoryAssessment | null {
  const categorySignals = signals.filter((signal) => signal.category === category)
  if (categorySignals.length === 0) return null

  const riskScore = Math.min(
    100,
    categorySignals.reduce((sum, signal) => sum + signal.score, 0)
  )
  return {
    category,
    riskScore,
    level: levelForScore(riskScore),
    signals: categorySignals,
    fingerprint: fraudFingerprint(category, categorySignals)
  }
}

/**
 * Full assessment for one user: every signal that fired, plus a per-category
 * roll-up (score + level + dedupe fingerprint) for the categories that
 * produced anything. Categories with no signals are omitted entirely.
 */
export function assessUserFraud(input: FraudAssessmentInput): FraudAssessment {
  const signals = evaluateFraudSignals(input)
  const categories = (['activity', 'token'] as FraudCategory[])
    .map((category) => summarizeCategory(category, signals))
    .filter((assessment): assessment is FraudCategoryAssessment => assessment !== null)
  return { signals, categories }
}
