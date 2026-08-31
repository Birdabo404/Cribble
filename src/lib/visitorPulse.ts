// Client-safe visitor pulse parsing. Fail closed on malformed payloads.
// Local preview is an explicit source, never a guessed production count.

export type VisitorPulse = {
  live: number
  last12h: number
}

export const LOCAL_PREVIEW_PULSE: VisitorPulse = { live: 1, last12h: 1 }

function finiteCount(value: unknown): number | null {
  if (typeof value === 'bigint' && value >= BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value)
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

export function parseVisitorPulseJson(data: unknown): VisitorPulse | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const rec = data as Record<string, unknown>
  if (rec.success !== true) return null
  const live = finiteCount(rec.live)
  const last12h = finiteCount(rec.last12h)
  if (live === null || last12h === null) return null
  return { live, last12h }
}

export function visitorPulseResponse(opts: {
  configured: boolean
  pulse: VisitorPulse | null
}): { success: true; live: number; last12h: number; source: 'rpc' | 'local-preview' } | {
  success: false
  configured: boolean
} {
  if (!opts.configured) {
    return { success: true, ...LOCAL_PREVIEW_PULSE, source: 'local-preview' }
  }
  if (!opts.pulse) {
    return { success: false, configured: true }
  }
  return { success: true, ...opts.pulse, source: 'rpc' }
}

export type ArenaStatsPhase = 'closed' | 'open' | 'closing'

export function nextArenaStatsPhase(
  phase: ArenaStatsPhase,
  event: 'open' | 'dismiss' | 'settled'
): ArenaStatsPhase {
  if (event === 'open') return phase === 'closed' ? 'open' : phase
  if (event === 'dismiss') return phase === 'open' ? 'closing' : phase
  if (event === 'settled') return phase === 'closing' ? 'closed' : phase
  return phase
}
