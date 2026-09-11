'use client'

// The CURSOR source of THE BURN board: opted-in users ranked by the token
// sums of their scraped public cursor.com profile — the no-CLI path onto
// the board. Data comes from /api/leaderboard/cursor-agents with the token
// board's window semantics; the chrome (ember frame, `[01]` indices, the
// pager, the fuse-draw mount) is the shared burn/ module, so flipping the
// source toggle reads as the same board wearing different fuel. Tokens
// are this source's sort key, so they take the ember hero slot — green
// stays reserved for the CLI board's dollars. A row opens the player's
// Cribble profile (the same /u/ page the CLI burn card links out to);
// the @handle under the name is the one link that leaves for cursor.com.

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { motionReduced } from '@/components/leaderboard/ai/aiMotion'
import { BurnAvatar } from '@/components/leaderboard/burn/BurnAvatar'
import { BurnCrown } from '@/components/leaderboard/burn/BurnCrown'
import { BurnEmpty } from '@/components/leaderboard/burn/BurnEmpty'
import { BurnIndex } from '@/components/leaderboard/burn/BurnIndex'
import { BurnPager, type BurnPagerYou } from '@/components/leaderboard/burn/BurnPager'
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
import type { BoardFeedReport } from '@/components/leaderboard/burnSource'
import { cursorProfileUrl } from '@/components/leaderboard/crtFeeds'
import { CursorOptInModal } from '@/components/leaderboard/CursorOptInModal'
import {
  IconBolt,
  IconCrownSolid,
  IconFlame,
  IconRefresh,
  IconUsers
} from '@/components/leaderboard/icons'
import { leaderboardScrollTo } from '@/components/leaderboard/LeaderboardScrollRuntime'
import { medalFor } from '@/components/leaderboard/types'
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

gsap.registerPlugin(useGSAP)

const WINDOWS: { id: CursorBoardWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: '7d', label: '7D' },
  { id: 'all', label: 'ALL' }
]

// One header for both breakpoints: the three md-only columns fold away
// (header, skeleton and row cells alike) on phones, leaving the mobile
// grid's three tracks. Every figure here is a compact count or a unit
// figure (20, 4, 95B) under a header wider than itself, so the numeric
// columns centre: header and figure share the track's midline. Skeleton
// runs are widthed to each column's typical value.
const COLUMNS: readonly BurnColumn[] = [
  { label: 'RANK', align: 'left', skeleton: '░░░░' },
  { label: 'PLAYER', align: 'left', skeleton: '░░░░░░░░░░░░░░' },
  { label: 'TOP MODELS', align: 'left', className: 'bb-md-only', skeleton: '░░░░░░░░░░░░' },
  {
    label: 'AGENTS',
    align: 'center',
    className: 'bb-md-only',
    title: 'local + cloud agents run',
    skeleton: '░░░'
  },
  {
    label: 'STREAK',
    align: 'center',
    className: 'bb-md-only',
    title: 'current streak, days',
    skeleton: '░░'
  },
  { label: 'TOKENS BURNED', align: 'center', sortKey: true, skeleton: '░░░░░░' }
]

const FOOTNOTE =
  'RANKED BY CURSOR.COM PROFILE TOKENS · OPT-IN · SCRAPED FROM PUBLIC PROFILES · NO CLI NEEDED'

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

  // The CRT gets every row, never the paged slice.
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

  const retry = useCallback(() => {
    setFailed(false)
    setRows(null)
    void load(windowId)
  }, [load, windowId])

  const state: BurnSlabState = failed
    ? 'error'
    : rows === null
      ? 'loading'
      : !schemaReady || rows.length === 0
        ? 'empty'
        : 'ready'
  const ready = state === 'ready'
  const leader = rows?.[0] ?? null
  const myIndex =
    rows && currentUserId !== null ? rows.findIndex((row) => row.userId === currentUserId) : -1
  const myRow = rows && myIndex >= 0 ? rows[myIndex] : null
  const agentsTotal = (totals?.agentsLocal ?? 0) + (totals?.agentsCloud ?? 0)
  const canJoin = (viewer === 'signedOut' || viewer === 'unlinked') && schemaReady

  // ---- paging ---------------------------------------------------------
  // Retune (rows → null) reopens on page one and a shrinking refetch
  // clamps — both inside the hook. The refs below only mark *pager-driven*
  // turns so neither of those plays the page-turn motion.
  const { page, setPage, totalPages, paged } = usePagedRows(rows)
  const pendingTurn = useRef<1 | -1 | null>(null)
  const pendingJump = useRef(false)
  const [jumpNonce, setJumpNonce] = useState(0)

  const goToPage = useCallback(
    (next: number) => {
      if (next === page) return
      pendingTurn.current = next > page ? 1 : -1
      setPage(next)
    },
    [page, setPage]
  )

  const jumpToYou = useCallback(() => {
    if (myIndex < 0) return
    pendingJump.current = true
    goToPage(pageOf(myIndex))
    setJumpNonce((n) => n + 1)
  }, [goToPage, myIndex])

  const pagerYou: BurnPagerYou | null =
    ready && myRow
      ? { rank: myRow.rank, onPage: pageOf(myIndex) === page, onJump: jumpToYou }
      : null

  // ---- motion ---------------------------------------------------------
  // One root over both slabs (stat strip + list) so the chrome cascade
  // settles them together; the toolbar between them keeps its CSS reveal.
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (rootRef.current) mountChrome(rootRef.current)
    },
    { scope: rootRef }
  )

  const rowsPlayed = useRef(false)
  useGSAP(
    () => {
      if (!ready || rowsPlayed.current || !rootRef.current) return
      rowsPlayed.current = true
      mountRows(rootRef.current)
    },
    { scope: rootRef, dependencies: [ready] }
  )

  // useGSAP is a layout effect: this runs after the commit that swapped
  // the page's rows in, before paint, so the new rows start off-screen.
  useGSAP(
    () => {
      const dir = pendingTurn.current
      if (dir === null) return
      pendingTurn.current = null
      if (rootRef.current) turnPage(rootRef.current, dir)
    },
    { scope: rootRef, dependencies: [page] }
  )

  // JUMP: after the viewer's page commits, scroll their row into view and
  // light it. The row is the one wearing data-yours — the same attribute
  // that paints its rail — so no ref threading through CursorRow.
  useGSAP(
    () => {
      if (!pendingJump.current) return
      const el = rootRef.current?.querySelector<HTMLElement>('.bb-row[data-yours]')
      if (!el) return // page still turning over — the next commit retries
      pendingJump.current = false
      leaderboardScrollTo(el, !motionReduced())
      igniteRow(el)
    },
    { scope: rootRef, dependencies: [paged, jumpNonce] }
  )

  return (
    <>
      {/* .bb on the root so the stat strip and the toolbar resolve the same
          tokens as the slab — one register for all three bands. */}
      <div ref={rootRef} className="bb space-y-4">
        <section className="bb-slab bb-stats">
          <BurnStat
            icon={<IconUsers size={11} className="bb-ink-2" />}
            label="PLAYERS"
            hint="linked profiles"
          >
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
            icon={<IconBolt size={11} className="bb-ember" />}
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
          </BurnStat>

          <BurnStat
            icon={<IconCrownSolid size={11} className="text-[rgb(var(--lb-gold))]" />}
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
            {leader ? `@${leader.cursorUsername.toUpperCase()}` : <span className="bb-ink-2">—</span>}
          </BurnStat>
        </section>

        {/* The one toolbar row (GLOBAL's pattern): the page's board tabs on
            the left; fuel, window, refresh and JOIN ride the right side,
            and under sm every group flows left with the same gap. */}
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
              ariaLabel="Cursor leaderboard period"
            />

            <div className="bb-seg">
              <button
                type="button"
                className="bb-segbtn"
                onClick={() => void refresh()}
                disabled={refreshing}
                aria-label="Refresh cursor leaderboard"
              >
                <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'SYNCING' : 'REFRESH'}
              </button>
            </div>

            {canJoin && (
              <div className="bb-seg">
                <button type="button" className="bb-segbtn" data-ember onClick={openOptIn}>
                  <IconFlame size={11} />
                  JOIN THE BOARD
                </button>
              </div>
            )}
          </div>
        </div>

        <section className="relative">
          <BurnSlab
            title="BURN BOARD"
            rangeLabel={
              ready && rows ? `${rangeLabel(page, PAGE_SIZE, rows.length)} players` : null
            }
            stamp={windowMeta?.label ?? null}
            columns={COLUMNS}
            gridClassName="bb-grid-cursor"
            state={state}
            ariaLabel="Cursor burn board"
            errorNode={
              <p className="bb-line bb-error" role="alert">
                The Cursor board failed to load.
                <button type="button" className="bb-toggle" onClick={retry}>
                  [ RETRY ]
                </button>
              </p>
            }
            emptyNode={
              schemaReady ? (
                <BurnEmpty
                  title="NO CURSOR PROFILES ON THE BOARD YET"
                  body="Set your cursor.com profile to public, claim your handle, and your burn shows up instantly. Works from any machine — no CLI needed."
                  action={viewer === 'linked' ? undefined : { label: LINK_CTA, onClick: openOptIn }}
                />
              ) : (
                <BurnEmpty
                  title="BOARD WARMING UP"
                  body="The page is ready, but the cursor profile migration has not been installed yet."
                />
              )
            }
            footer={
              ready ? (
                <BurnPager page={page} totalPages={totalPages} onPage={goToPage} you={pagerYou} />
              ) : null
            }
            footnote={FOOTNOTE}
          >
            <ol className="bb-rows">
              {paged.map((row) => (
                <CursorRow
                  key={row.userId}
                  row={row}
                  isMe={row.userId === currentUserId}
                  justLinked={linkedStamp !== null && row.userId === currentUserId}
                />
              ))}
            </ol>
          </BurnSlab>

          {ready && currentUserId !== null && myIndex < 0 && viewer !== 'loading' && (
            <div className="bb-cta">
              <div className="bb-seg">
                {viewer === 'linked' ? (
                  // Linked but not ranked: visibility is off or the last sync
                  // failed — that is managed in settings, not re-claimed.
                  <button
                    type="button"
                    className="bb-segbtn"
                    data-ember
                    onClick={() => openSettings(cursorProfileSection())}
                  >
                    LINKED, BUT NOT RANKED — CHECK YOUR PROFILE SETTINGS
                  </button>
                ) : (
                  <button type="button" className="bb-segbtn" data-ember onClick={openOptIn}>
                    {LINK_CTA}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

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
        /* CURSOR's tracks — RANK · PLAYER · TOP MODELS · AGENTS · STREAK ·
           TOKENS on desktop, index · identity · tokens on phones. Tracks
           and gap only: the slab pads every band through --bb-pad. The
           numeric tracks are sized to the wider of their widest pixel-font
           value and their header (▾ TOKENS BURNED runs ~122px) so the
           right-aligned header edge lands on the numeral edge. */
        .bb-grid-cursor {
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr) auto;
          column-gap: 12px;
          align-items: center;
        }
        @media (min-width: 768px) {
          .bb-grid-cursor {
            grid-template-columns: 56px minmax(0, 1fr) minmax(0, 220px) 88px 80px 132px;
            column-gap: 20px;
          }
        }

        /* The sub-line is a flex line — podium title, the @handle, and on
           phones the model — so the ellipsis can only ever land on the
           model: the title and the handle (the one link out to cursor.com)
           never shrink. */
        .lbc-subline {
          display: flex;
          align-items: baseline;
        }
        .lbc-subline > .bb-title {
          margin-right: 8px;
        }
        .lbc-subline > .lbc-handle {
          flex: none;
          transition: color 120ms;
        }
        /* On a phone the podium title takes a line of its own — THE
           MONARCH and a handle don't share 140px — and the handle and
           model drop under it with the room every other row gives them.
           The metrics zone is three lines tall, so the row doesn't grow. */
        @media (max-width: 767px) {
          .lbc-subline:has(.bb-title) {
            flex-wrap: wrap;
          }
          .lbc-subline > .bb-title {
            flex-basis: 100%;
            margin-right: 0;
          }
          /* a zero basis keeps the model on the handle's line, shrinking
             to its ellipsis instead of wrapping under */
          .lbc-subline:has(.bb-title) > .bb-mobile-only {
            flex: 1 1 0;
          }
        }
        .lbc-handle:hover,
        .lbc-handle:focus-visible {
          color: rgb(var(--bb-ember));
        }
        /* a streak of zero prints in ink-2 — no heat to show */
        .lbc-cold {
          color: rgb(var(--bb-ink-2));
        }
        @media (prefers-reduced-motion: reduce) {
          .lbc-subline > .lbc-handle {
            transition: none;
          }
        }
      `}</style>
    </>
  )
}

function CursorRow({
  row,
  isMe,
  justLinked = false
}: {
  row: CursorBoardRow
  isMe: boolean
  /** One-shot arrival flash for a row that just claimed its handle. */
  justLinked?: boolean
}) {
  const ref = useRef<HTMLLIElement>(null)
  const router = useRouter()
  const medal = medalFor(row.rank)
  const title = burnTitle(row.rank)
  const agentsTotal = row.agentsLocal + row.agentsCloud
  const models = row.topModels.slice(0, 2)
  const extraModels = row.topModels.length - models.length
  const modelsTitle =
    row.topModels.length > 0 ? `Top models: ${row.topModels.join(', ')}` : 'No models reported'
  const agentsTitle = `${formatNumber(row.agentsLocal)} local · ${formatNumber(row.agentsCloud)} cloud agents`
  const streakTitle = `Current streak ${formatNumber(row.currentStreak)} days · longest ${formatNumber(row.longestStreak)}`
  const exactTokens = `${formatExactInteger(row.tokens)} tokens`
  const profileHref = `/u/${encodeURIComponent(row.username)}`
  const char = (row.displayName || row.cursorUsername).charAt(0).toUpperCase()

  useGSAP(
    () => {
      if (justLinked && ref.current) igniteRow(ref.current)
    },
    { scope: ref }
  )

  // The name is the row's link (focusable, labelled); the rest of the row
  // is a mouse convenience for it. Clicks that land on another control —
  // the @handle out to cursor.com, the team logo, the badge caption — or
  // on a text selection are theirs, and a modified click opens a new tab
  // the way the link itself would.
  const openProfile = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('a, button, .bb-tip')) return
    if (window.getSelection()?.toString()) return
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(profileHref, '_blank', 'noopener')
      return
    }
    router.push(profileHref)
  }

  return (
    <li ref={ref} className="bb-row" data-yours={isMe || undefined}>
      <div className="bb-rowbtn bb-grid-cursor" onClick={openProfile}>
        <span className="bb-cell">
          <BurnIndex rank={row.rank} />
        </span>

        <div className="bb-cell bb-player">
          <BurnAvatar src={row.avatarUrl} char={char} rank={row.rank} />
          <div className="bb-stack">
            <span className="bb-nameline">
              <Link
                href={profileHref}
                className="bb-name bb-rowlink"
                aria-label={`Open profile for ${row.displayName} (rank ${row.rank}${title ? ` — ${title}` : ''}, ${formatCompactTokenCount(row.tokens)} tokens burned)`}
              >
                {row.displayName}
              </Link>
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
            <span className="bb-sub lbc-subline">
              {title && medal && (
                <span className="bb-title" style={{ color: medal.fg }}>
                  {row.rank === 1 && <BurnCrown />}
                  <span>{title}</span>
                </span>
              )}
              <a
                href={cursorProfileUrl(row.cursorUsername)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open cursor.com/@${row.cursorUsername}`}
                className="lbc-handle"
              >
                @{row.cursorUsername}
              </a>
              {models[0] && (
                <span className="bb-sub bb-mobile-only" title={modelsTitle}>
                  {'\u00A0·\u00A0'}
                  {models[0]}
                </span>
              )}
            </span>
          </div>
        </div>

        <span className="bb-cell bb-sub bb-md-only" title={modelsTitle}>
          {models.length > 0 ? (
            <>
              {models.join(' · ')}
              {extraModels > 0 && ` +${extraModels}`}
            </>
          ) : (
            '—'
          )}
        </span>

        <span className="bb-cell bb-num bb-num-center bb-md-only" title={agentsTitle}>
          {formatNumber(agentsTotal)}
          <span className="bb-sub">
            {formatNumber(row.agentsLocal)}L · {formatNumber(row.agentsCloud)}C
          </span>
        </span>

        <span className="bb-cell bb-num bb-num-center bb-md-only" title={streakTitle}>
          <span className={row.currentStreak > 0 ? undefined : 'lbc-cold'}>
            {formatNumber(row.currentStreak)}
          </span>
          <span className="bb-sub">DAYS</span>
        </span>

        {/* On phones this cell is the whole metrics zone: ember tokens on
            top, agents and streak stacked beneath — one line each, so the
            auto-sized zone stays as narrow as its widest figure and the
            name beside it keeps its room on a 375px screen. */}
        <span className="bb-cell bb-num bb-num-center" title={exactTokens}>
          <span className="bb-tokens bb-ember">{formatCompactTokenCount(row.tokens)}</span>
          <span className="bb-sub bb-mobile-only" title={agentsTitle}>
            {formatNumber(agentsTotal)} AGENTS
          </span>
          <span className="bb-sub bb-mobile-only" title={streakTitle}>
            {formatNumber(row.currentStreak)}D STREAK
          </span>
        </span>
      </div>
    </li>
  )
}
