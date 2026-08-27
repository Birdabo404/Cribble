import type { SeasonState } from '@/lib/season'
import { addCalendarDays, calendarDateInTimeZone } from '@/lib/timeZone'

export type TokenBoardWindowId = 'season' | '7d' | 'all'

export interface TokenBoardWindow {
  id: TokenBoardWindowId
  label: string
  since: string | null
  until: string | null
  timezone: string
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
  top_agent?: string | null
  top_agent_days?: number | string | null
  top_model?: string | null
  top_model_days?: number | string | null
  top_agent_tokens?: number | string | null
  top_model_tokens?: number | string | null
  agent_breakdown?: Array<{ name?: unknown; totalTokens?: unknown }> | null
  model_breakdown?: Array<{ name?: unknown; totalTokens?: unknown }> | null
  agent_breakdown_complete?: boolean | null
  model_breakdown_complete?: boolean | null
  timezone_complete?: boolean | null
}

export type TokenPersonaTone = 'danger' | 'hot' | 'cache' | 'output' | 'neutral'

export interface TokenPersona {
  id:
    | 'compute-baron'
    | 'audit-risk'
    | 'payroll-expense'
    | 'financial-incident'
    | 'whale'
    | 'priority-lane'
    | 'free-tier-freak'
    | 'groundhog-day'
    | 'cache-goblin'
    | 'yapper'
    | 'output-demon'
    | 'token-black-hole'
    | 'commitment-issues'
    | 'model-hopper'
    | 'botnet'
    | 'zookeeper'
    | 'raw-dogger'
    | 'ride-or-die'
    | 'touch-grass'
    | 'token-furnace'
    | 'wallet-on-fire'
    | 'small-fire'
  label: string
  tone: TokenPersonaTone
}

/** The affiliate mini-logo payload, same wire shape the season board's
 *  rows carry (assembled from getAffiliatedTeamsBatch). */
export interface TokenBoardTeam {
  username: string
  name: string
  logo: string | null
}

export interface TokenBoardRow {
  userId: number
  rank: number
  username: string
  displayName: string
  profileImage: string | null
  /** Raw subscription tier for the read-time isProTier gate. Hydrated by
   *  the route after ranking; buildTokenBoard itself never reads the DB. */
  tier: string | null
  /** Active affiliation to an approved team, or null. Route-hydrated. */
  team: TokenBoardTeam | null
  inputTokens: string
  outputTokens: string
  cacheCreationTokens: string
  cacheReadTokens: string
  cacheTokens: string
  totalTokens: string
  burnUsd: string
  cachePercent: number
  activeDays: number
  clientCount: number
  agents: string[]
  models: string[]
  lastSyncedAt: string | null
  topAgent: string | null
  topAgentDays: number
  topModel: string | null
  topModelDays: number
  topAgentTokens: string
  topModelTokens: string
  agentBreakdown: TokenBreakdownItem[]
  modelBreakdown: TokenBreakdownItem[]
  agentBreakdownComplete: boolean
  modelBreakdownComplete: boolean
  timezoneComplete: boolean
  provisional: boolean
  persona: TokenPersona
}

export interface TokenBoardTotals {
  pilots: number
  totalTokens: string
  burnUsd: string
  cachePercent: number
  topBurnUsd: string
}

export interface TokenBreakdownItem {
  name: string
  totalTokens: string
}

export interface TokenBoard {
  rows: TokenBoardRow[]
  totals: TokenBoardTotals
}

export function parseTokenBoardWindow(value: string | null): TokenBoardWindowId | null {
  if (value === null || value === '' || value === 'season') return 'season'
  if (value === '7d' || value === 'all') return value
  return null
}

export function resolveTokenBoardWindow(
  id: TokenBoardWindowId,
  season: SeasonState,
  nowMs: number = Date.now(),
  timezone: string = 'UTC'
): TokenBoardWindow {
  if (id === 'all') {
    return { id, label: 'ALL TIME', since: null, until: null, timezone }
  }

  if (id === '7d') {
    const today = calendarDateInTimeZone(nowMs, timezone)
    return {
      id,
      label: 'LAST 7 DAYS',
      since: addCalendarDays(today, -6),
      until: today,
      timezone
    }
  }

  if (season.current) {
    return {
      id,
      label: `SEASON ${season.current.number}`,
      since: calendarDateInTimeZone(Date.parse(season.current.startsAt), timezone),
      // Season end timestamps are exclusive. Subtract one millisecond so
      // a midnight boundary does not accidentally count the next season.
      until: calendarDateInTimeZone(Date.parse(season.current.endsAt) - 1, timezone),
      timezone
    }
  }

  // A brand-new calendar has no season window to rank. Preserve the
  // requested identity for the UI, but return an intentionally empty range.
  return {
    id,
    label: 'NO SEASON YET',
    since: '9999-12-31',
    until: '9999-12-31',
    timezone
  }
}

function finiteNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function exactInteger(value: number | string | null | undefined): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return '0'
    return String(value)
  }

  const candidate = value?.trim() ?? ''
  const match = candidate.match(/^(\d+)(?:\.0+)?$/)
  if (!match) return '0'
  return match[1].replace(/^0+(?=\d)/, '')
}

export function exactDecimal(value: number | string | null | undefined): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return '0'
    // Number inputs are used only by tests and older RPC adapters. Six
    // places matches the database scale without introducing exponent text.
    return value.toFixed(6).replace(/\.?0+$/, '') || '0'
  }

  const candidate = value?.trim() ?? ''
  const match = candidate.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return '0'
  const whole = match[1].replace(/^0+(?=\d)/, '')
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export function compareExactIntegers(left: string, right: string): number {
  const a = exactInteger(left)
  const b = exactInteger(right)
  return a.length - b.length || a.localeCompare(b)
}

function decimalParts(value: string) {
  const [whole, fraction = ''] = exactDecimal(value).split('.')
  return { whole, fraction }
}

export function compareExactDecimals(left: string, right: string): number {
  const a = decimalParts(left)
  const b = decimalParts(right)
  const wholeComparison = compareExactIntegers(a.whole, b.whole)
  if (wholeComparison !== 0) return wholeComparison
  const scale = Math.max(a.fraction.length, b.fraction.length)
  return a.fraction.padEnd(scale, '0').localeCompare(b.fraction.padEnd(scale, '0'))
}

export function addExactIntegers(left: string, right: string): string {
  const a = exactInteger(left)
  const b = exactInteger(right)
  let carry = 0
  let result = ''
  let leftIndex = a.length - 1
  let rightIndex = b.length - 1

  while (leftIndex >= 0 || rightIndex >= 0 || carry > 0) {
    const sum =
      (leftIndex >= 0 ? Number(a[leftIndex--]) : 0) +
      (rightIndex >= 0 ? Number(b[rightIndex--]) : 0) +
      carry
    result = String(sum % 10) + result
    carry = Math.floor(sum / 10)
  }
  return exactInteger(result)
}

export function addExactDecimals(left: string, right: string): string {
  const a = decimalParts(left)
  const b = decimalParts(right)
  const scale = Math.max(a.fraction.length, b.fraction.length)
  const sum = addExactIntegers(
    a.whole + a.fraction.padEnd(scale, '0'),
    b.whole + b.fraction.padEnd(scale, '0')
  )
  if (scale === 0) return sum
  const padded = sum.padStart(scale + 1, '0')
  return exactDecimal(`${padded.slice(0, -scale)}.${padded.slice(-scale)}`)
}

/** Shifts an exact decimal six places (× 1,000,000) without leaving
 *  exact-string arithmetic — token totals can exceed 2^53, so per-MTok
 *  rate checks must never round-trip through Number. */
function decimalTimesMillion(value: string): string {
  const { whole, fraction } = decimalParts(value)
  const padded = fraction.padEnd(6, '0')
  const tail = padded.slice(6)
  return exactDecimal(`${whole}${padded.slice(0, 6)}${tail ? `.${tail}` : ''}`)
}

export function formatExactInteger(value: string): string {
  return exactInteger(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatCompactTokenCount(value: string): string {
  const digits = exactInteger(value)
  if (digits.length <= 3) return digits
  const units = ['', 'k', 'M', 'B', 'T', 'Q']
  const unit = Math.floor((digits.length - 1) / 3)
  if (unit >= units.length) return `${digits[0]}.${digits.slice(1, 3)}e${digits.length - 1}`
  const wholeDigits = digits.length - unit * 3
  const fractionLength = Math.max(0, 3 - wholeDigits)
  const fraction = digits.slice(wholeDigits, wholeDigits + fractionLength).replace(/0+$/, '')
  return `${digits.slice(0, wholeDigits)}${fraction ? `.${fraction}` : ''}${units[unit]}`
}

export function exactIntegerToSafeNumber(value: string): number | null {
  const canonical = exactInteger(value)
  const parsed = Number(canonical)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function decimalToApproxNumber(value: string): number {
  const parsed = Number(exactDecimal(value))
  return Number.isFinite(parsed) ? parsed : Number.MAX_VALUE
}

export function exactRatioPercent(value: string, total: string): number {
  const numerator = exactInteger(value)
  const denominator = exactInteger(total)
  if (denominator === '0') return 0

  const logMagnitude = (digits: string) => {
    if (digits === '0') return Number.NEGATIVE_INFINITY
    const prefix = digits.slice(0, 15)
    return Math.log10(Number(prefix)) + digits.length - prefix.length
  }
  const ratio = 10 ** (logMagnitude(numerator) - logMagnitude(denominator))
  return Number.isFinite(ratio) ? Math.max(0, Math.min(100, ratio * 100)) : 0
}

export function usdDisplayParts(value: string): { tiny: boolean; number: string } {
  const canonical = exactDecimal(value)
  const tiny = compareExactDecimals(canonical, '0') > 0 && compareExactDecimals(canonical, '0.01') < 0
  const display = tiny ? '0.01' : canonical
  const { whole, fraction } = decimalParts(display)

  if (whole.length > 6) {
    return { tiny, number: formatCompactTokenCount(whole) }
  }

  const decimals = whole.length >= 4 ? '' : `.${fraction.padEnd(2, '0').slice(0, 2)}`
  return { tiny, number: `${formatExactInteger(whole)}${decimals}` }
}

export function cleanBreakdown(
  value: Array<{ name?: unknown; totalTokens?: unknown }> | null | undefined
): TokenBreakdownItem[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      const name = typeof item?.name === 'string' ? item.name.trim() : ''
      if (!name) return []
      return [{ name, totalTokens: exactInteger(String(item.totalTokens ?? '0')) }]
    })
    .sort((a, b) => compareExactIntegers(b.totalTokens, a.totalTokens) || a.name.localeCompare(b.name))
}

function cleanMix(value: string[] | null): string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
}

const TOKEN_AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'openai-codex': 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  'gemini-cli': 'Gemini CLI',
  copilot: 'GitHub Copilot',
  'github-copilot': 'GitHub Copilot',
  hermes: 'Hermes',
  'hermes-agent': 'Hermes',
  pi: 'Pi',
  'pi-agent': 'Pi',
  'pi-coding-agent': 'Pi',
  opencode: 'OpenCode',
  'open-code': 'OpenCode'
}

/**
 * Agent collector IDs → the AI board's tool names, for attaching opt-in
 * burn to existing AI board rows. Values must match resolveToolName()
 * output for the tool's canonical domain (cursor.com, github.com,
 * claude.ai, gemini.google.com) — verified by unit test. Deliberately
 * NOT exhaustive: agents without an AI-board tool (codex, opencode, …)
 * are absent so their spend is dropped instead of inventing tool rows.
 */
export const AGENT_AI_TOOL_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  'github-copilot': 'GitHub Copilot',
  claude: 'Claude',
  'claude-code': 'Claude',
  gemini: 'Gemini',
  'gemini-cli': 'Gemini'
}

/** Canonical agent-id normalization shared with tokenAgentLabel. */
export function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

export function tokenAgentLabel(value: string | null): string | null {
  if (!value) return null

  const normalized = normalizeAgentId(value)

  return (
    TOKEN_AGENT_LABELS[normalized] ??
    normalized
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

export function tokenModelLabel(value: string | null): string | null {
  if (!value) return null
  const model = value.trim().toLowerCase().replace(/_/g, '-')
  if (!model) return null

  const words = (suffix: string) =>
    suffix
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')

  const gpt = model.match(/^(gpt-\d+(?:\.\d+)?)(?:-(.+))?$/)
  if (gpt) return `${gpt[1].toUpperCase()}${gpt[2] ? ` ${words(gpt[2])}` : ''}`

  const claude = model.match(/^claude-(opus|sonnet|haiku)(?:-(\d+))?(?:-(\d+))?(?:-\d{8})?$/)
  if (claude) {
    const version = claude[2] ? ` ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}` : ''
    return `Claude ${words(claude[1])}${version}`
  }

  const gemini = model.match(/^gemini-(\d+(?:\.\d+)?)(?:-(.+))?$/)
  if (gemini) return `Gemini ${gemini[1]}${gemini[2] ? ` ${words(gemini[2])}` : ''}`

  return words(model)
}

export function tokenPersona(input: {
  burnUsd: number | string
  totalTokens: number | string
  outputTokens: number | string
  cachePercent: number
  modelCount: number
  activeDays: number
  clientCount: number
  agentCount: number
}): TokenPersona {
  const burnUsd = exactDecimal(input.burnUsd)
  const totalTokens = exactInteger(input.totalTokens)
  const outputTokens = exactInteger(input.outputTokens)
  const { cachePercent, modelCount, activeDays, clientCount, agentCount } = input
  const outputPercent = exactRatioPercent(outputTokens, totalTokens)

  // Spend tiers descend strictly so the biggest burners outrank everyone.
  if (compareExactDecimals(burnUsd, '25000') >= 0) {
    return { id: 'compute-baron', label: 'COMPUTE BARON', tone: 'danger' }
  }
  if (compareExactDecimals(burnUsd, '10000') >= 0) {
    return { id: 'audit-risk', label: 'AUDIT RISK', tone: 'danger' }
  }
  if (compareExactDecimals(burnUsd, '2500') >= 0) {
    return { id: 'payroll-expense', label: 'PAYROLL EXPENSE', tone: 'danger' }
  }
  if (compareExactDecimals(burnUsd, '500') >= 0) {
    return { id: 'financial-incident', label: 'FINANCIAL INCIDENT', tone: 'danger' }
  }
  if (compareExactDecimals(burnUsd, '100') >= 0) {
    return { id: 'whale', label: 'WHALE', tone: 'danger' }
  }
  // Blended rate ≥ $2/MTok, i.e. burn × 1,000,000 ≥ totalTokens × 2 —
  // fast-tier pricing paid to skip the queue.
  if (
    compareExactIntegers(totalTokens, '20000000') >= 0 &&
    compareExactDecimals(burnUsd, '100') < 0 &&
    compareExactDecimals(decimalTimesMillion(burnUsd), addExactIntegers(totalTokens, totalTokens)) >= 0
  ) {
    return { id: 'priority-lane', label: 'PRIORITY LANE', tone: 'hot' }
  }
  if (
    compareExactIntegers(totalTokens, '1000000000') >= 0 &&
    compareExactDecimals(burnUsd, '50') < 0
  ) {
    return { id: 'free-tier-freak', label: 'FREE TIER FREAK', tone: 'cache' }
  }
  if (cachePercent >= 98 && compareExactIntegers(totalTokens, '50000000') >= 0) {
    return { id: 'groundhog-day', label: 'GROUNDHOG DAY', tone: 'cache' }
  }
  if (cachePercent >= 90 && compareExactIntegers(totalTokens, '10000000') >= 0) {
    return { id: 'cache-goblin', label: 'CACHE GOBLIN', tone: 'cache' }
  }
  if (
    compareExactIntegers(outputTokens, '25000000') >= 0 ||
    (outputPercent >= 25 && compareExactIntegers(totalTokens, '1000000') >= 0)
  ) {
    return { id: 'yapper', label: 'YAPPER', tone: 'output' }
  }
  if (
    compareExactIntegers(outputTokens, '5000000') >= 0 ||
    (outputPercent >= 10 && compareExactIntegers(totalTokens, '1000000') >= 0)
  ) {
    return { id: 'output-demon', label: 'OUTPUT DEMON', tone: 'output' }
  }
  if (compareExactIntegers(totalTokens, '5000000000') >= 0) {
    return { id: 'token-black-hole', label: 'TOKEN BLACK HOLE', tone: 'hot' }
  }
  if (modelCount >= 10) {
    return { id: 'commitment-issues', label: 'COMMITMENT ISSUES', tone: 'neutral' }
  }
  if (modelCount >= 5) {
    return { id: 'model-hopper', label: 'MODEL HOPPER', tone: 'neutral' }
  }
  if (clientCount >= 3) {
    return { id: 'botnet', label: 'BOTNET', tone: 'neutral' }
  }
  if (agentCount >= 4) {
    return { id: 'zookeeper', label: 'ZOOKEEPER', tone: 'neutral' }
  }
  if (cachePercent <= 10 && compareExactIntegers(totalTokens, '10000000') >= 0) {
    return { id: 'raw-dogger', label: 'RAW DOGGER', tone: 'hot' }
  }
  if (modelCount === 1 && activeDays >= 14) {
    return { id: 'ride-or-die', label: 'RIDE OR DIE', tone: 'neutral' }
  }
  if (activeDays >= 28) {
    return { id: 'touch-grass', label: 'TOUCH GRASS', tone: 'hot' }
  }
  if (compareExactIntegers(totalTokens, '50000000') >= 0) {
    return { id: 'token-furnace', label: 'TOKEN FURNACE', tone: 'hot' }
  }
  if (compareExactDecimals(burnUsd, '25') >= 0) {
    return { id: 'wallet-on-fire', label: 'WALLET ON FIRE', tone: 'hot' }
  }
  return { id: 'small-fire', label: 'SMALL FIRE', tone: 'neutral' }
}

export function buildTokenBoard(source: TokenLeaderboardRpcRow[]): TokenBoard {
  const unranked = source.map((item) => {
    const userId = Math.round(finiteNumber(item.user_id))
    const inputTokens = exactInteger(item.input_tokens)
    const outputTokens = exactInteger(item.output_tokens)
    const cacheCreationTokens = exactInteger(item.cache_creation_tokens)
    const cacheReadTokens = exactInteger(item.cache_read_tokens)
    const cacheTokens = addExactIntegers(cacheCreationTokens, cacheReadTokens)
    const totalTokens = exactInteger(item.total_tokens)
    const burnUsd = exactDecimal(item.cost_usd)
    const activeDays = Math.round(finiteNumber(item.active_days))
    const clientCount = Math.round(finiteNumber(item.client_count))
    const models = cleanMix(item.models)
    const agents = cleanMix(item.agents)
    const reportedTopAgent = item.top_agent?.trim() || null
    // During a migration rollout an older RPC response will not have the
    // top-agent fields yet. A single reported agent is still unambiguous;
    // multiple agents deliberately stay unknown instead of inventing a top.
    const topAgent = reportedTopAgent ?? (agents.length === 1 ? agents[0] : null)
    const topAgentDays = reportedTopAgent
      ? Math.min(activeDays, Math.round(finiteNumber(item.top_agent_days ?? null)))
      : topAgent
        ? activeDays
        : 0
    const topAgentTokens = reportedTopAgent
      ? exactInteger(item.top_agent_tokens)
      : topAgent
        ? totalTokens
        : '0'
    const reportedTopModel = item.top_model?.trim() || null
    // Keep the UI useful while the migration rolls out: a one-model mix is
    // unambiguous, but a multi-model mix remains unknown until the RPC says
    // which model appeared on the most active days.
    const topModel = reportedTopModel ?? (models.length === 1 ? models[0] : null)
    const topModelDays = reportedTopModel
      ? Math.min(activeDays, Math.round(finiteNumber(item.top_model_days ?? null)))
      : topModel
        ? activeDays
        : 0
    const topModelTokens = reportedTopModel
      ? exactInteger(item.top_model_tokens)
      : topModel
        ? totalTokens
        : '0'
    const cachePercent = Math.round(exactRatioPercent(cacheTokens, totalTokens))
    const agentBreakdown = cleanBreakdown(item.agent_breakdown)
    const modelBreakdown = cleanBreakdown(item.model_breakdown)
    const username = item.username?.trim() || `User${userId}`

    return {
      userId,
      username,
      displayName: item.display_name?.trim() || username,
      profileImage: item.profile_image,
      // Identity extras (Pro check, affiliate logo) are hydrated by the
      // route from users/team_affiliations — this builder stays DB-free.
      tier: null as string | null,
      team: null as TokenBoardTeam | null,
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
      topAgent,
      topAgentDays,
      topAgentTokens,
      topModel,
      topModelDays,
      topModelTokens,
      agentBreakdown,
      modelBreakdown,
      agentBreakdownComplete: item.agent_breakdown_complete === true,
      modelBreakdownComplete: item.model_breakdown_complete === true,
      timezoneComplete: item.timezone_complete === true,
      provisional: activeDays < 3,
      persona: tokenPersona({
        burnUsd,
        totalTokens,
        outputTokens,
        cachePercent,
        modelCount: models.length,
        activeDays,
        clientCount,
        agentCount: agents.length
      })
    }
  })

  const rows: TokenBoardRow[] = unranked
    .filter((row) => row.userId > 0 && compareExactIntegers(row.totalTokens, '0') > 0)
    .sort(
      (a, b) =>
        compareExactDecimals(b.burnUsd, a.burnUsd) ||
        compareExactIntegers(b.totalTokens, a.totalTokens) ||
        compareExactIntegers(b.outputTokens, a.outputTokens) ||
        a.userId - b.userId
    )
    .map((row, index) => ({ ...row, rank: index + 1 }))

  const totalTokens = rows.reduce(
    (sum, row) => addExactIntegers(sum, row.totalTokens),
    '0'
  )
  const cacheTokens = rows.reduce(
    (sum, row) => addExactIntegers(sum, row.cacheTokens),
    '0'
  )

  return {
    rows,
    totals: {
      pilots: rows.length,
      totalTokens,
      burnUsd: rows.reduce((sum, row) => addExactDecimals(sum, row.burnUsd), '0'),
      cachePercent: Math.round(exactRatioPercent(cacheTokens, totalTokens)),
      topBurnUsd: rows[0]?.burnUsd ?? '0'
    }
  }
}
