import { z } from 'zod'

// Pure logic for the team HIRING BAR — the published thresholds every
// APPLY surface stamps pilots against. The dashboard PATCH validates
// bar writes with the schema below, and the apply modal, directory
// cards and applicant queue all render evaluateHiringBar's stamps
// verbatim, so a pilot can never see two different verdicts for the
// same bar. No I/O here — same contract as teamApplications; the facts
// come from fetchPilotHiringFacts (teamHiringServer).

/** team_affiliations.role (migration 066): 'owner' is a signed member
 *  holding the franchise's command-deck keys. Distinct from site-staff
 *  users.staff_role — a team owner commands one roster, never the site. */
export type TeamRole = 'member' | 'owner'

/** The published bar, mirroring users.team_req_min_*. NULL = that
 *  metric is off; a bar with every metric off is no bar at all. */
export interface HiringBar {
  minScore: number | null
  minTokens: number | null
  minBurnUsd: number | null
}

export function hasBar(bar: HiringBar): boolean {
  return bar.minScore !== null || bar.minTokens !== null || bar.minBurnUsd !== null
}

/** The users.team_req_* trio as any bar-reading route receives it.
 *  BIGINT/NUMERIC ride the wire as number or string depending on the
 *  driver; the union is wide so every route's row shape fits. */
export interface HiringBarColumns {
  team_req_min_score: number | string | null | undefined
  team_req_min_tokens: number | string | null | undefined
  team_req_min_burn_usd: number | string | null | undefined
}

function columnThreshold(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** The ONE coercion from stored bar columns to HiringBar, shared by the
 *  dashboard deck, the apply target and the public directory so their
 *  verdicts can never drift. NULL, zero, negatives and anything
 *  non-numeric all read "metric off" — hiringBarSchema never writes
 *  such values, so whatever carries them is not a bar. Legitimate
 *  thresholds are clamped to <= 1e15, inside JS safe-integer range,
 *  so Number() round-trips stored strings exactly. */
export function hiringBarFromColumns(row: HiringBarColumns): HiringBar {
  return {
    minScore: columnThreshold(row.team_req_min_score),
    minTokens: columnThreshold(row.team_req_min_tokens),
    minBurnUsd: columnThreshold(row.team_req_min_burn_usd)
  }
}

/** Thresholds are whole numbers >= 1 — "at least 0" would gate nothing,
 *  which NULL (metric off) already says. */
export const HIRING_BAR_MIN = 1

/** Score/token ceilings sit at 1e15: comfortably inside JS safe-integer
 *  range (~9e15) so values survive a JSON round-trip exactly, inside the
 *  BIGINT columns, and still an absurd flex — single usage writes are
 *  capped at 1e12 tokens (047), so no real pilot approaches 1Q. */
export const HIRING_BAR_MAX_SCORE = 1_000_000_000_000_000
export const HIRING_BAR_MAX_TOKENS = 1_000_000_000_000_000

/** Burn is whole USD, capped at $1B — cost facts cap at $1M per write
 *  (047), so this is unreachable headroom, not a real limit. */
export const HIRING_BAR_MAX_BURN_USD = 1_000_000_000

const thresholdSchema = (max: number) =>
  z.number().int().min(HIRING_BAR_MIN).max(max).nullable()

/** Wire shape for bar writes — the dashboard PATCH composes this into
 *  its body schema so route clamps and lib semantics can never drift. */
export const hiringBarSchema = z.object({
  minScore: thresholdSchema(HIRING_BAR_MAX_SCORE),
  minTokens: thresholdSchema(HIRING_BAR_MAX_TOKENS),
  minBurnUsd: thresholdSchema(HIRING_BAR_MAX_BURN_USD)
})

/** What the stamping surfaces know about one pilot. burnVerified=false
 *  means the pilot has not opted into the burn board (agent_usage_sharing
 *  consent v2, enforced inside the RPC), so their tokens/burn are
 *  unknowable — those fields ride as null and their stamps read
 *  'unverified', never 'missed'. Opting in is how a pilot proves burn.
 *  totalScore is always known (user_scores; a missing row reads 0). */
export interface PilotHiringFacts {
  totalScore: number
  burnVerified: boolean
  totalTokens: number | null
  burnUsd: number | null
}

export type MetricStamp = 'met' | 'missed' | 'unverified'

/** Per-metric stamps (null = that metric is off) plus the roll-up.
 *  'unverified' only ever applies to tokens/burnUsd — score is always
 *  known. Overall: 'no-bar' when nothing is on, 'below' when any
 *  enabled metric is missed (a definite fail outranks an unknown),
 *  'partial' when nothing missed but something unverified, 'clears'
 *  when every enabled metric is met. */
export type BarStamp = {
  score: MetricStamp | null
  tokens: MetricStamp | null
  burnUsd: MetricStamp | null
  overall: 'clears' | 'below' | 'partial' | 'no-bar'
}

function stampScore(min: number | null, totalScore: number): MetricStamp | null {
  if (min === null) return null
  return totalScore >= min ? 'met' : 'missed'
}

/** Burn metrics key off burnVerified, not the nullable values — an
 *  unconsented pilot stamps 'unverified' even if a stray number were
 *  present. A verified pilot's missing value reads as zero usage. */
function stampBurnMetric(
  min: number | null,
  verified: boolean,
  value: number | null
): MetricStamp | null {
  if (min === null) return null
  if (!verified) return 'unverified'
  return (value ?? 0) >= min ? 'met' : 'missed'
}

/** Boundary equality counts as met throughout: the bar reads "at least". */
export function evaluateHiringBar(bar: HiringBar, facts: PilotHiringFacts): BarStamp {
  const score = stampScore(bar.minScore, facts.totalScore)
  const tokens = stampBurnMetric(bar.minTokens, facts.burnVerified, facts.totalTokens)
  const burnUsd = stampBurnMetric(bar.minBurnUsd, facts.burnVerified, facts.burnUsd)

  let anyEnabled = false
  let anyMissed = false
  let anyUnverified = false
  for (const stamp of [score, tokens, burnUsd]) {
    if (stamp === null) continue
    anyEnabled = true
    switch (stamp) {
      case 'met':
        break
      case 'missed':
        anyMissed = true
        break
      case 'unverified':
        anyUnverified = true
        break
      default: {
        const exhaustive: never = stamp
        return exhaustive
      }
    }
  }

  const overall = !anyEnabled
    ? 'no-bar'
    : anyMissed
      ? 'below'
      : anyUnverified
        ? 'partial'
        : 'clears'

  return { score, tokens, burnUsd, overall }
}

/** Compact chip amount: '500', '1.5K', '50K', '100M', '1B'. Truncates
 *  (never rounds up) so a value under a unit boundary can't display as
 *  the boundary, and keeps at most three significant digits — the same
 *  digit-slicing as the burn board's formatCompactTokenCount, but with
 *  uppercase K because chips are all-caps copy. Inputs are validated
 *  bar thresholds (safe integers <= 1e15), so String() digits are exact. */
function compactAmount(value: number): string {
  const digits = String(Math.trunc(value))
  if (digits.length <= 3) return digits
  const units = ['', 'K', 'M', 'B', 'T', 'Q']
  const unit = Math.floor((digits.length - 1) / 3)
  const wholeDigits = digits.length - unit * 3
  const fraction = digits
    .slice(wholeDigits, wholeDigits + Math.max(0, 3 - wholeDigits))
    .replace(/0+$/, '')
  return `${digits.slice(0, wholeDigits)}${fraction ? `.${fraction}` : ''}${units[unit]}`
}

export function formatHiringScore(value: number): string {
  return compactAmount(value)
}

export function formatHiringTokens(value: number): string {
  return compactAmount(value)
}

export function formatHiringUsd(value: number): string {
  return `$${compactAmount(value)}`
}

/** The bar as ordered chip copy — e.g. ['50K GS', '100M TOKENS',
 *  '$1K BURN'] — skipping metrics that are off. Directory cards and
 *  the apply modal render these verbatim so the bar reads identically
 *  everywhere. */
export function hiringBarChips(bar: HiringBar): string[] {
  const chips: string[] = []
  if (bar.minScore !== null) chips.push(`${formatHiringScore(bar.minScore)} GS`)
  if (bar.minTokens !== null) chips.push(`${formatHiringTokens(bar.minTokens)} TOKENS`)
  if (bar.minBurnUsd !== null) chips.push(`${formatHiringUsd(bar.minBurnUsd)} BURN`)
  return chips
}
