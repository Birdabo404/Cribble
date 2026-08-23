import {
  addExactDecimals,
  addExactIntegers,
  compareExactIntegers,
  exactDecimal,
  exactInteger
} from '@/lib/tokenLeaderboard'
import {
  addCalendarDays,
  calendarDateInTimeZone,
  calendarDaysBetween,
  normalizeIanaTimeZone
} from '@/lib/timeZone'

export const MAX_TOKEN_USAGE_RANGE_DAYS = 366
export const DEFAULT_TOKEN_USAGE_RANGE_DAYS = 30
export const TOKEN_USAGE_STALE_AFTER_HOURS = 24

const MAX_BREAKDOWN_ITEMS = 20
const MAX_CLIENT_SUMMARIES = 10

type NumericValue = number | string | null

export interface AgentUsageDailyRow {
  date: string
  client_id: string
  input_tokens: NumericValue
  output_tokens: NumericValue
  cache_creation_tokens: NumericValue
  cache_read_tokens: NumericValue
  total_tokens: NumericValue
  cost_usd: NumericValue
  agents: string[] | null
  models: string[] | null
  cli_version: string | null
  ingested_at: string
}

export interface AgentKeyStateRow {
  revoked_at: string | null
  expires_at?: string | null
}

export interface TokenUsageRange {
  from: string
  to: string
  timezone: string
  inclusiveDays: number
  dayBasis: 'source'
}

export type TokenUsageKeyStatus =
  | 'none'
  | 'active'
  | 'all-revoked'
  | 'expired'
  | 'inactive'

export interface TokenUsageKeySummary {
  status: TokenUsageKeyStatus
  total: number
  active: number
  revoked: number
  expired: number
}

export interface TokenUsageTotals {
  inputTokens: string
  outputTokens: string
  cacheCreationTokens: string
  cacheReadTokens: string
  totalTokens: string
  storedCostUsd: string
}

export interface TokenUsageTrendPoint extends TokenUsageTotals {
  date: string
}

export interface TokenUsageClientSummary {
  label: string
  activeDays: number
  totalTokens: string
  storedCostUsd: string
  lastSyncedAt: string | null
}

export interface TokenUsageBreakdownItem {
  name: string
  reportedActiveDays: number
  primaryModelDays?: number
}

export interface TokenUsageBreakdown {
  items: TokenUsageBreakdownItem[]
  reportedActiveDays: number
  complete: boolean
  truncated: boolean
  omittedItems: number
}

export interface TokenUsageResponse {
  success: true
  range: TokenUsageRange
  availableBounds: { from: string; to: string } | null
  keys: TokenUsageKeySummary
  totals: TokenUsageTotals
  dailyTrend: TokenUsageTrendPoint[]
  activeDays: number
  clients: {
    count: number
    items: TokenUsageClientSummary[]
    truncated: boolean
    omitted: number
  }
  breakdowns: {
    agents: TokenUsageBreakdown
    models: TokenUsageBreakdown
    primaryModelEligibleActiveDays: number
  }
  sync: {
    lastSyncedAt: string | null
    freshness: 'never' | 'healthy' | 'stale'
    staleAfterHours: number
  }
  hasData: boolean
  generatedAt: string
}

export type ParsedTokenUsageRange =
  | { ok: true; range: TokenUsageRange }
  | { ok: false; error: string }

const EMPTY_TOTALS: TokenUsageTotals = {
  inputTokens: '0',
  outputTokens: '0',
  cacheCreationTokens: '0',
  cacheReadTokens: '0',
  totalTokens: '0',
  storedCostUsd: '0'
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || year > 9999) return false
  const normalized = new Date(Date.UTC(year, month - 1, day))
  return (
    normalized.getUTCFullYear() === year &&
    normalized.getUTCMonth() === month - 1 &&
    normalized.getUTCDate() === day
  )
}

/**
 * Parse an inclusive source-date window. `from`/`to` are canonical; the
 * `since`/`until` aliases keep the read path compatible with the token
 * leaderboard vocabulary. The browser never supplies an account id.
 */
export function parseTokenUsageRange(
  searchParams: URLSearchParams,
  nowMs: number = Date.now()
): ParsedTokenUsageRange {
  const requestedTimezone = searchParams.get('timezone') ?? 'UTC'
  const timezone = normalizeIanaTimeZone(requestedTimezone)
  if (!timezone) {
    return { ok: false, error: 'Timezone must be a valid IANA timezone' }
  }

  const canonicalFrom = searchParams.get('from')
  const canonicalTo = searchParams.get('to')
  const aliasFrom = searchParams.get('since')
  const aliasTo = searchParams.get('until')

  if (
    (canonicalFrom && aliasFrom && canonicalFrom !== aliasFrom) ||
    (canonicalTo && aliasTo && canonicalTo !== aliasTo)
  ) {
    return { ok: false, error: 'Conflicting source-day range parameters' }
  }

  let from = canonicalFrom ?? aliasFrom
  let to = canonicalTo ?? aliasTo
  if ((from === null) !== (to === null)) {
    return { ok: false, error: 'Both from and to source dates are required' }
  }

  if (from === null && to === null) {
    to = calendarDateInTimeZone(nowMs, timezone)
    from = addCalendarDays(to, -(DEFAULT_TOKEN_USAGE_RANGE_DAYS - 1))
  }

  if (!from || !to || !validDateKey(from) || !validDateKey(to)) {
    return { ok: false, error: 'Source dates must use YYYY-MM-DD' }
  }

  const dayDifference = calendarDaysBetween(from, to)
  if (dayDifference < 0) {
    return { ok: false, error: 'from must be on or before to' }
  }
  if (dayDifference >= MAX_TOKEN_USAGE_RANGE_DAYS) {
    return {
      ok: false,
      error: `Source-day range cannot exceed ${MAX_TOKEN_USAGE_RANGE_DAYS} inclusive days`
    }
  }

  return {
    ok: true,
    range: {
      from,
      to,
      timezone,
      inclusiveDays: dayDifference + 1,
      dayBasis: 'source'
    }
  }
}

function addTotals(target: TokenUsageTotals, row: AgentUsageDailyRow): TokenUsageTotals {
  return {
    inputTokens: addExactIntegers(target.inputTokens, exactInteger(row.input_tokens)),
    outputTokens: addExactIntegers(target.outputTokens, exactInteger(row.output_tokens)),
    cacheCreationTokens: addExactIntegers(
      target.cacheCreationTokens,
      exactInteger(row.cache_creation_tokens)
    ),
    cacheReadTokens: addExactIntegers(
      target.cacheReadTokens,
      exactInteger(row.cache_read_tokens)
    ),
    totalTokens: addExactIntegers(target.totalTokens, exactInteger(row.total_tokens)),
    storedCostUsd: addExactDecimals(target.storedCostUsd, exactDecimal(row.cost_usd))
  }
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Usage labels are untrusted collector input. React escapes text, but
  // controls and very long glyph runs still make poor dashboard content.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!cleaned) return null
  return [...cleaned].slice(0, 80).join('')
}

function cleanNames(value: string[] | null): string[] {
  if (!Array.isArray(value)) return []
  const names = new Map<string, string>()
  value.forEach((item) => {
    const cleaned = cleanName(item)
    if (!cleaned) return
    const key = cleaned.toLocaleLowerCase('en-US')
    if (!names.has(key)) names.set(key, cleaned)
  })
  return [...names.values()]
}

function supportsOrderedPrimaryModel(version: string | null): boolean {
  const match = version?.trim().match(/^v?(\d+)\.(\d+)(?:\.|$)/i)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 1 || (major === 1 && minor >= 2)
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (!right || !Number.isFinite(Date.parse(right))) return left
  if (!left || !Number.isFinite(Date.parse(left))) return right
  return Date.parse(right) > Date.parse(left) ? right : left
}

function summarizeKeys(rows: AgentKeyStateRow[], nowMs: number): TokenUsageKeySummary {
  const revoked = rows.filter((row) => row.revoked_at !== null).length
  const expired = rows.filter(
    (row) =>
      row.revoked_at === null &&
      row.expires_at != null &&
      Number.isFinite(Date.parse(row.expires_at)) &&
      Date.parse(row.expires_at) <= nowMs
  ).length
  const active = rows.length - revoked - expired

  let status: TokenUsageKeyStatus
  if (rows.length === 0) status = 'none'
  else if (active > 0) status = 'active'
  else if (revoked === rows.length) status = 'all-revoked'
  else if (expired + revoked === rows.length && expired > 0 && revoked === 0) status = 'expired'
  else status = 'inactive'

  return { status, total: rows.length, active, revoked, expired }
}

function freshnessFor(lastSyncedAt: string | null, nowMs: number) {
  if (!lastSyncedAt || !Number.isFinite(Date.parse(lastSyncedAt))) return 'never' as const
  const age = Math.max(0, nowMs - Date.parse(lastSyncedAt))
  return age <= TOKEN_USAGE_STALE_AFTER_HOURS * 3_600_000
    ? ('healthy' as const)
    : ('stale' as const)
}

interface MutableClientSummary {
  activeDates: Set<string>
  totals: TokenUsageTotals
  lastSyncedAt: string | null
}

interface MutableBreakdownItem {
  name: string
  dates: Set<string>
  primaryDates: Set<string>
}

function breakdownResult(
  source: Map<string, MutableBreakdownItem>,
  coverageDates: Set<string>,
  complete: boolean,
  includePrimaryDays: boolean
): TokenUsageBreakdown {
  const allItems = [...source.values()]
    .map<TokenUsageBreakdownItem>((item) => ({
      name: item.name,
      reportedActiveDays: item.dates.size,
      ...(includePrimaryDays ? { primaryModelDays: item.primaryDates.size } : {})
    }))
    .sort(
      (left, right) =>
        right.reportedActiveDays - left.reportedActiveDays ||
        (right.primaryModelDays ?? 0) - (left.primaryModelDays ?? 0) ||
        left.name.localeCompare(right.name)
    )
  const items = allItems.slice(0, MAX_BREAKDOWN_ITEMS)
  return {
    items,
    reportedActiveDays: coverageDates.size,
    complete,
    truncated: allItems.length > items.length,
    omittedItems: Math.max(0, allItems.length - items.length)
  }
}

export function buildUserTokenUsage(input: {
  rows: AgentUsageDailyRow[]
  keys: AgentKeyStateRow[]
  range: TokenUsageRange
  availableBounds: { from: string; to: string } | null
  freshestSuccessfulIngestAt: string | null
  nowMs?: number
}): TokenUsageResponse {
  const nowMs = input.nowMs ?? Date.now()
  const totalsByDate = new Map<string, TokenUsageTotals>()
  const activeDates = new Set<string>()
  const clients = new Map<string, MutableClientSummary>()
  const agents = new Map<string, MutableBreakdownItem>()
  const models = new Map<string, MutableBreakdownItem>()
  const agentCoverageDates = new Set<string>()
  const modelCoverageDates = new Set<string>()
  const primaryModelEligibleDates = new Set<string>()
  let totals = { ...EMPTY_TOTALS }
  let agentRowsComplete = true
  let modelRowsComplete = true

  const breakdownItem = (
    target: Map<string, MutableBreakdownItem>,
    name: string
  ): MutableBreakdownItem => {
    const key = name.toLocaleLowerCase('en-US')
    const existing = target.get(key)
    if (existing) return existing
    const created = { name, dates: new Set<string>(), primaryDates: new Set<string>() }
    target.set(key, created)
    return created
  }

  input.rows.forEach((row) => {
    if (row.date < input.range.from || row.date > input.range.to || !validDateKey(row.date)) {
      return
    }

    activeDates.add(row.date)
    totals = addTotals(totals, row)
    totalsByDate.set(row.date, addTotals(totalsByDate.get(row.date) ?? { ...EMPTY_TOTALS }, row))

    const clientKey = typeof row.client_id === 'string' && row.client_id ? row.client_id : 'unknown'
    const client = clients.get(clientKey) ?? {
      activeDates: new Set<string>(),
      totals: { ...EMPTY_TOTALS },
      lastSyncedAt: null
    }
    client.activeDates.add(row.date)
    client.totals = addTotals(client.totals, row)
    client.lastSyncedAt = latestTimestamp(client.lastSyncedAt, row.ingested_at)
    clients.set(clientKey, client)

    const rowAgents = cleanNames(row.agents)
    if (rowAgents.length === 0) agentRowsComplete = false
    else agentCoverageDates.add(row.date)
    rowAgents.forEach((name) => breakdownItem(agents, name).dates.add(row.date))

    const rowModels = cleanNames(row.models)
    if (rowModels.length === 0) modelRowsComplete = false
    else modelCoverageDates.add(row.date)
    rowModels.forEach((name) => breakdownItem(models, name).dates.add(row.date))

    if (supportsOrderedPrimaryModel(row.cli_version)) {
      const primaryModel = cleanName(row.models?.[0])
      if (primaryModel) {
        primaryModelEligibleDates.add(row.date)
        breakdownItem(models, primaryModel).primaryDates.add(row.date)
      }
    }
  })

  const dailyTrend: TokenUsageTrendPoint[] = []
  for (let index = 0; index < input.range.inclusiveDays; index += 1) {
    const date = addCalendarDays(input.range.from, index)
    dailyTrend.push({ date, ...(totalsByDate.get(date) ?? { ...EMPTY_TOTALS }) })
  }

  const allClientItems = [...clients.entries()]
    .sort(
      ([leftId, left], [rightId, right]) =>
        compareExactIntegers(right.totals.totalTokens, left.totals.totalTokens) ||
        leftId.localeCompare(rightId)
    )
    .map<TokenUsageClientSummary>(([, client], index) => ({
      label: `Client ${String(index + 1).padStart(2, '0')}`,
      activeDays: client.activeDates.size,
      totalTokens: client.totals.totalTokens,
      storedCostUsd: client.totals.storedCostUsd,
      lastSyncedAt: client.lastSyncedAt
    }))
  const clientItems = allClientItems.slice(0, MAX_CLIENT_SUMMARIES)
  const lastSyncedAt = Number.isFinite(Date.parse(input.freshestSuccessfulIngestAt ?? ''))
    ? input.freshestSuccessfulIngestAt
    : null

  return {
    success: true,
    range: input.range,
    availableBounds: input.availableBounds,
    keys: summarizeKeys(input.keys, nowMs),
    totals,
    dailyTrend,
    activeDays: activeDates.size,
    clients: {
      count: allClientItems.length,
      items: clientItems,
      truncated: allClientItems.length > clientItems.length,
      omitted: Math.max(0, allClientItems.length - clientItems.length)
    },
    breakdowns: {
      agents: breakdownResult(
        agents,
        agentCoverageDates,
        input.rows.length === 0 || agentRowsComplete,
        false
      ),
      models: breakdownResult(
        models,
        modelCoverageDates,
        input.rows.length === 0 || modelRowsComplete,
        true
      ),
      primaryModelEligibleActiveDays: primaryModelEligibleDates.size
    },
    sync: {
      lastSyncedAt,
      freshness: freshnessFor(lastSyncedAt, nowMs),
      staleAfterHours: TOKEN_USAGE_STALE_AFTER_HOURS
    },
    hasData: input.rows.length > 0,
    generatedAt: new Date(nowMs).toISOString()
  }
}
