import type { SeasonState } from '@/lib/season'

export type TokenBoardWindowId = 'season' | '7d' | 'all'

export interface TokenBoardWindow {
  id: TokenBoardWindowId
  label: string
  since: string | null
  until: string | null
}

export interface TokenLeaderboardRpcRow {
  user_id: number | string
  username: string | null
  display_name: string | null
  profile_image: string | null
  input_tokens: number | string | null
  output_tokens: number | string | null
  cache_creation_tokens: number | string | null
  cache_read_tokens: number | string | null
  total_tokens: number | string | null
  cost_usd: number | string | null
  active_days: number | string | null
  client_count: number | string | null
  agents: string[] | null
  models: string[] | null
  last_synced_at: string | null
}

export type TokenPersonaTone = 'danger' | 'hot' | 'cache' | 'output' | 'neutral'

export interface TokenPersona {
  id:
    | 'financial-incident'
    | 'whale'
    | 'cache-goblin'
    | 'output-demon'
    | 'model-hopper'
    | 'raw-dogger'
    | 'token-furnace'
    | 'wallet-on-fire'
    | 'small-fire'
  label: string
  tone: TokenPersonaTone
}

export interface TokenBoardRow {
  userId: number
  rank: number
  username: string
  displayName: string
  profileImage: string | null
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  cacheTokens: number
  totalTokens: number
  burnUsd: number
  cachePercent: number
  activeDays: number
  clientCount: number
  agents: string[]
  models: string[]
  lastSyncedAt: string | null
  provisional: boolean
  persona: TokenPersona
}

export interface TokenBoardTotals {
  pilots: number
  totalTokens: number
  burnUsd: number
  cachePercent: number
  topBurnUsd: number
}

export interface TokenBoard {
  rows: TokenBoardRow[]
  totals: TokenBoardTotals
}

const DAY_MS = 86_400_000

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function parseTokenBoardWindow(value: string | null): TokenBoardWindowId | null {
  if (value === null || value === '' || value === 'season') return 'season'
  if (value === '7d' || value === 'all') return value
  return null
}

export function resolveTokenBoardWindow(
  id: TokenBoardWindowId,
  season: SeasonState,
  nowMs: number = Date.now()
): TokenBoardWindow {
  if (id === 'all') {
    return { id, label: 'ALL TIME', since: null, until: null }
  }

  if (id === '7d') {
    return {
      id,
      label: 'LAST 7 DAYS',
      since: utcDate(nowMs - 6 * DAY_MS),
      until: utcDate(nowMs)
    }
  }

  if (season.current) {
    return {
      id,
      label: `SEASON ${season.current.number}`,
      since: utcDate(Date.parse(season.current.startsAt)),
      // Season end timestamps are exclusive. Subtract one millisecond so
      // a midnight boundary does not accidentally count the next season.
      until: utcDate(Date.parse(season.current.endsAt) - 1)
    }
  }

  // A brand-new calendar has no season window to rank. Preserve the
  // requested identity for the UI, but return an intentionally empty range.
  return { id, label: 'NO SEASON YET', since: '9999-12-31', until: '9999-12-31' }
}

function finiteNumber(value: number | string | null): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function cleanMix(value: string[] | null): string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
}

export function tokenPersona(input: {
  burnUsd: number
  totalTokens: number
  outputTokens: number
  cachePercent: number
  modelCount: number
}): TokenPersona {
  const { burnUsd, totalTokens, outputTokens, cachePercent, modelCount } = input
  const outputPercent = totalTokens > 0 ? (outputTokens / totalTokens) * 100 : 0

  if (burnUsd >= 500) {
    return { id: 'financial-incident', label: 'FINANCIAL INCIDENT', tone: 'danger' }
  }
  if (burnUsd >= 100) return { id: 'whale', label: 'WHALE', tone: 'danger' }
  if (cachePercent >= 90 && totalTokens >= 10_000_000) {
    return { id: 'cache-goblin', label: 'CACHE GOBLIN', tone: 'cache' }
  }
  if (outputTokens >= 5_000_000 || (outputPercent >= 10 && totalTokens >= 1_000_000)) {
    return { id: 'output-demon', label: 'OUTPUT DEMON', tone: 'output' }
  }
  if (modelCount >= 5) {
    return { id: 'model-hopper', label: 'MODEL HOPPER', tone: 'neutral' }
  }
  if (cachePercent <= 10 && totalTokens >= 10_000_000) {
    return { id: 'raw-dogger', label: 'RAW DOGGER', tone: 'hot' }
  }
  if (totalTokens >= 50_000_000) {
    return { id: 'token-furnace', label: 'TOKEN FURNACE', tone: 'hot' }
  }
  if (burnUsd >= 25) {
    return { id: 'wallet-on-fire', label: 'WALLET ON FIRE', tone: 'hot' }
  }
  return { id: 'small-fire', label: 'SMALL FIRE', tone: 'neutral' }
}

export function buildTokenBoard(source: TokenLeaderboardRpcRow[]): TokenBoard {
  const unranked = source.map((item) => {
    const userId = Math.round(finiteNumber(item.user_id))
    const inputTokens = Math.round(finiteNumber(item.input_tokens))
    const outputTokens = Math.round(finiteNumber(item.output_tokens))
    const cacheCreationTokens = Math.round(finiteNumber(item.cache_creation_tokens))
    const cacheReadTokens = Math.round(finiteNumber(item.cache_read_tokens))
    const cacheTokens = cacheCreationTokens + cacheReadTokens
    const totalTokens = Math.round(finiteNumber(item.total_tokens))
    const burnUsd = finiteNumber(item.cost_usd)
    const activeDays = Math.round(finiteNumber(item.active_days))
    const clientCount = Math.round(finiteNumber(item.client_count))
    const models = cleanMix(item.models)
    const agents = cleanMix(item.agents)
    const cachePercent =
      totalTokens > 0 ? Math.max(0, Math.min(100, Math.round((cacheTokens / totalTokens) * 100))) : 0
    const username = item.username?.trim() || `User${userId}`

    return {
      userId,
      username,
      displayName: item.display_name?.trim() || username,
      profileImage: item.profile_image,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cacheTokens,
      totalTokens,
      burnUsd,
      cachePercent,
      activeDays,
      clientCount,
      agents,
      models,
      lastSyncedAt: item.last_synced_at,
      provisional: activeDays < 3,
      persona: tokenPersona({
        burnUsd,
        totalTokens,
        outputTokens,
        cachePercent,
        modelCount: models.length
      })
    }
  })

  const rows: TokenBoardRow[] = unranked
    .filter((row) => row.userId > 0 && row.totalTokens > 0)
    .sort(
      (a, b) =>
        b.burnUsd - a.burnUsd ||
        b.totalTokens - a.totalTokens ||
        b.outputTokens - a.outputTokens ||
        a.userId - b.userId
    )
    .map((row, index) => ({ ...row, rank: index + 1 }))

  const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0)
  const cacheTokens = rows.reduce((sum, row) => sum + row.cacheTokens, 0)

  return {
    rows,
    totals: {
      pilots: rows.length,
      totalTokens,
      burnUsd: rows.reduce((sum, row) => sum + row.burnUsd, 0),
      cachePercent: totalTokens > 0 ? Math.round((cacheTokens / totalTokens) * 100) : 0,
      topBurnUsd: rows[0]?.burnUsd ?? 0
    }
  }
}
