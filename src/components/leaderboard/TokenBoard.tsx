'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { formatCompact, formatNumber } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { TokenAgentIcon } from '@/components/leaderboard/TokenAgentIcon'
import { TokenPlayerCard } from '@/components/leaderboard/TokenPlayerCard'
import {
  IconCrown,
  IconFlame,
  IconRefresh,
  IconTrophy,
  IconUsers
} from '@/components/leaderboard/icons'
import { medalA, medalFor, medalGlow } from '@/components/leaderboard/types'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { fetchMe as requestMe } from '@/lib/client/fetchMe'
import { isProTier } from '@/lib/entitlements'
import { prefersReducedMotion } from '@/lib/motion'
import {
  decimalToApproxNumber,
  exactIntegerToSafeNumber,
  formatCompactTokenCount,
  formatExactInteger,
  tokenAgentLabel,
  tokenModelLabel,
  usdDisplayParts
} from '@/lib/tokenLeaderboard'
import type {
  TokenBoardRow,
  TokenBoardTotals,
  TokenBoardWindow,
  TokenBoardWindowId,
  TokenPersonaTone
} from '@/lib/tokenLeaderboard'

gsap.registerPlugin(useGSAP)

const WINDOWS: { id: TokenBoardWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: '7d', label: '7D' },
  { id: 'all', label: 'ALL' }
]

// Mobile is a two-zone layout — identity left, burn metrics right — so the
// rank gutter shrinks to the medal box and the metrics column hugs its
// right-aligned content. The md+ grid is the untouched desktop table.
const ROW_GRID =
  'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] md:grid-cols-[4.2rem_minmax(0,1fr)_8.5rem_8.5rem_7.5rem] items-center gap-2.5 px-3.5 md:gap-3 md:px-5'

interface TokenApiResponse {
  success: boolean
  rows?: TokenBoardRow[]
  totals?: TokenBoardTotals
  window?: TokenBoardWindow
  schemaReady?: boolean
  generatedAt?: string
}

function formatUsd(value: string): string {
  const display = usdDisplayParts(value)
  return `${display.tiny ? '<' : ''}$${display.number}`
}

function formatUsdNumber(value: number): string {
  if (value >= 100_000) return formatCompact(value)
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value >= 1_000 ? 0 : 2,
    maximumFractionDigits: value >= 1_000 ? 0 : 2
  })
}

function UsdValue({ value, animated = false }: { value: string; animated?: boolean }) {
  const display = usdDisplayParts(value)
  const approximate = decimalToApproxNumber(display.tiny ? '0.01' : value)
  const canAnimate = animated && approximate <= Number.MAX_SAFE_INTEGER

  return (
    <>
      {display.tiny ? '<' : null}
      <span className="text-[#39ff88]">$</span>
      {canAnimate ? (
        <AnimatedCounter value={approximate} duration={1100} formatter={formatUsdNumber} />
      ) : (
        display.number
      )}
    </>
  )
}

function TokenValue({ value, animated = false }: { value: string; animated?: boolean }) {
  const safeValue = exactIntegerToSafeNumber(value)
  return animated && safeValue !== null ? (
    <AnimatedCounter
      value={safeValue}
      duration={1100}
      formatter={(next) => formatCompactTokenCount(String(Math.round(next)))}
    />
  ) : (
    <>{formatCompactTokenCount(value)}</>
  )
}

function personaStyle(tone: TokenPersonaTone): React.CSSProperties {
  const colors: Record<TokenPersonaTone, string> = {
    danger: '248 113 113',
    hot: '251 146 60',
    cache: '52 211 153',
    output: '192 132 252',
    neutral: '161 161 170'
  }
  const rgb = colors[tone]
  return {
    color: `rgb(${rgb})`,
    borderColor: `rgb(${rgb} / 0.35)`,
    background: `rgb(${rgb} / 0.07)`
  }
}

export function TokenBoard() {
  const [rows, setRows] = useState<TokenBoardRow[] | null>(null)
  const [totals, setTotals] = useState<TokenBoardTotals | null>(null)
  const [windowId, setWindowId] = useState<TokenBoardWindowId>('season')
  const [windowMeta, setWindowMeta] = useState<TokenBoardWindow | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const fetchSeq = useRef(0)

  // Arrival spotlight (?welcome=1 from onboarding): your row's <li> plus a
  // latch so the ignition can only ever fire on the first data landing.
  const myRowRef = useRef<HTMLLIElement | null>(null)
  const spotlightDone = useRef(false)

  const load = useCallback(async (requestedWindow: TokenBoardWindowId = windowId) => {
    const seq = ++fetchSeq.current
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const query = new URLSearchParams({ window: requestedWindow, timezone })
      const response = await fetch(`/api/leaderboard/tokens?${query}`, {
        cache: 'no-store'
      })
      const data: TokenApiResponse | null = await response.json().catch(() => null)
      if (seq !== fetchSeq.current) return
      if (!response.ok || !data?.success) {
        setFailed(true)
        return
      }

      setRows(Array.isArray(data.rows) ? data.rows : [])
      setTotals(data.totals ?? null)
      setWindowMeta(data.window ?? null)
      setSchemaReady(data.schemaReady !== false)
      setFailed(false)
    } catch {
      if (seq === fetchSeq.current) setFailed(true)
    }
  }, [windowId])

  useEffect(() => {
    void load(windowId)
  }, [load, windowId])

  useEffect(() => {
    void requestMe().then((result) => {
      if (result.ok && result.data.user?.id) setCurrentUserId(Number(result.data.user.id))
    })
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(windowId)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load, windowId])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([load(windowId), new Promise((resolve) => setTimeout(resolve, 500))])
    setRefreshing(false)
  }, [load, windowId])

  // Fresh from onboarding (?welcome=1): the moment the board AND your
  // identity have both landed, scroll your row center-stage and play a
  // one-time ignition pulse on it. The latch trips on that first landing
  // whatever it holds, so refetches and window flips can never re-fire it.
  // Not opted in / empty board → your row isn't there → nothing happens.
  useGSAP(
    () => {
      if (spotlightDone.current || rows === null || currentUserId === null) return
      spotlightDone.current = true
      if (new URLSearchParams(window.location.search).get('welcome') !== '1') return
      const el = myRowRef.current
      if (!el) return

      const reduced =
        prefersReducedMotion() || document.documentElement.dataset.motion === 'reduced'
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
      if (reduced) return

      // Ignition: flare in the Burn Board orange, then decay. clearProps
      // hands the row back to its class-based YOU wash at the end.
      const idle = '0 0 0 0px rgba(251,146,60,0), inset 0 0 0 0px rgba(251,146,60,0)'
      gsap
        .timeline({ delay: 0.35 })
        .fromTo(
          el,
          { backgroundColor: 'rgba(251,146,60,0)', boxShadow: idle },
          {
            backgroundColor: 'rgba(251,146,60,0.16)',
            boxShadow:
              '0 0 36px 2px rgba(251,146,60,0.3), inset 0 0 0 1px rgba(251,146,60,0.65)',
            duration: 0.35,
            ease: 'power2.out'
          }
        )
        .to(el, {
          backgroundColor: 'rgba(251,146,60,0)',
          boxShadow: idle,
          duration: 1.25,
          ease: 'power2.inOut',
          clearProps: 'backgroundColor,boxShadow'
        })
    },
    { dependencies: [rows, currentUserId] }
  )

  const loading = rows === null && !failed
  const leader = rows?.[0] ?? null
  const selectedRow = rows?.find((row) => row.userId === selectedUserId) ?? null

  return (
    <>
      <section className="lbt-reveal">
        <div className="lb-panel grid grid-cols-2 overflow-hidden md:grid-cols-4">
          <StatCell
            divider={0}
            icon={<IconUsers size={11} className="text-zinc-600" />}
            label="PLAYERS"
            hint="opted in"
          >
            <AnimatedCounter
              value={totals?.pilots ?? 0}
              duration={1000}
              formatter={(value) => formatNumber(Math.round(value))}
            />
          </StatCell>

          <StatCell
            divider={1}
            icon={<IconFlame size={11} className="text-orange-400" />}
            label="TOKENS TORCHED"
            hint={windowMeta?.label.toLowerCase()}
          >
            <TokenValue value={totals?.totalTokens ?? '0'} animated />
          </StatCell>

          <StatCell
            divider={2}
            icon={<IconTrophy size={11} className="text-orange-400" />}
            label="EST. BURN"
            hint="not a billing receipt"
          >
            <UsdValue value={totals?.burnUsd ?? '0'} animated />
          </StatCell>

          <StatCell
            divider={3}
            icon={<IconCrown size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />}
            label="TOP BURNER"
            hint={leader ? formatUsd(leader.burnUsd) : undefined}
          >
            {leader ? (
              <span className="block truncate">@{leader.username.toUpperCase()}</span>
            ) : (
              <span className="text-zinc-700">—</span>
            )}
          </StatCell>
        </div>
      </section>

      <section className="lbt-reveal relative" style={{ ['--rv' as string]: '80ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
              BURN BOARD
            </h2>
            {!loading && !failed && (rows?.length ?? 0) > 0 && (
              <span className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                {rows!.length} PLAYERS
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div
              className="lb-inset flex items-center gap-0.5 rounded-lg p-0.5"
              role="tablist"
              aria-label="Token leaderboard period"
            >
              {WINDOWS.map((item) => {
                const active = item.id === windowId
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      if (item.id === windowId) return
                      setRows(null)
                      setFailed(false)
                      setWindowId(item.id)
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.2em] transition-colors ${
                      active ? 'text-orange-300' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                    style={
                      active
                        ? {
                            border: '1px solid rgb(251 146 60 / 0.35)',
                            background: 'rgb(251 146 60 / 0.06)'
                          }
                        : { border: '1px solid transparent' }
                    }
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="lb-inset flex items-center gap-2 rounded-lg px-3 py-2 text-[9px] tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-100 disabled:cursor-wait"
              aria-label="Refresh token leaderboard"
            >
              <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{refreshing ? 'SYNCING' : 'REFRESH'}</span>
            </button>
          </div>
        </div>

        <div className="lb-panel relative overflow-hidden">
          <div
            className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[9px] tracking-[0.3em] text-zinc-500`}
          >
            <div>
              <span className="md:hidden">#</span>
              <span className="hidden md:inline">RANK</span>
            </div>
            <div>PLAYER</div>
            <div className="hidden md:block">TOP AGENT</div>
            <div className="hidden text-right text-orange-300 md:block">TOKENS BURNED</div>
            <div className="text-right">
              <span className="text-orange-300 md:hidden">TOKENS BURNED</span>
              <span className="hidden md:inline">EST. COST</span>
            </div>
          </div>

          <ul className="relative">
            {loading && Array.from({ length: 7 }, (_, index) => <SkeletonRow key={index} index={index} />)}

            {failed && (
              <li className="flex flex-col items-center gap-4 py-14 text-center">
                <span className="text-xs tracking-[0.15em] text-zinc-500">
                  The Burn Board failed to load.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFailed(false)
                    setRows(null)
                    void load(windowId)
                  }}
                  className="lb-inset flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  <IconRefresh size={11} />
                  RETRY
                </button>
              </li>
            )}

            {!loading && !failed && !schemaReady && (
              <EmptyState
                title="THE FUSE IS WIRED"
                body="The page is ready, but the private token leaderboard migration has not been installed yet."
                showSettings={false}
              />
            )}

            {!loading && !failed && schemaReady && (rows?.length ?? 0) === 0 && (
              <EmptyState
                title="NO ONE HAS VOLUNTEERED FOR PUBLIC HUMILIATION YET"
                body="Sync some token usage, then opt in from Account Settings. Raw daily usage stays private."
                showSettings
              />
            )}

            {!loading &&
              !failed &&
              schemaReady &&
              rows?.map((row, index) => (
                <TokenRow
                  key={row.userId}
                  row={row}
                  index={index}
                  isMe={row.userId === currentUserId}
                  rowRef={row.userId === currentUserId ? myRowRef : undefined}
                  onSelect={() => setSelectedUserId(row.userId)}
                />
              ))}
          </ul>
        </div>

        <p className="mt-3 text-center text-[9px] leading-5 tracking-[0.22em] text-zinc-600">
          RANKED BY ESTIMATED USD BURN · OPT-IN · SELF-REPORTED · NOT A BILLING RECEIPT
        </p>
      </section>

      {selectedRow && (
        <TokenPlayerCard
          key={`${windowId}-${selectedRow.userId}`}
          row={selectedRow}
          isYou={selectedRow.userId === currentUserId}
          windowLabel={windowMeta?.label ?? WINDOWS.find((item) => item.id === windowId)?.label ?? 'TOKENS'}
          onClose={() => setSelectedUserId(null)}
        />
      )}

      <style jsx global>{`
        .lbt-reveal {
          animation: lbt-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        .lbt-row-in {
          animation: lbt-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rd, 0ms);
        }
        @keyframes lbt-reveal-in {
          from { opacity: 0; transform: translateY(14px); }
        }
        @keyframes lbt-row-enter {
          from { opacity: 0; transform: translateY(8px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lbt-reveal,
          .lbt-row-in { animation: none; }
        }
      `}</style>
    </>
  )
}

function TokenRow({
  row,
  index,
  isMe,
  rowRef,
  onSelect
}: {
  row: TokenBoardRow
  index: number
  isMe: boolean
  rowRef?: React.Ref<HTMLLIElement>
  onSelect: () => void
}) {
  const medal = medalFor(row.rank)
  const agentLabel = tokenAgentLabel(row.topAgent)
  const modelLabel = tokenModelLabel(row.topModel)
  const agentTitle = agentLabel
    ? `${agentLabel} is the primary agent${modelLabel ? ` · ${modelLabel} is the primary model` : ''}`
    : row.agents.length > 1
      ? `No clear top agent reported (${row.agents.map((agent) => tokenAgentLabel(agent)).filter(Boolean).join(', ')})`
      : 'Agent not reported'

  return (
    <li
      ref={rowRef}
      className={`lbt-row-in ${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.05)] py-4 last:border-b-0 ${
        isMe ? 'bg-orange-400/[0.035]' : ''
      }`}
      style={{ ['--rd' as string]: `${Math.min(index, 12) * 34}ms` }}
    >
      <div className="flex items-center">
        {medal ? (
          <span
            className="inline-flex h-8 w-8 items-center justify-center text-[11px] [font-family:var(--font-pixel)]"
            style={{
              color: medal.fg,
              border: `1px solid ${medalA(medal.rgb, 0.5)}`,
              background: medalA(medal.rgb, 0.08),
              textShadow: `0 0 10px ${medalGlow(medal.rgb, 0.55)}`
            }}
          >
            {row.rank}
          </span>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
            {row.rank}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open token profile for ${row.displayName}`}
        className="group flex min-w-0 items-center gap-2.5 text-left md:gap-3"
      >
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 md:h-9 md:w-9">
          <Avatar
            src={row.profileImage}
            char={(row.displayName || row.username).charAt(0).toUpperCase()}
            imgClassName="h-full w-full object-cover"
            fallbackClassName="flex h-full w-full items-center justify-center text-[11px] font-semibold text-zinc-400"
          />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-display text-[13px] font-medium tracking-tight text-zinc-100 transition-colors group-hover:text-orange-300">
              {row.displayName}
            </span>
            {isProTier(row.tier) && <VerifiedBadge size={14} />}
            {row.team && <TeamMiniLogo team={row.team} size={14} />}
            {isMe && <span className="text-[8px] tracking-[0.16em] text-orange-400">YOU</span>}
          </span>
          {/* Mobile tool line — the persona chip trades down to a toned dot so
              the agent identity gets the space instead. Full persona still
              shows in the tap-through player card. */}
          <span className="mt-1 flex min-w-0 items-center gap-1.5 md:hidden" title={agentTitle}>
            <span
              className="h-[5px] w-[5px] shrink-0 rounded-full"
              style={{ background: personaStyle(row.persona.tone).color }}
              role="img"
              aria-label={row.persona.label}
            />
            <TokenAgentIcon agent={row.topAgent} size={12} bare mixed={row.agents.length > 1} />
            <span className="min-w-0 truncate text-[10px] leading-none text-zinc-300">
              <span className="font-medium">
                {agentLabel ?? (row.agents.length > 1 ? 'Mixed' : 'Unknown')}
              </span>
              {modelLabel && <span className="text-zinc-600"> · {modelLabel}</span>}
            </span>
          </span>
          <span className="mt-1 hidden min-w-0 items-center gap-1.5 md:flex">
            <span
              className="shrink-0 border px-1.5 py-0.5 text-[7px] font-semibold tracking-[0.14em]"
              style={personaStyle(row.persona.tone)}
            >
              {row.persona.label}
            </span>
            {row.provisional && (
              <span
                className="shrink-0 text-[7px] tracking-[0.12em] text-zinc-600"
                title="Fewer than 3 active sync days"
              >
                PROVISIONAL
              </span>
            )}
          </span>
        </span>
      </button>

      <div className="hidden min-w-0 items-center gap-2.5 md:flex" title={agentTitle}>
        <TokenAgentIcon agent={row.topAgent} size={18} mixed={row.agents.length > 1} />
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-medium text-zinc-300">
            {agentLabel ?? (row.agents.length > 1 ? 'Mixed' : 'Unknown')}
          </span>
          <span className="mt-0.5 block truncate text-[8px] text-zinc-600">
            {modelLabel ?? 'Model not reported'}
          </span>
        </span>
      </div>

      <div className="hidden text-right md:block" title={`${formatExactInteger(row.totalTokens)} tokens`}>
        <div
          className="text-[15px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(251 146 60)',
            textShadow: medal
              ? '0 0 12px rgb(249 115 22 / calc(0.42 * var(--lb-glow, 1)))'
              : '0 0 9px rgb(249 115 22 / calc(0.2 * var(--lb-glow, 1)))'
          }}
        >
          {formatCompactTokenCount(row.totalTokens)}
        </div>
        <div className="mt-1 text-[7px] tracking-[0.16em] text-orange-400/45">
          TOKENS
        </div>
      </div>
      {/* On mobile this cell is the whole money story: glowing token count on
          top, est. cost beneath. Tool identity lives on the player cell now. */}
      <div className="text-right">
        <div className="text-[15px] leading-none tabular-nums text-orange-300 [font-family:var(--font-pixel)]">
          <span
            className="md:hidden"
            style={{
              textShadow: medal
                ? '0 0 12px rgb(249 115 22 / calc(0.42 * var(--lb-glow, 1)))'
                : '0 0 9px rgb(249 115 22 / calc(0.2 * var(--lb-glow, 1)))'
            }}
          >
            {formatCompactTokenCount(row.totalTokens)}
          </span>
          <span className="hidden text-zinc-200 md:inline">
            <UsdValue value={row.burnUsd} />
          </span>
        </div>
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[7px] tracking-[0.1em] text-zinc-600">
          <span className="text-[10px] leading-none tabular-nums tracking-normal text-zinc-400 md:hidden">
            <UsdValue value={row.burnUsd} />
            <span
              className="ml-1 text-[7px] tracking-[0.1em] text-zinc-600"
              title={row.provisional ? 'Estimate · fewer than 3 active sync days' : undefined}
            >
              EST.{row.provisional ? '*' : ''}
            </span>
          </span>
          <span className="hidden md:inline">ESTIMATE</span>
        </div>
      </div>
    </li>
  )
}

function EmptyState({
  title,
  body,
  showSettings
}: {
  title: string
  body: string
  showSettings: boolean
}) {
  return (
    <li className="flex flex-col items-center px-5 py-14 text-center">
      <IconFlame size={24} className="text-orange-400/55" />
      <p className="mt-4 text-[10px] tracking-[0.22em] text-zinc-400">{title}</p>
      <p className="mt-2 max-w-md text-[11px] leading-5 text-zinc-600">{body}</p>
      {showSettings && (
        <Link
          href="/settings/account"
          className="mt-5 border border-orange-400/30 bg-orange-400/[0.05] px-3 py-2 text-[9px] tracking-[0.2em] text-orange-300 transition-colors hover:bg-orange-400/[0.1]"
        >
          JOIN THE BURN BOARD
        </Link>
      )}
    </li>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <li
      className="lbt-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)]"
      style={{ ['--rd' as string]: `${index * 45}ms` }}
    >
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        <span className="flex items-center gap-2.5 md:gap-3">
          <span className="h-8 w-8 shrink-0 rounded-full bg-[rgb(var(--lb-panel-edge)/0.05)] md:h-9 md:w-9" />
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="h-3 w-28 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
            <span className="h-2.5 w-24 rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:hidden" />
          </span>
        </span>
        <span className="hidden h-8 w-24 rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-4 w-20 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.06)] md:block" />
        <span className="flex flex-col items-end gap-1.5 justify-self-end">
          <span className="h-4 w-16 rounded bg-[rgb(var(--lb-panel-edge)/0.06)] md:w-24" />
          <span className="h-2.5 w-20 rounded bg-[rgb(var(--lb-panel-edge)/0.05)] md:hidden" />
        </span>
      </div>
    </li>
  )
}

function StatCell({
  divider,
  icon,
  label,
  hint,
  valueStyle,
  children
}: {
  divider: number
  icon: React.ReactNode
  label: string
  hint?: string
  valueStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  const divClass = (() => {
    if (divider === 0) return ''
    if (divider === 1) return 'border-l border-[rgb(var(--lb-panel-edge)/0.08)]'
    if (divider === 2) {
      return 'border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-l md:border-t-0'
    }
    return 'border-l border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0'
  })()

  return (
    <div className={`flex min-w-0 flex-col items-center overflow-hidden px-4 py-4 text-center ${divClass}`}>
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[9px] tracking-[0.16em] sm:tracking-[0.28em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div
        className="mt-2.5 max-w-full truncate text-[clamp(11px,2.6vw,16px)] text-zinc-50 tabular-nums [font-family:var(--font-pixel)]"
        style={valueStyle}
      >
        {children}
      </div>
      {hint && <div className="mt-1 max-w-full truncate text-[9px] tracking-[0.16em] text-zinc-600">{hint}</div>}
    </div>
  )
}
