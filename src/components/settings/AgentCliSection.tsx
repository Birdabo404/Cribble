'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatRelative } from '@/components/dashboard-v2/format'
import type { TokenUsageResponse } from '@/lib/userTokenUsage'
import { AgentSetupGuide } from './AgentSetupGuide'
import type { AgentLinkSummary } from './AgentSetupGuide'
import { SettingsButton } from './SettingsButton'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import { SkeletonRow } from './Skeleton'
import { Switch } from './Switch'

interface AgentKeySummary {
  id: number
  prefix: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string
  clients: Array<{
    id: string
    machineName: string
    timezone: string | null
    lastSeenAt: string
    schemaVersion: number
  }>
}

interface CreatedAgentKey {
  id: number
  key: string
  prefix: string
  label: string
  createdAt: string
  expiresAt: string
}

type AgentKeysState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; keys: AgentKeySummary[] }

type AgentSharingState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; enabled: boolean; enabledAt: string | null }

/** Linked-state check: unknown until the first fetch settles. */
type AgentLinkState =
  | { phase: 'checking' }
  | { phase: 'ready'; summary: AgentLinkSummary | null }

/** Gentler than the welcome stage's 4s — settings is not a countdown. */
const LINK_POLL_MS = 10_000

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

function formatExpiry(iso: string): string {
  const remaining = Date.parse(iso) - Date.now()
  if (remaining <= 0) return 'expired'
  const days = Math.ceil(remaining / 86_400_000)
  if (days >= 2) return `in ${days} days`
  const hours = Math.max(1, Math.ceil(remaining / 3_600_000))
  return `in ${hours} hour${hours === 1 ? '' : 's'}`
}

function isAgentKeySummary(value: unknown): value is AgentKeySummary {
  if (typeof value !== 'object' || value === null) return false

  return (
    'id' in value &&
    typeof value.id === 'number' &&
    'prefix' in value &&
    typeof value.prefix === 'string' &&
    'label' in value &&
    typeof value.label === 'string' &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    'lastUsedAt' in value &&
    isNullableString(value.lastUsedAt) &&
    'revokedAt' in value &&
    isNullableString(value.revokedAt) &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'string' &&
    'clients' in value &&
    Array.isArray(value.clients) &&
    value.clients.every(
      (client) =>
        typeof client === 'object' &&
        client !== null &&
        'id' in client &&
        typeof client.id === 'string' &&
        'machineName' in client &&
        typeof client.machineName === 'string' &&
        'timezone' in client &&
        isNullableString(client.timezone) &&
        'lastSeenAt' in client &&
        typeof client.lastSeenAt === 'string' &&
        'schemaVersion' in client &&
        typeof client.schemaVersion === 'number'
    )
  )
}

function parseKeyList(data: unknown): AgentKeySummary[] | null {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('keys' in data) ||
    !Array.isArray(data.keys) ||
    !data.keys.every(isAgentKeySummary)
  ) {
    return null
  }
  return data.keys
}

function parseCreatedKey(data: unknown): CreatedAgentKey | null {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('id' in data) ||
    typeof data.id !== 'number' ||
    !('key' in data) ||
    typeof data.key !== 'string' ||
    !('prefix' in data) ||
    typeof data.prefix !== 'string' ||
    !('label' in data) ||
    typeof data.label !== 'string' ||
    !('createdAt' in data) ||
    typeof data.createdAt !== 'string' ||
    !('expiresAt' in data) ||
    typeof data.expiresAt !== 'string'
  ) {
    return null
  }

  return {
    id: data.id,
    key: data.key,
    prefix: data.prefix,
    label: data.label,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt
  }
}

function parseSharing(data: unknown): { enabled: boolean; enabledAt: string | null } | null {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('enabled' in data) ||
    typeof data.enabled !== 'boolean' ||
    !('enabledAt' in data) ||
    !isNullableString(data.enabledAt)
  ) {
    return null
  }

  return { enabled: data.enabled, enabledAt: data.enabledAt }
}

// availableBounds !== null means at least one sync was EVER ingested —
// the same "first sync received" signal the welcome flow uses. A
// malformed response reads as not-linked: keep the guide open.
function readLinkSummary(data: unknown): AgentLinkSummary | null {
  if (typeof data !== 'object' || data === null) return null
  const response = data as Partial<TokenUsageResponse>
  if (response.success !== true) return null
  if (response.availableBounds === null || response.availableBounds === undefined) {
    return null
  }
  return {
    totalTokens: response.totals?.totalTokens ?? '0',
    storedCostUsd: response.totals?.storedCostUsd ?? '0',
    lastSyncedAt: response.sync?.lastSyncedAt ?? null
  }
}

async function fetchLinkSummary(): Promise<AgentLinkSummary | null> {
  try {
    const response = await fetch('/api/user/token-usage', {
      credentials: 'include',
      cache: 'no-store'
    })
    if (!response.ok) return null
    const data: unknown = await response.json().catch(() => null)
    return readLinkSummary(data)
  } catch {
    return null
  }
}

export function AgentCliSection() {
  const [keysState, setKeysState] = useState<AgentKeysState>({ phase: 'loading' })
  const [sharingState, setSharingState] = useState<AgentSharingState>({ phase: 'loading' })
  const [linkState, setLinkState] = useState<AgentLinkState>({ phase: 'checking' })
  const [guideExpanded, setGuideExpanded] = useState(false)
  const [label, setLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<CreatedAgentKey | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [sharingError, setSharingError] = useState<string | null>(null)
  const [updatingSharing, setUpdatingSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadKeys = useCallback(async () => {
    setKeysState({ phase: 'loading' })
    try {
      const response = await fetch('/api/user/agent-keys', {
        credentials: 'include',
        cache: 'no-store'
      })
      const data: unknown = await response.json().catch(() => null)
      const keys = parseKeyList(data)
      if (!response.ok || keys === null) {
        throw new Error(responseError(data, 'Could not load your token tracker keys'))
      }
      setKeysState({ phase: 'ready', keys })
    } catch {
      setKeysState({ phase: 'error' })
    }
  }, [])

  const loadSharing = useCallback(async () => {
    setSharingState({ phase: 'loading' })
    setSharingError(null)
    try {
      const response = await fetch('/api/user/agent-sharing', {
        credentials: 'include',
        cache: 'no-store'
      })
      const data: unknown = await response.json().catch(() => null)
      const sharing = parseSharing(data)
      if (!response.ok || sharing === null) {
        throw new Error(responseError(data, 'Could not load Burn Board sharing'))
      }
      setSharingState({ phase: 'ready', ...sharing })
    } catch (error) {
      setSharingState({ phase: 'error' })
      setSharingError(
        error instanceof Error ? error.message : 'Could not load Burn Board sharing'
      )
    }
  }, [])

  useEffect(() => {
    void loadKeys()
    void loadSharing()
  }, [loadKeys, loadSharing])

  // One check on mount decides the guide's starting posture: linked
  // accounts get the collapsed summary, everyone else gets the steps.
  useEffect(() => {
    let cancelled = false
    void fetchLinkSummary().then((summary) => {
      if (cancelled) return
      setLinkState({ phase: 'ready', summary })
      setGuideExpanded(summary === null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // While the guide is open and the account has never synced, listen for
  // the first sync so step 4 can flip to "First sync received". Stops as
  // soon as it lands (or the guide closes, or we unmount). A mid-session
  // link does NOT collapse the guide — the user is reading it.
  useEffect(() => {
    if (linkState.phase !== 'ready' || linkState.summary !== null || !guideExpanded) return
    let cancelled = false
    const id = window.setInterval(() => {
      void fetchLinkSummary().then((summary) => {
        if (cancelled || summary === null) return
        setLinkState({ phase: 'ready', summary })
      })
    }, LINK_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [linkState, guideExpanded])

  const activeKeyCount =
    keysState.phase === 'ready'
      ? keysState.keys.filter(
          (key) => key.revokedAt === null && Date.parse(key.expiresAt) > Date.now()
        ).length
      : 0

  const createKey = useCallback(async () => {
    const nextLabel = label.trim()
    if (creating || !nextLabel || activeKeyCount >= 5) return

    setCreating(true)
    setCreateError(null)
    setCopied(false)
    try {
      const response = await fetch('/api/user/agent-keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: nextLabel })
      })
      const data: unknown = await response.json().catch(() => null)
      const next = parseCreatedKey(data)
      if (!response.ok || next === null) {
        throw new Error(responseError(data, 'Could not create a token tracker key'))
      }

      setCreatedKey(next)
      setKeysState((current) =>
        current.phase === 'ready'
          ? {
              phase: 'ready',
              keys: [
                {
                  id: next.id,
                  prefix: next.prefix,
                  label: next.label,
                  createdAt: next.createdAt,
                  lastUsedAt: null,
                  revokedAt: null,
                  expiresAt: next.expiresAt,
                  clients: []
                },
                ...current.keys
              ]
            }
          : current
      )
      setLabel('')
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : 'Could not create a token tracker key'
      )
    } finally {
      setCreating(false)
    }
  }, [activeKeyCount, creating, label])

  const copyKey = useCallback(async () => {
    if (!createdKey) return
    try {
      await navigator.clipboard.writeText(createdKey.key)
      setCopied(true)
      setCreateError(null)
    } catch {
      setCreateError('Could not copy automatically. Select the key and copy it manually.')
    }
  }, [createdKey])

  const updateSharing = useCallback(
    async (enabled: boolean) => {
      if (sharingState.phase !== 'ready' || updatingSharing) return
      if (
        enabled &&
        !window.confirm(
          'Join the public Burn Board? Cribble will publish your username, aggregate token totals, estimated cost, and agent/model breakdowns. Raw usage and machine details stay private, and you can leave at any time.'
        )
      ) {
        return
      }

      setUpdatingSharing(true)
      setSharingError(null)
      try {
        const response = await fetch('/api/user/agent-sharing', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled })
        })
        const data: unknown = await response.json().catch(() => null)
        const sharing = parseSharing(data)
        if (!response.ok || sharing === null) {
          throw new Error(responseError(data, 'Could not update Burn Board sharing'))
        }
        setSharingState({ phase: 'ready', ...sharing })
      } catch (error) {
        setSharingError(
          error instanceof Error ? error.message : 'Could not update Burn Board sharing'
        )
      } finally {
        setUpdatingSharing(false)
      }
    },
    [sharingState, updatingSharing]
  )

  const revokeKey = useCallback(
    async (key: AgentKeySummary) => {
      if (key.revokedAt || revokingId !== null) return
      if (!window.confirm(`Revoke “${key.label}”? The CLI using it will stop syncing.`)) {
        return
      }

      setRevokingId(key.id)
      setRevokeError(null)
      try {
        const response = await fetch('/api/user/agent-keys', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: key.id })
        })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(responseError(data, 'Could not revoke the token tracker key'))
        }
        setKeysState((current) =>
          current.phase === 'ready'
            ? {
                phase: 'ready',
                keys: current.keys.map((item) =>
                  item.id === key.id
                    ? { ...item, revokedAt: item.revokedAt ?? new Date().toISOString() }
                    : item
                )
              }
            : current
        )
      } catch (error) {
        setRevokeError(
          error instanceof Error ? error.message : 'Could not revoke the token tracker key'
        )
      } finally {
        setRevokingId(null)
      }
    },
    [revokingId]
  )

  return (
    <SettingsSection
      title="Token tracker CLI"
      description={
        <>
          Your season score comes from the browser extension. Cribble Agent is a separate CLI
          that reads local coding-agent token burn (Claude Code, Cursor, and more via ccusage)
          into your token dashboard — and the Burn Board only if you opt in. Requires Node 18+
          on macOS, with Linux and Windows in beta.
        </>
      }
    >
      {linkState.phase === 'checking' ? (
        <SkeletonRow />
      ) : (
        <AgentSetupGuide
          linked={linkState.summary}
          expanded={guideExpanded}
          onToggleExpanded={() => setGuideExpanded((current) => !current)}
          label={label}
          onLabelChange={setLabel}
          onCreate={() => void createKey()}
          creating={creating}
          activeKeyCount={activeKeyCount}
          createdKey={createdKey?.key ?? null}
          onDismissKey={() => setCreatedKey(null)}
          onCopyKey={() => void copyKey()}
          keyCopied={copied}
          createError={createError}
        />
      )}

      {revokeError && (
        <div className="px-4 py-3 sm:px-5">
          <p role="alert" className="text-[13px] leading-5 text-[color:var(--st-danger)]">
            {revokeError}
          </p>
        </div>
      )}

      {keysState.phase === 'loading' && <SkeletonRow />}

      {keysState.phase === 'error' && (
        <SettingsRow label="Keys unavailable" description="Could not load your token tracker keys.">
          <SettingsButton variant="ghost" onClick={() => void loadKeys()}>
            Try again
          </SettingsButton>
        </SettingsRow>
      )}

      {keysState.phase === 'ready' && keysState.keys.length === 0 && (
        <SettingsRow
          label="No keys yet"
          description="Create one in step 2 above, then save it in Cribble Agent when prompted."
        />
      )}

      {keysState.phase === 'ready' &&
        keysState.keys.map((key) => (
          <SettingsRow
            key={key.id}
            label={key.label}
            description={
              <>
                <span className="font-data">{key.prefix}</span>
                {' · '}Created {formatRelative(key.createdAt)}
                {' · '}Last used {key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'never'}
                {' · '}Expires {formatExpiry(key.expiresAt)}
                {key.clients.length > 0 && (
                  <>
                    {' · '}Machine{key.clients.length > 1 ? 's' : ''}:{' '}
                    {key.clients.map((client) => client.machineName).join(', ')}
                  </>
                )}
              </>
            }
          >
            {key.revokedAt ? (
              <span className="text-[13px] leading-5 text-[color:var(--st-text-faint)]">
                Revoked {formatRelative(key.revokedAt)}
              </span>
            ) : Date.parse(key.expiresAt) <= Date.now() ? (
              <span className="text-[13px] leading-5 text-[color:var(--st-text-faint)]">
                Expired
              </span>
            ) : (
              <SettingsButton
                variant="danger-outline"
                pending={revokingId === key.id}
                disabled={revokingId !== null && revokingId !== key.id}
                onClick={() => void revokeKey(key)}
              >
                Revoke
              </SettingsButton>
            )}
          </SettingsRow>
        ))}

      <SettingsRow
        label="Join the Burn Board"
        description={
          sharingState.phase === 'ready' && sharingState.enabled
            ? 'Your public profile, aggregate token totals, estimated cost, and agent/model breakdowns are ranked. Raw usage and machine details stay private.'
            : 'Opt in to the public token leaderboard. Sharing is off by default and does not affect your season score.'
        }
      >
        {sharingState.phase === 'error' ? (
          <SettingsButton variant="ghost" onClick={() => void loadSharing()}>
            Try again
          </SettingsButton>
        ) : (
          <Switch
            checked={sharingState.phase === 'ready' && sharingState.enabled}
            disabled={sharingState.phase !== 'ready' || updatingSharing}
            onChange={(enabled) => void updateSharing(enabled)}
            aria-label="Share aggregate token usage on the Burn Board"
          />
        )}
      </SettingsRow>

      {sharingError && (
        <div className="px-4 py-3 sm:px-5">
          <p role="alert" className="text-[13px] leading-5 text-[color:var(--st-danger)]">
            {sharingError}
          </p>
        </div>
      )}
    </SettingsSection>
  )
}
