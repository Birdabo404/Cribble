'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import {
  SOURCES,
  type BoardFeedReport,
  type BurnSource
} from '@/components/leaderboard/burnSource'
import { CrtBurn, type BurnFeed, type BurnSelection } from '@/components/leaderboard/CrtBurn'
import { cursorProfileUrl } from '@/components/leaderboard/crtFeeds'
import { CursorBoard } from '@/components/leaderboard/CursorBoard'
import { leaderboardScrollTo } from '@/components/leaderboard/LeaderboardScrollRuntime'
import { LeaderboardSponsorFlip } from '@/components/leaderboard/LeaderboardSponsorFlip'
import { TokenAgentIcon } from '@/components/leaderboard/TokenAgentIcon'
import { TokenPlayerCard } from '@/components/leaderboard/TokenPlayerCard'
import {
  IconCrown,
  IconFlame,
  IconRefresh,
  IconTrophy,
  IconUsers
} from '@/components/leaderboard/icons'
import {
  personaChipStyle,
  personaDotStyle,
  tokenPersonaVisual
} from '@/components/leaderboard/tokenPersonaVisual'
import { medalA, medalFor, medalGlow, type Medal } from '@/components/leaderboard/types'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { useSettingsModal } from '@/components/settings/SettingsModalContext'
import { fetchMe as requestMe } from '@/lib/client/fetchMe'
import type { CursorBoardRow } from '@/lib/cursorProfileBoard'
import { isProTier } from '@/lib/entitlements'
import { prefersReducedMotion } from '@/lib/motion'
import {
  decimalToApproxNumber,
  exactIntegerToSafeNumber,
  formatApproxUsdNumber,
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
  TokenBoardWindowId
} from '@/lib/tokenLeaderboard'

gsap.registerPlugin(useGSAP)

const WINDOWS: { id: TokenBoardWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: '7d', label: '7D' },
  { id: 'all', label: 'ALL' }
]

// BurnSource lives in burnSource.ts (shared with the CRT wrapper); the
// page keeps importing it from here.
export type { BurnSource } from '@/components/leaderboard/burnSource'

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

function UsdValue({ value, animated = false }: { value: string; animated?: boolean }) {
  const display = usdDisplayParts(value)
  const approximate = decimalToApproxNumber(display.tiny ? '0.01' : value)
  const canAnimate = animated && approximate <= Number.MAX_SAFE_INTEGER

  return (
    <>
      {display.tiny ? '<' : null}
      <span className="lbt-money">$</span>
      {canAnimate ? (
        <AnimatedCounter value={approximate} duration={1100} formatter={formatApproxUsdNumber} />
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

// ?source= is read once at mount (deep links like
// /leaderboard?view=tokens&source=cursor), matching the page's ?view=
// pattern — toggle clicks stay client state only. The shared window
// selection lives here so it survives source flips; each board fetches
// its own API for whichever window is active.
export function TokenBoard({
  burnSource = null,
  linkedStamp = null,
  onOptInOpenChange,
  frozen = false,
  toolbar
}: {
  /** Page-level source override (the coin-up success CTA lands on the
   *  CURSOR source even when this board mounted on CLI). */
  burnSource?: BurnSource | null
  /** Bumped when the viewer links a cursor.com profile mid-session, so
   *  an already-mounted CursorBoard refetches its stale unlinked state. */
  linkedStamp?: number | null
  /** CursorBoard's JOIN modal open state, bubbled to the page's
   *  animation-freeze guard. */
  onOptInOpenChange?: (open: boolean) => void
  /** True while a page-level modal covers the arena (the COIN-UP prompt)
   *  — pauses the burn tube the way the page freeze pauses the CSS. */
  frozen?: boolean
  /** The page's board tabs (GLOBAL / TOKENS / AI / TEAMS). The burn CRT
   *  mounts here, so this view seats the tabs itself — between the stat
   *  strip and the list, where GLOBAL's toolbar row sits under its hero. */
  toolbar?: React.ReactNode
}) {
  const searchParams = useSearchParams()
  const [source, setSource] = useState<BurnSource>(() =>
    searchParams.get('source') === 'cursor' ? 'cursor' : 'cli'
  )
  const [windowId, setWindowId] = useState<TokenBoardWindowId>('season')

  // The CRT's feed: whichever board is active reports its rows here (null
  // while fetching). The burn card's selection lives up here too so the
  // tube can open it from PRESS START and pause while it's up.
  const [feed, setFeed] = useState<BurnFeed | null>(null)
  const [feedFailed, setFeedFailed] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const sourceRef = useRef(source)
  sourceRef.current = source

  // Re-tune: every path that changes what the tube is tuned to (source
  // toggle, window pill, page override) drops the feed and the card in
  // the same commit as the new feed identity, so the tube renders an
  // empty rotation under the new id — clean AWAITING → glitch-in, never
  // a stale rank 1 from the previous feed.
  const retune = useCallback(() => {
    setFeed(null)
    setFeedFailed(false)
    setSelectedUserId(null)
  }, [])

  const handleSourceChange = useCallback(
    (next: BurnSource) => {
      if (next === sourceRef.current) return
      retune()
      setSource(next)
    },
    [retune]
  )

  const handleWindowChange = useCallback(
    (next: TokenBoardWindowId) => {
      retune()
      setWindowId(next)
    },
    [retune]
  )

  useEffect(() => {
    if (burnSource !== null) handleSourceChange(burnSource)
  }, [burnSource, handleSourceChange])

  const handleCliFeed = useCallback(({ rows, failed }: BoardFeedReport<TokenBoardRow>) => {
    setFeed(rows === null ? null : { source: 'cli', rows })
    setFeedFailed(failed)
  }, [])
  const handleCursorFeed = useCallback(({ rows, failed }: BoardFeedReport<CursorBoardRow>) => {
    setFeed(rows === null ? null : { source: 'cursor', rows })
    setFeedFailed(failed)
  }, [])

  const handleOptInOpenChange = useCallback(
    (open: boolean) => {
      setJoinOpen(open)
      onOptInOpenChange?.(open)
    },
    [onOptInOpenChange]
  )

  // PRESS START: CLI rows have a burn card; CURSOR rows have no card and
  // mirror the row's handle link out to cursor.com.
  const handleCrtSelect = useCallback((selection: BurnSelection) => {
    switch (selection.source) {
      case 'cli': {
        setSelectedUserId(selection.row.userId)
        return
      }
      case 'cursor': {
        window.open(
          cursorProfileUrl(selection.row.cursorUsername),
          '_blank',
          'noopener,noreferrer'
        )
        return
      }
      default: {
        const exhaustive: never = selection
        throw new Error(`Unhandled burn selection: ${String(exhaustive)}`)
      }
    }
  }, [])

  const sourceToggle = (
    <div
      className="lb-inset flex items-center gap-0.5 rounded-lg p-0.5"
      role="tablist"
      aria-label="Burn board source"
    >
      {SOURCES.map((item) => {
        const active = item.id === source
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => handleSourceChange(item.id)}
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
  )

  return (
    <>
      {/* ---------- CRT burn mode: the tube above the board, like GLOBAL ---------- */}
      {/* Reveal cascade mirrors GLOBAL's (CRT → stat strip → toolbar row →
          list): 40ms here, then 90 / 140 / 190ms inside the child board. */}
      <section className="lb4-reveal" style={{ ['--rv' as string]: '40ms' }}>
        <CrtBurn
          source={source}
          feed={feed}
          windowId={windowId}
          // A failed fetch is a dead channel (NO CARRIER), not a slow one.
          loading={feed === null && !feedFailed}
          frozen={frozen || selectedUserId !== null || joinOpen}
          onSelect={handleCrtSelect}
        />
      </section>

      {source === 'cursor' ? (
        <CursorBoard
          windowId={windowId}
          onWindowChange={handleWindowChange}
          toolbar={toolbar}
          sourceToggle={sourceToggle}
          linkedStamp={linkedStamp}
          onOptInOpenChange={handleOptInOpenChange}
          onFeed={handleCursorFeed}
        />
      ) : (
        <CliTokenBoard
          windowId={windowId}
          onWindowChange={handleWindowChange}
          toolbar={toolbar}
          sourceToggle={sourceToggle}
          selectedUserId={selectedUserId}
          onSelectUser={setSelectedUserId}
          onFeed={handleCliFeed}
        />
      )}
    </>
  )
}

function CliTokenBoard({
  windowId,
  onWindowChange,
  toolbar,
  sourceToggle,
  selectedUserId,
  onSelectUser,
  onFeed
}: {
  windowId: TokenBoardWindowId
  onWindowChange: (next: TokenBoardWindowId) => void
  /** The page's board tabs, seated on the left of this board's one
   *  toolbar row (GLOBAL's pattern). */
  toolbar?: React.ReactNode
  sourceToggle: React.ReactNode
  /** The open burn card's row, owned by TokenBoard so the CRT's PRESS
   *  START can open it too; null closes it. */
  selectedUserId: number | null
  onSelectUser: (userId: number | null) => void
  /** Reports the landed rows (null while fetching) and the failure state
   *  to the CRT above. */
  onFeed?: (report: BoardFeedReport<TokenBoardRow>) => void
}) {
  const [rows, setRows] = useState<TokenBoardRow[] | null>(null)
  const [totals, setTotals] = useState<TokenBoardTotals | null>(null)
  const [windowMeta, setWindowMeta] = useState<TokenBoardWindow | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const fetchSeq = useRef(0)

  useEffect(() => {
    onFeed?.({ rows, failed })
  }, [rows, failed, onFeed])

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
      // Routed through the leaderboard smoother when it's live (a native
      // scrollIntoView would fight the transform-based smoothing); falls
      // back to scrollIntoView with the same animated/instant intent.
      leaderboardScrollTo(el, !reduced)
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
      <section className="lbt-reveal" style={{ ['--rv' as string]: '90ms' }}>
        <LeaderboardSponsorFlip>
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
              valueStyle={
                leader
                  ? {
                      color: 'rgb(var(--lb-gold))',
                      textShadow: '0 0 12px rgb(var(--lb-gold) / calc(0.4 * var(--lb-glow, 1)))'
                    }
                  : undefined
              }
            >
              {leader ? (
                <span className="block truncate">@{leader.username.toUpperCase()}</span>
              ) : (
                <span className="text-zinc-700">—</span>
              )}
            </StatCell>
          </div>
        </LeaderboardSponsorFlip>
      </section>

      {/* The one toolbar row (GLOBAL's pattern): the page's board tabs on
          the left; fuel toggle, window pills and refresh ride the right
          side, wrapping under the tabs on phones. */}
      <div
        className="lbt-reveal !mt-3 flex flex-wrap items-center justify-between gap-2"
        style={{ ['--rv' as string]: '140ms' }}
      >
        {toolbar}

        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-1">
          {sourceToggle}

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
                    onWindowChange(item.id)
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

      <section className="lbt-reveal relative" style={{ ['--rv' as string]: '190ms' }}>
        <div className="lb-panel relative overflow-hidden">
          {/* header strip folded into the panel's top edge, like STANDINGS */}
          <div className="flex items-baseline justify-between gap-3 border-b border-[rgb(var(--lb-panel-edge)/0.08)] px-4 py-3 md:px-5">
            <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
              BURN BOARD
            </h2>
            {!loading && !failed && (rows?.length ?? 0) > 0 && (
              <span className="text-[10px] tracking-[0.2em] text-zinc-500 tabular-nums">
                {rows!.length} PLAYERS
              </span>
            )}
          </div>
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
              <span className="lbt-money hidden whitespace-nowrap tracking-[0.18em] md:inline">
                MONEY BURNED
              </span>
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
                  leaderBurnUsd={(leader ?? row).burnUsd}
                  isMe={row.userId === currentUserId}
                  rowRef={row.userId === currentUserId ? myRowRef : undefined}
                  onSelect={() => onSelectUser(row.userId)}
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
          onClose={() => onSelectUser(null)}
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

        /* Persona visuals: chips/dots author --pv-hue (bright) and --pv-ink
           (deep) inline; the theme picks which one --pv resolves to here in
           CSS — an inline --pv would win the cascade and never swap. */
        .lbt-pv {
          --pv: var(--pv-hue);
          --pv2: var(--pv2-hue);
        }
        html.light .lbt-pv {
          --pv: var(--pv-ink);
          --pv2: var(--pv2-ink, var(--pv-ink));
        }

        /* Money-green — the hero hue for the sort key. Neon on dark,
           AA green ink on white (glows already drop via --lb-glow). */
        .lbt-money { color: rgb(57 255 136); }
        html.light .lbt-money { color: rgb(21 128 61); }

        /* --- top-3 regalia (adapted from the season board's RankRegalia,
           lbt- prefixed since that component never mounts here) --- */
        .lbt-ring-spin {
          animation: lbt-ring-spin 10s linear infinite;
        }
        @keyframes lbt-ring-spin {
          to { transform: rotate(360deg); }
        }
        /* #2 — light catching polished platinum: one sweep, then rest */
        .lbt-glint {
          animation: lbt-glint-sweep 7.2s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
        }
        @keyframes lbt-glint-sweep {
          0% { transform: rotate(0deg); }
          24%, 100% { transform: rotate(360deg); }
        }
        .lbt-aura {
          animation: lbt-aura-breathe 5.2s ease-in-out infinite;
        }
        @keyframes lbt-aura-breathe {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.07); }
        }
        /* #3 — warm ember breathe, slower and dimmer than the champion */
        .lbt-ember-ring {
          animation: lbt-ember-ring-breathe 4.5s ease-in-out infinite;
        }
        @keyframes lbt-ember-ring-breathe {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.95; }
        }
        /* #1's flame — pinned at the base so the flicker licks upward */
        .lbt-flame {
          transform-origin: 50% 100%;
          animation: lbt-flame-flicker 2.4s ease-in-out infinite;
        }
        html.light .lbt-flame { color: rgb(234 88 12); }
        @keyframes lbt-flame-flicker {
          0%, 100% { transform: scale(1) rotate(-4deg); opacity: 0.92; }
          30% { transform: scale(1.12) rotate(3deg); opacity: 1; }
          55% { transform: scale(0.93) rotate(-2deg); opacity: 0.8; }
          80% { transform: scale(1.05) rotate(4deg); opacity: 1; }
        }
        /* #1's rank plate — slow specular sweep; opacity rides --lb-glow
           so the white flash never smears on light panels */
        .lbt-shimmer {
          pointer-events: none;
          background: linear-gradient(115deg, transparent 25%, rgb(255 255 255 / 0.3) 50%, transparent 75%);
          transform: translateX(-120%);
          animation: lbt-shimmer-sweep 5.8s ease-in-out 1.4s infinite;
          opacity: var(--lb-glow, 1);
        }
        @keyframes lbt-shimmer-sweep {
          0%, 58% { transform: translateX(-120%); }
          82%, 100% { transform: translateX(120%); }
        }

        /* Relative burn bar — scaleX so the reveal stays compositor-only;
           it grows out of the rank gutter just after its row lands. */
        .lbt-burnbar {
          transform-origin: left center;
          animation: lbt-bar-grow 720ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: calc(var(--rd, 0ms) + 180ms);
        }
        @keyframes lbt-bar-grow {
          from { transform: scaleX(0); }
        }

        /* Ember drift — row #1 only, 4 tiny dots rising on GPU transforms.
           Dark mode only: on white they'd read as dirt, not fire. */
        .lbt-embers {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .lbt-embers span {
          position: absolute;
          bottom: -4px;
          width: 3px;
          height: 3px;
          border-radius: 9999px;
          background: rgb(251 146 60);
          opacity: 0;
          animation: lbt-ember-rise 5.2s linear infinite;
        }
        .lbt-embers span:nth-child(1) { left: 6%; }
        .lbt-embers span:nth-child(2) {
          left: 16%;
          width: 2px;
          height: 2px;
          background: rgb(255 214 68);
          animation-delay: 1.6s;
          animation-duration: 6.4s;
        }
        .lbt-embers span:nth-child(3) {
          left: 30%;
          animation-delay: 3.1s;
          animation-duration: 5.8s;
        }
        .lbt-embers span:nth-child(4) {
          left: 42%;
          width: 2px;
          height: 2px;
          background: rgb(249 115 22);
          animation-delay: 4.4s;
          animation-duration: 7s;
        }
        @keyframes lbt-ember-rise {
          0% { transform: translate(0, 0); opacity: 0; }
          12% { opacity: 0.85; }
          60% { opacity: 0.4; }
          100% { transform: translate(6px, -64px); opacity: 0; }
        }
        html.light .lbt-embers { display: none; }

        @media (prefers-reduced-motion: reduce) {
          .lbt-reveal,
          .lbt-row-in,
          .lbt-ring-spin,
          .lbt-glint,
          .lbt-aura,
          .lbt-ember-ring,
          .lbt-flame,
          .lbt-shimmer,
          .lbt-burnbar { animation: none; }
          /* motion-only artifacts — static rings and bars stay */
          .lbt-glint,
          .lbt-shimmer { opacity: 0; }
          .lbt-embers { display: none; }
        }
      `}</style>
    </>
  )
}

function TokenRow({
  row,
  index,
  leaderBurnUsd,
  isMe,
  rowRef,
  onSelect
}: {
  row: TokenBoardRow
  index: number
  leaderBurnUsd: string
  isMe: boolean
  rowRef?: React.Ref<HTMLLIElement>
  onSelect: () => void
}) {
  const medal = medalFor(row.rank)
  const personaVisual = tokenPersonaVisual(row.persona)
  const agentLabel = tokenAgentLabel(row.topAgent)
  const modelLabel = tokenModelLabel(row.topModel)
  const agentTitle = agentLabel
    ? `${agentLabel} is the primary agent${modelLabel ? ` · ${modelLabel} is the primary model` : ''}`
    : row.agents.length > 1
      ? `No clear top agent reported (${row.agents.map((agent) => tokenAgentLabel(agent)).filter(Boolean).join(', ')})`
      : 'Agent not reported'

  // Relative burn bar — sqrt compresses the leader's runaway lead so
  // mid-board rows keep a visible bar instead of a 1px sliver.
  const leaderBurn = decimalToApproxNumber(leaderBurnUsd)
  const burnRatio =
    leaderBurn > 0
      ? Math.sqrt(Math.min(decimalToApproxNumber(row.burnUsd) / leaderBurn, 1))
      : 0

  return (
    <li
      ref={rowRef}
      className={`lbt-row-in ${ROW_GRID} relative border-b border-[rgb(var(--lb-panel-edge)/0.05)] transition-colors last:border-b-0 hover:bg-orange-400/[0.03] ${
        medal ? 'py-[1.15rem]' : 'py-4'
      } ${isMe ? 'bg-orange-400/[0.035]' : ''}`}
      style={{
        ['--rd' as string]: `${Math.min(index, 12) * 34}ms`,
        // Medal wash: strongest in the rank gutter, gone by mid-row, plus a
        // 2px edge bar in the medal hue. Inline background wins over the
        // hover/me tints — champion rows carry their own weather.
        ...(medal
          ? {
              background: `linear-gradient(90deg, ${medalA(medal.rgb, 0.09)}, ${medalA(medal.rgb, 0.03)} 22%, transparent 45%)`,
              boxShadow: `inset 2px 0 0 ${medalA(medal.rgb, 0.7)}`
            }
          : null)
      }}
    >
      {row.rank === 1 && (
        <span aria-hidden className="lbt-embers">
          <span />
          <span />
          <span />
          <span />
        </span>
      )}

      <div className="flex items-center">
        {medal ? (
          <span
            className={`lbt-rankplate relative inline-flex items-center justify-center overflow-hidden [font-family:var(--font-pixel)] ${
              row.rank === 1 ? 'h-9 w-9 text-[14px]' : 'h-8 w-8 text-[13px]'
            }`}
            style={{
              color: medal.fg,
              border: `1px solid ${medalA(medal.rgb, 0.5)}`,
              background: medalA(medal.rgb, 0.08),
              textShadow: `0 0 10px ${medalGlow(medal.rgb, 0.65)}, 0 0 24px ${medalGlow(medal.rgb, 0.3)}`
            }}
          >
            {row.rank}
            {row.rank === 1 && <span aria-hidden className="lbt-shimmer absolute inset-0" />}
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
        <TokenRankAvatar row={row} medal={medal} />
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
              className="lbt-pv h-[5px] w-[5px] shrink-0 rounded-full"
              style={personaDotStyle(personaVisual)}
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
              className="lbt-pv inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.14em]"
              style={personaChipStyle(personaVisual)}
            >
              {personaVisual.flame && <IconFlame size={8} className="shrink-0" />}
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
          {/* Money is the sort key, so it's the hero: money-green pixel
              numerals with a glow the orange tokens now defer to. */}
          <span
            className="lbt-money hidden text-[16px] md:inline"
            style={{
              textShadow: medal
                ? '0 0 14px rgb(57 255 136 / calc(0.45 * var(--lb-glow, 1)))'
                : '0 0 9px rgb(57 255 136 / calc(0.22 * var(--lb-glow, 1)))'
            }}
          >
            <UsdValue value={row.burnUsd} />
          </span>
        </div>
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[7px] tracking-[0.1em] text-zinc-600">
          <span className="lbt-money text-[10px] leading-none tabular-nums tracking-normal md:hidden">
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

      <span
        aria-hidden
        className="lbt-burnbar pointer-events-none absolute bottom-0 left-0 h-[2px]"
        style={{
          width: `${(burnRatio * 100).toFixed(2)}%`,
          background:
            'linear-gradient(90deg, rgb(239 68 68 / 0.85), rgb(249 115 22 / 0.9) 45%, rgb(255 214 68 / 0.95))',
          boxShadow: '0 0 6px rgb(249 115 22 / calc(0.45 * var(--lb-glow, 1)))'
        }}
      />
    </li>
  )
}

/** Row avatar with burn-native medal regalia for the top three. The ring
 *  band is RankRegalia's clip trick — an oversized conic layer clipped by
 *  the overflow-hidden ring wrapper, with the opaque avatar covering the
 *  interior so only a 2px band shows. #1 spins slowly under a breathing
 *  aura and wears this board's flickering flame instead of the season
 *  crown; #2 gets a platinum glint sweep; #3 a bronze ember breathe. */
function TokenRankAvatar({ row, medal }: { row: TokenBoardRow; medal: Medal | null }) {
  const char = (row.displayName || row.username).charAt(0).toUpperCase()

  if (!medal) {
    return (
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 md:h-9 md:w-9">
        <Avatar
          src={row.profileImage}
          char={char}
          handle={row.username}
          imgClassName="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center text-[11px] font-semibold text-zinc-400"
        />
      </span>
    )
  }

  const champion = row.rank === 1
  const ring = champion
    ? `conic-gradient(from 0deg, ${medalA(medal.rgb, 0.35)}, ${medalA(medal.rgb, 0.95)} 80deg, ${medalA(medal.rgb, 1)} 120deg, ${medalA(medal.rgb, 0.4)} 200deg, ${medalA(medal.rgb, 0.85)} 290deg, ${medalA(medal.rgb, 0.35)})`
    : `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.85)}, ${medalA(medal.rgb, 0.22)}, ${medalA(medal.rgb, 0.85)})`

  return (
    <span className="relative h-8 w-8 shrink-0 md:h-9 md:w-9">
      {champion && (
        <span
          aria-hidden
          className="lbt-aura absolute -inset-1 rounded-full"
          style={{ boxShadow: `0 0 14px 3px ${medalGlow(medal.rgb, 0.5)}` }}
        />
      )}
      {row.rank === 3 && (
        <span
          aria-hidden
          className="lbt-ember-ring absolute -inset-1 rounded-full"
          style={{ boxShadow: `0 0 12px 2px ${medalGlow(medal.rgb, 0.55)}` }}
        />
      )}
      <span
        aria-hidden
        className="absolute -inset-[2px] overflow-hidden rounded-full"
        style={{ boxShadow: `0 0 10px ${medalGlow(medal.rgb, champion ? 0.4 : 0.25)}` }}
      >
        <span
          className={`absolute -inset-[30%] ${champion ? 'lbt-ring-spin' : ''}`}
          style={{ background: ring }}
        />
        {row.rank === 2 && (
          <span
            className="lbt-glint absolute -inset-[30%]"
            style={{
              background: `conic-gradient(from 0deg, transparent 328deg, ${medalA(medal.rgb, 0.95)} 348deg, transparent 360deg)`
            }}
          />
        )}
      </span>
      <Avatar
        src={row.profileImage}
        char={char}
        handle={row.username}
        imgClassName="absolute inset-0 h-full w-full rounded-full object-cover"
        fallbackClassName="absolute inset-0 flex items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-zinc-400"
      />
      {champion && (
        <span
          aria-hidden
          className="lbt-flame absolute -right-[6px] -top-[9px] text-orange-400"
          style={{ filter: 'drop-shadow(0 0 4px rgb(249 115 22 / calc(0.8 * var(--lb-glow, 1))))' }}
        >
          <IconFlame size={11} className="block" />
        </span>
      )}
    </span>
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
  const { openSettings } = useSettingsModal()
  return (
    <li className="flex flex-col items-center px-5 py-14 text-center">
      <IconFlame size={24} className="text-orange-400/55" />
      <p className="mt-4 text-[10px] tracking-[0.22em] text-zinc-400">{title}</p>
      <p className="mt-2 max-w-md text-[11px] leading-5 text-zinc-600">{body}</p>
      {showSettings && (
        <button
          type="button"
          onClick={() => openSettings('account')}
          className="mt-5 border border-orange-400/30 bg-orange-400/[0.05] px-3 py-2 text-[9px] tracking-[0.2em] text-orange-300 transition-colors hover:bg-orange-400/[0.1]"
        >
          JOIN THE BURN BOARD
        </button>
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
