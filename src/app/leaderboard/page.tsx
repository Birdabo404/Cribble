'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import SpaceBackdrop from '@/components/SpaceBackdrop'

type Tier = 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'PREMIUM+' | 'AFFILIATE'

interface LeaderUser {
  userId: number
  rank: number
  username: string
  display_name: string
  profile_image: string | null
  score: number
  isActive: boolean
  lastSeen: string | null
  tier: Tier
  topTools?: { name: string; visits: number; active_ms: number; percent: number }[]
}

const SEASON = {
  name: 'SEASON 01',
  startISO: '2026-04-01T00:00:00.000Z',
  endISO: '2026-07-01T00:00:00.000Z'
}

import { ACCENT, accentA } from '@/lib/theme'
import { ThemeToggle } from '@/components/ThemeToggle'

// "GLOBAL LEADERBOARD" in block characters — same art as v1, kept for the retro touch
const ASCII_HEADER = String.raw` ██████╗ ██╗      ██████╗ ██████╗  █████╗ ██╗         ██╗     ███████╗ █████╗ ██████╗ ███████╗██████╗ ██████╗  ██████╗  █████╗ ██████╗ ██████╗ 
██╔════╝ ██║     ██╔═══██╗██╔══██╗██╔══██╗██║         ██║     ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ███╗██║     ██║   ██║██████╔╝███████║██║         ██║     █████╗  ███████║██║  ██║█████╗  ██████╔╝██████╔╝██║   ██║███████║██████╔╝██║  ██║
██║   ██║██║     ██║   ██║██╔══██╗██╔══██║██║         ██║     ██╔══╝  ██╔══██║██║  ██║██╔══╝  ██╔══██╗██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║
╚██████╔╝███████╗╚██████╔╝██████╔╝██║  ██║███████╗    ███████╗███████╗██║  ██║██████╔╝███████╗██║  ██║██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
 ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝    ╚══════╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ `

const formatNumber = (n: number) => n.toLocaleString('en-US')

const formatCompact = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

const formatRelative = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`
  return `${Math.floor(diff / 86400_000)}d`
}

const tierAccent = (tier: Tier | undefined): string => {
  switch (tier) {
    case 'PRO':
      return 'text-amber-300 border-amber-300/40 bg-amber-300/5'
    case 'PREMIUM':
    case 'PREMIUM+':
      return 'text-zinc-100 border-zinc-300/40 bg-zinc-300/5'
    case 'AFFILIATE':
      return 'text-cyan-300 border-cyan-300/40 bg-cyan-300/5'
    case 'BASIC':
      return 'text-accent border-accent/40 bg-accent/5'
    default:
      return 'text-zinc-300 border-zinc-700 bg-zinc-900/60'
  }
}

const rankAccent = (rank: number) => {
  if (rank === 1) return { text: 'text-zinc-100' }
  if (rank === 2) return { text: 'text-zinc-300' }
  if (rank === 3) return { text: 'text-zinc-400' }
  return { text: 'text-zinc-500' }
}

const PAGE_SIZE = 30

export default function LeaderboardV2() {
  const [leaderboard, setLeaderboard] = useState<LeaderUser[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [countdown, setCountdown] = useState<{
    d: number
    h: number
    m: number
    s: number
    ended: boolean
  }>({ d: 0, h: 0, m: 0, s: 0, ended: false })
  const [page, setPage] = useState(1)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (data.success) {
        const rows = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.leaderboard)
            ? data.leaderboard
            : []
        setLeaderboard(rows)
      }
    } catch {}
  }, [])

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/user/me', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      if (data?.user?.id) setCurrentUserId(Number(data.user.id))
    } catch {}
  }, [])

  useEffect(() => {
    Promise.all([fetchData(), fetchMe()]).finally(() => setLoading(false))
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData, fetchMe])

  // Countdown
  useEffect(() => {
    const tick = () => {
      const end = new Date(SEASON.endISO).getTime()
      const diff = end - Date.now()
      if (diff <= 0) {
        setCountdown({ d: 0, h: 0, m: 0, s: 0, ended: true })
        return
      }
      setCountdown({
        d: Math.floor(diff / 86400_000),
        h: Math.floor((diff % 86400_000) / 3600_000),
        m: Math.floor((diff % 3600_000) / 60_000),
        s: Math.floor((diff % 60_000) / 1000),
        ended: false
      })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const totals = useMemo(() => {
    const totalPlayers = leaderboard.length
    const activePlayers = leaderboard.filter((u) => u.isActive).length
    return { totalPlayers, activePlayers }
  }, [leaderboard])

  const me = useMemo(
    () => leaderboard.find((u) => u.userId === currentUserId) || null,
    [leaderboard, currentUserId]
  )

  const top3 = useMemo(() => leaderboard.slice(0, 3), [leaderboard])

  // Keep standings comprehensive (including top 3) so small leaderboards
  // do not appear empty in the table section.
  const filteredStandings = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return leaderboard
    return leaderboard.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.display_name || '').toLowerCase().includes(q)
    )
  }, [leaderboard, query])

  const totalPages = Math.max(1, Math.ceil(filteredStandings.length / PAGE_SIZE))

  // Reset to page 1 whenever the underlying filtered list or query changes
  useEffect(() => {
    setPage(1)
  }, [query])

  // Clamp page if the data shrank (e.g. after a refetch removes players)
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pagedStandings = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredStandings.slice(start, start + PAGE_SIZE)
  }, [filteredStandings, page])

  const showingFrom = filteredStandings.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const showingTo = Math.min(page * PAGE_SIZE, filteredStandings.length)

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-mono selection:bg-accent/20">
      <SpaceBackdrop />

      {/* horizon line */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 h-px opacity-30 z-0"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgb(var(--accent-rgb)/0.55), transparent)'
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-6 pt-10 pb-16">
        <Header
          totalPlayers={totals.totalPlayers}
          activePlayers={totals.activePlayers}
        />

        <main className="mt-14">
          {/* TITLE BLOCK — ASCII art retro header */}
          <section className="flex flex-col items-center gap-5">
            <div className="w-full overflow-x-auto py-2">
              <pre
                aria-label="GLOBAL LEADERBOARD"
                className="whitespace-pre leading-[0.9] font-mono text-center mx-auto"
                style={{
                  fontSize: 'clamp(4.5px, 0.78vw, 9.5px)',
                  color: ACCENT,
                  textShadow: `0 0 8px ${accentA(0.33)}, 0 0 22px ${accentA(0.15)}`,
                  letterSpacing: '-0.02em'
                }}
              >
                {ASCII_HEADER}
              </pre>
            </div>

            <p className="text-[11px] tracking-[0.2em] text-zinc-500 text-center">
              <span style={{ color: `${accentA(0.8)}` }}>{'// '}</span>
              ranked by season-long score
              <span className="mx-2 text-zinc-700">·</span>
              live sync every 30s
            </p>
          </section>

          {/* SEASON COUNTDOWN — compact, centered, animated digits */}
          <section className="mt-10 flex justify-center">
            <SeasonCountdown
              seasonName={SEASON.name}
              countdown={countdown}
            />
          </section>

          {/* PODIUM — top 3, restrained and uniform */}
          {!loading && top3.length > 0 && (
            <section className="mt-10">
              <div
                className="text-[10px] tracking-[0.4em] mb-4"
                style={{ color: `${accentA(0.7)}` }}
              >
                {'// TOP 3'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {top3.map((u) => (
                  <PodiumCard
                    key={u.userId}
                    user={u}
                    isYou={u.userId === currentUserId}
                  />
                ))}
              </div>
            </section>
          )}

          {/* SEARCH + LIST */}
          <section className="mt-10">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-baseline gap-3">
                <div
                  className="text-[10px] tracking-[0.4em]"
                  style={{ color: `${accentA(0.7)}` }}
                >
                  STANDINGS
                </div>
                {!loading && filteredStandings.length > 0 && (
                  <div className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                    {showingFrom}–{showingTo} / {formatNumber(filteredStandings.length)}
                  </div>
                )}
              </div>
              <SearchBar value={query} onChange={setQuery} />
            </div>

            <div
              className="rounded-2xl border bg-zinc-950/80 backdrop-blur-sm overflow-hidden"
              style={{ borderColor: `${accentA(0.15)}` }}
            >
              <HeaderRow />
              <ul className="divide-y divide-zinc-900/80">
                {loading && (
                  <li className="py-10 text-center text-xs tracking-[0.3em] text-zinc-600">
                    LOADING…
                  </li>
                )}
                {!loading && filteredStandings.length === 0 && (
                  <li className="py-10 text-center text-xs text-zinc-500">
                    {query ? 'No players match that handle.' : 'Standings will appear here once players are ranked.'}
                  </li>
                )}
                {!loading &&
                  pagedStandings.map((u) => (
                    <Row
                      key={u.userId}
                      user={u}
                      isYou={u.userId === currentUserId}
                    />
                  ))}
              </ul>
            </div>

            {!loading && totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} onPage={setPage} />
            )}

            {/* "You" sticky inline summary if user is far down the list */}
            {me && me.rank > 13 && (
              <div
                className="mt-3 rounded-2xl border backdrop-blur-sm"
                style={{
                  borderColor: `${accentA(0.25)}`,
                  background: `${accentA(0.04)}`
                }}
              >
                <Row user={me} isYou compact />
              </div>
            )}
          </section>
        </main>

        <Footer />
      </div>
    </div>
  )
}

function Header({
  totalPlayers,
  activePlayers
}: {
  totalPlayers: number
  activePlayers: number
}) {
  return (
    <header className="flex items-center justify-between gap-4">
      <a
        href="/dashboard"
        className="text-sm tracking-[0.4em] text-zinc-100 font-semibold hover:opacity-80 transition-opacity"
        aria-label="Back to dashboard"
      >
        CRIBBLE<span style={{ color: ACCENT }}>.</span>
      </a>

      <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-950/70">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: ACCENT,
            boxShadow: `0 0 8px ${accentA(0.69)}`
          }}
        />
        <span className="text-[10px] tracking-[0.3em] text-zinc-400">LIVE</span>
        <span className="text-[10px] text-zinc-700">·</span>
        <span className="text-[10px] tracking-[0.2em] text-zinc-500 tabular-nums">
          {formatNumber(totalPlayers)} PLAYERS · {formatNumber(activePlayers)} ONLINE
        </span>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <a
          href="/dashboard"
          className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 transition-colors"
        >
          ← DASHBOARD
        </a>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="mt-12 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
      <span>CRIBBLE · {new Date().getFullYear()}</span>
      <span style={{ color: `${accentA(0.6)}` }}>
        {'// climb. or don\u2019t. we\u2019re keeping score.'}
      </span>
    </footer>
  )
}

function SeasonCountdown({
  seasonName,
  countdown
}: {
  seasonName: string
  countdown: { d: number; h: number; m: number; s: number; ended: boolean }
}) {
  if (countdown.ended) {
    return (
      <div className="inline-flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 backdrop-blur-sm px-4 py-2">
        <span
          className="text-[10px] tracking-[0.4em] font-semibold"
          style={{ color: ACCENT }}
        >
          {seasonName}
        </span>
        <span className="h-3 w-px bg-zinc-800" />
        <span className="text-[11px] tracking-[0.2em] text-rose-300">
          season ended
        </span>
      </div>
    )
  }

  const segs: { value: number; suffix: string }[] = [
    { value: countdown.d, suffix: 'D' },
    { value: countdown.h, suffix: 'H' },
    { value: countdown.m, suffix: 'M' },
    { value: countdown.s, suffix: 'S' }
  ]

  return (
    <div className="inline-flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 backdrop-blur-sm px-4 py-2">
      <span
        className="text-[10px] tracking-[0.4em] font-semibold"
        style={{ color: ACCENT }}
      >
        {seasonName}
      </span>
      <span className="h-3 w-px bg-zinc-800" />
      <span className="text-[10px] tracking-[0.3em] text-zinc-500">
        ENDS IN
      </span>
      <div className="flex items-baseline gap-1.5">
        {segs.map((seg, i) => (
          <span key={seg.suffix} className="flex items-baseline">
            <span
              key={seg.value}
              className="countdown-tick tabular-nums text-sm font-semibold text-zinc-100"
            >
              {seg.value.toString().padStart(2, '0')}
            </span>
            <span className="ml-0.5 text-[9px] tracking-[0.3em] text-zinc-500">
              {seg.suffix}
            </span>
            {i < segs.length - 1 && (
              <span className="mx-1.5 text-zinc-700">:</span>
            )}
          </span>
        ))}
      </div>

      <style jsx global>{`
        @keyframes countdown-tick {
          0% {
            opacity: 0.35;
            transform: translateY(-3px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .countdown-tick {
          animation: countdown-tick 0.45s ease-out;
          display: inline-block;
          min-width: 1.5ch;
          text-align: center;
        }
        @media (prefers-reduced-motion: reduce) {
          .countdown-tick {
            animation: none;
          }
        }
      `}</style>
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

  // Build a windowed page list with ellipses: 1 … (page-2)…(page+2) … last
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
    'px-2.5 py-1.5 rounded-md border text-[11px] tracking-[0.15em] tabular-nums transition-colors'
  const idleBtn =
    'border-zinc-800/80 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100'
  const disabledBtn =
    'border-zinc-900/80 text-zinc-700 cursor-not-allowed opacity-60'

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
        ← PREV
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span
            key={`gap-${i}`}
            className="px-1 text-[11px] text-zinc-700 select-none"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            className={`${baseBtn} ${
              p === page ? '' : idleBtn
            }`}
            style={
              p === page
                ? {
                    borderColor: `${accentA(0.5)}`,
                    color: ACCENT,
                    background: `${accentA(0.07)}`
                  }
                : undefined
            }
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => !atLast && onPage(page + 1)}
        disabled={atLast}
        className={`${baseBtn} ${atLast ? disabledBtn : idleBtn}`}
      >
        NEXT →
      </button>

      <span className="mx-1 h-4 w-px bg-zinc-800/80" />

      <button
        type="button"
        onClick={() => !atLast && onPage(totalPages)}
        disabled={atLast}
        className={`${baseBtn} ${atLast ? disabledBtn : idleBtn}`}
        title={`Jump to page ${totalPages}`}
      >
        LAST ⇥
      </button>
    </nav>
  )
}

function PodiumCard({
  user,
  isYou
}: {
  user: LeaderUser
  isYou: boolean
}) {
  const isFirst = user.rank === 1
  const topTool = user.topTools?.[0]
  const rankLabel = user.rank.toString().padStart(2, '0')
  const accentColor = isFirst ? ACCENT : 'rgb(var(--z700))'

  return (
    <div
      className="relative rounded-xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm overflow-hidden transition-colors hover:border-zinc-700"
    >
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full w-px"
        style={{ background: accentColor, opacity: isFirst ? 0.9 : 0.4 }}
      />

      <div className="relative p-4">
        <div className="flex items-center justify-between">
          <div
            className="text-[11px] tracking-[0.3em] tabular-nums"
            style={{ color: isFirst ? ACCENT : 'rgb(var(--z400))' }}
          >
            {rankLabel}
          </div>
          <span
            className={`shrink-0 text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border ${tierAccent(user.tier)}`}
          >
            {user.tier}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="relative shrink-0">
            {user.profile_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.profile_image}
                alt={user.username}
                className="h-10 w-10 rounded-full border border-zinc-800 object-cover"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sm text-zinc-400">
                {user.username[0]?.toUpperCase()}
              </div>
            )}
            {user.isActive && (
              <span
                className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border-2 border-zinc-950"
                style={{
                  background: ACCENT,
                  boxShadow: `0 0 5px ${accentA(0.67)}`
                }}
                title="Active in last 24h"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="truncate text-sm text-zinc-100">
                @{user.username}
              </span>
              {isYou && (
                <span
                  className="text-[9px] tracking-[0.2em]"
                  style={{ color: ACCENT }}
                >
                  YOU
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 truncate mt-0.5">
              {user.isActive
                ? 'online now'
                : `last seen ${formatRelative(user.lastSeen)} ago`}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-zinc-900 pt-3">
          <div>
            <div className="text-[9px] tracking-[0.3em] text-zinc-600">SCORE</div>
            <div className="text-xl font-semibold tracking-tight text-zinc-50 tabular-nums">
              {formatCompact(user.score)}
            </div>
          </div>
          {topTool && (
            <div className="text-right min-w-0">
              <div className="text-[9px] tracking-[0.3em] text-zinc-600">TOP</div>
              <div className="text-[11px] text-zinc-300 truncate">
                {topTool.name}
                <span className="text-zinc-600"> · {topTool.percent}%</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HeaderRow() {
  return (
    <div className="grid grid-cols-[3rem_1fr_auto_auto] md:grid-cols-[3rem_1fr_8rem_8rem_auto] items-center gap-3 px-4 md:px-5 py-3 border-b border-zinc-900 text-[10px] tracking-[0.3em] text-zinc-500">
      <div>RANK</div>
      <div>PLAYER</div>
      <div className="hidden md:block">TOP TOOL</div>
      <div className="text-right">SCORE</div>
      <div className="text-right">ACT</div>
    </div>
  )
}

function Row({
  user,
  isYou,
  compact
}: {
  user: LeaderUser
  isYou?: boolean
  compact?: boolean
}) {
  const accent = rankAccent(user.rank)
  const topTool = user.topTools?.[0]
  return (
    <li
      className="grid grid-cols-[3rem_1fr_auto_auto] md:grid-cols-[3rem_1fr_8rem_8rem_auto] items-center gap-3 px-4 md:px-5 py-3 transition-colors hover:bg-zinc-900/30"
      style={{
        background: isYou && !compact ? `${accentA(0.05)}` : undefined,
        borderLeft: isYou && !compact ? `2px solid ${ACCENT}` : undefined,
        marginLeft: isYou && !compact ? '-2px' : undefined
      }}
    >
      <div className={`text-sm tabular-nums ${accent.text}`}>#{user.rank}</div>

      <div className="flex items-center gap-3 min-w-0">
        {user.profile_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.profile_image}
            alt={user.username}
            className="h-7 w-7 rounded-full border border-zinc-800 object-cover flex-shrink-0"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[11px] text-zinc-400 flex-shrink-0">
            {user.username[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex items-center gap-2">
          <span
            className="text-sm truncate"
            style={{ color: isYou ? ACCENT : 'rgb(var(--z50))' }}
          >
            @{user.username}
          </span>
          {isYou && (
            <span
              className="text-[9px] tracking-[0.3em]"
              style={{ color: ACCENT }}
            >
              YOU
            </span>
          )}
          <span
            className={`hidden md:inline text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border ${tierAccent(user.tier)}`}
          >
            {user.tier}
          </span>
        </div>
      </div>

      <div className="hidden md:block min-w-0 text-xs text-zinc-400 truncate">
        {topTool ? (
          <span>
            <span className="text-zinc-200">{topTool.name}</span>{' '}
            <span className="text-zinc-600">· {topTool.percent}%</span>
          </span>
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </div>

      <div className="text-right text-sm text-zinc-100 tabular-nums">
        {formatNumber(user.score)}
      </div>

      <div className="text-right">
        {user.isActive ? (
          <span
            className="inline-flex items-center justify-center h-1.5 w-1.5 rounded-full"
            style={{
              background: ACCENT,
              boxShadow: `0 0 6px ${accentA(0.6)}`
            }}
            title="Active in last 24h"
          />
        ) : (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-700"
            title={`Last seen ${formatRelative(user.lastSeen)} ago`}
          />
        )}
      </div>
    </li>
  )
}

function SearchBar({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div
      className="flex items-center w-full max-w-xs border border-zinc-800 rounded-md bg-zinc-950/80 overflow-hidden transition-colors"
      style={{ ['--hg' as string]: ACCENT }}
    >
      <span
        className="pl-3 pr-1 text-xs select-none"
        style={{ color: `${accentA(0.5)}` }}
      >
        ▸
      </span>
      <input
        type="text"
        placeholder="search players…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent px-2 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200 px-3 border-l border-zinc-800"
        >
          CLEAR
        </button>
      )}
    </div>
  )
}
