'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { motionReduced } from '@/components/leaderboard/ai/aiMotion'
import { ToolMark } from '@/components/leaderboard/ai/ToolMark'
import { BurnAvatar } from '@/components/leaderboard/burn/BurnAvatar'
import { BurnCrown } from '@/components/leaderboard/burn/BurnCrown'
import { BurnEmpty } from '@/components/leaderboard/burn/BurnEmpty'
import { BurnIndex } from '@/components/leaderboard/burn/BurnIndex'
import { BurnPager } from '@/components/leaderboard/burn/BurnPager'
import { BurnSeg } from '@/components/leaderboard/burn/BurnSeg'
import {
  BurnSlab,
  type BurnColumn,
  type BurnSlabState
} from '@/components/leaderboard/burn/BurnSlab'
import { BurnStat } from '@/components/leaderboard/burn/BurnStat'
import { BurnTip } from '@/components/leaderboard/burn/BurnTip'
import {
  igniteRow,
  mountChrome,
  mountRows,
  turnPage
} from '@/components/leaderboard/burn/burnMotion'
import {
  PAGE_SIZE,
  pageOf,
  rangeLabel,
  usePagedRows
} from '@/components/leaderboard/burn/burnPaging'
import { burnTitle } from '@/components/leaderboard/burn/burnTitles'
import {
  SOURCES,
  type BoardFeedReport,
  type BurnSource
} from '@/components/leaderboard/burnSource'
import { CrtBurn, type BurnFeed, type BurnSelection } from '@/components/leaderboard/CrtBurn'
import { cursorProfileUrl } from '@/components/leaderboard/crtFeeds'
import { CursorBoard } from '@/components/leaderboard/CursorBoard'
import { leaderboardScrollTo } from '@/components/leaderboard/LeaderboardScrollRuntime'
import { TokenPlayerCard } from '@/components/leaderboard/TokenPlayerCard'
import {
  IconCrownSolid,
  IconFlame,
  IconRefresh,
  IconTrophy,
  IconUsers
} from '@/components/leaderboard/icons'
import {
  personaDotStyle,
  personaTextStyle,
  tokenPersonaVisual
} from '@/components/leaderboard/tokenPersonaVisual'
import { medalFor } from '@/components/leaderboard/types'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { useSettingsModal } from '@/components/settings/SettingsModalContext'
import { fetchMe as requestMe } from '@/lib/client/fetchMe'
import type { CursorBoardRow } from '@/lib/cursorProfileBoard'
import { isProTier } from '@/lib/entitlements'
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

// The CLI slab's columns. MONEY is a ledger column — figures the width of
// the header, ones digits stacked on the track's right edge under the
// label's edge. TOKENS is a compact unit figure (9.2B under a 13-glyph
// header), so it centres: header and figure share the track's midline.
// TOP AGENT and TOKENS fold away under md — the same class hides the
// header cell, the skeleton cell and (in TokenRow) the row cell, so the
// three-track mobile grid always fills.
const CLI_COLUMNS: readonly BurnColumn[] = [
  { label: 'RANK', align: 'left', skeleton: '░░░░' },
  { label: 'PLAYER', align: 'left', skeleton: '░░░░░░░░░░░░░░' },
  { label: 'TOP AGENT', align: 'left', className: 'bb-md-only', skeleton: '░░░░░░░░' },
  {
    label: 'TOKENS BURNED',
    align: 'center',
    className: 'bb-md-only',
    title: 'Rounded — hover a figure for the exact count',
    skeleton: '░░░░░'
  },
  {
    label: 'MONEY BURNED',
    sortKey: true,
    title: 'Estimated USD — not a billing receipt',
    skeleton: '░░░░░░░'
  }
]

const FOOTNOTE =
  'RANKED BY EST. USD BURN · OPT-IN · SELF-REPORTED · NOT A BILLING RECEIPT · * FEWER THAN 3 SYNC DAYS'

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
    <BurnSeg
      items={SOURCES}
      value={source}
      onChange={handleSourceChange}
      ariaLabel="Burn board source"
    />
  )

  return (
    <>
      {/* ---------- CRT burn mode: the tube above the board, like GLOBAL ---------- */}
      {/* Reveal cascade mirrors GLOBAL's (CRT → stat strip → toolbar row →
          list): 40ms here, then the child board's GSAP chrome mount for
          its two slabs with the CSS toolbar reveal at 140ms between. */}
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
  const { openSettings } = useSettingsModal()

  // The CRT above gets the whole board, never the page slice.
  useEffect(() => {
    onFeed?.({ rows, failed })
  }, [rows, failed, onFeed])

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

  const retry = useCallback(() => {
    setFailed(false)
    setRows(null)
    void load(windowId)
  }, [load, windowId])

  const loading = rows === null && !failed
  const leader = rows?.[0] ?? null
  const selectedRow = rows?.find((row) => row.userId === selectedUserId) ?? null

  // Paging is a client-side slice over the full board. A retune (rows →
  // null) reopens on page 1 and a refetch that shrinks the board clamps,
  // both inside the hook.
  const { page, setPage, totalPages, paged } = usePagedRows(rows)
  const myIndex =
    rows && currentUserId !== null ? rows.findIndex((row) => row.userId === currentUserId) : -1
  const myRow = rows && myIndex >= 0 ? rows[myIndex] : null

  const slabState: BurnSlabState = loading
    ? 'loading'
    : failed
      ? 'error'
      : !schemaReady || (rows?.length ?? 0) === 0
        ? 'empty'
        : 'ready'
  const ready = slabState === 'ready'

  // ---- motion -------------------------------------------------------
  // One root around both slabs so the chrome mount settles them in
  // sequence before the rules draw.
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (rootRef.current) mountChrome(rootRef.current)
    },
    { scope: rootRef }
  )

  // The viewer's row: the arrival spotlight (?welcome=1) and the pager's
  // JUMP share one path — mark the row wanted, turn to its page, and let
  // the effect after that commit scroll to it and light it up.
  const myRowRef = useRef<HTMLLIElement | null>(null)
  const pendingJump = useRef<number | null>(null)
  const [jumpNonce, setJumpNonce] = useState(0)
  const spotlightDone = useRef(false)

  const jumpToMyRow = useCallback(() => {
    if (!myRow) return
    pendingJump.current = myRow.userId
    setPage(pageOf(myIndex))
    // The row may already be on this page; the nonce fires the effect
    // regardless.
    setJumpNonce((n) => n + 1)
  }, [myRow, myIndex, setPage])

  // Fresh from onboarding: the moment the board AND your identity have
  // both landed, jump to your row. The latch trips on that first landing
  // whatever it holds, so refetches and window flips can never re-fire
  // it. Not opted in / empty board → your row isn't there → nothing
  // happens. A layout effect so a viewer on page 2 never paints page 1.
  useLayoutEffect(() => {
    if (spotlightDone.current || rows === null || currentUserId === null) return
    spotlightDone.current = true
    if (new URLSearchParams(window.location.search).get('welcome') !== '1') return
    if (myRow) jumpToMyRow()
  }, [rows, currentUserId, myRow, jumpToMyRow])

  useGSAP(
    () => {
      if (pendingJump.current === null) return
      const el = myRowRef.current
      if (!el) return // the row's page hasn't committed yet — the next commit retries
      pendingJump.current = null
      leaderboardScrollTo(el, !motionReduced())
      igniteRow(el)
    },
    { scope: rootRef, dependencies: [paged, jumpNonce] }
  )

  // Page turn: the new rows enter from the direction of travel. Skipped
  // on the first render, on a retune (the reset to page 1 happens under
  // the skeleton) and before the first entrance, which mountRows owns.
  // Declared ahead of that entrance so a first landing that also turns
  // the page (welcome on page 2) reads the latch before it trips: one
  // entrance, not a turn layered on top of it.
  const rowsPlayed = useRef(false)
  const prevPage = useRef(page)
  useGSAP(
    () => {
      const from = prevPage.current
      prevPage.current = page
      if (from === page || !ready || !rowsPlayed.current || !rootRef.current) return
      turnPage(rootRef.current, page > from ? 1 : -1)
    },
    { scope: rootRef, dependencies: [page, ready] }
  )

  // Rows enter once, the first time the slab is ready. When a jump is
  // already queued for a row off this page, the page is about to turn
  // under the same paint, so the entrance waits for the page that lands.
  useGSAP(
    () => {
      if (!ready || rowsPlayed.current || !rootRef.current) return
      const wanted = pendingJump.current
      if (wanted !== null && !paged.some((row) => row.userId === wanted)) return
      rowsPlayed.current = true
      mountRows(rootRef.current)
    },
    { scope: rootRef, dependencies: [ready, paged] }
  )

  return (
    <>
      {/* .bb on the root so the stat strip and the toolbar resolve the same
          tokens as the slab — one register for all three bands. */}
      <div ref={rootRef} className="bb space-y-4">
        <section className="bb-slab bb-stats">
          <BurnStat icon={<IconUsers size={11} className="bb-ink-2" />} label="PLAYERS" hint="opted in">
            <AnimatedCounter
              value={totals?.pilots ?? 0}
              duration={1000}
              formatter={(value) => formatNumber(Math.round(value))}
            />
          </BurnStat>

          <BurnStat
            icon={<IconFlame size={11} className="bb-ember" />}
            label="TOKENS TORCHED"
            hint={windowMeta?.label.toLowerCase()}
          >
            <TokenValue value={totals?.totalTokens ?? '0'} animated />
          </BurnStat>

          <BurnStat
            icon={<IconTrophy size={11} className="bb-ember" />}
            label="EST. BURN"
            hint="not a billing receipt"
          >
            <UsdValue value={totals?.burnUsd ?? '0'} animated />
          </BurnStat>

          <BurnStat
            icon={<IconCrownSolid size={11} className="text-[rgb(var(--lb-gold))]" />}
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
            {leader ? `@${leader.username.toUpperCase()}` : <span className="bb-ink-2">—</span>}
          </BurnStat>
        </section>

        {/* The one toolbar row (GLOBAL's pattern): the page's board tabs on
            the left; fuel, window and refresh ride the right side, and
            under sm every group flows left with the same gap. */}
        <div className="bb-bar bb-reveal" style={{ ['--rv' as string]: '140ms' }}>
          {toolbar}

          <div className="bb-bar-tools">
            {sourceToggle}

            <BurnSeg
              items={WINDOWS}
              value={windowId}
              onChange={(next) => {
                if (next === windowId) return
                setRows(null)
                setFailed(false)
                onWindowChange(next)
              }}
              ariaLabel="Token leaderboard period"
            />

            <div className="bb-seg">
              <button
                type="button"
                className="bb-segbtn"
                onClick={() => void refresh()}
                disabled={refreshing}
                aria-label="Refresh token leaderboard"
              >
                <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'SYNCING' : 'REFRESH'}
              </button>
            </div>
          </div>
        </div>

        <BurnSlab
          title="BURN BOARD"
          rangeLabel={
            ready && rows ? `${rangeLabel(page, PAGE_SIZE, rows.length)} players` : null
          }
          stamp={windowMeta?.label ?? null}
          columns={CLI_COLUMNS}
          gridClassName="bb-grid-cli"
          state={slabState}
          errorNode={
            <p className="bb-line bb-error" role="alert">
              The Burn Board failed to load.
              <button type="button" className="bb-toggle" onClick={retry}>
                [ RETRY ]
              </button>
            </p>
          }
          emptyNode={
            schemaReady ? (
              <BurnEmpty
                title="NO ONE HAS VOLUNTEERED FOR PUBLIC HUMILIATION YET"
                body="Sync some token usage, then opt in from Account Settings. Raw daily usage stays private."
                action={{ label: 'JOIN THE BURN BOARD', onClick: () => openSettings('account') }}
              />
            ) : (
              <BurnEmpty
                title="THE FUSE IS WIRED"
                body="The page is ready, but the private token leaderboard migration has not been installed yet."
              />
            )
          }
          footer={
            ready ? (
              <BurnPager
                page={page}
                totalPages={totalPages}
                onPage={setPage}
                you={
                  myRow
                    ? { rank: myRow.rank, onPage: pageOf(myIndex) === page, onJump: jumpToMyRow }
                    : null
                }
              />
            ) : null
          }
          footnote={FOOTNOTE}
        >
          <ol className="bb-rows">
            {paged.map((row) => (
              <TokenRow
                key={row.userId}
                row={row}
                isMe={row.userId === currentUserId}
                rowRef={row.userId === currentUserId ? myRowRef : undefined}
                onSelect={() => onSelectUser(row.userId)}
              />
            ))}
          </ol>
        </BurnSlab>
      </div>

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
        /* The CLI grid — tracks and gap only; the slab pads every band
           through --bb-pad. Numeric tracks are sized to the wider of the
           widest real pixel-font value (999.9B, $307,175) and the header
           label (TOKENS BURNED runs ~110px at 11px / 0.18em): the centred
           TOKENS track puts header and figure on one midline, the
           right-aligned MONEY track on one right edge. Mobile is two
           zones: index + identity, figures. */
        .bb-grid-cli {
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr) auto;
          column-gap: 10px;
          align-items: center;
        }
        @media (min-width: 768px) {
          .bb-grid-cli {
            grid-template-columns: 56px minmax(0, 1fr) minmax(0, 200px) 116px 140px;
            column-gap: 24px;
          }
        }
        /* Phones: the pixel font runs 1em a glyph, so a 15px $307,175* is
           135px of the 309px row and the tool line beside it keeps ~40px.
           13px hands 18px back and still sits over the 11px count; the
           10px gutter above and 4px tool-line gap buy the last 8px that
           "Claude Code" needs beside an eight-glyph figure. */
        @media (max-width: 767px) {
          .bb-grid-cli .bb-money {
            font-size: 13px;
          }
        }
      `}</style>
    </>
  )
}

function TokenRow({
  row,
  isMe,
  rowRef,
  onSelect
}: {
  row: TokenBoardRow
  isMe: boolean
  rowRef?: React.Ref<HTMLLIElement>
  onSelect: () => void
}) {
  const personaVisual = tokenPersonaVisual(row.persona)
  const medal = medalFor(row.rank)
  const title = burnTitle(row.rank)
  const agentLabel = tokenAgentLabel(row.topAgent)
  const modelLabel = tokenModelLabel(row.topModel)
  const mixed = row.agents.length > 1
  const agentName = agentLabel ?? (mixed ? 'Mixed' : 'Unknown')
  const agentTitle = agentLabel
    ? `${agentLabel} is the primary agent${modelLabel ? ` · ${modelLabel} is the primary model` : ''}`
    : mixed
      ? `No clear top agent reported (${row.agents.map((agent) => tokenAgentLabel(agent)).filter(Boolean).join(', ')})`
      : 'Agent not reported'
  const exactTokens = `${formatExactInteger(row.totalTokens)} tokens`
  const char = (row.displayName || row.username).charAt(0).toUpperCase()

  return (
    <li ref={rowRef} className="bb-row" data-yours={isMe || undefined}>
      {/* The whole row is the button, so the label carries the two figures
          a reader would otherwise lose behind it. */}
      <button
        type="button"
        onClick={onSelect}
        className="bb-rowbtn bb-grid-cli"
        aria-label={`Open token profile for ${row.displayName} (rank ${row.rank}${title ? ` — ${title}` : ''}, ${formatUsd(row.burnUsd)} burned)`}
      >
        <span className="bb-cell">
          <BurnIndex rank={row.rank} />
        </span>

        <span className="bb-cell bb-player">
          <BurnAvatar src={row.profileImage} char={char} handle={row.username} rank={row.rank} />
          <span className="bb-stack">
            <span className="bb-nameline">
              <span className="bb-name">{row.displayName}</span>
              {isProTier(row.tier) && (
                <BurnTip text="Verified · Cribble Premium" focusable>
                  <VerifiedBadge size={14} />
                </BurnTip>
              )}
              {row.team && (
                <BurnTip text={`Team · ${row.team.name}`}>
                  <TeamMiniLogo team={row.team} size={14} />
                </BurnTip>
              )}
              {isMe && <span className="bb-tag bb-tag-you">YOU</span>}
            </span>
            {/* The podium's standing prints in the medal hue where every
                other row prints its persona; the crown leads rank 1. */}
            {title && medal ? (
              <span className="bb-persona bb-md-only" style={{ color: medal.fg }}>
                {row.rank === 1 && <BurnCrown />}
                <span className="bb-persona-label">{title}</span>
              </span>
            ) : (
              <span
                className="lbt-pv bb-persona bb-md-only"
                style={personaTextStyle(personaVisual)}
              >
                {personaVisual.flame && <IconFlame size={8} className="shrink-0" />}
                <span className="bb-persona-label">{row.persona.label}</span>
              </span>
            )}
            {/* Mobile tool line — the persona trades down to a toned dot
                (the medal hue on the podium, and for rank 1 the crown, the
                dot's promotion) so the agent identity gets the space; the
                model stays in the title (and the player card) rather than
                pushing the agent's own name into an ellipsis beside the $
                hero. */}
            <span className="bb-mobile-only mt-0.5 flex items-center gap-1" title={agentTitle}>
              {row.rank === 1 && title && medal ? (
                <span role="img" aria-label={title} style={{ color: medal.fg }}>
                  <BurnCrown />
                </span>
              ) : (
                <span
                  className={`h-[5px] w-[5px] shrink-0 rounded-full ${medal ? '' : 'lbt-pv'}`}
                  style={medal ? { background: medal.fg } : personaDotStyle(personaVisual)}
                  role="img"
                  aria-label={title ?? row.persona.label}
                />
              )}
              <ToolMark name={agentName} size={12} className="bb-mark" />
              <span className="bb-sub bb-ink">{agentName}</span>
            </span>
          </span>
        </span>

        <span className="bb-cell bb-md-only flex items-center gap-2.5" title={agentTitle}>
          <ToolMark name={agentName} size={22} className="bb-mark" />
          <span className="bb-stack">
            <span className="bb-name block">{agentName}</span>
            <span className="bb-sub">{modelLabel ?? 'Model not reported'}</span>
          </span>
        </span>

        <span className="bb-cell bb-num bb-num-center bb-md-only" title={exactTokens}>
          <span className="bb-tokens">{formatCompactTokenCount(row.totalTokens)}</span>
        </span>

        {/* On phones this cell is the whole figures zone: the $ hero over
            the token count. */}
        <span className="bb-cell bb-num">
          <span className="bb-money">
            <UsdValue value={row.burnUsd} />
            {row.provisional && (
              <span className="bb-money-pv" title="Estimate · fewer than 3 active sync days">
                *
              </span>
            )}
          </span>
          <span className="bb-sub bb-pixel bb-mobile-only" title={exactTokens}>
            {formatCompactTokenCount(row.totalTokens)}
          </span>
        </span>
      </button>
    </li>
  )
}
