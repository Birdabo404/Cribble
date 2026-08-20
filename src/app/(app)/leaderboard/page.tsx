'use client'

// Leaderboard v4 — "the arena".
//
// Solid panels instead of liquid glass, medals instead of the house accent:
// neon-gold champion, platinum runner-up, ember third. Scores are the
// loudest thing on the page (Press Start 2P everywhere a number matters).
// Every row and podium card opens an animated player profile card.
//
// Live engine: 15s polling + refetch on tab focus, FLIP row re-ordering,
// server-persisted rank movement arrows (migration 012), score-gain pops,
// and chase/defend gap read-outs on the sticky "you" bar.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'
import { fetchMe as requestMe } from '@/lib/client/fetchMe'
import { prefersReducedMotion } from '@/lib/motion'
import { countdownTo, type SeasonState } from '@/lib/season'
import AnimatedCounter from '@/components/AnimatedCounter'
import {
  formatCompact,
  formatNumber,
  formatRelative
} from '@/components/dashboard-v2/format'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsRight,
  IconCrown,
  IconHourglass,
  IconPulse,
  IconRefresh,
  IconSearch,
  IconTrophy,
  IconUsers,
  MoveGlyph,
  ToolIcon
} from '@/components/leaderboard/icons'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { AsteroidShower } from '@/components/dashboard-v3/AsteroidShower'
import { AiBoard } from '@/components/leaderboard/AiBoard'
import { PlayerCard, type ChaseInfo } from '@/components/leaderboard/PlayerCard'
import { Podium } from '@/components/leaderboard/Podium'
import { RankAvatar } from '@/components/leaderboard/RankRegalia'
import { TeamBoard } from '@/components/leaderboard/TeamBoard'
import { medalA, medalFor, medalGlow, type LeaderRow } from '@/components/leaderboard/types'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { getPlate } from '@/lib/cosmetics/plates'
import { isProTier } from '@/lib/entitlements'

const PAGE_SIZE = 25
const POLL_MS = 15_000
const FLASH_MS = 2_400

/** Which board is on stage: the season race, lifetime standings, the
 *  machines (ai), or the companies (teams). */
type BoardView = 'season' | 'alltime' | 'ai' | 'teams'

const BOARD_TABS: { id: BoardView; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: 'alltime', label: 'ALL-TIME' },
  { id: 'ai', label: 'AI' },
  { id: 'teams', label: 'TEAMS' }
]

/** The two pilot standings views — the only ones that own the pilot
 *  chrome (stat bar, podium, standings table) and the 15s poll. AI and
 *  TEAMS render self-fetching boards instead. */
const isStandingsView = (v: BoardView) => v === 'season' || v === 'alltime'

/** One score-gain pop: the points gained between two polls, a per-pop tilt
 *  so repeat pops don't stamp identically, and a stamp that remounts the
 *  span (key change) so the CSS animation restarts on back-to-back gains. */
type ScoreFlash = { amount: number; tilt: number; stamp: number }

export default function LeaderboardArena() {
  const [rows, setRows] = useState<LeaderRow[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [showPodium, setShowPodium] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [view, setView] = useState<BoardView>('season')
  const [seasonMeta, setSeasonMeta] = useState<SeasonState | null>(null)

  // The poll callbacks read the current view through a ref so the
  // mount effect below never has to re-subscribe on view flips.
  const viewRef = useRef<BoardView>(view)
  viewRef.current = view

  // Pilot chrome (stat bar, podium, standings, refresh) only exists on
  // the standings views — AI and TEAMS hide all of it.
  const isStandings = isStandingsView(view)

  // score-gain pops: userId -> pop payload for the +N floater
  const [flashes, setFlashes] = useState<ReadonlyMap<number, ScoreFlash>>(new Map())
  const prevScores = useRef(new Map<number, number>())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Monotonic guard: a slow response must never overwrite a newer one
  // (manual refresh and the poll can be in flight simultaneously).
  const fetchSeq = useRef(0)

  const fetchData = useCallback(async () => {
    const seq = ++fetchSeq.current
    const board = viewRef.current === 'alltime' ? 'alltime' : 'season'
    try {
      const res = await fetch(`/api/leaderboard?board=${board}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (seq !== fetchSeq.current) return
      if (!data.success) return
      if (data.season) setSeasonMeta(data.season as SeasonState)
      const next: LeaderRow[] = Array.isArray(data.data) ? data.data : []

      // diff scores for the +N pops
      const gained = new Map<number, ScoreFlash>()
      for (const row of next) {
        const old = prevScores.current.get(row.userId)
        if (old !== undefined && row.score > old) {
          gained.set(row.userId, {
            amount: row.score - old,
            tilt: Math.random() * 14 - 7,
            stamp: Date.now()
          })
        }
      }
      prevScores.current = new Map(next.map((r) => [r.userId, r.score]))
      if (gained.size > 0) {
        setFlashes(gained)
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlashes(new Map()), FLASH_MS)
      }

      setRows(next)
      setLastSyncAt(Date.now())
    } catch {}
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    // minimum spin so the animation reads even on fast responses
    await Promise.all([fetchData(), new Promise((r) => setTimeout(r, 650))])
    setRefreshing(false)
  }, [fetchData])

  const fetchMe = useCallback(async () => {
    // Shared /me client cache — on a hard load this reuses the nav
    // shell's request instead of firing a duplicate.
    const result = await requestMe()
    if (!result.ok) return
    const id = result.data.user?.id
    if (id) setCurrentUserId(Number(id))
  }, [])

  // initial load + poll + refetch when the tab regains focus.
  // Hidden tabs skip the poll entirely — the visibility handler refetches
  // the moment the player comes back. The AI and TEAMS views skip it too
  // (their data is server-cached; each board refetches itself), and
  // switching back to a standings board refetches immediately so the
  // pause never shows.
  useEffect(() => {
    Promise.all([fetchData(), fetchMe()]).finally(() => setLoading(false))
    const id = setInterval(() => {
      if (!document.hidden && isStandingsView(viewRef.current)) void fetchData()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isStandingsView(viewRef.current)) {
        void fetchData()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [fetchData, fetchMe])

  const handleViewChange = useCallback(
    (next: BoardView) => {
      const prev = viewRef.current
      setView((current) => (current === next ? current : next))
      if (isStandingsView(next) && prev !== next) {
        // The two standings boards rank by different scores — a board
        // switch must never read as everyone "gaining" the difference.
        viewRef.current = next
        prevScores.current = new Map()
        setFlashes(new Map())
        skipFlip.current = true
        void fetchData()
      }
    },
    [fetchData]
  )

  const totals = useMemo(
    () => ({
      totalPlayers: rows.length,
      activePlayers: rows.filter((u) => u.isActive).length
    }),
    [rows]
  )

  const me = useMemo(
    () => rows.find((u) => u.userId === currentUserId) || null,
    [rows, currentUserId]
  )

  const top3 = useMemo(() => rows.slice(0, 3), [rows])
  const leader = rows[0] ?? null
  const topScore = leader?.score ?? 0

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.display_name || '').toLowerCase().includes(q)
    )
  }, [rows, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  useEffect(() => {
    setPage(1)
  }, [query])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  )

  const showingFrom = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const showingTo = Math.min(page * PAGE_SIZE, filtered.length)

  // ---- FLIP: rows glide to their new positions between polls ----------
  const rowRefs = useRef(new Map<number, HTMLLIElement>())
  const prevTops = useRef(new Map<number, number>())
  const skipFlip = useRef(true)

  // Page/search jumps teleport rows — don't animate those. This must be a
  // layout effect declared BEFORE the FLIP pass: layout effects run in
  // declaration order, so the skip flag is raised before FLIP reads it.
  // (As a plain useEffect it ran after FLIP had already animated the jump.)
  useLayoutEffect(() => {
    skipFlip.current = true
  }, [page, query])

  useLayoutEffect(() => {
    const refs = rowRefs.current
    const previous = prevTops.current
    const next = new Map<number, number>()
    refs.forEach((el, id) => {
      if (el && el.isConnected) next.set(id, el.getBoundingClientRect().top)
    })
    if (!skipFlip.current && !prefersReducedMotion()) {
      next.forEach((top, id) => {
        const old = previous.get(id)
        if (old === undefined) return
        const dy = old - top
        if (Math.abs(dy) < 4) return
        refs.get(id)?.animate(
          [
            { transform: `translateY(${dy}px)`, zIndex: '5' },
            { transform: 'translateY(0)', zIndex: '5' }
          ],
          { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        )
      })
    }
    skipFlip.current = false
    prevTops.current = next
  }, [paged])

  const setRowRef = useCallback((id: number, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [])

  // ---- profile card wiring --------------------------------------------
  // The card row is derived from the freshest poll data, so an open card
  // live-updates (score, rank, movement) instead of freezing the stale
  // object captured at click time.
  const selected = useMemo(
    () => (selectedId === null ? null : rows.find((u) => u.userId === selectedId) ?? null),
    [rows, selectedId]
  )
  const handleSelect = useCallback((u: LeaderRow) => setSelectedId(u.userId), [])
  const handleCardClose = useCallback(() => setSelectedId(null), [])

  const chaseFor = useCallback(
    (row: LeaderRow): ChaseInfo | null => {
      if (row.rank === 1) {
        const second = rows.find((u) => u.rank === 2)
        return second ? { gap: row.score - second.score, username: second.username } : null
      }
      const above = rows.find((u) => u.rank === row.rank - 1)
      return above ? { gap: Math.max(1, above.score - row.score), username: above.username } : null
    },
    [rows]
  )

  return (
    <>
      <AsteroidShower />

      <div
        className={`page-zoom-out lb4-root relative mx-auto max-w-6xl px-4 sm:px-6 pb-16 pt-6 ${
          selected ? 'lb4-freeze' : ''
        }`}
      >
        {/* arena atmosphere — gold spotlight + faint synthwave side washes */}
        <div aria-hidden className="lb4-arena pointer-events-none absolute inset-x-0 top-0 h-[620px]" />

        {/* ---------- title lockup ---------- */}
        <header className="lb4-reveal relative mt-3 flex flex-col items-center" style={{ ['--rv' as string]: '0ms' }}>
          <div className="flex items-center gap-2.5 text-[rgb(var(--lb-gold))]">
            <span className="h-px w-8 bg-gradient-to-r from-transparent to-[rgb(var(--lb-gold)/0.6)]" />
            <IconCrown size={13} />
            <span className="font-display text-[10px] font-semibold tracking-[0.42em] sm:tracking-[0.55em]">
              {view === 'ai'
                ? 'THE AI'
                : view === 'teams'
                  ? 'THE TEAMS'
                  : view === 'alltime'
                    ? 'ALL-TIME'
                    : 'SEASON'}
            </span>
            <IconCrown size={13} className="-scale-x-100" />
            <span className="h-px w-8 bg-gradient-to-l from-transparent to-[rgb(var(--lb-gold)/0.6)]" />
          </div>
          <h1 className="lb4-title mt-4 select-none text-center leading-none [font-family:var(--font-pixel)]">
            LEADERBOARD
          </h1>
          <p className="mt-4 text-[10px] tracking-[0.24em] sm:tracking-[0.3em] text-zinc-600">
            <span className="text-[rgb(var(--lb-gold)/0.85)]">
              {seasonMeta?.phase === 'intermission'
                ? 'INTERMISSION'
                : seasonMeta?.current?.name ?? 'SEASON'}
            </span>
            <span className="mx-2 text-zinc-800">·</span>
            {view === 'ai' ? (
              'the machines, ranked by pilot usage'
            ) : view === 'teams' ? (
              'ranked by combined season score'
            ) : (
              <>
                {view === 'alltime' ? 'ranked by lifetime score' : 'ranked by season score'}
                <span className="mx-2 text-zinc-800">·</span>
                <SyncStatus lastSyncAt={lastSyncAt} />
              </>
            )}
          </p>
        </header>

        <main className="mt-8 space-y-5">
          {/* ---------- stat bar ---------- */}
          {isStandings && (
            <section className="lb4-reveal" style={{ ['--rv' as string]: '90ms' }}>
              <StatBar
                totalPlayers={totals.totalPlayers}
                activePlayers={totals.activePlayers}
                topScore={topScore}
                leaderName={leader?.username ?? null}
                season={seasonMeta}
              />
            </section>
          )}

          {/* ---------- view controls ---------- */}
          <div
            className={`lb4-reveal flex flex-wrap items-center justify-between gap-2 ${
              isStandings ? '!mt-3' : ''
            }`}
            style={{ ['--rv' as string]: '150ms' }}
          >
            {/* board switch — pilots, the machines, or the teams */}
            <div
              className="lb-inset flex min-w-0 max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="tablist"
              aria-label="Leaderboard view"
            >
              {BOARD_TABS.map((tab) => {
                const active = view === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleViewChange(tab.id)}
                    className={`shrink-0 rounded-md px-2.5 py-2 sm:px-3 sm:py-1 text-[10px] tracking-[0.2em] sm:tracking-[0.3em] transition-colors ${
                      active ? '' : 'text-zinc-500 hover:text-zinc-100'
                    }`}
                    style={
                      active
                        ? {
                            border: '1px solid rgb(var(--lb-gold) / 0.5)',
                            color: 'rgb(var(--lb-gold))',
                            background: 'rgb(var(--lb-gold) / 0.07)'
                          }
                        : { border: '1px solid transparent' }
                    }
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {isStandings && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="lb-inset flex items-center gap-2 rounded-lg px-3 py-2 sm:py-1.5 text-[10px] tracking-[0.2em] sm:tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100 disabled:cursor-wait"
                  aria-label="Refresh leaderboard"
                >
                  <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'SYNCING' : 'REFRESH'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPodium((v) => !v)}
                  className="lb-inset flex items-center gap-2 rounded-lg px-3 py-2 sm:py-1.5 text-[10px] tracking-[0.2em] sm:tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100"
                  aria-expanded={showPodium}
                >
                  PODIUM
                  <IconChevronDown
                    size={11}
                    className={`transition-transform duration-300 ${showPodium ? '' : '-rotate-90'}`}
                  />
                </button>
              </div>
            )}
          </div>

          {/* ---------- THE AI LEADERBOARD ---------- */}
          {view === 'ai' && <AiBoard />}

          {/* ---------- THE TEAMS BOARD ---------- */}
          {view === 'teams' && <TeamBoard />}

          {/* ---------- intermission: standings locked ---------- */}
          {view === 'season' && seasonMeta?.phase === 'intermission' && (
            <IntermissionBanner state={seasonMeta} />
          )}

          {/* ---------- podium (collapsible) ---------- */}
          {/* visibility joins the transition so the collapsed podium drops out
              of paint, tab order and screen readers; lb4-pod-off freezes its
              infinite FX so they stop burning frames while hidden */}
          {isStandings && (
          <div
            className={`lb4-reveal grid transition-[grid-template-rows,opacity,margin,visibility] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              showPodium ? '' : 'lb4-pod-off'
            }`}
            style={{
              ['--rv' as string]: '210ms',
              gridTemplateRows: showPodium ? '1fr' : '0fr',
              opacity: showPodium ? 1 : 0,
              marginTop: showPodium ? undefined : 0,
              visibility: showPodium ? 'visible' : 'hidden'
            }}
            aria-hidden={!showPodium}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="px-1 pt-8 pb-1">
                {!loading && top3.length > 0 && (
                  <Podium top3={top3} currentUserId={currentUserId} onSelect={handleSelect} />
                )}
                {loading && <PodiumSkeleton />}
              </div>
            </div>
          </div>
          )}

          {/* ---------- standings ---------- */}
          {isStandings && (
          <section className="lb4-reveal relative" style={{ ['--rv' as string]: '300ms' }}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
                  STANDINGS
                </h2>
                {!loading && filtered.length > 0 && (
                  <span className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                    {showingFrom}–{showingTo} / {formatNumber(filtered.length)}
                  </span>
                )}
              </div>
              <SearchBar value={query} onChange={setQuery} />
            </div>

            <div className="lb-panel relative overflow-hidden">
              <HeaderRow />
              <ul className="relative">
                {loading &&
                  Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} index={i} />)}
                {!loading && filtered.length === 0 && (
                  <li className="py-14 text-center text-xs tracking-[0.15em] text-zinc-500">
                    {query
                      ? 'No pilots match that callsign.'
                      : 'Standings appear once pilots start syncing.'}
                  </li>
                )}
                {!loading &&
                  paged.map((u, i) => (
                    <Row
                      key={u.userId}
                      user={u}
                      index={i}
                      topScore={topScore}
                      isYou={u.userId === currentUserId}
                      flash={flashes.get(u.userId) ?? null}
                      onSelect={handleSelect}
                      setRef={setRowRef}
                    />
                  ))}
              </ul>
            </div>

            {!loading && totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} onPage={setPage} />
            )}

            {/* ---------- sticky YOU bar ---------- */}
            {me && (
              <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mt-4">
                <YouBar me={me} chase={chaseFor(me)} onSelect={handleSelect} />
              </div>
            )}
          </section>
          )}
        </main>

        <footer className="mt-10 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
          <span>CRIBBLE · {new Date().getFullYear()}</span>
          <span className="text-zinc-700">{'// the board never sleeps'}</span>
        </footer>

        {selected && (
          <PlayerCard
            row={selected}
            isYou={selected.userId === currentUserId}
            chase={chaseFor(selected)}
            onClose={handleCardClose}
          />
        )}

        <style jsx global>{`
          /* arena atmosphere — dark mode gets the full stage lighting */
          .lb4-arena {
            background:
              radial-gradient(46% 340px at 50% -40px, rgb(var(--lb-gold) / 0.1), transparent 70%),
              radial-gradient(30% 300px at 12% 60px, rgb(var(--banner-a) / 0.05), transparent 70%),
              radial-gradient(30% 300px at 88% 60px, rgb(var(--banner-b) / 0.05), transparent 70%);
            mask-image: linear-gradient(180deg, black 55%, transparent);
            -webkit-mask-image: linear-gradient(180deg, black 55%, transparent);
          }
          html.light .lb4-arena {
            background: radial-gradient(46% 320px at 50% -40px, rgb(var(--lb-gold) / 0.09), transparent 70%);
          }

          /* retro-arcade title: white face, gold drop, magenta echo */
          .lb4-title {
            font-size: clamp(19px, 4.4vw, 42px);
            color: rgb(var(--z50));
            letter-spacing: 0.03em;
            text-shadow:
              0 0 26px rgb(var(--lb-gold) / 0.3),
              0.09em 0.09em 0 rgb(var(--lb-gold) / 0.5),
              0.18em 0.18em 0 rgb(var(--banner-a) / 0.22);
          }
          html.light .lb4-title {
            text-shadow:
              0.09em 0.09em 0 rgb(var(--lb-gold) / 0.45),
              0.18em 0.18em 0 rgb(var(--banner-a) / 0.16);
          }

          .lb4-live-dot {
            background: rgb(var(--lb-up));
            box-shadow: 0 0 8px rgb(var(--lb-up) / 0.8);
            animation: lb4-live-pulse 2s ease-in-out infinite;
          }
          @keyframes lb4-live-pulse {
            0%,
            100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.45;
              transform: scale(0.8);
            }
          }

          /* first-paint cascade */
          .lb4-reveal {
            animation: lb4-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
            animation-delay: var(--rv, 0ms);
          }
          @keyframes lb4-reveal-in {
            from {
              opacity: 0;
              transform: translateY(14px);
            }
          }

          /* countdown digits tick in place */
          @keyframes lb4-tick {
            0% {
              opacity: 0.3;
              transform: translateY(-3px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .lb4-tick {
            animation: lb4-tick 0.4s ease-out;
            display: inline-block;
            min-width: 1.5ch;
            text-align: center;
          }

          /* score-gain pop — impact bounce, then floats up off the score
             and fades. Every frame carries rotate(var(--gain-rot)) so the
             per-pop tilt stays on for the whole flight. */
          .lb4-gain {
            animation: lb4-gain-float ${FLASH_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
            pointer-events: none;
          }
          @keyframes lb4-gain-float {
            0% {
              opacity: 0;
              transform: translateY(6px) scale(0.45) rotate(var(--gain-rot, 0deg));
            }
            16% {
              opacity: 1;
              transform: translateY(0) scale(1.22) rotate(var(--gain-rot, 0deg));
            }
            26% {
              transform: translateY(0) scale(0.94) rotate(var(--gain-rot, 0deg));
            }
            38% {
              transform: translateY(0) scale(1) rotate(var(--gain-rot, 0deg));
            }
            70% {
              opacity: 1;
              transform: translateY(-8px) scale(1) rotate(var(--gain-rot, 0deg));
            }
            100% {
              opacity: 0;
              transform: translateY(-20px) scale(1) rotate(var(--gain-rot, 0deg));
            }
          }

          /* row flash when its score just moved */
          .lb4-row-flash {
            animation: lb4-row-glow ${FLASH_MS}ms ease-out;
          }
          @keyframes lb4-row-glow {
            0%,
            100% {
              background-color: transparent;
            }
            15% {
              background-color: rgb(var(--lb-gold) / 0.07);
            }
          }

          /* row entrance stagger on first table paint */
          .lb4-row-in {
            animation: lb4-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
            animation-delay: var(--rd, 0ms);
          }
          @keyframes lb4-row-enter {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
          }

          /* Plated rows are physical nameplates, and the art is a fixed dark
             product (authored against the dark arena panel). In light mode a
             plated row is a RUNWAY DISSOLVE: a single long two-hue ramp —
             white, a pastel blush of the plate's accent (--pa), a descent
             through its deep scene hue (--pb) with the art fading in through
             it — with the steep segment landed in text-free gutters. Only
             the cells over the finished descent — 24H / SCORE / STATUS,
             tagged .lb4-dk — re-declare their palette vars to the dark-theme
             values (zinc text scale, medal hues, movement colors, hairlines —
             and the neon glow multiplier, so the score glow re-lights over
             the art). The TOP TOOL cell is deliberately untagged: it renders
             ink on the blush like a non-plated row, which is what gives the
             ramp its runway. Dark mode is untouched: the bleed layer stays
             hidden, the opaque base stays full-bleed, and PlateLayer keeps
             its default left fade. */
          html.light .lb4-plated .lb4-dk {
            --z50: 250 250 250;
            --z100: 244 244 245;
            --z200: 228 228 231;
            --z300: 212 212 216;
            --z400: 161 161 170;
            --z500: 113 113 122;
            --z600: 82 82 91;
            --z700: 63 63 70;
            --z800: 39 39 42;
            --z900: 24 24 27;
            --z950: 9 9 11;
            --lb-gold: 255 214 68;
            --lb-gold-hi: 255 240 160;
            --lb-silver: 216 228 242;
            --lb-bronze: 255 145 77;
            --lb-score: 252 255 0;
            --lb-up: 74 222 128;
            --lb-down: 251 113 133;
            --lb-panel-bg: 9 10 13;
            --lb-panel-edge: 255 255 255;
            --lb-glow: 1;
          }

          /* Runway geometry. The identity zone is PURE WHITE — no art, no
             tint — until past the pilot cell (the grey wash that used to sit
             under names was dark art at 8–30% alpha over white). From there
             ONE eased dissolve runs to the score column, built as a matched
             pair: ground (.lb4-bleed) and art (--plate-mask) ride the same
             slow–fast–slow alpha ladder (~0.08 alpha/rem peak on desktop,
             soft shoulders on both ends — plateaus and slope steps are what
             read as a "band"), with the art trailing the ground by ~1.5rem
             (0.65rem mobile) so it always fades in over its own scene hue
             (--pb is the color the art approaches at its left edge), never
             over white — mid-fade stays chromatic instead of washing out to
             grey. The ramp opens as a whisper-alpha blush of the plate's
             ACCENT (--pa, cap 0.05 — a warm pass-through, not a visible
             band) and hands off to --pb while total alpha is ≤ ~0.08: any
             momentary sRGB desaturation between the two hues renders at
             L≥240 over white — invisible. Zones:
               white (avatar, name, @user — clean panel white)
               → blush→tint (tool cell, ink text on ≤ ~0.28 scene tint)
               → descent (text-free gutters: tool cell's empty right end +
                 the right-aligned 24H cell's empty left end)
               → full scene (score/status, .lb4-dk dark palette; ground
                 ≥ 0.9 by the score column, opaque under the score text,
                 art full ~1.5rem after the ground).
             Anchors: desktop right block = 31rem columns + 3 gaps + 1.25rem
             pad ⇒ tool cell starts at 100% − 34.5rem (its text ends near
             −28rem), score column at 100% − 19.25rem, score text from
             ≈ −16rem. Every stop sits inside ~42rem and positions stay
             monotonic, so a ~45rem row (768px viewport) keeps the whole
             ladder on-canvas — nothing clamps to 0 and murks the name the
             way the old 70rem-start mask did at tablet widths.
             Mobile: pilot truncates at 100% − 9.25rem (1rem pad + 7.5rem
             score cell + 0.75rem gap) and has no gutter — the ramp is still
             ≤ ~0.17 at the truncation anchor and the score rides a
             scene-hued halo (--lb-halo) instead of a solid ground. */
          .lb4-bleed {
            display: none;
          }
          html.light .lb4-plated .lb4-base {
            display: none;
          }
          html.light .lb4-plated .lb4-bleed {
            display: block;
            background: linear-gradient(
              90deg,
              rgb(var(--pa, 124 118 140) / 0) calc(100% - 13rem),
              rgb(var(--pa, 124 118 140) / 0.04) calc(100% - 11.75rem),
              rgb(var(--pa, 124 118 140) / 0.05) calc(100% - 10.9rem),
              rgb(var(--pb, 24 24 27) / 0.09) calc(100% - 10.15rem),
              rgb(var(--pb, 24 24 27) / 0.16) calc(100% - 9.4rem),
              rgb(var(--pb, 24 24 27) / 0.26) calc(100% - 8.7rem),
              rgb(var(--pb, 24 24 27) / 0.38) calc(100% - 8.05rem),
              rgb(var(--pb, 24 24 27) / 0.51) calc(100% - 7.45rem),
              rgb(var(--pb, 24 24 27) / 0.64) calc(100% - 6.85rem),
              rgb(var(--pb, 24 24 27) / 0.76) calc(100% - 6.3rem),
              rgb(var(--pb, 24 24 27) / 0.87) calc(100% - 5.75rem),
              rgb(var(--pb, 24 24 27) / 0.95) calc(100% - 5.2rem),
              rgb(var(--pb, 24 24 27)) calc(100% - 4.5rem)
            );
          }
          html.light .lb4-plated {
            --plate-mask: linear-gradient(
              90deg,
              transparent calc(100% - 12.35rem),
              rgb(0 0 0 / 0.04) calc(100% - 11.1rem),
              rgb(0 0 0 / 0.05) calc(100% - 10.25rem),
              rgb(0 0 0 / 0.09) calc(100% - 9.5rem),
              rgb(0 0 0 / 0.16) calc(100% - 8.75rem),
              rgb(0 0 0 / 0.26) calc(100% - 8.05rem),
              rgb(0 0 0 / 0.38) calc(100% - 7.4rem),
              rgb(0 0 0 / 0.51) calc(100% - 6.8rem),
              rgb(0 0 0 / 0.64) calc(100% - 6.2rem),
              rgb(0 0 0 / 0.76) calc(100% - 5.65rem),
              rgb(0 0 0 / 0.87) calc(100% - 5.1rem),
              rgb(0 0 0 / 0.95) calc(100% - 4.55rem),
              rgb(0 0 0) calc(100% - 3.85rem)
            );
          }
          @media (min-width: 768px) {
            html.light .lb4-plated .lb4-bleed {
              background: linear-gradient(
                90deg,
                rgb(var(--pa, 124 118 140) / 0) calc(100% - 42rem),
                rgb(var(--pa, 124 118 140) / 0.04) calc(100% - 38rem),
                rgb(var(--pa, 124 118 140) / 0.05) calc(100% - 35.5rem),
                rgb(var(--pb, 24 24 27) / 0.08) calc(100% - 33.5rem),
                rgb(var(--pb, 24 24 27) / 0.13) calc(100% - 31rem),
                rgb(var(--pb, 24 24 27) / 0.2) calc(100% - 29rem),
                rgb(var(--pb, 24 24 27) / 0.28) calc(100% - 27.5rem),
                rgb(var(--pb, 24 24 27) / 0.39) calc(100% - 26rem),
                rgb(var(--pb, 24 24 27) / 0.51) calc(100% - 24.5rem),
                rgb(var(--pb, 24 24 27) / 0.63) calc(100% - 23rem),
                rgb(var(--pb, 24 24 27) / 0.75) calc(100% - 21.5rem),
                rgb(var(--pb, 24 24 27) / 0.84) calc(100% - 20.25rem),
                rgb(var(--pb, 24 24 27) / 0.91) calc(100% - 19.25rem),
                rgb(var(--pb, 24 24 27) / 0.96) calc(100% - 18.25rem),
                rgb(var(--pb, 24 24 27) / 0.99) calc(100% - 17.25rem),
                rgb(var(--pb, 24 24 27)) calc(100% - 16.25rem)
              );
            }
            html.light .lb4-plated {
              --plate-mask: linear-gradient(
                90deg,
                transparent calc(100% - 40.5rem),
                rgb(0 0 0 / 0.04) calc(100% - 36.5rem),
                rgb(0 0 0 / 0.05) calc(100% - 34rem),
                rgb(0 0 0 / 0.08) calc(100% - 32rem),
                rgb(0 0 0 / 0.13) calc(100% - 29.5rem),
                rgb(0 0 0 / 0.2) calc(100% - 27.5rem),
                rgb(0 0 0 / 0.28) calc(100% - 26rem),
                rgb(0 0 0 / 0.39) calc(100% - 24.5rem),
                rgb(0 0 0 / 0.51) calc(100% - 23rem),
                rgb(0 0 0 / 0.63) calc(100% - 21.5rem),
                rgb(0 0 0 / 0.75) calc(100% - 20rem),
                rgb(0 0 0 / 0.84) calc(100% - 18.75rem),
                rgb(0 0 0 / 0.91) calc(100% - 17.75rem),
                rgb(0 0 0 / 0.96) calc(100% - 16.75rem),
                rgb(0 0 0 / 0.99) calc(100% - 15.75rem),
                rgb(0 0 0) calc(100% - 14.75rem)
              );
            }
          }

          /* Stragglers over the art: the 24H delta lands where the descent is
             still finishing (ground alpha ~0.63–0.91) and the status column
             sits on the art's full-strength right edge — both get a halo in
             the scene's own hue (reads as ambience, not smudge). The score
             gets the same treatment via the --lb-halo gate on its inline
             text-shadow at EVERY width: mobile because it has no gutter, and
             desktop because the art now rests near full strength under the
             score — bright scene features (cherry's moon) would otherwise
             sit right behind the neon digits. The tool % and @username
             captions keep their dim-caption role but need real ink on the
             blush/tint — zinc-600 was tuned for white. */
          html.light .lb4-plated .lb4-delta {
            text-shadow:
              0 1px 2px rgb(var(--pb, 9 10 13) / 0.95),
              0 0 10px rgb(var(--pb, 9 10 13) / 0.8);
          }
          html.light .lb4-plated .lb4-pct {
            color: rgb(var(--z300) / 0.8);
          }
          html.light .lb4-plated .lb4-cap {
            color: rgb(var(--z300) / 0.8);
          }
          html.light .lb4-plated {
            --lb-halo: 1;
          }

          /* Light rest for the art: 0.55 dimming was tuned for a fully dark
             board, and even 0.75 read as a grey veil that only lifted on
             hover. 0.85 keeps the scene saturated at rest — capped there
             (not 1) because the row's right edge must stay inside the dark
             row's own slope budget: dark shows art features at effective
             0.55 alpha, and past ~0.87 the same features in light exceed
             the bleed-verify slope probe's 1.6× ratio. Hover/focus still
             blooms to full — these outrank the utility classes on the
             wrapper, so restate the bloom for light. */
          html.light .lb4-plated .lb4-art {
            opacity: 0.85;
          }
          html.light .lb4-plated:hover .lb4-art,
          html.light .lb4-plated:focus-within .lb4-art {
            opacity: 1;
          }

          /* The showcase slab: full-bleed in both themes — the one wrapper
             that groups base/bleed/art/YOU/flash under a shared geometry +
             clip. */
          .lb4-slab {
            inset: 0;
          }

          /* CPU guards — freeze every infinite animation when it can't be
             seen: the whole arena while the profile modal covers it (its
             backdrop blur would otherwise re-sample animating pixels every
             frame), and the podium FX while the podium is collapsed. */
          .lb4-freeze *,
          .lb4-pod-off * {
            animation-play-state: paused !important;
          }

          @media (prefers-reduced-motion: reduce) {
            .lb4-reveal,
            .lb4-tick,
            .lb4-gain,
            .lb4-row-flash,
            .lb4-row-in,
            .lb4-live-dot {
              animation: none;
            }
          }
        `}</style>
      </div>
    </>
  )
}

/* ================= self-ticking time read-outs ================= */
/* These own their 1s intervals so the clock only re-renders these leaf
   spans — previously the heartbeat re-rendered the entire arena (podium,
   all rows, stat bar) every single second. */

function SyncStatus({ lastSyncAt }: { lastSyncAt: number | null }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (lastSyncAt === null) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastSyncAt])

  const ago =
    lastSyncAt === null ? null : Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000))

  return (
    <span className="inline-flex items-center gap-1.5" suppressHydrationWarning>
      <span className="lb4-live-dot h-1.5 w-1.5 rounded-full" />
      {ago === null ? 'connecting' : ago < 3 ? 'live' : `synced ${ago}s ago`}
    </span>
  )
}

function SeasonCountdown({ state }: { state: SeasonState | null }) {
  // Active season counts down to its lock; intermission counts down to the
  // next launch. The tick that flips the phase runs every 15 minutes, so a
  // finished countdown briefly reads CLOSING / LAUNCHING until it lands.
  const target =
    state?.phase === 'active'
      ? state.current?.endsAt ?? null
      : state?.next?.startsAt ?? null

  const [countdown, setCountdown] = useState(() =>
    target ? countdownTo(target) : null
  )

  useEffect(() => {
    if (!target) {
      setCountdown(null)
      return
    }
    setCountdown(countdownTo(target))
    const id = setInterval(() => setCountdown(countdownTo(target)), 1000)
    return () => clearInterval(id)
  }, [target])

  const label = !state
    ? 'SEASON'
    : state.phase === 'active'
      ? `${state.current?.name ?? 'SEASON'} · ENDS IN`
      : state.next
        ? `NEXT SEASON IN`
        : `${state.current?.name ?? 'SEASON'} · STATUS`

  return (
    <>
      <div className="flex items-center gap-1.5 text-[9px] tracking-[0.28em] sm:tracking-[0.35em] text-zinc-500">
        <IconHourglass size={11} className="text-zinc-600" />
        {label}
      </div>
      {!state || !target ? (
        <div className="mt-2.5 text-sm text-rose-400 [font-family:var(--font-pixel)] md:text-base">
          {state ? 'ENDED' : '——'}
        </div>
      ) : countdown?.ended ? (
        <div className="mt-2.5 text-sm text-amber-300 [font-family:var(--font-pixel)] md:text-base">
          {state.phase === 'active' ? 'CLOSING' : 'LAUNCHING'}
        </div>
      ) : countdown ? (
        <div className="mt-2.5 flex items-baseline text-xs text-zinc-50 tabular-nums [font-family:var(--font-pixel)] md:text-sm">
          {(
            [
              { v: countdown.d, sfx: 'D' },
              { v: countdown.h, sfx: 'H' },
              { v: countdown.m, sfx: 'M' },
              { v: countdown.s, sfx: 'S' }
            ] as const
          ).map((seg, i) => (
            <span key={seg.sfx} className="flex items-baseline">
              <span key={seg.v} className="lb4-tick" suppressHydrationWarning>
                {seg.v.toString().padStart(2, '0')}
              </span>
              <span className="ml-0.5 font-mono text-[9px] tracking-[0.2em] text-zinc-500">
                {seg.sfx}
              </span>
              {i < 3 && <span className="mx-1 text-xs text-zinc-700">:</span>}
            </span>
          ))}
        </div>
      ) : null}
    </>
  )
}

/* ================= intermission banner ================= */

function IntermissionBanner({ state }: { state: SeasonState }) {
  const startsAt = state.next ? new Date(state.next.startsAt) : null
  return (
    <section className="lb4-reveal" style={{ ['--rv' as string]: '180ms' }}>
      <div
        className="lb-panel flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4"
        style={{ border: '1px solid rgb(var(--lb-gold) / 0.35)' }}
      >
        <div className="flex items-center gap-3">
          <IconTrophy size={15} className="shrink-0 text-[rgb(var(--lb-gold))]" />
          <div>
            <div
              className="text-[10px] font-semibold tracking-[0.4em]"
              style={{ color: 'rgb(var(--lb-gold))' }}
            >
              STANDINGS LOCKED
            </div>
            <p className="mt-1 text-[10px] tracking-[0.2em] text-zinc-500">
              {state.current?.name ?? 'SEASON'} final results. Activity still counts
              toward all-time — season scores reset at launch.
            </p>
          </div>
        </div>
        {state.next && startsAt && (
          <div className="text-right">
            <div className="text-[9px] tracking-[0.35em] text-zinc-500">
              {state.next.name} DEPLOYS
            </div>
            <div className="mt-1 text-xs text-zinc-50 [font-family:var(--font-pixel)]">
              {startsAt
                .toLocaleDateString('en-US', {
                  month: 'short',
                  day: '2-digit',
                  timeZone: 'UTC'
                })
                .toUpperCase()}{' '}
              UTC
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/* ================= stat bar ================= */

function StatBar({
  totalPlayers,
  activePlayers,
  topScore,
  leaderName,
  season
}: {
  totalPlayers: number
  activePlayers: number
  topScore: number
  leaderName: string | null
  season: SeasonState | null
}) {
  const divCls = (i: number) => {
    if (i === 0) return ''
    if (i === 1) return 'border-l border-[rgb(var(--lb-panel-edge)/0.08)]'
    if (i === 2)
      return 'border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0 md:border-l'
    return 'border-t border-l border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0'
  }

  return (
    <div className="lb-panel grid grid-cols-2 overflow-hidden md:grid-cols-4">
      {/* players */}
      <div className={`px-3.5 py-3.5 sm:px-4 sm:py-4 ${divCls(0)}`}>
        <div className="flex items-center gap-1.5 text-[9px] tracking-[0.28em] sm:tracking-[0.35em] text-zinc-500">
          <IconUsers size={11} className="text-zinc-600" />
          PLAYERS
        </div>
        <div className="mt-2.5 text-sm text-zinc-50 tabular-nums [font-family:var(--font-pixel)] md:text-base">
          <AnimatedCounter value={totalPlayers} duration={1100} formatter={(v) => formatNumber(Math.round(v))} />
        </div>
      </div>

      {/* online */}
      <div className={`px-3.5 py-3.5 sm:px-4 sm:py-4 ${divCls(1)}`}>
        <div className="flex items-center gap-1.5 text-[9px] tracking-[0.28em] sm:tracking-[0.35em] text-zinc-500">
          <IconPulse size={11} className="text-zinc-600" />
          ONLINE NOW
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-sm text-zinc-50 tabular-nums [font-family:var(--font-pixel)] md:text-base">
          <AnimatedCounter value={activePlayers} duration={1100} formatter={(v) => formatNumber(Math.round(v))} />
          <span className="lb4-live-dot h-1.5 w-1.5 rounded-full" />
        </div>
      </div>

      {/* top score — gold, with the holder's callsign */}
      <div className={`px-3.5 py-3.5 sm:px-4 sm:py-4 ${divCls(2)}`}>
        <div className="flex items-center gap-1.5 text-[9px] tracking-[0.28em] sm:tracking-[0.35em] text-zinc-500">
          <IconTrophy size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />
          TOP SCORE
        </div>
        <div
          className="mt-2.5 text-sm tabular-nums [font-family:var(--font-pixel)] md:text-base"
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: '0 0 14px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
          }}
        >
          <AnimatedCounter value={topScore} duration={1100} formatter={(v) => formatCompact(Math.round(v))} />
        </div>
        {leaderName && (
          <div className="mt-1 truncate text-[9px] tracking-[0.2em] text-zinc-600">
            held by <span className="text-zinc-400">@{leaderName}</span>
          </div>
        )}
      </div>

      {/* season countdown — self-ticking */}
      <div className={`px-3.5 py-3.5 sm:px-4 sm:py-4 ${divCls(3)}`}>
        <SeasonCountdown state={season} />
      </div>
    </div>
  )
}

/* ================= standings table ================= */

const ROW_GRID =
  'grid grid-cols-[3.6rem_minmax(0,1fr)_auto] md:grid-cols-[4.2rem_minmax(0,1fr)_8.5rem_5.5rem_10.5rem_6.5rem] items-center gap-3 px-4 md:px-5'

function HeaderRow() {
  return (
    <div
      className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[10px] md:text-[9px] tracking-[0.35em] text-zinc-500`}
    >
      <div>RANK</div>
      <div>PILOT</div>
      <div className="hidden md:block">TOP TOOL</div>
      <div className="hidden text-right md:block">24H</div>
      <div className="text-right text-zinc-300">SCORE</div>
      <div className="hidden text-right md:block">STATUS</div>
    </div>
  )
}

function MovementChip({ user }: { user: LeaderRow }) {
  if (user.rankDelta > 0) {
    return (
      <span
        className="flex items-center gap-0.5 text-[9px] font-semibold tabular-nums"
        style={{ color: 'rgb(var(--lb-up))' }}
        title={`Climbed ${user.rankDelta} place${user.rankDelta === 1 ? '' : 's'}`}
      >
        <MoveGlyph dir="up" size={7} />
        {user.rankDelta}
      </span>
    )
  }
  if (user.rankDelta < 0) {
    return (
      <span
        className="flex items-center gap-0.5 text-[9px] font-semibold tabular-nums"
        style={{ color: 'rgb(var(--lb-down))' }}
        title={`Dropped ${-user.rankDelta} place${user.rankDelta === -1 ? '' : 's'}`}
      >
        <MoveGlyph dir="down" size={7} />
        {-user.rankDelta}
      </span>
    )
  }
  if (user.isNew) {
    return (
      <span
        className="text-[8px] font-semibold tracking-[0.18em]"
        style={{ color: 'rgb(var(--lb-gold))' }}
        title="New to the board"
      >
        NEW
      </span>
    )
  }
  return <span className="text-[9px] text-zinc-800">—</span>
}

function Row({
  user,
  index,
  topScore,
  isYou,
  flash,
  onSelect,
  setRef
}: {
  user: LeaderRow
  index: number
  topScore: number
  isYou: boolean
  flash: ScoreFlash | null
  onSelect: (u: LeaderRow) => void
  setRef: (id: number, el: HTMLLIElement | null) => void
}) {
  const medal = medalFor(user.rank)
  const topTool = user.topTools?.[0]
  const pct = topScore > 0 ? Math.max(2, Math.round((user.score / topScore) * 100)) : 0
  const plated = Boolean(user.plate)
  // Per-plate hues driving the light-mode runway dissolve: --pa (signature
  // accent) opens the ramp as a pastel blush, --pb (deep scene hue) carries
  // the descent into the art. image-kind renders carry neither in the
  // catalog and unknown/retired ids resolve to null — both fall back to
  // neutrals so the gradient stays valid.
  const plateDef = user.plate ? getPlate(user.plate) : null
  const plateBleed =
    plateDef?.render.kind === 'css' ? plateDef.render.bleed : '24 24 27'
  const plateAccent =
    plateDef?.render.kind === 'css' ? plateDef.render.accent : '124 118 140'

  return (
    <li
      ref={(el) => setRef(user.userId, el)}
      className={`lb4-row-in relative border-b border-[rgb(var(--lb-panel-edge)/0.05)] last:border-b-0 ${
        plated ? 'lb4-plated' : ''
      } ${flash ? 'lb4-row-flash' : ''}`}
      style={{
        ['--rd' as string]: `${Math.min(index, 12) * 34}ms`,
        ['--pb' as string]: plated ? plateBleed : undefined,
        ['--pa' as string]: plated ? plateAccent : undefined,
        background: isYou && !plated ? 'rgb(var(--accent-rgb) / 0.045)' : undefined,
        boxShadow: isYou && !plated ? 'inset 2px 0 0 rgb(var(--accent-rgb))' : undefined
      }}
    >
      {/* Row geometry: py-4 padding + h-9 avatar ⇒ ~68px rows. The plate
          art scenes are tuned against this height — keep the two in sync.
          (The slab is full-bleed in both themes; light mode crops the art
          horizontally via masks, never vertically.) */}
      <button
        type="button"
        onClick={() => onSelect(user)}
        aria-label={`Open profile — @${user.username}, rank ${user.rank}`}
        className={`${ROW_GRID} group relative w-full py-4 text-left transition-colors focus-visible:outline-none ${
          plated
            ? ''
            : 'hover:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:bg-[rgb(var(--lb-panel-edge)/0.045)]'
        }`}
      >
        {user.plate && (
          /* Showcase slab — the one wrapper that owns the plated
             presentation, so every layer below (base/bleed, art, YOU
             jewelry, flash) shares its geometry and clip. Full-bleed in
             both themes (.lb4-slab: inset 0). Dark mode: the nameplate IS
             the row, edge to edge, over the opaque dark base. Light mode:
             the runway dissolve — the neutral base hides, the identity
             zone stays pure panel white, and the .lb4-bleed gradient
             carries one eased descent through an accent blush (--pa) into
             the deep scene hue (--pb) while the art emerges through the
             same interval; no neutral gray, no hard seam, no flat band. */
          <div aria-hidden className="lb4-slab absolute overflow-hidden">
            {/* Nameplate surface — plate art is authored against the dark
                arena panel, so in dark mode it always paints over an opaque
                dark base (same treatment as the shop preview). Light mode
                hides it (.lb4-base): a neutral black under-layer is exactly
                what made the old transition read as gray smog — the bleed
                layer below is the light-mode ground instead. */}
            <div className="lb4-base absolute inset-0" style={{ background: 'rgb(9 10 13)' }} />
            {/* Runway ramp — light mode only. One gradient, two hues: the
                accent blush opens at low alpha (ink text stays readable on
                the pastel), hands off to the deep scene hue while still
                translucent, and reaches full depth only at the score
                column — the art's mask rises through the same interval so
                the descent always shows scene texture. Cells past the
                descent (.lb4-dk) re-pin their palette vars to dark-theme
                values. */}
            <div className="lb4-bleed absolute inset-0" />
            {/* the art rests dimmed (a page of 25 plated rows must stay
                scannable) and blooms to full strength on hover/focus — the
                single hover effect on a plated row, so no gray veil ever
                crosses the artwork. Dark rests at 0.55 (full-dark board);
                light rests at 0.85 (.lb4-art) — near-full saturation
                without the mouse, and the sliver of bleed hue blending
                through is in the art's own color family. PlateLayer clips
                itself, so the score-gain pop can still float past the
                row's top edge; lives inside the FLIP-measured <li>, so
                reordering carries it along. */}
            <div
              className="lb4-art absolute inset-0 opacity-[0.55] transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <PlateLayer plateId={user.plate} />
            </div>
            {isYou && (
              <>
                {/* the YOU marker stays OFF the art: an accent keyline plus
                    a short wash over the left identity zone (dark panel in
                    dark mode, the white half in light — reads like the
                    non-plated YOU treatment there), replacing the full-row
                    accent wash that muddied the plate colors */}
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 w-36 max-w-[45%]"
                  style={{
                    background:
                      'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.13), transparent)'
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
                  style={{ background: 'rgb(var(--accent-rgb))' }}
                />
              </>
            )}
            {/* score-flash repainted above the plate (the li background
                sits underneath the opaque nameplate surface) */}
            {flash && <div className="lb4-row-flash pointer-events-none absolute inset-0" />}
          </div>
        )}

        {/* rank + movement */}
        <div className="relative flex items-center gap-2">
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
              {user.rank}
            </span>
          ) : (
            <span className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
              {user.rank}
            </span>
          )}
          <MovementChip user={user} />
        </div>

        {/* pilot — top three wear rank regalia; companies (tier TEAM) get
            the square avatar */}
        <div className="relative flex min-w-0 items-center gap-3">
          <RankAvatar user={user} />
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="truncate font-display text-[13px] font-medium tracking-tight"
              style={{ color: isYou ? 'rgb(var(--accent-rgb))' : 'rgb(var(--z100))' }}
            >
              {user.display_name || `@${user.username}`}
            </span>
            {isProTier(user.tier) && <VerifiedBadge size={14} />}
            {user.team && <TeamMiniLogo team={user.team} size={14} />}
            <span className="lb4-cap hidden shrink-0 text-[10px] text-zinc-600 lg:inline">
              @{user.username}
            </span>
            {isYou && (
              <span className="shrink-0 text-[8px] tracking-[0.25em] text-accent">YOU</span>
            )}
          </span>
        </div>

        {/* top tool — deliberately NOT .lb4-dk. In a light-plated row this
            cell sits on the runway's opening tint (scene hue ≤ ~0.28 under
            its text) and renders ink text exactly like a non-plated light
            row — that's what buys the dissolve ~9rem of extra runway
            before any cell demands a dark ground. Dark mode is unaffected:
            the .lb4-dk pins only exist under html.light. */}
        <div className="relative hidden min-w-0 items-center gap-2 md:flex">
          {topTool ? (
            <>
              <ToolIcon name={topTool.name} size={13} className="shrink-0 text-zinc-400" />
              <span className="truncate text-xs text-zinc-300">{topTool.name}</span>
              <span className="lb4-pct shrink-0 text-[9px] tabular-nums text-zinc-600">
                {topTool.percent}%
              </span>
            </>
          ) : (
            <span className="text-zinc-800">—</span>
          )}
        </div>

        {/* 24h gain — first dark-palette cell; its right-aligned span sits
            where the runway's descent is finishing (ground alpha ~0.8–1),
            so the delta gets a scene-hued halo (.lb4-delta) to hold it
            against whatever the art paints beneath. */}
        <div className="lb4-dk relative hidden text-right text-[11px] tabular-nums md:block">
          {user.todayScore > 0 ? (
            <span className="lb4-delta" style={{ color: 'rgb(var(--lb-up))' }}>
              +{formatCompact(user.todayScore)}
            </span>
          ) : (
            <span className="text-zinc-700">·</span>
          )}
        </div>

        {/* SCORE — the main thing. The mobile min-width pins the auto column
            (and with it the bleed-side edge of the 1fr pilot column) so a
            short score can't let a long name stretch under the full-strength
            bleed; 7.5rem seats a 9-glyph pixel-font score ("9,999,999"). */}
        <div className="lb4-dk relative min-w-[7.5rem] text-right md:min-w-0">
          {flash && (
            <span
              key={flash.stamp}
              className="lb4-gain absolute -top-3 right-0 text-[9px] font-semibold tabular-nums"
              style={{
                ['--gain-rot' as string]: `${flash.tilt}deg`,
                color: 'rgb(var(--lb-gold-hi))',
                textShadow: '0 0 8px rgb(var(--lb-gold) / 0.55)'
              }}
            >
              +{formatCompact(flash.amount)}
            </span>
          )}
          <div
            className="text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)]"
            style={{
              color: 'rgb(var(--lb-score))',
              // --lb-halo (0 everywhere except light-plated rows) gates a
              // scene-hued dark halo — same recipe as .lb4-delta: mobile
              // because the score lands while the ground is still
              // translucent, desktop because near-full-strength art (e.g.
              // cherry's moon) can be bright right behind the neon digits.
              textShadow: medal
                ? '0 0 12px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1))), 0 1px 2px rgb(var(--pb, 9 10 13) / calc(0.95 * var(--lb-halo, 0))), 0 0 10px rgb(var(--pb, 9 10 13) / calc(0.8 * var(--lb-halo, 0)))'
                : '0 0 10px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1))), 0 1px 2px rgb(var(--pb, 9 10 13) / calc(0.95 * var(--lb-halo, 0))), 0 0 10px rgb(var(--pb, 9 10 13) / calc(0.8 * var(--lb-halo, 0)))'
            }}
          >
            {formatNumber(user.score)}
          </div>
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)]">
            <div
              className="ml-auto h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: medal
                  ? `linear-gradient(90deg, ${medalA(medal.rgb, 0.4)}, ${medal.fg})`
                  : 'linear-gradient(90deg, rgb(var(--z700)), rgb(var(--z400)))'
              }}
            />
          </div>
        </div>

        {/* status */}
        <div className="lb4-dk relative hidden items-center justify-end gap-1.5 text-[10px] tabular-nums md:flex">
          {user.isActive ? (
            <>
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: 'rgb(var(--lb-up))',
                  boxShadow: '0 0 6px rgb(var(--lb-up) / 0.7)'
                }}
              />
              {/* .lb4-delta: same scene-hued halo as the 24H delta — the
                  status column sits over the art's right edge, the row's
                  brightest ground on scenes like koi */}
              <span className="lb4-delta" style={{ color: 'rgb(var(--lb-up))' }}>
                online
              </span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
              <span className="lb4-delta text-zinc-600">{formatRelative(user.lastSeen)}</span>
            </>
          )}
        </div>
      </button>
    </li>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <li
      className="lb4-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)]"
      style={{ ['--rd' as string]: `${index * 50}ms` }}
    >
      {/* mirrors the live Row geometry (py-4 + h-9 avatar ⇒ ~68px) so the
          table doesn't jump when data lands; shimmer blocks ride the
          panel-edge ink so they read on the white panel too */}
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        <span className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-full bg-[rgb(var(--lb-panel-edge)/0.05)]" />
          <span className="h-3 w-32 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        </span>
        <span className="hidden h-3 w-20 rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-10 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="h-3.5 w-24 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.06)]" />
        <span className="hidden h-3 w-14 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
      </div>
    </li>
  )
}

function PodiumSkeleton() {
  return (
    <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3 md:gap-5">
      {[64, 96, 48].map((h, i) => (
        <div key={i} className={`animate-pulse ${i === 1 ? 'md:order-2' : i === 0 ? 'md:order-1' : 'md:order-3'}`}>
          <div className="lb-panel p-5">
            <div className="mx-auto h-16 w-16 rounded-full bg-[rgb(var(--lb-panel-edge)/0.05)]" />
            <div className="mx-auto mt-4 h-3 w-24 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
            <div className="mx-auto mt-3 h-5 w-32 rounded bg-[rgb(var(--lb-panel-edge)/0.07)]" />
            <div className="mx-auto mt-4 rounded bg-[rgb(var(--lb-panel-edge)/0.03)]" style={{ height: h / 2 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ================= sticky YOU bar ================= */

function YouBar({
  me,
  chase,
  onSelect
}: {
  me: LeaderRow
  chase: ChaseInfo | null
  onSelect: (u: LeaderRow) => void
}) {
  const medal = medalFor(me.rank)

  return (
    <button
      type="button"
      onClick={() => onSelect(me)}
      aria-label="Open your profile card"
      // blur-md, not xl: this sticky bar re-samples whatever scrolls under
      // it every frame, so the kernel size directly prices every scroll.
      className="block w-full text-left backdrop-blur-md"
      style={{
        // A docked strip of your own table row: the same flat accent wash
        // and 2px rail the isYou Row wears, on a translucent arena panel.
        background:
          'linear-gradient(0deg, rgb(var(--accent-rgb) / 0.045), rgb(var(--accent-rgb) / 0.045)), rgb(var(--lb-panel-bg) / 0.88)',
        border: '1px solid rgb(var(--accent-rgb) / 0.18)',
        boxShadow: 'inset 2px 0 0 rgb(var(--accent-rgb)), 0 16px 36px -20px rgb(0 0 0 / 0.5)'
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3 md:gap-4 md:px-5">
        {/* rank + movement — the table's badge, chip only when they moved */}
        <div className="flex shrink-0 items-center gap-2">
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
              {me.rank}
            </span>
          ) : (
            <span className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
              {me.rank}
            </span>
          )}
          {(me.rankDelta !== 0 || me.isNew) && <MovementChip user={me} />}
        </div>

        <RankAvatar user={me} />

        {/* identity + the one competitive fact: lead when #1, chase otherwise */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[13px] font-medium tracking-tight text-accent">
              {me.display_name || `@${me.username}`}
            </span>
            <span
              className="shrink-0 px-1.5 py-[3px] text-[8px] leading-none tracking-[0.25em] text-accent"
              style={{
                border: '1px solid rgb(var(--accent-rgb) / 0.4)',
                background: 'rgb(var(--accent-rgb) / 0.08)'
              }}
            >
              YOU
            </span>
          </div>
          {chase && (
            <div className="mt-1 truncate text-[11px] tabular-nums text-zinc-500">
              {me.rank === 1 ? (
                <>
                  <span className="text-zinc-300">+{formatNumber(chase.gap)}</span> @
                  {chase.username}
                </>
              ) : (
                <>
                  <span className="text-zinc-300">{formatNumber(chase.gap)}</span> to @
                  {chase.username}
                </>
              )}
            </div>
          )}
        </div>

        {/* today delta + score — the table's 24H and SCORE columns, docked */}
        <div className="flex shrink-0 items-baseline gap-3">
          {me.todayScore > 0 && (
            <span className="text-[11px] tabular-nums" style={{ color: 'rgb(var(--lb-up))' }}>
              +{formatCompact(me.todayScore)}
            </span>
          )}
          <span
            className="text-[15px] leading-none tabular-nums [font-family:var(--font-pixel)]"
            style={{
              color: 'rgb(var(--lb-score))',
              textShadow: '0 0 10px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
            }}
          >
            {formatNumber(me.score)}
          </span>
        </div>
      </div>
    </button>
  )
}

/* ================= search + pagination ================= */

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="lb-inset flex w-full sm:max-w-xs items-center overflow-hidden rounded-lg">
      <span className="pl-3 pr-1 text-zinc-600">
        <IconSearch size={12} />
      </span>
      <input
        type="text"
        placeholder="hunt a pilot…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent px-2 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="border-l border-[rgb(var(--lb-panel-edge)/0.08)] px-3 py-2 text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200"
        >
          CLEAR
        </button>
      )}
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  onPage
}: {
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null

  const pages: (number | '…')[] = []
  const window = 2
  const start = Math.max(2, page - window)
  const end = Math.min(totalPages - 1, page + window)

  pages.push(1)
  if (start > 2) pages.push('…')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages - 1) pages.push('…')
  if (totalPages > 1) pages.push(totalPages)

  const baseBtn =
    'lb-inset flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] tracking-[0.15em] tabular-nums transition-colors'
  const idleBtn = 'text-zinc-400 hover:text-zinc-100'
  const disabledBtn = 'text-zinc-700 cursor-not-allowed opacity-50'

  const atFirst = page === 1
  const atLast = page === totalPages

  return (
    <nav
      aria-label="Standings pagination"
      className="mt-4 flex flex-wrap items-center justify-center gap-1.5"
    >
      <button
        type="button"
        onClick={() => !atFirst && onPage(page - 1)}
        disabled={atFirst}
        className={`${baseBtn} ${atFirst ? disabledBtn : idleBtn}`}
      >
        <IconChevronLeft size={11} />
        PREV
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="hidden select-none px-1 text-[11px] text-zinc-700 sm:inline">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            className={`hidden sm:flex ${baseBtn} ${p === page ? '' : idleBtn}`}
            style={
              p === page
                ? {
                    borderColor: 'rgb(var(--lb-gold) / 0.5)',
                    color: 'rgb(var(--lb-gold))',
                    background: 'rgb(var(--lb-gold) / 0.07)'
                  }
                : undefined
            }
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}

      <span className="lb-inset rounded-lg px-3 py-1.5 text-[11px] tracking-[0.15em] tabular-nums text-zinc-400 sm:hidden">
        PAGE {page} / {totalPages}
      </span>

      <button
        type="button"
        onClick={() => !atLast && onPage(page + 1)}
        disabled={atLast}
        className={`${baseBtn} ${atLast ? disabledBtn : idleBtn}`}
      >
        NEXT
        <IconChevronRight size={11} />
      </button>

      <span className="mx-1 hidden h-4 w-px bg-[rgb(var(--lb-panel-edge)/0.08)] sm:inline" />

      <button
        type="button"
        onClick={() => !atLast && onPage(totalPages)}
        disabled={atLast}
        className={`hidden sm:flex ${baseBtn} ${atLast ? disabledBtn : idleBtn}`}
        title={`Jump to page ${totalPages}`}
      >
        LAST
        <IconChevronsRight size={11} />
      </button>
    </nav>
  )
}
