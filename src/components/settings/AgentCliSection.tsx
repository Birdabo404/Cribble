'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatRelative } from '@/components/dashboard-v2/format'
import { SettingsButton } from './SettingsButton'
import { TextField } from './Field'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import { SkeletonRow } from './Skeleton'

interface AgentKeySummary {
  id: number
  prefix: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

interface CreatedAgentKey {
  id: number
  key: string
  prefix: string
  label: string
  createdAt: string
}

type AgentKeysState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; keys: AgentKeySummary[] }

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
    isNullableString(value.revokedAt)
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
    typeof data.createdAt !== 'string'
  ) {
    return null
  }

  return {
    id: data.id,
    key: data.key,
    prefix: data.prefix,
    label: data.label,
    createdAt: data.createdAt
  }
}

export function AgentCliSection() {
  const [keysState, setKeysState] = useState<AgentKeysState>({ phase: 'loading' })
  const [label, setLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<CreatedAgentKey | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const activeKeyCount =
    keysState.phase === 'ready'
      ? keysState.keys.filter((key) => key.revokedAt === null).length
      : 0

  const createKey = useCallback(async () => {
    const nextLabel = label.trim()
    if (creating || !nextLabel || activeKeyCount >= 5) return

    setCreating(true)
    setActionError(null)
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
                  revokedAt: null
                },
                ...current.keys
              ]
            }
          : current
      )
      setLabel('')
    } catch (error) {
      setActionError(
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
      setActionError(null)
    } catch {
      setActionError('Could not copy automatically. Select the key and copy it manually.')
    }
  }, [createdKey])

  const revokeKey = useCallback(
    async (key: AgentKeySummary) => {
      if (key.revokedAt || revokingId !== null) return
      if (!window.confirm(`Revoke “${key.label}”? The CLI using it will stop syncing.`)) {
        return
      }

      setRevokingId(key.id)
      setActionError(null)
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
        setActionError(
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
      description="Create a key so Cribble Agent can send local coding-agent token totals to this account. This is separate from browser activity."
    >
      <SettingsRow
        label="Create a key"
        description="Name this computer so you can recognize and revoke its access later."
        stack
      >
        <div className="flex w-full flex-col gap-2 sm:w-80 sm:flex-row sm:items-end">
          <TextField
            label="Computer name"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createKey()
            }}
            placeholder="Personal MacBook"
            autoComplete="off"
            maxLength={40}
            disabled={creating || activeKeyCount >= 5}
          />
          <SettingsButton
            onClick={() => void createKey()}
            pending={creating}
            disabled={!label.trim() || activeKeyCount >= 5}
          >
            Create
          </SettingsButton>
        </div>
      </SettingsRow>

      {createdKey && (
        <div
          className="space-y-3 bg-[color:var(--st-panel-hover)] px-4 py-4 sm:px-5"
          aria-live="polite"
        >
          <div>
            <p className="text-[14px] font-medium leading-5 text-[color:var(--st-text)]">
              Copy this key now
            </p>
            <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
              It is shown once. In the Cribble Agent folder, run{' '}
              <span className="font-data">node index.js auth set</span>, then paste the key when
              prompted.
            </p>
          </div>
          <code className="block select-all break-all rounded-lg border border-[color:var(--st-border-strong)] bg-[color:var(--st-panel)] px-3 py-2.5 font-data text-[12.5px] leading-5 text-[color:var(--st-text)]">
            {createdKey.key}
          </code>
          <div className="flex items-center justify-end gap-1.5">
            <SettingsButton variant="ghost" onClick={() => setCreatedKey(null)}>
              Done
            </SettingsButton>
            <SettingsButton onClick={() => void copyKey()}>
              {copied ? 'Copied' : 'Copy key'}
            </SettingsButton>
          </div>
        </div>
      )}

      {actionError && (
        <div className="px-4 py-3 sm:px-5">
          <p role="alert" className="text-[13px] leading-5 text-[color:var(--st-danger)]">
            {actionError}
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
          description="Create one above, then save it in Cribble Agent when prompted."
        />
      )}

      {keysState.phase === 'ready' && activeKeyCount >= 5 && (
        <div className="px-4 py-3 sm:px-5">
          <p className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            You have five active keys. Revoke one before creating another.
          </p>
        </div>
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
              </>
            }
          >
            {key.revokedAt ? (
              <span className="text-[13px] leading-5 text-[color:var(--st-text-faint)]">
                Revoked {formatRelative(key.revokedAt)}
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
    </SettingsSection>
  )
}
