'use client'

// Leaderboard v3 — liquid-glass redesign matching the dashboard v3 language.
// Podium (2-1-3), stat strip with live season countdown, standings table
// with relative score bars, and a sticky "you" row.

import { useCallback, useEffect, useMemo, useState } from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { AmbientGlow } from '@/components/dashboard-v3/AmbientGlow'
import { GlassTilt } from '@/components/dashboard-v3/GlassTilt'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ACCENT, accentA } from '@/lib/theme'
import {
  SEASON,
  formatCompact,
  formatNumber,
  formatRelative,
  tierAccent
} from '@/components/dashboard-v2/format'
import type { Tier } from '@/types/dashboard'

type SocialKind = 'x' | 'github' | 'youtube' | 'linkedin'

type Socials = Partial<Record<SocialKind, string | null>>

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
  provider?: 'x' | 'github' | 'other'
  banner_image?: string | null
  socials?: Socials
  role?: string | null
}

/* Onboarding roles — glyphs/labels mirror the /welcome wizard options. */
const ROLE_BADGE: Record<string, { glyph: string; label: string }> = {
  student: { glyph: '▲', label: 'STUDENT' },
  researcher: { glyph: '✦', label: 'RESEARCHER' },
  developer: { glyph: '◇', label: 'DEVELOPER' },
  designer: { glyph: '◆', label: 'DESIGNER' },
  founder: { glyph: '⌬', label: 'FOUNDER' },
  product: { glyph: '⬢', label: 'PRODUCT' },
  writer: { glyph: '▰', label: 'WRITER' },
  other: { glyph: '◌', label: 'EXPLORER' }
}

// "GLOBAL LEADERBOARD" in block characters — same art as v1, kept for the retro touch
const ASCII_HEADER = String.raw` ██████╗ ██╗      ██████╗ ██████╗  █████╗ ██╗         ██╗     ███████╗ █████╗ ██████╗ ███████╗██████╗ ██████╗  ██████╗  █████╗ ██████╗ ██████╗ 
██╔════╝ ██║     ██╔═══██╗██╔══██╗██╔══██╗██║         ██║     ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ███╗██║     ██║   ██║██████╔╝███████║██║         ██║     █████╗  ███████║██║  ██║█████╗  ██████╔╝██████╔╝██║   ██║███████║██████╔╝██║  ██║
██║   ██║██║     ██║   ██║██╔══██╗██╔══██║██║         ██║     ██╔══╝  ██╔══██║██║  ██║██╔══╝  ██╔══██╗██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║
╚██████╔╝███████╗╚██████╔╝██████╔╝██║  ██║███████╗    ███████╗███████╗██║  ██║██████╔╝███████╗██║  ██║██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
 ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝    ╚══════╝╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ `

const PAGE_SIZE = 30

type Countdown = { d: number; h: number; m: number; s: number; ended: boolean }

/**
 * Medal treatment for podium ranks. #1 wears the theme accent (champion =
 * house color), #2 silver, #3 bronze. Silver rides the flipped zinc scale so
 * it stays visible in light mode.
 */
const medalFor = (rank: number) => {
  if (rank === 1)
    return {
      fg: 'var(--accent)',
      ring: 'rgb(var(--accent-rgb) / 0.55)',
      bg: 'rgb(var(--accent-rgb) / 0.10)'
    }
  if (rank === 2)
    return {
      fg: 'rgb(var(--z200))',
      ring: 'rgb(var(--z200) / 0.45)',
      bg: 'rgb(var(--z200) / 0.08)'
    }
  if (rank === 3)
    return {
      fg: '#d97706',
      ring: 'rgb(217 119 6 / 0.45)',
      bg: 'rgb(217 119 6 / 0.10)'
    }
  return null
}

export default function LeaderboardV3() {
  const [leaderboard, setLeaderboard] = useState<LeaderUser[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [countdown, setCountdown] = useState<Countdown>({
    d: 0,
    h: 0,
    m: 0,
    s: 0,
    ended: false
  })
  const [page, setPage] = useState(1)
  const [showPodium, setShowPodium] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    // Minimum spin time so the animation reads even on fast responses
    await Promise.all([fetchData(), new Promise((r) => setTimeout(r, 600))])
    setRefreshing(false)
  }, [fetchData])

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

  // Season countdown
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

  const topScore = leaderboard[0]?.score ?? 0

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

  // Reset to page 1 whenever the query changes
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
      <AmbientGlow />
      <GlassTilt />

      {/* horizon line — thin accent scanline at the bottom for retro hint */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 h-px opacity-25 z-0"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgb(var(--accent-rgb)/0.55), transparent)'
        }}
      />

      <div className="lb-reveal-root relative z-10 max-w-6xl mx-auto px-6 pt-10 pb-16">
        <Header
          totalPlayers={totals.totalPlayers}
          activePlayers={totals.activePlayers}
        />

        {/* TITLE BLOCK — ASCII art retro header */}
        <section className="mt-12 flex flex-col items-center gap-3">
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
          <p className="text-[10px] tracking-[0.3em] text-zinc-600 text-center">
            <span style={{ color: `${accentA(0.8)}` }}>{'// '}</span>
            ranked by season-long score
            <span className="mx-2 text-zinc-800">·</span>
            live sync every 30s
          </p>
        </section>

        <main className="mt-8 space-y-5">
          <StatStrip
            totalPlayers={totals.totalPlayers}
            activePlayers={totals.activePlayers}
            topScore={topScore}
            countdown={countdown}
          />

          {/* VIEW CONTROLS — refresh + podium toggle */}
          <div className="flex items-center justify-end gap-2 !mt-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 text-[10px] tracking-[0.3em] px-3 py-1.5 rounded-lg liquid-glass-inset text-zinc-400 hover:text-zinc-100 transition-colors disabled:cursor-wait"
              aria-label="Refresh leaderboard"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              {refreshing ? 'SYNCING' : 'REFRESH'}
            </button>
            <button
              type="button"
              onClick={() => setShowPodium((v) => !v)}
              className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded-lg liquid-glass-inset text-zinc-400 hover:text-zinc-100 transition-colors"
              aria-expanded={showPodium}
            >
              {showPodium ? 'HIDE PODIUM ▲' : 'SHOW PODIUM ▼'}
            </button>
          </div>

          {/* Collapsible podium — grid-rows 1fr→0fr gives a smooth height slide */}
          <div
            className="grid transition-[grid-template-rows,opacity,margin] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              gridTemplateRows: showPodium ? '1fr' : '0fr',
              opacity: showPodium ? 1 : 0,
              marginTop: showPodium ? undefined : 0
            }}
          >
            <div className="min-h-0 overflow-hidden">
              {!loading && top3.length > 0 && (
                <Podium top3={top3} topScore={topScore} currentUserId={currentUserId} />
              )}
            </div>
          </div>

          {/* STANDINGS */}
          <section className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-baseline gap-3">
                <div
                  className="text-[10px] tracking-[0.4em]"
                  style={{ color: `${accentA(0.7)}` }}
                >
                  {'// STANDINGS'}
                </div>
                {!loading && filteredStandings.length > 0 && (
                  <div className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                    {showingFrom}–{showingTo} / {formatNumber(filteredStandings.length)}
                  </div>
                )}
              </div>
              <SearchBar value={query} onChange={setQuery} />
            </div>

            <div className="relative rounded-2xl liquid-glass overflow-hidden">
              <HeaderRow />
              <ul className="relative divide-y divide-white/[0.05]">
                {loading && (
                  <li className="py-12 text-center text-xs tracking-[0.3em] text-zinc-600">
                    LOADING…
                  </li>
                )}
                {!loading && filteredStandings.length === 0 && (
                  <li className="py-12 text-center text-xs text-zinc-500">
                    {query
                      ? 'No players match that handle.'
                      : 'Standings will appear here once players are ranked.'}
                  </li>
                )}
                {!loading &&
                  pagedStandings.map((u) => (
                    <Row
                      key={u.userId}
                      user={u}
                      topScore={topScore}
                      isYou={u.userId === currentUserId}
                    />
                  ))}
              </ul>
            </div>

            {!loading && totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} onPage={setPage} />
            )}

            {/* "You" summary — floats at the viewport bottom while scrolling the table */}
            {me && me.rank > 3 && (
              <div className="sticky bottom-4 z-20 mt-4">
                <div
                  className="rounded-2xl border backdrop-blur-xl overflow-hidden"
                  style={{
                    borderColor: `${accentA(0.3)}`,
                    background: `${accentA(0.06)}`,
                    boxShadow: `0 8px 32px -12px ${accentA(0.25)}, 0 4px 16px rgb(0 0 0 / 0.4)`
                  }}
                >
                  <ul>
                    <Row user={me} topScore={topScore} isYou pinned />
                  </ul>
                </div>
              </div>
            )}
          </section>
        </main>

        <Footer />
      </div>

      <style jsx global>{`
        /* First-paint cascade — header → banner → strip → podium → table. */
        .lb-reveal-root > header,
        .lb-reveal-root > section,
        .lb-reveal-root > main > *,
        .lb-reveal-root > footer {
          animation: lb-reveal-in 520ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        .lb-reveal-root > header {
          animation-delay: 0ms;
        }
        .lb-reveal-root > section {
          animation-delay: 70ms;
        }
        .lb-reveal-root > main > *:nth-child(1) {
          animation-delay: 150ms;
        }
        .lb-reveal-root > main > *:nth-child(2) {
          animation-delay: 220ms;
        }
        .lb-reveal-root > main > *:nth-child(3) {
          animation-delay: 300ms;
        }
        .lb-reveal-root > main > *:nth-child(4) {
          animation-delay: 380ms;
        }
        .lb-reveal-root > footer {
          animation-delay: 460ms;
        }

        @keyframes lb-reveal-in {
          from {
            opacity: 0;
            transform: translateY(10px);
            filter: blur(4px);
          }
        }

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

        /* CRT banner glitch — one coordinated event per 10s cycle.
           The scan line rolls down slowly during the first ~22% of the
           cycle (~2.2s of travel); the field jitter and wordmark RGB split
           fire inside that same window, then the banner is perfectly still
           until the next pass. */
        @keyframes banner-crt-sweep {
          0% {
            transform: translateY(-28px);
            opacity: 0;
          }
          2% {
            opacity: 1;
          }
          20% {
            opacity: 1;
          }
          22% {
            transform: translateY(104px);
            opacity: 0;
          }
          100% {
            transform: translateY(104px);
            opacity: 0;
          }
        }
        .banner-scanline {
          animation: banner-crt-sweep 10s linear infinite;
          will-change: transform, opacity;
        }

        @keyframes banner-crt-jitter {
          0%, 4.9%, 16.6%, 100% { transform: translateX(0); }
          5% { transform: translateX(-3px); }
          6.2% { transform: translateX(0); }
          10% { transform: translateX(2px); }
          11.2% { transform: translateX(0); }
          15% { transform: translateX(-1px); }
        }
        .banner-field {
          animation: banner-crt-jitter 10s steps(1) infinite;
        }

        @keyframes banner-wordmark-glitch {
          0%, 7.9%, 14.1%, 100% { text-shadow: none; transform: none; }
          8% {
            text-shadow: -2px 0 rgb(var(--banner-b) / 0.9), 2px 0 rgb(var(--banner-a) / 0.9);
            transform: translateX(1px);
          }
          12% {
            text-shadow: 2px 0 rgb(var(--banner-b) / 0.7), -2px 0 rgb(var(--banner-a) / 0.7);
            transform: translateX(-1px);
          }
        }
        .banner-wordmark {
          animation: banner-wordmark-glitch 10s steps(1) infinite;
        }

        /* Light mode keeps the calm orange banner — no glitches */
        html.light .banner-glitch {
          display: none;
        }
        html.light .banner-field,
        html.light .banner-wordmark {
          animation: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .lb-reveal-root > header,
          .lb-reveal-root > section,
          .lb-reveal-root > main > *,
          .lb-reveal-root > footer,
          .countdown-tick,
          .banner-glitch,
          .banner-field,
          .banner-wordmark {
            animation: none;
          }
        }
      `}</style>
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

      <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full liquid-glass-inset">
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
          className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded-lg liquid-glass-inset text-zinc-300 hover:text-zinc-100 transition-colors"
        >
          ← DASHBOARD
        </a>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="mt-10 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
      <span>CRIBBLE · {new Date().getFullYear()}</span>
      <span style={{ color: `${accentA(0.6)}` }}>
        {'// climb. or don\u2019t. we\u2019re keeping score.'}
      </span>
    </footer>
  )
}

/** Four-cell glass strip: players, online, top score, season countdown. */
function StatStrip({
  totalPlayers,
  activePlayers,
  topScore,
  countdown
}: {
  totalPlayers: number
  activePlayers: number
  topScore: number
  countdown: Countdown
}) {
  const divCls = (i: number) => {
    if (i === 0) return ''
    if (i === 1) return 'border-l border-white/[0.08]'
    if (i === 2) return 'border-t border-white/[0.08] md:border-t-0 md:border-l'
    return 'border-t border-l border-white/[0.08] md:border-t-0'
  }

  // Retro arcade readout: Press Start 2P (loaded in layout as --font-pixel)
  const pixelValue =
    'mt-2 flex items-center gap-2 text-sm md:text-base text-zinc-50 tabular-nums [font-family:var(--font-pixel)]'

  const cells = [
    { label: 'PLAYERS', value: totalPlayers, formatter: formatNumber },
    {
      label: 'ONLINE NOW',
      value: activePlayers,
      formatter: formatNumber,
      live: true
    },
    { label: 'TOP SCORE', value: topScore, formatter: formatCompact }
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 rounded-xl liquid-glass overflow-hidden">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`relative px-4 py-3.5 transition-colors hover:bg-white/[0.04] ${divCls(i)}`}
        >
          <div className="text-[9px] tracking-[0.35em] text-zinc-500">{c.label}</div>
          <div className={pixelValue}>
            <AnimatedCounter
              value={c.value}
              duration={1100}
              formatter={(v) => c.formatter(Math.round(v))}
            />
            {c.live && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: ACCENT, boxShadow: `0 0 8px ${accentA(0.69)}` }}
              />
            )}
          </div>
        </div>
      ))}

      <div className={`relative px-4 py-3.5 transition-colors hover:bg-white/[0.04] ${divCls(3)}`}>
        <div className="text-[9px] tracking-[0.35em] text-zinc-500">
          {SEASON.name} · {countdown.ended ? 'STATUS' : 'ENDS IN'}
        </div>
        {countdown.ended ? (
          <div className="mt-2 text-sm md:text-base text-rose-400 [font-family:var(--font-pixel)]">
            ENDED
          </div>
        ) : (
          <div className="mt-2 flex items-baseline text-xs md:text-sm text-zinc-50 tabular-nums [font-family:var(--font-pixel)]">
            {(
              [
                { v: countdown.d, sfx: 'D' },
                { v: countdown.h, sfx: 'H' },
                { v: countdown.m, sfx: 'M' },
                { v: countdown.s, sfx: 'S' }
              ] as const
            ).map((seg, i) => (
              <span key={seg.sfx} className="flex items-baseline">
                <span key={seg.v} className="countdown-tick">
                  {seg.v.toString().padStart(2, '0')}
                </span>
                <span className="ml-0.5 font-mono text-[9px] tracking-[0.2em] text-zinc-500">
                  {seg.sfx}
                </span>
                {i < 3 && <span className="mx-1 text-zinc-700 text-xs">:</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Classic podium — #1 elevated in the center, #2 left, #3 right on desktop. */
function Podium({
  top3,
  topScore,
  currentUserId
}: {
  top3: LeaderUser[]
  topScore: number
  currentUserId: number | null
}) {
  // Desktop ordering 2-1-3; mobile keeps natural rank order.
  const orderCls = (rank: number) => {
    if (rank === 1) return 'md:order-2'
    if (rank === 2) return 'md:order-1'
    return 'md:order-3'
  }

  return (
    <section>
      <div
        className="text-[10px] tracking-[0.4em] mb-3"
        style={{ color: `${accentA(0.7)}` }}
      >
        {'// PODIUM'}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        {top3.map((u) => (
          <PodiumCard
            key={u.userId}
            user={u}
            topScore={topScore}
            isYou={u.userId === currentUserId}
            className={orderCls(u.rank)}
          />
        ))}
      </div>
    </section>
  )
}

const PLACE_LABEL: Record<number, string> = {
  1: 'CHAMPION',
  2: 'RUNNER-UP',
  3: 'THIRD PLACE'
}

const SOCIAL_BASE: Record<SocialKind, string> = {
  x: 'https://x.com/',
  github: 'https://github.com/',
  youtube: 'https://youtube.com/@',
  linkedin: 'https://linkedin.com/in/'
}

const SOCIAL_LABEL: Record<SocialKind, string> = {
  x: 'X',
  github: 'GitHub',
  youtube: 'YouTube',
  linkedin: 'LinkedIn'
}

/** Accepts either a bare handle or a full URL stored in user metadata. */
const socialHref = (kind: SocialKind, raw: string) =>
  raw.startsWith('http') ? raw : SOCIAL_BASE[kind] + raw.replace(/^@/, '')

const SOCIAL_ICON_PATHS: Record<SocialKind, string> = {
  x: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  github:
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  youtube:
    'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'
}

function SocialLinks({ socials, username }: { socials: Socials; username: string }) {
  const entries = (Object.keys(SOCIAL_BASE) as SocialKind[])
    .map((kind) => ({ kind, value: socials[kind] }))
    .filter((e): e is { kind: SocialKind; value: string } => Boolean(e.value))

  if (entries.length === 0) return null

  return (
    <div className="flex items-center justify-center gap-1">
      {entries.map(({ kind, value }) => (
        <a
          key={kind}
          href={socialHref(kind, value)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`@${username} on ${SOCIAL_LABEL[kind]}`}
          title={SOCIAL_LABEL[kind]}
          className="p-1.5 rounded-md text-zinc-500 hover:text-accent hover:bg-white/[0.06] transition-colors"
        >
          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="currentColor" aria-hidden>
            <path d={SOCIAL_ICON_PATHS[kind]} />
          </svg>
        </a>
      ))}
    </div>
  )
}

/**
 * Default banner for users without one (GitHub/Google sign-ins): a duotone
 * gradient over a faint grid, with a ghost CRIBBLE wordmark. Pure CSS.
 * Colors come from --banner-a/--banner-b (globals.css): deep teal-to-blue
 * in dark mode (analogous to the green accent), orange in light mode.
 */
const bannerA = (alpha: number) => `rgb(var(--banner-a) / ${alpha})`
const bannerB = (alpha: number) => `rgb(var(--banner-b) / ${alpha})`

/**
 * One coordinated CRT glitch event per cycle (see BANNER_GLITCH_CYCLE):
 * a scan line rolls down the banner while the field jitters horizontally
 * and the wordmark takes a brief RGB split — then everything is still
 * until the next cycle. Dark mode only.
 */
function CribbleBanner() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {/* color field — jitters a few px while the scan line passes */}
      <div
        className="banner-field absolute inset-0"
        style={{
          background: [
            `linear-gradient(115deg, ${bannerA(0.18)}, ${bannerB(0.1)} 55%, transparent)`,
            `repeating-linear-gradient(90deg, ${bannerA(0.05)} 0 1px, transparent 1px 18px)`,
            `repeating-linear-gradient(0deg, ${bannerA(0.05)} 0 1px, transparent 1px 18px)`
          ].join(', ')
        }}
      />

      {/* CRT scan line — soft band with a bright 1px core, rolls top to bottom */}
      <span
        className="banner-glitch banner-scanline absolute inset-x-0 top-0 h-6 opacity-0"
        style={{
          background: [
            `linear-gradient(180deg, transparent, ${bannerA(0.08)} 30%, transparent 70%)`,
            `linear-gradient(180deg, transparent 47%, ${bannerA(0.55)} 50%, transparent 53%)`
          ].join(', ')
        }}
      />

      <span
        className="banner-wordmark absolute bottom-1.5 right-3 font-mono font-semibold tracking-[0.45em] text-[10px] select-none"
        style={{ color: bannerA(0.35) }}
      >
        CRIBBLE<span style={{ color: bannerA(0.6) }}>.</span>
      </span>
    </div>
  )
}

function PodiumCard({
  user,
  topScore,
  isYou,
  className = ''
}: {
  user: LeaderUser
  topScore: number
  isYou: boolean
  className?: string
}) {
  const isFirst = user.rank === 1
  const medal = medalFor(user.rank)!
  const topTool = user.topTools?.[0]
  const pct = topScore > 0 ? Math.max(2, Math.round((user.score / topScore) * 100)) : 0
  const hasSocials = user.socials && Object.values(user.socials).some(Boolean)

  return (
    <div
      className={`relative rounded-2xl liquid-glass liquid-glass-flat overflow-hidden ${
        isFirst ? 'banner-gold md:pb-2' : ''
      } ${className}`}
    >
      {/* medal-colored top edge — anchors the card's color to its structure */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] z-10"
        style={{
          background: `linear-gradient(90deg, transparent 8%, ${medal.fg} 50%, transparent 92%)`,
          opacity: isFirst ? 0.9 : 0.4
        }}
      />

      {/* banner — X header image when available, Cribble default otherwise */}
      <div className={`relative overflow-hidden ${isFirst ? 'h-24' : 'h-20'}`}>
        {user.banner_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.banner_image}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <CribbleBanner />
        )}

        {/* place chip */}
        <div className="absolute top-2.5 left-2.5 flex items-baseline gap-1.5 rounded-md px-2 py-1 liquid-glass-inset">
          <span
            className="text-[10px] font-semibold tabular-nums"
            style={{ color: medal.fg }}
          >
            {user.rank.toString().padStart(2, '0')}
          </span>
          <span className="text-[8px] tracking-[0.3em] text-zinc-300">
            {PLACE_LABEL[user.rank]}
          </span>
        </div>
      </div>

      <div className={`relative flex flex-col items-center text-center px-5 ${isFirst ? 'pb-5' : 'pb-4'}`}>
        {/* avatar with medal ring, dipping just below the banner edge */}
        <div className={`relative ${isFirst ? '-mt-[26px]' : '-mt-[22px]'}`}>
          <div
            className={`rounded-full p-[2px] ${isFirst ? 'h-[76px] w-[76px]' : 'h-[60px] w-[60px]'}`}
            style={{
              background: medal.ring,
              // solid halo in the card surface color so the ring reads over the banner
              boxShadow: '0 0 0 3px rgb(var(--c-black))'
            }}
          >
            {user.profile_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.profile_image}
                alt={user.username}
                className="h-full w-full rounded-full border border-zinc-800 object-cover"
              />
            ) : (
              <div
                className={`h-full w-full rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 ${
                  isFirst ? 'text-2xl' : 'text-lg'
                }`}
              >
                {user.username[0]?.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* identity */}
        <div className="mt-3 flex items-center gap-1.5 max-w-full">
          <span
            className={`truncate font-semibold ${isFirst ? 'text-base' : 'text-sm'} text-zinc-100`}
          >
            @{user.username}
          </span>
          {isYou && (
            <span className="text-[9px] tracking-[0.2em] shrink-0" style={{ color: ACCENT }}>
              YOU
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className={`text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border ${tierAccent(user.tier)}`}
          >
            {user.tier}
          </span>
          {user.role && ROLE_BADGE[user.role] && (
            <span className="text-[10px] tracking-[0.2em] text-zinc-500">
              <span style={{ color: bannerA(0.8) }}>{ROLE_BADGE[user.role].glyph}</span>{' '}
              {ROLE_BADGE[user.role].label}
            </span>
          )}
        </div>

        {/* score */}
        <div
          className={`mt-3 font-semibold tracking-tight tabular-nums text-zinc-50 ${
            isFirst ? 'text-4xl' : 'text-2xl'
          }`}
          style={isFirst ? { textShadow: `0 0 24px ${accentA(0.35)}` } : undefined}
        >
          {formatNumber(user.score)}
          <span className="ml-1.5 text-[10px] font-normal tracking-[0.3em] text-zinc-500">
            PTS
          </span>
        </div>

        {/* relative-to-leader bar */}
        <div className="mt-2.5 w-full max-w-[220px]">
          <div className="h-1 rounded-full bg-zinc-900 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: isFirst
                  ? `linear-gradient(90deg, ${accentA(0.6)}, ${ACCENT})`
                  : medal.fg,
                opacity: isFirst ? 1 : 0.6
              }}
            />
          </div>
          {topTool && (
            <div className="mt-2 text-[10px] text-zinc-500 truncate">
              top tool <span className="text-zinc-300">{topTool.name}</span>
              <span className="text-zinc-600"> · {topTool.percent}%</span>
            </div>
          )}
        </div>

        {/* direct socials */}
        {hasSocials && (
          <div className="mt-3 pt-2.5 w-full border-t border-white/[0.06]">
            <SocialLinks socials={user.socials!} username={user.username} />
          </div>
        )}
      </div>
    </div>
  )
}

const ROW_GRID =
  'grid grid-cols-[3rem_minmax(0,1fr)_auto] md:grid-cols-[3.5rem_minmax(0,1fr)_9.5rem_10rem_6rem] items-center gap-3 px-4 md:px-5'

function HeaderRow() {
  return (
    <div
      className={`${ROW_GRID} py-3 border-b border-white/[0.08] text-[9px] tracking-[0.35em] text-zinc-500`}
    >
      <div>RANK</div>
      <div>PLAYER</div>
      <div className="hidden md:block">TOP TOOL</div>
      <div className="text-right">SCORE</div>
      <div className="hidden md:block text-right">LAST SEEN</div>
    </div>
  )
}

function Row({
  user,
  topScore,
  isYou,
  pinned
}: {
  user: LeaderUser
  topScore: number
  isYou?: boolean
  pinned?: boolean
}) {
  const medal = medalFor(user.rank)
  const topTool = user.topTools?.[0]
  const pct = topScore > 0 ? Math.max(2, Math.round((user.score / topScore) * 100)) : 0

  return (
    <li
      className={`${ROW_GRID} py-3 transition-colors hover:bg-white/[0.04]`}
      style={{
        background: isYou && !pinned ? `${accentA(0.05)}` : undefined,
        boxShadow: isYou && !pinned ? `inset 2px 0 0 ${ACCENT}` : undefined
      }}
    >
      {/* rank — medal chip for the top 3, plain number below */}
      <div>
        {medal ? (
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums"
            style={{
              color: medal.fg,
              borderColor: medal.ring,
              background: medal.bg
            }}
          >
            {user.rank}
          </span>
        ) : (
          <span className="text-sm tabular-nums text-zinc-500">#{user.rank}</span>
        )}
      </div>

      {/* player */}
      <div className="flex items-center gap-3 min-w-0">
        {user.profile_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.profile_image}
            alt={user.username}
            className="h-7 w-7 rounded-full border border-zinc-800 object-cover shrink-0"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[11px] text-zinc-400 shrink-0">
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
            <span className="text-[9px] tracking-[0.3em] shrink-0" style={{ color: ACCENT }}>
              YOU
            </span>
          )}
          <span
            className={`hidden md:inline shrink-0 text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border ${tierAccent(user.tier)}`}
          >
            {user.tier}
          </span>
        </div>
      </div>

      {/* top tool */}
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

      {/* score + relative bar */}
      <div className="text-right">
        <div className="text-sm text-zinc-100 tabular-nums">
          {formatNumber(user.score)}
        </div>
        <div className="mt-1 h-0.5 rounded-full bg-zinc-900 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: medal
                ? medal.fg
                : `linear-gradient(90deg, ${accentA(0.35)}, ${accentA(0.7)})`,
              opacity: medal ? 0.7 : 1,
              marginLeft: 'auto'
            }}
          />
        </div>
      </div>

      {/* last seen */}
      <div className="hidden md:flex items-center justify-end gap-1.5 text-[10px] tabular-nums">
        {user.isActive ? (
          <>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: ACCENT, boxShadow: `0 0 6px ${accentA(0.6)}` }}
            />
            <span style={{ color: ACCENT }}>online</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
            <span className="text-zinc-500">{formatRelative(user.lastSeen)}</span>
          </>
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
    <div className="flex items-center w-full max-w-xs rounded-lg liquid-glass-inset overflow-hidden">
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
          className="text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200 px-3 py-2 border-l border-white/[0.08]"
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

  // Windowed page list with ellipses: 1 … (page-2)…(page+2) … last
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
    'px-2.5 py-1.5 rounded-lg text-[11px] tracking-[0.15em] tabular-nums transition-colors liquid-glass-inset'
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
            className={`${baseBtn} ${p === page ? '' : idleBtn}`}
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

      <span className="mx-1 h-4 w-px bg-white/[0.08]" />

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
