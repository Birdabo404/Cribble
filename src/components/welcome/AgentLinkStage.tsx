'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import {
  formatCompactTokenCount,
  tokenAgentLabel,
  usdDisplayParts
} from '@/lib/tokenLeaderboard'
import type { TokenUsageResponse } from '@/lib/userTokenUsage'
import {
  IconCheck,
  IconCopy,
  IconTerminal
} from '@/components/welcome/icons'
import {
  ChoiceCard,
  GhostButton,
  PrimaryButton,
  StageActions,
  StageShell
} from '@/components/welcome/shared'
import {
  CRIBBLE_EASE,
  welcomeMotionReduced
} from '@/components/welcome/welcomeMotion'
import type { AgentProgressSnapshot } from '@/components/welcome/welcomeProgress'

/** Single source for every command this stage shows, so the panel can
 *  never drift apart from itself. */
export const AGENT_CLI_COMMANDS = {
  install: 'npm install -g cribble-agent',
  connect: 'cribble connect',
  sync: 'cribble sync',
  autoSync: 'cribble start'
} as const

const SYNC_POLL_MS = 4_000

type AgentPhase = 'install' | 'key' | 'connect' | 'sync'

const AGENT_PHASES: { id: AgentPhase; label: string }[] = [
  { id: 'install', label: 'INSTALL' },
  { id: 'key', label: 'KEY' },
  { id: 'connect', label: 'CONNECT' },
  { id: 'sync', label: 'SYNC' }
]

interface MintedKey {
  key: string
  prefix: string
  label: string
}

interface SyncPreview {
  totalTokens: string
  storedCostUsd: string
  topAgent: string | null
}

type ConsentState =
  | { phase: 'idle' }
  | { phase: 'saving'; join: boolean }
  | { phase: 'done'; joined: boolean }

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

function parseMintedKey(data: unknown): MintedKey | null {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('key' in data) ||
    typeof data.key !== 'string' ||
    !('prefix' in data) ||
    typeof data.prefix !== 'string' ||
    !('label' in data) ||
    typeof data.label !== 'string'
  ) {
    return null
  }
  return { key: data.key, prefix: data.prefix, label: data.label }
}

// availableBounds !== null means at least one sync was EVER ingested —
// that's the "first sync received" signal, regardless of the default
// range's totals. A malformed response reads as not-synced: keep polling.
function readSyncPreview(data: unknown): SyncPreview | null {
  if (typeof data !== 'object' || data === null) return null
  const response = data as Partial<TokenUsageResponse>
  if (response.success !== true) return null
  if (response.availableBounds === null || response.availableBounds === undefined) {
    return null
  }
  return {
    totalTokens: response.totals?.totalTokens ?? '0',
    storedCostUsd: response.totals?.storedCostUsd ?? '0',
    topAgent: response.breakdowns?.agents.items[0]?.name ?? null
  }
}

/**
 * The welcome flow's centerpiece: a mission-control panel that walks
 * INSTALL → KEY → CONNECT → SYNC, mints the agent key inline, listens for
 * the account's first token sync, then asks the Burn Board question as two
 * explicit consent cards. Ember is the hue here — this is a token surface.
 */
export function AgentLinkStage({
  step,
  initialProgress,
  onProgress,
  onFinish
}: {
  step: number
  /** Phase booleans restored by session resume. The minted key itself is
   *  never persisted (shown once by design), so a resumed KEY phase mints
   *  again or takes the "I already have a key" path. */
  initialProgress: AgentProgressSnapshot
  /** Mirrors phase-boolean changes up to the page, which persists them. */
  onProgress: (next: AgentProgressSnapshot) => void
  /** Terminal navigation — the page owns the router. */
  onFinish: (path: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const railLineRef = useRef<HTMLDivElement>(null)
  const radarRef = useRef<HTMLSpanElement>(null)
  const checkRef = useRef<HTMLSpanElement>(null)
  const tokensRef = useRef<HTMLSpanElement>(null)
  const usdRef = useRef<HTMLSpanElement>(null)

  const [installDone, setInstallDone] = useState(initialProgress.installDone)
  const [connectDone, setConnectDone] = useState(initialProgress.connectDone)
  const [machineLabel, setMachineLabel] = useState('')
  const [minting, setMinting] = useState(false)
  const [mintedKey, setMintedKey] = useState<MintedKey | null>(null)
  const [keySkipped, setKeySkipped] = useState(initialProgress.keySkipped)
  const [mintError, setMintError] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [consent, setConsent] = useState<ConsentState>({ phase: 'idle' })
  const [consentError, setConsentError] = useState<string | null>(null)

  // Report the phase booleans upward whenever they move, so a reload can
  // restore them. Fires once on mount too — an idempotent echo.
  useEffect(() => {
    onProgress({ installDone, connectDone, keySkipped })
  }, [installDone, connectDone, keySkipped, onProgress])

  const synced = preview !== null
  const phaseDone: Record<AgentPhase, boolean> = {
    install: installDone || synced,
    key: mintedKey !== null || keySkipped || synced,
    connect: connectDone || synced,
    sync: synced
  }
  const doneCount = AGENT_PHASES.filter((p) => phaseDone[p.id]).length
  const activePhase = AGENT_PHASES.find((p) => !phaseDone[p.id])?.id ?? null

  // Listen for the first sync. Starts immediately (an account that synced
  // before skips straight to the ask) and stops once detected or unmounted.
  useEffect(() => {
    if (synced) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/user/token-usage', {
          credentials: 'include',
          cache: 'no-store'
        })
        if (!res.ok || cancelled) return
        const data: unknown = await res.json().catch(() => null)
        if (cancelled) return
        const next = readSyncPreview(data)
        if (next) setPreview(next)
      } catch {
        // Network hiccup — the next tick retries.
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), SYNC_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [synced])

  const mintKey = useCallback(async () => {
    const label = machineLabel.trim()
    if (minting || !label) return
    setMinting(true)
    setMintError(null)
    setKeyCopied(false)
    try {
      const res = await fetch('/api/user/agent-keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      })
      const data: unknown = await res.json().catch(() => null)
      const created = parseMintedKey(data)
      if (!res.ok || created === null) {
        throw new Error(responseError(data, 'Could not create an agent key'))
      }
      setMintedKey(created)
    } catch (error) {
      setMintError(
        error instanceof Error ? error.message : 'Could not create an agent key'
      )
    } finally {
      setMinting(false)
    }
  }, [machineLabel, minting])

  const copyKey = useCallback(async () => {
    if (!mintedKey) return
    try {
      await navigator.clipboard.writeText(mintedKey.key)
      setKeyCopied(true)
      setMintError(null)
    } catch {
      setMintError(
        'Could not copy automatically. Select the key and copy it manually.'
      )
    }
  }, [mintedKey])

  const copyCommand = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCommand(id)
    } catch {
      setCopiedCommand(null)
    }
  }, [])

  const chooseSharing = useCallback(
    async (join: boolean) => {
      if (consent.phase !== 'idle') return
      setConsent({ phase: 'saving', join })
      setConsentError(null)
      try {
        const res = await fetch('/api/user/agent-sharing', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: join })
        })
        const data: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(
            responseError(data, 'Could not update Burn Board sharing')
          )
        }
        setConsent({ phase: 'done', joined: join })
      } catch (error) {
        setConsentError(
          error instanceof Error
            ? error.message
            : 'Could not update Burn Board sharing'
        )
        setConsent({ phase: 'idle' })
      }
    },
    [consent.phase]
  )

  // Progress line grows as phases complete. Reduced motion snaps.
  useGSAP(
    () => {
      const line = railLineRef.current
      if (!line) return
      const progress = doneCount / AGENT_PHASES.length
      if (welcomeMotionReduced()) {
        gsap.set(line, { scaleX: progress })
        return
      }
      gsap.to(line, {
        scaleX: progress,
        duration: 0.7,
        ease: CRIBBLE_EASE,
        overwrite: 'auto'
      })
    },
    { scope: rootRef, dependencies: [doneCount] }
  )

  // Radar pulse while listening. revertOnUpdate kills the loop the moment
  // sync lands; reduced motion never starts it (static ring + dot).
  useGSAP(
    () => {
      if (synced || welcomeMotionReduced()) return
      gsap.fromTo(
        '.agent-radar-ring',
        { scale: 0.55, autoAlpha: 0.7 },
        {
          scale: 2.4,
          autoAlpha: 0,
          duration: 2,
          repeat: -1,
          ease: 'power1.out',
          stagger: 0.65
        }
      )
    },
    { scope: rootRef, dependencies: [synced], revertOnUpdate: true }
  )

  // One-time key reveal, wiped left-to-right. The CONNECT card eases into
  // view alongside it — the key's whole point is the paste that follows.
  useGSAP(
    () => {
      if (!mintedKey) return
      const reduced = welcomeMotionReduced()
      rootRef.current
        ?.querySelector('[data-agent-phase="connect"]')
        ?.scrollIntoView({
          block: 'nearest',
          behavior: reduced ? 'auto' : 'smooth'
        })
      if (reduced) return
      gsap.fromTo(
        '.agent-key-reveal',
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: CRIBBLE_EASE }
      )
    },
    { scope: rootRef, dependencies: [mintedKey] }
  )

  // Signal acquisition: collapse the radar, pop the check, expand the
  // preview, count the burn up. Reduced motion snaps to the final states
  // (React already renders the exact final numbers as text).
  useGSAP(
    () => {
      if (!preview) return
      const radar = radarRef.current
      const check = checkRef.current
      // Ease the acquisition into view: the bottom-most consent card pulls
      // the preview along with it. Fired as the timeline starts so the
      // scroll and the reveal read as one moment.
      const consents = rootRef.current?.querySelectorAll('.agent-consent')
      const scrollTarget =
        consents && consents.length > 0
          ? consents[consents.length - 1]
          : rootRef.current?.querySelector('.agent-preview')
      scrollTarget?.scrollIntoView({
        block: 'nearest',
        behavior: welcomeMotionReduced() ? 'auto' : 'smooth'
      })
      if (welcomeMotionReduced()) {
        if (radar) gsap.set(radar, { autoAlpha: 0 })
        if (check) gsap.set(check, { autoAlpha: 1, scale: 1 })
        return
      }
      const tl = gsap.timeline({ defaults: { ease: CRIBBLE_EASE } })
      if (radar) {
        tl.to(radar, {
          scale: 0.4,
          autoAlpha: 0,
          duration: 0.3,
          ease: 'power2.in'
        })
      }
      if (check) {
        tl.fromTo(
          check,
          { scale: 0.4, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(2.2)' },
          '-=0.05'
        )
      }
      tl.fromTo(
        '.agent-preview',
        { autoAlpha: 0, y: 10, scale: 0.98 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.5 },
        '-=0.2'
      )
      tl.fromTo(
        '.agent-consent',
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.07 },
        '-=0.25'
      )

      const tokensEl = tokensRef.current
      const usdEl = usdRef.current
      const tokensTarget = Number(preview.totalTokens)
      const usdTarget = Number(preview.storedCostUsd)
      if (
        tokensEl &&
        usdEl &&
        Number.isFinite(tokensTarget) &&
        Number.isFinite(usdTarget)
      ) {
        const finalTokens = formatCompactTokenCount(preview.totalTokens)
        const finalUsd = usdDisplayParts(preview.storedCostUsd).number
        const counter = { tokens: 0, usd: 0 }
        tl.to(
          counter,
          {
            tokens: tokensTarget,
            usd: usdTarget,
            duration: 1.1,
            ease: 'power2.out',
            snap: { tokens: 1 },
            onUpdate: () => {
              tokensEl.textContent = formatCompactTokenCount(
                String(Math.round(counter.tokens))
              )
              usdEl.textContent = usdDisplayParts(counter.usd.toFixed(2)).number
            },
            // Land exactly on the strings React rendered, so a later
            // re-render can't shift the digits.
            onComplete: () => {
              tokensEl.textContent = finalTokens
              usdEl.textContent = finalUsd
            }
          },
          '-=0.35'
        )
      }
    },
    { scope: rootRef, dependencies: [preview] }
  )

  const topAgentName = preview ? tokenAgentLabel(preview.topAgent) : null
  const maxKeysHit = mintError?.includes('Maximum of 5') === true

  return (
    <StageShell
      step={step}
      stage="agent"
      title="Link your coding agent."
      subtitle="Four commands wire your agents' token burn into Cribble. Keep this page open. It hears the first sync land."
    >
      <div ref={rootRef}>
        {/* Phase rail */}
        <div className="card-enter glass-lite mt-9 rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <span className="text-ember">
              <IconTerminal size={17} />
            </span>
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              CRIBBLE AGENT · LINK SEQUENCE
            </span>
          </div>
          <div className="mt-5 flex items-center justify-between">
            {AGENT_PHASES.map((phase) => (
              <span
                key={phase.id}
                className={`font-mono text-[9px] tracking-[0.25em] transition-colors duration-300 ${
                  phaseDone[phase.id]
                    ? 'text-ember'
                    : activePhase === phase.id
                    ? 'text-zinc-200'
                    : 'text-zinc-600'
                }`}
              >
                {phase.label}
              </span>
            ))}
          </div>
          <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-zinc-900">
            <div
              ref={railLineRef}
              className="h-full origin-left scale-x-0 rounded-full bg-ember"
            />
          </div>
        </div>

        <div className="mt-3 space-y-3">
          <PhaseCard
            index="01"
            label="INSTALL"
            title="Install the CLI"
            done={phaseDone.install}
            active={activePhase === 'install'}
          >
            <CommandBlock
              id="install"
              command={AGENT_CLI_COMMANDS.install}
              copiedCommand={copiedCommand}
              onCopy={copyCommand}
            />
            {!phaseDone.install && (
              <MarkDoneButton onClick={() => setInstallDone(true)} />
            )}
          </PhaseCard>

          <PhaseCard
            index="02"
            label="KEY"
            title="Mint a key for this machine"
            done={phaseDone.key}
            active={activePhase === 'key'}
          >
            {mintedKey ? (
              <div className="agent-key-reveal space-y-3">
                <p className="text-xs leading-relaxed text-zinc-500">
                  You get one look at this. Copy it, then paste it when{' '}
                  <span className="font-data text-zinc-300">
                    {AGENT_CLI_COMMANDS.connect}
                  </span>{' '}
                  asks.
                </p>
                <code className="block select-all break-all rounded-lg border border-zinc-800 bg-black/60 px-3.5 py-2.5 font-data text-[12.5px] leading-5 text-zinc-100">
                  {mintedKey.key}
                </code>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[9px] tracking-[0.25em] text-zinc-600">
                    {mintedKey.label.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyKey()}
                    className="press-scale inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-3.5 py-1.5 font-mono text-[9px] tracking-[0.25em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
                  >
                    <IconCopy size={11} />
                    {keyCopied ? 'COPIED' : 'COPY KEY'}
                  </button>
                </div>
              </div>
            ) : keySkipped ? (
              <p className="text-xs leading-relaxed text-zinc-500">
                Using a key you already have. Manage keys any time in
                Settings → Token tracker CLI.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={machineLabel}
                    onChange={(event) => setMachineLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void mintKey()
                    }}
                    placeholder="Personal MacBook"
                    autoComplete="off"
                    maxLength={40}
                    disabled={minting}
                    aria-label="Machine name"
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3.5 py-2.5 text-[13px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-zinc-500 sm:w-64"
                  />
                  <button
                    type="button"
                    onClick={() => void mintKey()}
                    disabled={minting || !machineLabel.trim()}
                    className="press-scale shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-30"
                    style={{
                      background: 'var(--foreground)',
                      color: 'var(--background)'
                    }}
                  >
                    {minting ? 'Creating…' : 'Create key'}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                  Name this computer so you can recognize and revoke its
                  access later.
                </p>
                <button
                  type="button"
                  onClick={() => setKeySkipped(true)}
                  className="mt-2 font-mono text-[9px] tracking-[0.25em] text-zinc-600 transition-colors hover:text-zinc-300"
                >
                  I ALREADY HAVE A KEY
                </button>
              </>
            )}
            {mintError && (
              <p
                role="alert"
                className="mt-3 text-xs leading-relaxed text-ember"
              >
                {mintError}
                {maxKeysHit && ' Revoke one in Settings → Token tracker CLI.'}
              </p>
            )}
          </PhaseCard>

          <PhaseCard
            index="03"
            label="CONNECT"
            title="Bind the key"
            done={phaseDone.connect}
            active={activePhase === 'connect'}
          >
            <CommandBlock
              id="connect"
              command={AGENT_CLI_COMMANDS.connect}
              copiedCommand={copiedCommand}
              onCopy={copyCommand}
            />
            <p className="mt-2 text-xs leading-relaxed text-zinc-600">
              Paste the key when it prompts you.
            </p>
            {!phaseDone.connect && (
              <MarkDoneButton onClick={() => setConnectDone(true)} />
            )}
          </PhaseCard>

          <PhaseCard
            index="04"
            label="SYNC"
            title="Send the first burn"
            done={phaseDone.sync}
            active={activePhase === 'sync'}
          >
            <CommandBlock
              id="sync"
              command={AGENT_CLI_COMMANDS.sync}
              copiedCommand={copiedCommand}
              onCopy={copyCommand}
            />
            <div className="mt-4 flex items-center gap-3.5">
              <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
                <span
                  ref={radarRef}
                  className="absolute inset-0 inline-flex items-center justify-center"
                >
                  <span
                    className="agent-radar-ring absolute inset-0 rounded-full border"
                    style={{ borderColor: 'rgb(var(--ember-rgb) / 0.5)' }}
                  />
                  <span
                    className="agent-radar-ring absolute inset-0 rounded-full border"
                    style={{ borderColor: 'rgb(var(--ember-rgb) / 0.5)' }}
                  />
                  <span className="h-1.5 w-1.5 rounded-full bg-ember" />
                </span>
                <span
                  ref={checkRef}
                  className="invisible inline-flex h-6 w-6 items-center justify-center rounded-full bg-ember text-black opacity-0"
                >
                  <IconCheck size={12} />
                </span>
              </span>
              <span
                className={`font-mono text-[10px] tracking-[0.3em] ${
                  synced ? 'text-ember' : 'text-zinc-500'
                }`}
              >
                {synced ? 'FIRST SYNC RECEIVED' : 'LISTENING FOR FIRST SYNC…'}
              </span>
            </div>
            <p className="mt-3 font-mono text-[9px] tracking-[0.2em] text-zinc-600">
              PREFER AUTOMATIC?{' '}
              <span className="text-zinc-400">
                {AGENT_CLI_COMMANDS.autoSync}
              </span>{' '}
              KEEPS SYNCING IN THE BACKGROUND.
            </p>
          </PhaseCard>
        </div>

        {preview && (
          <div
            className="agent-preview glass-lite mt-3 rounded-2xl p-6"
            style={{ borderColor: 'rgb(var(--ember-rgb) / 0.4)' }}
          >
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              SIGNAL ACQUIRED
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-data">
              <span className="text-3xl font-semibold text-ember">
                <span ref={tokensRef}>
                  {formatCompactTokenCount(preview.totalTokens)}
                </span>{' '}
                <span className="text-base font-normal">tokens</span>
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-xl text-zinc-200">
                ~$
                <span ref={usdRef}>
                  {usdDisplayParts(preview.storedCostUsd).number}
                </span>
              </span>
              {topAgentName && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="text-sm text-zinc-400">{topAgentName}</span>
                </>
              )}
            </div>
          </div>
        )}

        {synced && consent.phase !== 'done' && (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <ChoiceCard
                className="agent-consent"
                selected={consent.phase === 'saving' && consent.join}
                disabled={consent.phase === 'saving'}
                onClick={() => void chooseSharing(true)}
                large
              >
                <div className="text-base font-semibold text-zinc-100">
                  Join the public Burn Board
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
                  Publishes your username, aggregate token totals, estimated
                  cost, and agent/model breakdowns. Raw usage and machine
                  details stay private. Leave any time.
                </p>
              </ChoiceCard>
              <ChoiceCard
                className="agent-consent"
                selected={consent.phase === 'saving' && !consent.join}
                disabled={consent.phase === 'saving'}
                onClick={() => void chooseSharing(false)}
                large
              >
                <div className="text-base font-semibold text-zinc-100">
                  Keep usage private
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
                  Your burn stays on your own token dashboard. Nothing is
                  ranked or published. You can join the board later in
                  Settings.
                </p>
              </ChoiceCard>
            </div>
            {consentError && (
              <p role="alert" className="mt-3 text-xs leading-relaxed text-ember">
                {consentError}
              </p>
            )}
          </>
        )}

        {consent.phase === 'done' && (
          <div className="note-enter glass-lite mt-3 rounded-2xl p-6">
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              {consent.joined ? 'ENTRY CONFIRMED' : 'KEPT PRIVATE'}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
              {consent.joined
                ? 'Your burn is live on the public board. Go see where you land.'
                : 'Your totals stay yours. The token dashboard keeps the full picture, and Settings can put you on the board any time.'}
            </p>
          </div>
        )}

        <StageActions>
          {consent.phase === 'done' ? (
            consent.joined ? (
              <>
                <GhostButton
                  noIcon
                  onClick={() => onFinish('/dashboard/tokens')}
                >
                  Token dashboard
                </GhostButton>
                <PrimaryButton
                  emphasized
                  onClick={() => onFinish('/leaderboard?view=tokens&welcome=1')}
                >
                  See the Burn Board
                </PrimaryButton>
              </>
            ) : (
              <>
                <GhostButton
                  noIcon
                  onClick={() => onFinish('/leaderboard?view=tokens')}
                >
                  Peek at the Burn Board
                </GhostButton>
                <PrimaryButton
                  emphasized
                  onClick={() => onFinish('/dashboard/tokens')}
                >
                  Open your token dashboard
                </PrimaryButton>
              </>
            )
          ) : (
            <GhostButton noIcon onClick={() => onFinish('/dashboard/tokens')}>
              Do this later
            </GhostButton>
          )}
        </StageActions>
      </div>
    </StageShell>
  )
}

function PhaseCard({
  index,
  label,
  title,
  done,
  active,
  children
}: {
  index: string
  label: string
  title: string
  done: boolean
  active: boolean
  children: React.ReactNode
}) {
  return (
    <div
      data-agent-phase={label.toLowerCase()}
      className="card-enter glass-lite rounded-2xl p-5 transition-colors duration-300"
      style={{
        borderColor: active ? 'rgb(var(--ember-rgb) / 0.4)' : undefined
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] transition-colors duration-300 ${
            done
              ? 'border-transparent bg-ember text-black'
              : active
              ? 'border-zinc-600 text-zinc-200'
              : 'border-zinc-800 text-zinc-600'
          }`}
        >
          {done ? <IconCheck size={10} /> : index}
        </span>
        <span className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
          {label}
        </span>
        <span className="text-sm font-semibold text-zinc-100">{title}</span>
      </div>
      <div className="mt-4 pl-8">{children}</div>
    </div>
  )
}

function MarkDoneButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-scale mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-800 px-4 py-2 font-mono text-[9px] tracking-[0.25em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
    >
      RAN IT
    </button>
  )
}

function CommandBlock({
  id,
  command,
  copiedCommand,
  onCopy
}: {
  id: string
  command: string
  copiedCommand: string | null
  onCopy: (id: string, text: string) => Promise<void>
}) {
  const copied = copiedCommand === id
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/60 px-3.5 py-2.5">
      <span className="select-all font-data text-[12.5px] text-zinc-200">
        <span className="text-zinc-600">$ </span>
        {command}
      </span>
      <button
        type="button"
        onClick={() => void onCopy(id, command)}
        className="press-scale inline-flex shrink-0 items-center gap-1.5 font-mono text-[9px] tracking-[0.25em] text-zinc-500 transition-colors hover:text-zinc-200"
      >
        <IconCopy size={12} />
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </div>
  )
}
