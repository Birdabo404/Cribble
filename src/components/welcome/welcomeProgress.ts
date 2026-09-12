// Session resume for the welcome wizard. Every answer and the current
// stage persist to sessionStorage as they change, so a reload never
// restarts the flow from scratch. The extension stage leans on this
// hardest: a content script can't reach a tab that was open when the
// extension was installed, so after a store install the stage persists
// its state, reloads once on its own, and resumes here with the intro
// skipped. sessionStorage scopes the snapshot to the tab and the sitting;
// closing the tab forgets everything by itself.
import type { Stage } from '@/components/welcome/shared'
import type { CountMode } from '@/lib/countMode'
import { parseCountMode } from '@/lib/countMode'

/** The agent stage's phase booleans. The minted key itself is never
 *  persisted — it's shown once by design — so a resumed KEY phase asks
 *  again (or takes the "I already have a key" path). */
export interface AgentProgressSnapshot {
  installDone: boolean
  connectDone: boolean
  keySkipped: boolean
}

export const EMPTY_AGENT_PROGRESS: AgentProgressSnapshot = {
  installDone: false,
  connectDone: false,
  keySkipped: false
}

/** The extension stage's memory across its own reload. storeOpenedAt is
 *  when the store card was clicked (null if never) — the auto-reconnect
 *  only fires after a store visit. autoReconnects counts reloads the
 *  stage triggered itself, capped at one so a broken install can't spin
 *  the tab. pinAcknowledged is the one user-claimed step: pinning is
 *  invisible to the handshake, so it has to be remembered here. */
export interface ExtensionProgressSnapshot {
  storeOpenedAt: number | null
  autoReconnects: number
  pinAcknowledged: boolean
}

export const EMPTY_EXTENSION_PROGRESS: ExtensionProgressSnapshot = {
  storeOpenedAt: null,
  autoReconnects: 0,
  pinAcknowledged: false
}

export interface WelcomeProgress {
  stage: Exclude<Stage, 'intro'>
  mode: string | null
  countMode: CountMode | null
  role: string | null
  goal: string | null
  topTools: string[]
  agent: AgentProgressSnapshot
  extension: ExtensionProgressSnapshot
  /** Set right before a self-triggered reload so the resume skips the
   *  intro's minimum hold: the reconnect should read as one dark beat,
   *  not a replayed brand moment. The page clears it on resume. */
  fastResume: boolean
  savedAt: number
}

const STORAGE_KEY = 'cribble.welcome.progress'

/** Ceiling for resuming an onboarded user into a setup stage. The tab
 *  scope already limits the snapshot's life; this adds a wall-clock cap
 *  so a laptop reopened days later gets the normal gate verdict. */
export const PROGRESS_FRESH_MS = 24 * 60 * 60 * 1000

// The intro is deliberately absent: it's a loading moment, not progress.
const RESUMABLE_STAGES = [
  'mode',
  'team',
  'count',
  'privacy',
  'role',
  'goal',
  'tools',
  'extension',
  'agent'
] as const

function parseStage(value: unknown): WelcomeProgress['stage'] | null {
  return typeof value === 'string' &&
    (RESUMABLE_STAGES as readonly string[]).includes(value)
    ? (value as WelcomeProgress['stage'])
    : null
}

function parseNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function parseNullableTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// A reload counter: anything that isn't a whole non-negative number
// reads as zero. That re-arms one auto-reconnect, which is harmless —
// the stage writes a proper integer before it reloads, so a malformed
// value can only come from outside and can't recur on its own.
function parseCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

function parseRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

export function saveWelcomeProgress(progress: WelcomeProgress): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Storage can be unavailable (private windows, quota) — resume is
    // best-effort, the wizard itself still works.
  }
}

/** Parse defensively: sessionStorage is client-writable, so anything that
 *  doesn't validate reads as "no saved progress". */
export function loadWelcomeProgress(): WelcomeProgress | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return null
    const record = data as Record<string, unknown>
    const stage = parseStage(record.stage)
    if (stage === null) return null
    if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) {
      return null
    }
    const agent = parseRecord(record.agent)
    const extension = parseRecord(record.extension)
    return {
      stage,
      mode: parseNullableString(record.mode),
      countMode: parseCountMode(record.countMode),
      role: parseNullableString(record.role),
      goal: parseNullableString(record.goal),
      topTools: Array.isArray(record.topTools)
        ? record.topTools.filter((t): t is string => typeof t === 'string')
        : [],
      agent: {
        installDone: agent.installDone === true,
        connectDone: agent.connectDone === true,
        keySkipped: agent.keySkipped === true
      },
      extension: {
        storeOpenedAt: parseNullableTimestamp(extension.storeOpenedAt),
        autoReconnects: parseCount(extension.autoReconnects),
        pinAcknowledged: extension.pinAcknowledged === true
      },
      fastResume: record.fastResume === true,
      savedAt: record.savedAt
    }
  } catch {
    return null
  }
}

export function clearWelcomeProgress(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function isProgressFresh(
  progress: WelcomeProgress,
  now: number = Date.now()
): boolean {
  return now - progress.savedAt < PROGRESS_FRESH_MS
}
