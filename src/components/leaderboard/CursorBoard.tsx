'use client'

// The CURSOR source of THE BURN board: opted-in users ranked by the token
// sums of their scraped public cursor.com profile — the no-CLI path onto
// the board. Data comes from /api/leaderboard/cursor-agents with the token
// board's window semantics; the visual system (row grid, medals, pixel
// numerals, stat strip) mirrors TokenBoard so flipping the source toggle
// reads as the same board wearing different fuel.

import { useCallback, useEffect, useRef, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import type { BoardFeedReport } from '@/components/leaderboard/burnSource'
import { CursorOptInModal } from '@/components/leaderboard/CursorOptInModal'
import { LeaderboardSponsorFlip } from '@/components/leaderboard/LeaderboardSponsorFlip'
import {
  IconBolt,
  IconCrown,
  IconFlame,
  IconRefresh,
  IconUsers
} from '@/components/leaderboard/icons'
import { medalA, medalFor, medalGlow, type Medal } from '@/components/leaderboard/types'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { useSettingsModal } from '@/components/settings/SettingsModalContext'
import { isSettingsSectionId, type SettingsSectionId } from '@/components/settings/sectionIds'
import { fetchMe as requestMe } from '@/lib/client/fetchMe'
import type {
  CursorBoardRow,
  CursorBoardTotals,
  CursorBoardWindow,
  CursorBoardWindowId
} from '@/lib/cursorProfileBoard'
import { isProTier } from '@/lib/entitlements'
import {
  exactIntegerToSafeNumber,
  formatCompactTokenCount,
  formatExactInteger
} from '@/lib/tokenLeaderboard'

const WINDOWS: { id: CursorBoardWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: '7d', label: '7D' },
  { id: 'all', label: 'ALL' }
]

// Two-zone mobile layout like TokenBoard: identity left, metrics right.
// Desktop: RANK | PLAYER | TOP MODELS | AGENTS | STREAK | TOKENS, with the
// sort key (tokens) rightmost, matching the CLI board's money column.
const ROW_GRID =
  'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] md:grid-cols-[4.2rem_minmax(0,1fr)_minmax(0,9.5rem)_6.5rem_5.5rem_8.5rem] items-center gap-2.5 px-3.5 md:gap-3 md:px-5'

// The settings agent registers a 'cursor-profile' section; until that id
// lands in SETTINGS_SECTION_IDS the CTA falls back to the account tab.
const CURSOR_PROFILE_SECTION = 'cursor-profile'

function cursorProfileSection(): SettingsSectionId {
  return isSettingsSectionId(CURSOR_PROFILE_SECTION) ? CURSOR_PROFILE_SECTION : 'account'
}

const LINK_CTA = 'LINK YOUR CURSOR.COM PROFILE — NO CLI NEEDED'

/** Where the signed-in viewer stands with the CURSOR board: resolved
 *  from /api/user/me plus /api/user/cursor-profile. Drives which opt-in
 *  affordances render (JOIN button, empty-state CTA, footer CTA). */
type ViewerLinkState = 'loading' | 'signedOut' | 'unlinked' | 'linked'

interface CursorApiResponse {
  success: boolean
  rows?: CursorBoardRow[]
  totals?: CursorBoardTotals
  window?: CursorBoardWindow
  schemaReady?: boolean
  generatedAt?: string
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

export function CursorBoard({
  windowId,
  onWindowChange,
  toolbar,
  sourceToggle,
  linkedStamp = null,
  onOptInOpenChange,
  onFeed
}: {
  windowId: CursorBoardWindowId
  onWindowChange: (next: CursorBoardWindowId) => void
  /** The page's board tabs, seated on the left of this board's one
   *  toolbar row (GLOBAL's pattern). */
  toolbar?: React.ReactNode
  sourceToggle: React.ReactNode
  /** Bumped when the viewer links a cursor.com profile elsewhere on the
   *  page (the coin-up prompt) — refetches rows + viewer link state so a
   *  board mounted with stale "unlinked" state catches up. */
  linkedStamp?: number | null
  /** Reports the JOIN-button modal's open state up to the page, which
   *  freezes the arena's ambient animation while the backdrop blur covers
   *  it (same guard the auto prompt engages). */
  onOptInOpenChange?: (open: boolean) => void
  /** Reports the landed rows (null while fetching) and the failure state
   *  to the CRT above the board, so the tube can cycle the top burners of
   *  this source — or drop to NO CARRIER when the fetch dies. */
  onFeed?: (report: BoardFeedReport<CursorBoardRow>) => void
}) {
  const [rows, setRows] = useState<CursorBoardRow[] | null>(null)
  const [totals, setTotals] = useState<CursorBoardTotals | null>(null)
  const [windowMeta, setWindowMeta] = useState<CursorBoardWindow | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [viewer, setViewer] = useState<ViewerLinkState>('loading')
  const [optInOpen, setOptInOpen] = useState(false)
  const fetchSeq = useRef(0)
  const { openSettings } = useSettingsModal()

  useEffect(() => {
    onFeed?.({ rows, failed })
  }, [rows, failed, onFeed])

  const load = useCallback(async (requestedWindow: CursorBoardWindowId = windowId) => {
    const seq = ++fetchSeq.current
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const query = new URLSearchParams({ window: requestedWindow, timezone })
      const response = await fetch(`/api/leaderboard/cursor-agents?${query}`, {
        cache: 'no-store'
      })
      const data: CursorApiResponse | null = await response.json().catch(() => null)
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
    let cancelled = false
    void requestMe().then(async (result) => {
      if (cancelled) return
      if (!(result.ok && result.data.user?.id)) {
        setViewer('signedOut')
        return
      }
      setCurrentUserId(Number(result.data.user.id))
      try {
        const response = await fetch('/api/user/cursor-profile', {
          credentials: 'include',
          cache: 'no-store'
        })
        const data: { success?: unknown; linked?: unknown } | null = await response
          .json()
          .catch(() => null)
        if (cancelled) return
        // Never demote an established 'linked': the coin-up prompt may
        // have landed a claim while this mount-time GET was in flight.
        setViewer((prev) =>
          prev === 'linked'
            ? prev
            : data?.success === true && data.linked === true
              ? 'linked'
              : 'unlinked'
        )
      } catch {
        // Status unknown: offer the opt-in anyway — re-claiming your own
        // handle is a harmless no-op server-side. Same in-flight guard:
        // a network hiccup must not resurface JOIN for a linked viewer.
        if (!cancelled) setViewer((prev) => (prev === 'linked' ? prev : 'unlinked'))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A mid-session link (the coin-up prompt fired while this board was
  // already mounted) flips the viewer straight to linked — the claim
  // just succeeded, no need to re-ask the API — and refetches the rows
  // so the new player appears.
  useEffect(() => {
    if (linkedStamp === null) return
    setViewer('linked')
    void load(windowId)
  }, [linkedStamp, load, windowId])

  // The JOIN modal's open state feeds the page's animation freeze. The
  // cleanup handles unmount-while-open (source/tab switches) too.
  useEffect(() => {
    if (!optInOpen) return
    onOptInOpenChange?.(true)
    return () => onOptInOpenChange?.(false)
  }, [optInOpen, onOptInOpenChange])

  // Signed-out viewers get sent to login; the board deep link brings
  // them straight back to this source after auth.
  const openOptIn = useCallback(() => {
    if (viewer === 'signedOut') {
      window.location.assign('/login')
      return
    }
    setOptInOpen(true)
  }, [viewer])

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

  const loading = rows === null && !failed
  const leader = rows?.[0] ?? null
  const onBoard =
    currentUserId !== null && (rows?.some((row) => row.userId === currentUserId) ?? false)
  const agentsTotal = (totals?.agentsLocal ?? 0) + (totals?.agentsCloud ?? 0)
  const canJoin = (viewer === 'signedOut' || viewer === 'unlinked') && schemaReady

  return (
    <>
      <section className="lbc-reveal" style={{ ['--rv' as string]: '90ms' }}>
        <LeaderboardSponsorFlip>
          <div className="lb-panel grid grid-cols-2 overflow-hidden md:grid-cols-4">
            <StatCell
              divider={0}
              icon={<IconUsers size={11} className="text-zinc-600" />}
              label="PLAYERS"
              hint="linked profiles"
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
              icon={<IconBolt size={11} className="text-orange-400" />}
              label="AGENTS RUN"
              hint={
                totals
                  ? `${formatNumber(totals.agentsLocal)} local · ${formatNumber(totals.agentsCloud)} cloud`
                  : undefined
              }
            >
              <AnimatedCounter
                value={agentsTotal}
                duration={1000}
                formatter={(value) => formatNumber(Math.round(value))}
              />
            </StatCell>

            <StatCell
              divider={3}
              icon={<IconCrown size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />}
              label="TOP BURNER"
              hint={leader ? `${formatCompactTokenCount(leader.tokens)} tokens` : undefined}
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
                <span className="block truncate">@{leader.cursorUsername.toUpperCase()}</span>
              ) : (
                <span className="text-zinc-700">—</span>
              )}
            </StatCell>
          </div>
        </LeaderboardSponsorFlip>
      </section>

      {/* The one toolbar row (GLOBAL's pattern): the page's board tabs on
          the left; fuel toggle, window pills, refresh and JOIN ride the
          right side, wrapping under the tabs on phones. */}
      <div
        className="lbc-reveal !mt-3 flex flex-wrap items-center justify-between gap-2"
        style={{ ['--rv' as string]: '140ms' }}
      >
        {toolbar}

        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-1">
          {sourceToggle}

          <div
            className="lb-inset flex items-center gap-0.5 rounded-lg p-0.5"
            role="tablist"
            aria-label="Cursor leaderboard period"
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
            aria-label="Refresh cursor leaderboard"
          >
            <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{refreshing ? 'SYNCING' : 'REFRESH'}</span>
          </button>

          {canJoin && (
            <button
              type="button"
              onClick={openOptIn}
              className="flex items-center gap-2 rounded-lg border border-orange-400/40 bg-orange-400/[0.08] px-3 py-2 text-[9px] tracking-[0.2em] text-orange-300 transition-colors hover:bg-orange-400/[0.16]"
            >
              <IconFlame size={11} />
              <span>
                JOIN<span className="hidden sm:inline"> THE BOARD</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <section className="lbc-reveal relative" style={{ ['--rv' as string]: '190ms' }}>
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
            <div className="hidden md:block">TOP MODELS</div>
            <div className="hidden text-right md:block">AGENTS</div>
            <div className="hidden text-right md:block">STREAK</div>
            <div className="text-right text-orange-300">TOKENS BURNED</div>
          </div>

          <ul className="relative">
            {loading && Array.from({ length: 7 }, (_, index) => <SkeletonRow key={index} index={index} />)}

            {failed && (
              <li className="flex flex-col items-center gap-4 py-14 text-center">
                <span className="text-xs tracking-[0.15em] text-zinc-500">
                  The Cursor board failed to load.
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
                title="BOARD WARMING UP"
                body="The page is ready, but the cursor profile migration has not been installed yet."
              />
            )}

            {!loading && !failed && schemaReady && (rows?.length ?? 0) === 0 && (
              <EmptyState
                title="NO CURSOR PROFILES ON THE BOARD YET"
                body="Set your cursor.com profile to public, claim your handle, and your burn shows up instantly. Works from any machine — no CLI needed."
                onLink={viewer === 'linked' ? undefined : openOptIn}
              />
            )}

            {!loading &&
              !failed &&
              schemaReady &&
              rows?.map((row, index) => (
                <CursorRow
                  key={row.userId}
                  row={row}
                  index={index}
                  isMe={row.userId === currentUserId}
                  justLinked={linkedStamp !== null && row.userId === currentUserId}
                />
              ))}
          </ul>
        </div>

        {!loading && !failed && schemaReady && (rows?.length ?? 0) > 0 && currentUserId !== null && !onBoard && viewer !== 'loading' && (
          <div className="mt-3 flex justify-center">
            {viewer === 'linked' ? (
              // Linked but not ranked: visibility is off or the last sync
              // failed — that is managed in settings, not re-claimed.
              <button
                type="button"
                onClick={() => openSettings(cursorProfileSection())}
                className="border border-orange-400/30 bg-orange-400/[0.05] px-3 py-2 text-[9px] tracking-[0.2em] text-orange-300 transition-colors hover:bg-orange-400/[0.1]"
              >
                LINKED, BUT NOT RANKED — CHECK YOUR PROFILE SETTINGS
              </button>
            ) : (
              <button
                type="button"
                onClick={openOptIn}
                className="border border-orange-400/30 bg-orange-400/[0.05] px-3 py-2 text-[9px] tracking-[0.2em] text-orange-300 transition-colors hover:bg-orange-400/[0.1]"
              >
                {LINK_CTA}
              </button>
            )}
          </div>
        )}

        <p className="mt-3 text-center text-[9px] leading-5 tracking-[0.22em] text-zinc-600">
          RANKED BY CURSOR.COM PROFILE TOKENS · OPT-IN · SCRAPED FROM PUBLIC PROFILES · NO CLI NEEDED
        </p>
      </section>

      {optInOpen && (
        <CursorOptInModal
          rankWindow={windowId}
          onClose={() => setOptInOpen(false)}
          onLinked={() => {
            setViewer('linked')
            void load(windowId)
          }}
        />
      )}

      <style jsx global>{`
        .lbc-reveal {
          animation: lbc-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        .lbc-row-in {
          animation: lbc-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rd, 0ms);
        }
        @keyframes lbc-reveal-in {
          from { opacity: 0; transform: translateY(14px); }
        }
        @keyframes lbc-row-enter {
          from { opacity: 0; transform: translateY(8px); }
        }
        html.light .lbc-flame { color: rgb(234 88 12); }
        /* Arrival flash for a freshly claimed row — one ember pulse on
           top of the entrance, then the row settles into its YOU wash. */
        .lbc-row-claimed {
          animation:
            lbc-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards,
            lbc-claim-flash 2.2s ease-out backwards;
          animation-delay: var(--rd, 0ms);
        }
        @keyframes lbc-claim-flash {
          0%, 100% { box-shadow: inset 0 0 0 0 rgb(251 146 60 / 0); }
          18% {
            background-color: rgb(251 146 60 / 0.14);
            box-shadow: inset 0 0 0 1px rgb(251 146 60 / 0.55);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lbc-reveal,
          .lbc-row-in,
          .lbc-row-claimed { animation: none; }
        }
      `}</style>
    </>
  )
}

function CursorRow({
  row,
  index,
  isMe,
  justLinked = false
}: {
  row: CursorBoardRow
  index: number
  isMe: boolean
  /** One-shot arrival flash for a row that just claimed its handle. */
  justLinked?: boolean
}) {
  const medal = medalFor(row.rank)
  const agentsTotal = row.agentsLocal + row.agentsCloud
  const models = row.topModels.slice(0, 2)
  const extraModels = row.topModels.length - models.length
  const modelsTitle =
    row.topModels.length > 0 ? `Top models: ${row.topModels.join(', ')}` : 'No models reported'
  const agentsTitle = `${formatNumber(row.agentsLocal)} local · ${formatNumber(row.agentsCloud)} cloud agents`
  const streakTitle = `Current streak ${formatNumber(row.currentStreak)} days · longest ${formatNumber(row.longestStreak)}`
  const profileUrl = `https://cursor.com/@${encodeURIComponent(row.cursorUsername)}`

  return (
    <li
      className={`lbc-row-in ${ROW_GRID} relative border-b border-[rgb(var(--lb-panel-edge)/0.05)] transition-colors last:border-b-0 hover:bg-orange-400/[0.03] ${
        medal ? 'py-[1.15rem]' : 'py-4'
      } ${isMe ? 'bg-orange-400/[0.035]' : ''} ${justLinked ? 'lbc-row-claimed' : ''}`}
      style={{
        ['--rd' as string]: `${Math.min(index, 12) * 34}ms`,
        ...(medal
          ? {
              background: `linear-gradient(90deg, ${medalA(medal.rgb, 0.09)}, ${medalA(medal.rgb, 0.03)} 22%, transparent 45%)`,
              boxShadow: `inset 2px 0 0 ${medalA(medal.rgb, 0.7)}`
            }
          : null)
      }}
    >
      <div className="flex items-center">
        {medal ? (
          <span
            className={`relative inline-flex items-center justify-center overflow-hidden [font-family:var(--font-pixel)] ${
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
          </span>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
            {row.rank}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
        <CursorRankAvatar row={row} medal={medal} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-display text-[13px] font-medium tracking-tight text-zinc-100">
              {row.displayName}
            </span>
            {isProTier(row.tier) && <VerifiedBadge size={14} />}
            {row.team && <TeamMiniLogo team={row.team} size={14} />}
            {isMe && <span className="text-[8px] tracking-[0.16em] text-orange-400">YOU</span>}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5">
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open cursor.com/@${row.cursorUsername}`}
              className="shrink-0 truncate text-[10px] leading-none text-zinc-500 transition-colors hover:text-orange-300"
            >
              @{row.cursorUsername}
            </a>
            {models[0] && (
              <span
                className="min-w-0 truncate text-[10px] leading-none text-zinc-600 md:hidden"
                title={modelsTitle}
              >
                · {models[0]}
              </span>
            )}
          </span>
        </span>
      </div>

      <div className="hidden min-w-0 flex-wrap items-center gap-1 md:flex" title={modelsTitle}>
        {models.length > 0 ? (
          <>
            {models.map((model) => (
              <span
                key={model}
                className="max-w-full truncate border border-[rgb(var(--lb-panel-edge)/0.12)] bg-[rgb(var(--lb-panel-edge)/0.04)] px-1.5 py-0.5 text-[8px] tracking-[0.08em] text-zinc-400"
              >
                {model}
              </span>
            ))}
            {extraModels > 0 && (
              <span className="shrink-0 text-[8px] tracking-[0.08em] text-zinc-600">
                +{extraModels}
              </span>
            )}
          </>
        ) : (
          <span className="text-zinc-800">—</span>
        )}
      </div>

      <div className="hidden text-right md:block" title={agentsTitle}>
        <div className="text-[13px] leading-none tabular-nums text-zinc-100 [font-family:var(--font-pixel)]">
          {formatNumber(agentsTotal)}
        </div>
        <div className="mt-1 text-[7px] tracking-[0.12em] text-zinc-600 tabular-nums">
          {formatNumber(row.agentsLocal)}L · {formatNumber(row.agentsCloud)}C
        </div>
      </div>

      <div className="hidden text-right md:block" title={streakTitle}>
        <div
          className={`flex items-center justify-end gap-1 text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)] ${
            row.currentStreak > 0 ? 'text-orange-300' : 'text-zinc-600'
          }`}
        >
          {row.currentStreak > 0 && (
            <IconFlame size={10} className="lbc-flame shrink-0 text-orange-400/70" />
          )}
          {formatNumber(row.currentStreak)}
        </div>
        <div className="mt-1 text-[7px] tracking-[0.16em] text-zinc-600">DAYS</div>
      </div>

      {/* On mobile this cell is the whole metrics zone: glowing token count
          on top, agents + streak beneath. */}
      <div className="text-right" title={`${formatExactInteger(row.tokens)} tokens`}>
        <div
          className="text-[15px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(251 146 60)',
            textShadow: medal
              ? '0 0 12px rgb(249 115 22 / calc(0.42 * var(--lb-glow, 1)))'
              : '0 0 9px rgb(249 115 22 / calc(0.2 * var(--lb-glow, 1)))'
          }}
        >
          {formatCompactTokenCount(row.tokens)}
        </div>
        <div className="mt-1 hidden text-[7px] tracking-[0.16em] text-orange-400/45 md:block">
          TOKENS
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[7px] tracking-[0.1em] text-zinc-600 tabular-nums md:hidden">
          <span title={agentsTitle}>{formatNumber(agentsTotal)} AGENTS</span>
          <span>·</span>
          <span title={streakTitle}>{formatNumber(row.currentStreak)}D STREAK</span>
        </div>
      </div>
    </li>
  )
}

/** Row avatar with a static medal ring for the top three — the burn
 *  palette's medal hues without TokenBoard's animated regalia, which
 *  lives in CSS that only mounts with the CLI board. */
function CursorRankAvatar({ row, medal }: { row: CursorBoardRow; medal: Medal | null }) {
  const char = (row.displayName || row.cursorUsername).charAt(0).toUpperCase()

  if (!medal) {
    return (
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 md:h-9 md:w-9">
        <Avatar
          src={row.avatarUrl}
          char={char}
          imgClassName="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center text-[11px] font-semibold text-zinc-400"
        />
      </span>
    )
  }

  return (
    <span className="relative h-8 w-8 shrink-0 md:h-9 md:w-9">
      <span
        aria-hidden
        className="absolute -inset-[2px] rounded-full"
        style={{
          border: `2px solid ${medalA(medal.rgb, 0.65)}`,
          boxShadow: `0 0 10px ${medalGlow(medal.rgb, row.rank === 1 ? 0.45 : 0.28)}`
        }}
      />
      <Avatar
        src={row.avatarUrl}
        char={char}
        imgClassName="absolute inset-0 h-full w-full rounded-full object-cover"
        fallbackClassName="absolute inset-0 flex items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-zinc-400"
      />
      {row.rank === 1 && (
        <span
          aria-hidden
          className="lbc-flame absolute -right-[6px] -top-[9px] text-orange-400"
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
  onLink
}: {
  title: string
  body: string
  /** Opt-in trigger; omitted when the viewer is already linked or the
   *  schema is not installed yet. */
  onLink?: () => void
}) {
  return (
    <li className="flex flex-col items-center px-5 py-14 text-center">
      <IconFlame size={24} className="text-orange-400/55" />
      <p className="mt-4 text-[10px] tracking-[0.22em] text-zinc-400">{title}</p>
      <p className="mt-2 max-w-md text-[11px] leading-5 text-zinc-600">{body}</p>
      {onLink && (
        <button
          type="button"
          onClick={onLink}
          className="mt-5 border border-orange-400/30 bg-orange-400/[0.05] px-3 py-2 text-[9px] tracking-[0.2em] text-orange-300 transition-colors hover:bg-orange-400/[0.1]"
        >
          {LINK_CTA}
        </button>
      )}
    </li>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <li
      className="lbc-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)]"
      style={{ ['--rd' as string]: `${index * 45}ms` }}
    >
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        <span className="flex items-center gap-2.5 md:gap-3">
          <span className="h-8 w-8 shrink-0 rounded-full bg-[rgb(var(--lb-panel-edge)/0.05)] md:h-9 md:w-9" />
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="h-3 w-28 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
            <span className="h-2.5 w-20 rounded bg-[rgb(var(--lb-panel-edge)/0.04)]" />
          </span>
        </span>
        <span className="hidden h-5 w-24 rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-4 w-12 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.05)] md:block" />
        <span className="hidden h-4 w-10 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.05)] md:block" />
        <span className="flex flex-col items-end gap-1.5 justify-self-end">
          <span className="h-4 w-16 rounded bg-[rgb(var(--lb-panel-edge)/0.06)] md:w-20" />
          <span className="h-2.5 w-24 rounded bg-[rgb(var(--lb-panel-edge)/0.05)] md:hidden" />
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
