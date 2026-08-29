// Scraper + parser for public cursor.com/@username profiles, feeding the
// CURSOR source of THE BURN board. The profile page embeds a Next.js RSC
// stream (self.__next_f.push([1,"…"]) script chunks) whose escaped JSON
// carries displayName/avatarUrl/visibility, a stats object, topModels and
// two rolling ~30-day daily series (tokensOverTime, agentsOverTime).
//
// The parser deliberately does NOT assume one exact envelope: it decodes
// every pushed string chunk, concatenates them in document order (payloads
// can split across chunks) and extracts each field independently with a
// bounded, string-aware JSON scan. cursor.com shipping a different page
// shell degrades to parse_error instead of throwing.

export interface CursorProfileStats {
  currentStreak: number
  longestStreak: number
  agentsLocal: number
  agentsCloud: number
  longestAgentSeconds: number
}

export interface CursorTokensPoint {
  /** Calendar day, YYYY-MM-DD. */
  date: string
  tokens: number
}

export interface CursorAgentsPoint {
  /** Calendar day, YYYY-MM-DD. */
  date: string
  local: number
  cloud: number
}

export interface CursorProfileData {
  displayName: string | null
  avatarUrl: string | null
  /** ISO timestamp cursor.com reports as the account's join date. */
  joinedDate: string | null
  stats: CursorProfileStats
  /** Ranked model names, most used first. */
  topModels: string[]
  tokensOverTime: CursorTokensPoint[]
  agentsOverTime: CursorAgentsPoint[]
}

export type CursorProfileResult =
  | { status: 'ok'; profile: CursorProfileData }
  | { status: 'not_found' }
  | { status: 'private' }
  | { status: 'parse_error'; message: string }
  | { status: 'fetch_error'; message: string }

/** Every terminal state a sync can record — mirrors
 *  cursor_profiles.last_sync_status. */
export type CursorSyncStatus = CursorProfileResult['status']

/** One merged day of both daily series, ready for cursor_profile_daily. */
export interface CursorDailyRow {
  date: string
  tokens: number
  agentsLocal: number
  agentsCloud: number
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const PROFILE_USER_AGENT =
  'CribbleBot/1.0 (+https://cribble.dev; cursor-profile-board)'
const PROFILE_FETCH_TIMEOUT_MS = 15_000

/**
 * Canonical claim key: trimmed, one leading @ stripped, lowercased. Null
 * when the remainder is not a plausible cursor.com handle — the routes
 * turn that into a 400/not_found instead of fetching arbitrary paths.
 */
export function normalizeCursorUsername(input: string): string | null {
  const candidate = input.trim().replace(/^@/, '').toLowerCase()
  return USERNAME_PATTERN.test(candidate) ? candidate : null
}

const RSC_PUSH_CHUNK = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g

function decodeRscChunk(raw: string): string {
  // The pushed string is a JSON-compatible literal (Next serializes it
  // with JSON.stringify), so JSON.parse is the exact inverse.
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    // Minimal fallback: the two escapes the payload cannot live without.
    return raw.replace(/\\(["\\/])/g, '$1')
  }
}

/**
 * Returns the exclusive end index of the JSON value starting at `start`,
 * or null when the text is truncated/malformed. String-aware: braces and
 * brackets inside string literals do not count toward nesting.
 */
function scanJsonValueEnd(text: string, start: number): number | null {
  const first = text[start]

  if (first === '"') {
    let escaped = false
    for (let i = start + 1; i < text.length; i++) {
      if (escaped) {
        escaped = false
      } else if (text[i] === '\\') {
        escaped = true
      } else if (text[i] === '"') {
        return i + 1
      }
    }
    return null
  }

  if (first === '{' || first === '[') {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return i + 1
      }
    }
    return null
  }

  // Number / true / false / null — runs until a JSON delimiter.
  const match = text.slice(start, start + 64).match(/^[^,}\]\s]+/)
  return match ? start + match[0].length : null
}

/**
 * Extracts and JSON-parses the value of the first `"key":` occurrence at
 * or after `from`. Undefined means "not present or unparsable" — callers
 * decide whether that is private or parse_error.
 */
function extractJsonField(text: string, key: string, from: number): unknown {
  const marker = `"${key}":`
  const at = text.indexOf(marker, from)
  if (at === -1) return undefined
  const start = at + marker.length
  const end = scanJsonValueEnd(text, start)
  if (end === null) return undefined
  try {
    return JSON.parse(text.slice(start, end)) as unknown
  } catch {
    return undefined
  }
}

// Postgres-safe ceilings (migration 062): tokens land in a BIGINT
// column but must also stay exact JS integers; every other counter
// lands in INTEGER columns. A pathological scraped value (1e300, …)
// clamps here instead of failing the insert and turning the whole
// claim/sync into a 500.
const TOKENS_CEILING = Number.MAX_SAFE_INTEGER
const COUNTER_CEILING = 2_147_483_647

function asNonNegativeInt(value: unknown, ceiling: number = COUNTER_CEILING): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(Math.min(parsed, ceiling))
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

// Scraped, stored and displayed — so bound at the door: an absurd
// display name or a non-https avatar "URL" degrades to null instead of
// failing the parse or landing an oversized/unsafe value in the row.
const DISPLAY_NAME_MAX = 120
const AVATAR_URL_MAX = 2048

function asDisplayName(value: unknown): string | null {
  const text = asOptionalString(value)
  // Code points, not UTF-16 units — display names love astral emoji.
  return text !== null && [...text].length <= DISPLAY_NAME_MAX ? text : null
}

function asAvatarUrl(value: unknown): string | null {
  const text = asOptionalString(value)
  if (text === null || text.length > AVATAR_URL_MAX) return null
  try {
    return new URL(text).protocol === 'https:' ? text : null
  } catch {
    return null
  }
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function asDateKey(value: unknown): string | null {
  return typeof value === 'string' && DATE_KEY_PATTERN.test(value) ? value : null
}

const TOP_MODELS_LIMIT = 10

function cleanTopModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    // Both shapes cursor.com has shipped: bare names and {name, vendor, …}.
    const name =
      typeof item === 'string'
        ? item.trim()
        : typeof (item as { name?: unknown })?.name === 'string'
          ? ((item as { name: string }).name).trim()
          : ''
    if (name && !names.includes(name)) names.push(name)
    if (names.length >= TOP_MODELS_LIMIT) break
  }
  return names
}

function cleanTokensSeries(value: unknown): CursorTokensPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const date = asDateKey((item as { date?: unknown })?.date)
    if (!date) return []
    return [
      { date, tokens: asNonNegativeInt((item as { tokens?: unknown }).tokens, TOKENS_CEILING) }
    ]
  })
}

function cleanAgentsSeries(value: unknown): CursorAgentsPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const date = asDateKey((item as { date?: unknown })?.date)
    if (!date) return []
    return [
      {
        date,
        local: asNonNegativeInt((item as { local?: unknown }).local),
        cloud: asNonNegativeInt((item as { cloud?: unknown }).cloud)
      }
    ]
  })
}

/**
 * Parses a fetched cursor.com profile page. Pure and network-free — the
 * unit tests run it against a saved fixture. not_found/fetch_error are
 * transport outcomes and never come from here.
 */
export function parseCursorProfileHtml(
  html: string
): Extract<CursorProfileResult, { status: 'ok' | 'private' | 'parse_error' }> {
  const chunks: string[] = []
  for (const match of html.matchAll(RSC_PUSH_CHUNK)) {
    chunks.push(decodeRscChunk(match[1]))
  }
  if (chunks.length === 0) {
    return { status: 'parse_error', message: 'No RSC payload chunks in page' }
  }

  const text = chunks.join('')
  // Scope field lookups to the profile object when the envelope is intact;
  // fall back to the whole stream when cursor.com reshapes the tree.
  const profileAt = text.indexOf('"profile":')
  const from = profileAt === -1 ? 0 : profileAt

  const visibility = extractJsonField(text, 'visibility', from)
  const stats = extractJsonField(text, 'stats', from)
  const displayName = extractJsonField(text, 'displayName', from)

  const looksLikeProfile =
    visibility !== undefined || stats !== undefined || displayName !== undefined
  if (!looksLikeProfile) {
    return { status: 'parse_error', message: 'Profile payload not found in page' }
  }

  if (typeof visibility === 'string' && visibility !== 'PUBLIC') {
    return { status: 'private' }
  }
  // A profile page without a stats object is one we may not read
  // (cursor.com hides stats rather than the whole page in some states).
  if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
    return { status: 'private' }
  }

  const statsRecord = stats as Record<string, unknown>
  return {
    status: 'ok',
    profile: {
      displayName: asDisplayName(displayName),
      avatarUrl: asAvatarUrl(extractJsonField(text, 'avatarUrl', from)),
      joinedDate: asOptionalString(extractJsonField(text, 'joinedDate', from)),
      stats: {
        currentStreak: asNonNegativeInt(statsRecord.currentStreak),
        longestStreak: asNonNegativeInt(statsRecord.longestStreak),
        agentsLocal: asNonNegativeInt(statsRecord.agentsLocal),
        agentsCloud: asNonNegativeInt(statsRecord.agentsCloud),
        longestAgentSeconds: asNonNegativeInt(statsRecord.longestAgentSeconds)
      },
      topModels: cleanTopModels(extractJsonField(text, 'topModels', from)),
      tokensOverTime: cleanTokensSeries(extractJsonField(text, 'tokensOverTime', from)),
      agentsOverTime: cleanAgentsSeries(extractJsonField(text, 'agentsOverTime', from))
    }
  }
}

/**
 * Merges the two daily series by date into cursor_profile_daily rows.
 * A date present in only one series keeps zeros for the other — the
 * upsert must still overwrite that day so re-syncs converge.
 */
export function mergeCursorDailySeries(
  profile: Pick<CursorProfileData, 'tokensOverTime' | 'agentsOverTime'>
): CursorDailyRow[] {
  const byDate = new Map<string, CursorDailyRow>()
  const rowFor = (date: string): CursorDailyRow => {
    let row = byDate.get(date)
    if (!row) {
      row = { date, tokens: 0, agentsLocal: 0, agentsCloud: 0 }
      byDate.set(date, row)
    }
    return row
  }

  for (const point of profile.tokensOverTime) {
    rowFor(point.date).tokens = point.tokens
  }
  for (const point of profile.agentsOverTime) {
    const row = rowFor(point.date)
    row.agentsLocal = point.local
    row.agentsCloud = point.cloud
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Fetches and parses one public profile. Network problems and non-404
 * HTTP failures come back as fetch_error so the cron can record them
 * without treating the link as gone.
 */
export async function fetchCursorProfile(username: string): Promise<CursorProfileResult> {
  const normalized = normalizeCursorUsername(username)
  if (!normalized) return { status: 'not_found' }

  let response: Response
  try {
    response = await fetch(`https://cursor.com/@${encodeURIComponent(normalized)}`, {
      headers: {
        'User-Agent': PROFILE_USER_AGENT,
        Accept: 'text/html'
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROFILE_FETCH_TIMEOUT_MS)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'fetch_error', message }
  }

  if (response.status === 404) return { status: 'not_found' }
  if (!response.ok) {
    return { status: 'fetch_error', message: `HTTP ${response.status}` }
  }

  try {
    return parseCursorProfileHtml(await response.text())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'parse_error', message }
  }
}
