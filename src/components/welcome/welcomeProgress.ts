// Session resume for the welcome wizard. Every answer and the current
// stage persist to sessionStorage as they change, so a reload (or the
// extension stage's RELOAD AND CHECK) never restarts the flow from
// scratch. sessionStorage scopes the snapshot to the tab and the sitting;
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

export interface WelcomeProgress {
  stage: Exclude<Stage, 'intro'>
  mode: string | null
  countMode: CountMode | null
  role: string | null
  goal: string | null
  topTools: string[]
  agent: AgentProgressSnapshot
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
    const agent =
      typeof record.agent === 'object' && record.agent !== null
        ? (record.agent as Record<string, unknown>)
        : {}
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
