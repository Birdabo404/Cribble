'use client'

// Cursor profile link — the no-CLI path onto THE BURN board's CURSOR
// source. Users claim their public cursor.com/@username and a 6-hourly
// cron re-scrapes the stats the profile page already publishes. Drives
// /api/user/cursor-profile: GET status, POST claim, PATCH board toggle,
// DELETE unlink (which also erases the accumulated daily history).
//
// Deep link: 'cursor-profile' is a registered settings section id that
// renders the Account page — this card scrolls itself into view when it
// sees that id active.

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatNumber, formatRelative } from '@/components/dashboard-v2/format'
import type { CursorSyncStatus } from '@/lib/cursorProfile'
import { formatCompactTokenCount } from '@/lib/tokenLeaderboard'
import { SettingsButton } from './SettingsButton'
import { useSettingsModal } from './SettingsModalContext'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import { SkeletonRow } from './Skeleton'
import { Switch } from './Switch'

interface CursorProfileStats {
  /** 30-day token sum as an exact integer string (token-board convention). */
  tokens30d: string
  agentsLocal: number
  agentsCloud: number
  currentStreak: number
  longestStreak: number
  longestAgentSeconds: number
  topModels: string[]
}

interface LinkedCursorProfile {
  cursorUsername: string
  displayName: string | null
  avatarUrl: string | null
  boardEnabled: boolean
  lastSyncedAt: string | null
  lastSyncStatus: string | null
  stats: CursorProfileStats
}

type ProfileState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'unlinked' }
  | { phase: 'linked'; profile: LinkedCursorProfile }

function responseError(data: unknown, fallback: string): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error
  }
  return fallback
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseStats(value: unknown): CursorProfileStats | null {
  if (typeof value !== 'object' || value === null) return null
  const stats = value as Record<string, unknown>
  if (
    typeof stats.tokens30d !== 'string' ||
    typeof stats.agentsLocal !== 'number' ||
    typeof stats.agentsCloud !== 'number' ||
    typeof stats.currentStreak !== 'number' ||
    typeof stats.longestStreak !== 'number' ||
    typeof stats.longestAgentSeconds !== 'number' ||
    !Array.isArray(stats.topModels)
  ) {
    return null
  }
  return {
    tokens30d: stats.tokens30d,
    agentsLocal: stats.agentsLocal,
    agentsCloud: stats.agentsCloud,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    longestAgentSeconds: stats.longestAgentSeconds,
    topModels: stats.topModels.filter(
      (model): model is string => typeof model === 'string'
    )
  }
}

/** GET/POST/PATCH all return the same linked-state body; a malformed
 *  response reads as null so callers surface an error instead of
 *  rendering garbage. */
function parseLinkedState(
  data: unknown
): Extract<ProfileState, { phase: 'unlinked' | 'linked' }> | null {
  if (typeof data !== 'object' || data === null) return null
  if (!('success' in data) || data.success !== true) return null
  if (!('linked' in data) || typeof data.linked !== 'boolean') return null
  if (!data.linked) return { phase: 'unlinked' }
  if (!('profile' in data) || typeof data.profile !== 'object' || data.profile === null) {
    return null
  }
  const profile = data.profile as Record<string, unknown>
  if (
    typeof profile.cursorUsername !== 'string' ||
    !isNullableString(profile.displayName) ||
    !isNullableString(profile.avatarUrl) ||
    typeof profile.boardEnabled !== 'boolean' ||
    !isNullableString(profile.lastSyncedAt) ||
    !isNullableString(profile.lastSyncStatus)
  ) {
    return null
  }
  const stats = parseStats(profile.stats)
  if (stats === null) return null
  return {
    phase: 'linked',
    profile: {
      cursorUsername: profile.cursorUsername,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      boardEnabled: profile.boardEnabled,
      lastSyncedAt: profile.lastSyncedAt,
      lastSyncStatus: profile.lastSyncStatus,
      stats
    }
  }
}

const SYNC_STATUSES: readonly CursorSyncStatus[] = [
  'ok',
  'not_found',
  'private',
  'parse_error',
  'fetch_error'
]

function isCursorSyncStatus(value: string): value is CursorSyncStatus {
  return (SYNC_STATUSES as readonly string[]).includes(value)
}

function syncDescription(profile: LinkedCursorProfile): string {
  const when = profile.lastSyncedAt ? formatRelative(profile.lastSyncedAt) : 'never'
  const status = profile.lastSyncStatus
  if (status === null || !isCursorSyncStatus(status)) {
    return `Last sync ${when}. Profiles re-sync automatically every 6 hours.`
  }
  switch (status) {
    case 'ok':
      return `Synced ${when}. Profiles re-sync automatically every 6 hours.`
    case 'not_found':
      return `Sync failed ${when} — no profile at cursor.com/@${profile.cursorUsername} anymore.`
    case 'private':
      return `Sync failed ${when} — the profile is no longer public, so it is off the board until it is public again.`
    case 'parse_error':
    case 'fetch_error':
      return `Sync failed ${when} — cursor.com could not be read. The next attempt is automatic.`
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <p role="alert" className="text-[13px] leading-5 text-[color:var(--st-danger)]">
        {message}
      </p>
    </div>
  )
}

export function CursorProfileSection() {
  const { section } = useSettingsModal()
  const [state, setState] = useState<ProfileState>({ phase: 'loading' })
  const [username, setUsername] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [updatingBoard, setUpdatingBoard] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState(false)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const response = await fetch('/api/user/cursor-profile', {
        credentials: 'include',
        cache: 'no-store'
      })
      const data: unknown = await response.json().catch(() => null)
      const next = response.ok ? parseLinkedState(data) : null
      if (next === null) {
        setState({ phase: 'error' })
        return
      }
      setState(next)
    } catch {
      setState({ phase: 'error' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Deep link ('cursor-profile' section id): bring this card into view —
  // once on mount and again when our own fetch settles the card's height.
  useEffect(() => {
    if (section !== 'cursor-profile') return
    const frame = requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [section, state.phase])

  const link = useCallback(async () => {
    const candidate = username.trim()
    if (linking || candidate === '') return

    setLinking(true)
    setLinkError(null)
    try {
      // The server normalizes the handle (strips a leading @, lowercases)
      // and live-validates that the cursor.com profile is public.
      const response = await fetch('/api/user/cursor-profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: candidate })
      })
      const data: unknown = await response.json().catch(() => null)
      const next = response.ok ? parseLinkedState(data) : null
      if (!response.ok || next === null) {
        throw new Error(responseError(data, 'Could not link your cursor.com profile'))
      }
      setState(next)
      setUsername('')
    } catch (error) {
      setLinkError(
        error instanceof Error ? error.message : 'Could not link your cursor.com profile'
      )
    } finally {
      setLinking(false)
    }
  }, [linking, username])

  const updateBoard = useCallback(
    async (enabled: boolean) => {
      if (state.phase !== 'linked' || updatingBoard) return

      setUpdatingBoard(true)
      setBoardError(null)
      try {
        const response = await fetch('/api/user/cursor-profile', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boardEnabled: enabled })
        })
        const data: unknown = await response.json().catch(() => null)
        const next = response.ok ? parseLinkedState(data) : null
        if (!response.ok || next === null) {
          throw new Error(responseError(data, 'Could not update board visibility'))
        }
        setState(next)
      } catch (error) {
        setBoardError(
          error instanceof Error ? error.message : 'Could not update board visibility'
        )
      } finally {
        setUpdatingBoard(false)
      }
    },
    [state.phase, updatingBoard]
  )

  const unlink = useCallback(async () => {
    if (state.phase !== 'linked' || unlinking) return
    if (
      !window.confirm(
        `Unlink @${state.profile.cursorUsername}? You drop off the CURSOR board and the synced history Cribble accumulated for this profile is erased.`
      )
    ) {
      return
    }

    setUnlinking(true)
    setUnlinkError(null)
    try {
      const response = await fetch('/api/user/cursor-profile', {
        method: 'DELETE',
        credentials: 'include'
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(responseError(data, 'Could not unlink your cursor.com profile'))
      }
      setState({ phase: 'unlinked' })
    } catch (error) {
      setUnlinkError(
        error instanceof Error ? error.message : 'Could not unlink your cursor.com profile'
      )
    } finally {
      setUnlinking(false)
    }
  }, [state, unlinking])

  return (
    <div ref={rootRef} id="settings-cursor-profile" className="scroll-mt-4">
      <SettingsSection
        title="Cursor profile"
        description={
          <>
            The no-CLI path onto THE BURN board: link your public cursor.com profile and
            Cribble reads the stats it already publishes — tokens, agents, streak. Your
            profile must be set to public at{' '}
            <a
              href="https://cursor.com/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[color:var(--st-border-strong)] underline-offset-2 hover:text-[color:var(--st-text)]"
            >
              cursor.com/settings
            </a>
            .
          </>
        }
      >
        {state.phase === 'loading' && <SkeletonRow />}

        {state.phase === 'error' && (
          <SettingsRow
            label="Status unavailable"
            description="Could not load your cursor.com profile link."
          >
            <SettingsButton variant="ghost" onClick={() => void load()}>
              Try again
            </SettingsButton>
          </SettingsRow>
        )}

        {state.phase === 'unlinked' && (
          <>
            <SettingsRow
              label="Link your profile"
              description="Claiming is trust-based and first come, first served — one cursor.com handle per Cribble account."
              stack
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void link()
                }}
                className="flex w-full items-center gap-2 sm:w-auto"
              >
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="@username"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={linking}
                  aria-label="Your cursor.com username, with or without the leading @"
                  className="st-input block w-full min-w-0 rounded-lg px-3 py-2.5 text-[16px] leading-6 sm:w-52 md:py-1.5 md:text-[14px]"
                />
                <SettingsButton type="submit" pending={linking} disabled={username.trim() === ''}>
                  Link
                </SettingsButton>
              </form>
            </SettingsRow>
            {linkError && <ErrorNote message={linkError} />}
          </>
        )}

        {state.phase === 'linked' && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
              {state.profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={state.profile.avatarUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-full border border-[color:var(--st-border)] object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--st-border)] bg-[color:var(--st-panel-hover)] text-[16px] font-semibold text-[color:var(--st-text-muted)]"
                >
                  {state.profile.cursorUsername.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 grow basis-40 sm:basis-0">
                <div className="truncate text-[15px] font-medium leading-6 text-[color:var(--st-text)]">
                  {state.profile.displayName || state.profile.cursorUsername}
                </div>
                <a
                  href={`https://cursor.com/@${state.profile.cursorUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-[13px] leading-5 text-[color:var(--st-text-muted)] hover:text-[color:var(--st-text)] hover:underline"
                >
                  cursor.com/@{state.profile.cursorUsername}
                </a>
              </div>
              <SettingsButton
                variant="danger-outline"
                pending={unlinking}
                onClick={() => void unlink()}
              >
                Unlink
              </SettingsButton>
            </div>
            {unlinkError && <ErrorNote message={unlinkError} />}

            <SettingsRow
              label="Last 30 days"
              description={
                <>
                  <span className="font-data">
                    {formatCompactTokenCount(state.profile.stats.tokens30d)}
                  </span>{' '}
                  tokens
                  {' · '}
                  {formatNumber(state.profile.stats.agentsLocal)} local /{' '}
                  {formatNumber(state.profile.stats.agentsCloud)} cloud agents
                  {' · '}
                  {formatNumber(state.profile.stats.currentStreak)}-day streak
                </>
              }
            />

            <SettingsRow label="Last sync" description={syncDescription(state.profile)} />

            <SettingsRow
              label="Show on THE BURN"
              description="Appear on the board's CURSOR source, ranked by token burn. Turning this off hides you without unlinking."
            >
              <Switch
                checked={state.profile.boardEnabled}
                disabled={updatingBoard}
                onChange={(enabled) => void updateBoard(enabled)}
                aria-label="Show your cursor.com stats on THE BURN board"
              />
            </SettingsRow>
            {boardError && <ErrorNote message={boardError} />}
          </>
        )}
      </SettingsSection>
    </div>
  )
}
