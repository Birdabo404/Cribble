'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { formatRelative } from '@/components/dashboard-v2/format'
import {
  AGENT_CLI_COMMANDS,
  AGENT_PLATFORMS,
  DEFAULT_AGENT_PLATFORM,
  agentPlatform,
  detectAgentPlatform,
  type AgentPlatformId
} from '@/lib/agentCli'
import { formatCompactTokenCount, usdDisplayParts } from '@/lib/tokenLeaderboard'
import { TextField } from './Field'
import { SettingsButton } from './SettingsButton'
import { SettingsRow } from './SettingsRow'

/** Account-level "a sync has ever landed" evidence, with headline totals. */
export interface AgentLinkSummary {
  totalTokens: string
  storedCostUsd: string
  lastSyncedAt: string | null
}

export interface AgentSetupGuideProps {
  /** Non-null once the account has ever received a sync. */
  linked: AgentLinkSummary | null
  expanded: boolean
  onToggleExpanded: () => void
  /** Step 2 — key creation state, owned by the section. */
  label: string
  onLabelChange: (value: string) => void
  onCreate: () => void
  creating: boolean
  activeKeyCount: number
  /** The one-time secret, present right after creation until dismissed. */
  createdKey: string | null
  onDismissKey: () => void
  onCopyKey: () => void
  keyCopied: boolean
  createError: string | null
}

/**
 * Four-step Cribble Agent walkthrough in the settings idiom: quiet
 * numbered steps, `--st-*` tokens, no animation. Steps 2 (key exists)
 * and 4 (first sync received) are the only ones that can show a check —
 * they are the only server-verifiable facts. Once linked, the guide
 * collapses to a one-line summary with a disclosure to reopen the steps
 * for a second machine.
 */
export function AgentSetupGuide({
  linked,
  expanded,
  onToggleExpanded,
  label,
  onLabelChange,
  onCreate,
  creating,
  activeKeyCount,
  createdKey,
  onDismissKey,
  onCopyKey,
  keyCopied,
  createError
}: AgentSetupGuideProps) {
  const atKeyCap = activeKeyCount >= 5
  const [platform, setPlatform] = useState<AgentPlatformId>(DEFAULT_AGENT_PLATFORM)
  const installTarget = agentPlatform(platform)

  // After mount, never during render: detecting inline would let the
  // server paint one chip and the browser hydrate another.
  useEffect(() => {
    setPlatform(detectAgentPlatform())
  }, [])

  return (
    <div>
      {linked && (
        <SettingsRow
          label="Cribble Agent linked"
          description={
            <>
              {formatCompactTokenCount(linked.totalTokens)} tokens {'· '}~$
              {usdDisplayParts(linked.storedCostUsd).number} tracked
              {linked.lastSyncedAt && <>{' · '}last sync {formatRelative(linked.lastSyncedAt)}</>}
            </>
          }
        >
          <SettingsButton variant="ghost" aria-expanded={expanded} onClick={onToggleExpanded}>
            Setup guide
          </SettingsButton>
        </SettingsRow>
      )}

      {expanded && (
        <ol
          aria-label="Cribble Agent setup"
          className={`space-y-5 px-4 pb-4 sm:px-5 ${linked ? 'pt-1' : 'pt-4'}`}
        >
          <SetupStep number={1} title="Install the CLI">
            <PlatformPicker selected={platform} onSelect={setPlatform} />
            {/* Keyed on the command so a platform switch clears "Copied" —
                it must never vouch for a command they never copied. */}
            <CommandLine key={installTarget.install} command={installTarget.install} />
            {installTarget.beta && (
              <p className="mt-1.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                {installTarget.label} tracking is in beta. Every step below is identical.
              </p>
            )}
          </SetupStep>

          <SetupStep
            number={2}
            title="Create a key"
            done={createdKey !== null || activeKeyCount > 0}
          >
            {createdKey !== null ? (
              <div
                aria-live="polite"
                className="mt-2 space-y-3 rounded-lg bg-[color:var(--st-panel-hover)] p-3"
              >
                <div>
                  <p className="text-[14px] font-medium leading-5 text-[color:var(--st-text)]">
                    Copy this key now
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                    It is shown once. Paste it when{' '}
                    <span className="font-data">{AGENT_CLI_COMMANDS.connect}</span> asks in step 3.
                  </p>
                </div>
                <code className="block select-all break-all rounded-lg border border-[color:var(--st-border-strong)] bg-[color:var(--st-panel)] px-3 py-2.5 font-data text-[12.5px] leading-5 text-[color:var(--st-text)]">
                  {createdKey}
                </code>
                <div className="flex items-center justify-end gap-1.5">
                  <SettingsButton variant="ghost" onClick={onDismissKey}>
                    Done
                  </SettingsButton>
                  <SettingsButton onClick={onCopyKey}>
                    {keyCopied ? 'Copied' : 'Copy key'}
                  </SettingsButton>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                  {atKeyCap
                    ? 'You have five active keys. Revoke one before creating another.'
                    : activeKeyCount > 0
                      ? `You have ${activeKeyCount} active key${
                          activeKeyCount === 1 ? '' : 's'
                        } — reuse the one saved on that machine, or create another.`
                      : 'Name this computer so you can recognize and revoke its access later.'}
                </p>
                <div className="mt-2.5 flex w-full flex-col gap-2 sm:w-80 sm:flex-row sm:items-end">
                  <TextField
                    label="Computer name"
                    value={label}
                    onChange={(event) => onLabelChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onCreate()
                    }}
                    placeholder="Personal MacBook"
                    autoComplete="off"
                    maxLength={40}
                    disabled={creating || atKeyCap}
                  />
                  <SettingsButton
                    onClick={onCreate}
                    pending={creating}
                    disabled={!label.trim() || atKeyCap}
                  >
                    Create
                  </SettingsButton>
                </div>
              </>
            )}
            {createError && (
              <p role="alert" className="mt-2 text-[13px] leading-5 text-[color:var(--st-danger)]">
                {createError}
              </p>
            )}
          </SetupStep>

          <SetupStep number={3} title="Connect">
            <CommandLine command={AGENT_CLI_COMMANDS.connect} />
            <p className="mt-1.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
              Paste the key at the prompt. On macOS it is stored in your Keychain.
            </p>
          </SetupStep>

          <SetupStep number={4} title="Send your first sync" done={linked !== null}>
            <CommandLine command={AGENT_CLI_COMMANDS.sync} />
            <p className="mt-1.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
              Prefer automatic? <span className="font-data">{AGENT_CLI_COMMANDS.autoSync}</span>{' '}
              keeps syncing in the background.
            </p>
            <p
              aria-live="polite"
              className={`mt-1.5 text-[13px] leading-5 ${
                linked
                  ? 'text-[color:var(--st-text)]'
                  : 'text-[color:var(--st-text-faint)]'
              }`}
            >
              {linked ? 'First sync received' : 'Waiting for first sync…'}
            </p>
          </SetupStep>
        </ol>
      )}
    </div>
  )
}

/**
 * OS chips above the install command. Detection picks the opening chip,
 * so this is mostly a correction affordance — its real job is telling a
 * Linux or Windows user that a build exists for them at all.
 */
function PlatformPicker({
  selected,
  onSelect
}: {
  selected: AgentPlatformId
  onSelect: (id: AgentPlatformId) => void
}) {
  return (
    <div
      role="group"
      aria-label="Your operating system"
      className="mt-2 flex flex-wrap items-center gap-1"
    >
      {AGENT_PLATFORMS.map((platform) => {
        const active = platform.id === selected
        return (
          <button
            key={platform.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(platform.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium leading-none transition-colors duration-150 ${
              active
                ? 'border-[color:var(--st-border-strong)] bg-[color:var(--st-panel-hover)] text-[color:var(--st-text)]'
                : 'border-transparent text-[color:var(--st-text-muted)] hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]'
            }`}
          >
            {platform.label}
            {platform.beta && (
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--st-text-faint)]">
                Beta
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function SetupStep({
  number,
  title,
  done = false,
  children
}: {
  number: number
  title: string
  /** Only server-verifiable steps (2 and 4) ever pass true. */
  done?: boolean
  children: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] leading-none ${
          done
            ? 'border-transparent bg-[color:var(--st-accent)] text-[color:var(--st-accent-contrast)]'
            : 'border-[color:var(--st-border-strong)] text-[color:var(--st-text-muted)]'
        }`}
      >
        {done ? <IconCheck /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-6 text-[color:var(--st-text)]">
          {done && <span className="sr-only">Done: </span>}
          {title}
        </div>
        {children}
      </div>
    </li>
  )
}

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch {
      // The command text is select-all, so manual copy still works.
      setCopied(false)
    }
  }

  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-[10px] border border-[color:var(--st-terminal-border)] bg-[color:var(--st-terminal-bg)] py-1.5 pl-3.5 pr-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <code className="min-w-0 select-all break-all py-1 font-data text-[12.5px] leading-5 text-[color:var(--st-terminal-accent)]">
        <span aria-hidden className="text-[color:var(--st-terminal-muted)]">
          {'$ '}
        </span>
        {command}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className={`inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-[12px] font-medium leading-none transition-colors duration-150 hover:bg-white/[0.07] ${
          copied
            ? 'text-[color:var(--st-terminal-ink)]'
            : 'text-[color:var(--st-terminal-muted)] hover:text-[color:var(--st-terminal-ink)]'
        }`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function IconCheck() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  )
}
