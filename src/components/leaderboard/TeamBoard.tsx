'use client'

// THE TEAMS BOARD — the arena's third board, and the only one that owns
// rosters, so the squad itself is the show. Approved company accounts
// ranked by the combined season score of their active affiliates (via
// /api/leaderboard/teams, one cached site-wide aggregate). Every row
// carries a segmented squad bar (member shares stacked inside the
// team's gap-to-leader bar), a facepile of the crew, and podium plate
// washes for the top three; expanding a row drops the roster with an
// MVP chip, per-member burn, segment dots and a seats-filled footer.
// SCORE and BURN are separate standings: switching lenses changes the
// rendered order, rank badges, podium chrome and champion title. Viewers
// without a team get a FIELD A TEAM recruit bar where members see their
// YOUR TEAM bar. The payload is identical for every viewer and
// server-cached, so there is
// no 15s poll: fetch on mount and when the tab regains focus.

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import { formatCompact, formatNumber } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { LeaderboardSponsorFlip } from '@/components/leaderboard/LeaderboardSponsorFlip'
import {
  IconChevronDown,
  IconFlame,
  IconRefresh,
  IconSearch,
  IconShieldStar,
  IconTrophy,
  IconUsers
} from '@/components/leaderboard/icons'
import { medalA, medalFor, medalGlow } from '@/components/leaderboard/types'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { fetchMe } from '@/lib/client/fetchMe'
import { isProTier } from '@/lib/entitlements'
import { prefersReducedMotion } from '@/lib/motion'
import {
  compareExactDecimals,
  decimalToApproxNumber,
  usdDisplayParts
} from '@/lib/tokenLeaderboard'
import type {
  TeamBoardMember,
  TeamBoardRow,
  TeamBoardTotals
} from '@/lib/teamLeaderboard'

const ROW_GRID =
  'grid grid-cols-[3.6rem_minmax(0,1fr)_auto_1rem] md:grid-cols-[4.2rem_minmax(0,1fr)_6.5rem_7rem_10.5rem_1rem] items-center gap-3 px-4 md:px-5'

// Roster rows keep the team grid's gutters — col 1 stays an empty rank
// gutter so member identity sits exactly under the team identity, and the
// trailing 1rem track mirrors the chevron column so scores right-align
// with the team score above. The share track exists at every breakpoint
// (auto on mobile carries just the percent; 7.5rem on desktop fits
// bar + "100%").
const MEMBER_GRID =
  'grid grid-cols-[3.6rem_minmax(0,1fr)_auto_auto_1rem] md:grid-cols-[4.2rem_minmax(0,1fr)_7.5rem_auto_1rem] items-center gap-3 px-4 md:px-5'

// Gold medal chrome — MVP chips and the recruit hooks borrow the
// champion's hue even when no champion is on screen.
const GOLD = medalFor(1)!

// team_affiliations caps active rosters at 10 seats (migration 029).
const SEAT_LIMIT = 10

// Segment brightness by contribution order: the top scorer burns near
// solid, each teammate steps down, clamped so tail seats stay legible.
const segmentAlpha = (index: number) => Math.max(0.3, 0.95 - index * 0.2)

type BoardLens = 'score' | 'burn'

const LENSES: { id: BoardLens; label: string }[] = [
  { id: 'score', label: 'SCORE' },
  { id: 'burn', label: 'BURN' }
]

/** BURN standings: opted-in burn desc, score breaks equal-burn ties,
 *  and teams with no shared burn follow in their score-board order. */
function compareTeamBurn(a: TeamBoardRow, b: TeamBoardRow): number {
  const aBurns = a.burnPilots > 0
  const bBurns = b.burnPilots > 0
  if (aBurns !== bBurns) return aBurns ? -1 : 1
  if (aBurns && bBurns) {
    const byBurn = compareExactDecimals(b.burnUsd, a.burnUsd)
    if (byBurn !== 0) return byBurn
  }
  return b.score - a.score || a.rank - b.rank
}

export function TeamBoard() {
  const [teams, setTeams] = useState<TeamBoardRow[] | null>(null)
  const [totals, setTotals] = useState<TeamBoardTotals | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [viewerId, setViewerId] = useState<number | null>(null)
  // Settled fetchMe (success OR failure) — a failed result means
  // logged-out, and that viewer earns the recruit bar, so the bar must
  // wait for the check instead of flashing at everyone on mount.
  const [viewerChecked, setViewerChecked] = useState(false)
  const [lens, setLens] = useState<BoardLens>('score')

  // Monotonic guard, same as the other boards: a slow response must
  // never overwrite a newer one.
  const fetchSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      const res = await fetch('/api/leaderboard/teams', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (seq !== fetchSeq.current) return
      if (!res.ok || !data?.success) {
        setFailed(true)
        return
      }
      setTeams(Array.isArray(data.data) ? (data.data as TeamBoardRow[]) : [])
      setTotals((data.totals as TeamBoardTotals) ?? null)
      setFailed(false)
    } catch {
      if (seq === fetchSeq.current) setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    void (async () => {
      const result = await fetchMe()
      if (result.ok) {
        const id = result.data.user?.id
        if (id) setViewerId(Number(id))
      }
      setViewerChecked(true)
    })()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load])

  const loading = teams === null && !failed
  const leader = teams?.[0] ?? null
  const topScore = leader?.score ?? 0

  // Board-wide burn ceiling for the lens's relative bars — computed off
  // the full list (not the search results) so a filtered view keeps the
  // same scale, exactly like the score bars against the global leader.
  const topBurn = useMemo(() => {
    if (!teams) return 0
    let top = '0'
    for (const team of teams) {
      if (team.burnPilots > 0 && compareExactDecimals(team.burnUsd, top) > 0) {
        top = team.burnUsd
      }
    }
    return decimalToApproxNumber(top)
  }, [teams])

  // Lens-specific rank is global, not search-result-relative: filtering
  // the board must never turn the first matching team into rank 1.
  const burnRanks = useMemo(() => {
    if (!teams) return new Map<number, number>()
    return new Map(
      [...teams]
        .sort(compareTeamBurn)
        .map((team, index) => [team.userId, index + 1] as const)
    )
  }, [teams])

  const filtered = useMemo(() => {
    if (!teams) return []
    const q = query.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(
      (t) =>
        t.username.toLowerCase().includes(q) ||
        (t.display_name || '').toLowerCase().includes(q)
    )
  }, [teams, query])

  // Each lens owns its standings. The backend's team.rank is the score
  // rank; BURN derives its parallel rank from the same full payload.
  const displayed = useMemo(() => {
    if (lens !== 'burn') return filtered
    return [...filtered].sort(compareTeamBurn)
  }, [filtered, lens])

  // The viewer's team: they either ARE the company account or sit on
  // its roster.
  const myTeam = useMemo(() => {
    if (viewerId === null || !teams) return null
    return (
      teams.find(
        (t) => t.userId === viewerId || t.members.some((m) => m.userId === viewerId)
      ) ?? null
    )
  }, [teams, viewerId])

  const toggle = useCallback((id: number) => {
    setOpenId((cur) => (cur === id ? null : id))
  }, [])

  // Row ref map so the YOUR TEAM bar can scroll its row into view.
  const rowRefs = useRef(new Map<number, HTMLLIElement>())
  const setRowRef = useCallback((id: number, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [])

  // Jump target waiting for its row to exist. Clearing a live search
  // remounts the list on a later commit, so a lone rAF can look the row
  // up before React has put it back — the scroll runs from a layout
  // effect instead, after the commit that carries the row.
  const pendingJumpId = useRef<number | null>(null)
  const [jumpNonce, setJumpNonce] = useState(0)

  const jumpToMyTeam = useCallback(() => {
    const target = myTeam
    if (!target) return
    pendingJumpId.current = target.userId
    setOpenId(target.userId)
    // A live search may be hiding the row we're about to scroll to.
    setQuery('')
    // Bump even when the query was already empty so the effect still runs.
    setJumpNonce((n) => n + 1)
  }, [myTeam])

  useLayoutEffect(() => {
    const id = pendingJumpId.current
    if (id == null) return
    const el = rowRefs.current.get(id)
    if (!el) return // row still filtered out — the next `displayed` commit retries
    pendingJumpId.current = null
    el.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    })
  }, [displayed, jumpNonce])

  return (
    <>
      {/* ---------- stat strip / sponsor flip ---------- */}
      <section className="lbt-reveal">
        <LeaderboardSponsorFlip>
          <div className="lb-panel grid grid-cols-2 overflow-hidden md:grid-cols-4">
            <StatCell
              icon={<IconShieldStar size={11} className="text-zinc-600" />}
              label="TEAMS"
            >
              <AnimatedCounter
                value={totals?.teams ?? 0}
                duration={1100}
                formatter={(v) => formatNumber(Math.round(v))}
              />
            </StatCell>

            <StatCell
              className="border-l border-[rgb(var(--lb-panel-edge)/0.08)]"
              icon={<IconUsers size={11} className="text-zinc-600" />}
              label="PILOTS"
              hint="on rosters"
            >
              <AnimatedCounter
                value={totals?.members ?? 0}
                duration={1100}
                formatter={(v) => formatNumber(Math.round(v))}
              />
            </StatCell>

            <StatCell
              className="border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-l md:border-t-0"
              icon={<IconTrophy size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />}
              label="TOP SCORE"
              valueStyle={{
                color: 'rgb(var(--lb-score))',
                textShadow: '0 0 14px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
              }}
              hint={
                leader ? (
                  <>
                    held by <span className="text-zinc-400">@{leader.username}</span>
                  </>
                ) : undefined
              }
            >
              <AnimatedCounter
                value={totals?.topScore ?? 0}
                duration={1100}
                formatter={(v) => formatCompact(Math.round(v))}
              />
            </StatCell>

            <StatCell
              className="border-l border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0"
              icon={<IconFlame size={11} className="text-orange-400" />}
              label="SEASON BURN"
              hint="OPT-IN ESTIMATES"
            >
              <BurnValue value={totals?.burnUsd ?? '0'} animated />
            </StatCell>
          </div>
        </LeaderboardSponsorFlip>
      </section>

      {/* ---------- team standings ---------- */}
      <section className="lbt-reveal relative" style={{ ['--rv' as string]: '120ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
              STANDINGS
            </h2>
            {!loading && !failed && displayed.length > 0 && (
              <span className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                {displayed.length} TEAMS
              </span>
            )}
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <LensToggle lens={lens} onChange={setLens} />
            <TeamSearch value={query} onChange={setQuery} />
          </div>
        </div>

        <div className="lb-panel relative overflow-hidden">
          <div
            className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[9px] tracking-[0.35em] text-zinc-500`}
          >
            <div>RANK</div>
            <div>TEAM</div>
            <div className="hidden text-right md:block">SQUAD</div>
            <div
              className={`hidden text-right md:block ${
                lens === 'burn' ? 'text-[#39ff88]/80' : ''
              }`}
            >
              BURN
            </div>
            <div
              className={`text-right ${
                lens === 'burn' ? 'text-zinc-300 md:text-zinc-500' : 'text-zinc-300'
              }`}
            >
              SCORE
            </div>
            <div aria-hidden />
          </div>

          <ul className="relative">
            {loading &&
              Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} index={i} />)}

            {failed && (
              <li className="flex flex-col items-center gap-4 py-14 text-center">
                <span className="text-xs tracking-[0.15em] text-zinc-500">
                  The team standings failed to load.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFailed(false)
                    setTeams(null)
                    void load()
                  }}
                  className="lb-inset flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  <IconRefresh size={11} />
                  RETRY
                </button>
              </li>
            )}

            {!loading && !failed && displayed.length === 0 && (
              query ? (
                <li className="py-14 text-center text-xs tracking-[0.15em] text-zinc-500">
                  No teams match that callsign.
                </li>
              ) : (
                <li className="flex flex-col items-center px-5 py-14 text-center">
                  <IconShieldStar size={24} className="text-[rgb(var(--lb-gold)/0.55)]" />
                  <p className="mt-4 text-[10px] tracking-[0.22em] text-zinc-400">
                    THE WALL IS EMPTY — BE THE FIRST TEAM ON IT
                  </p>
                  <p className="mt-2 max-w-md text-[11px] leading-5 text-zinc-600">
                    Pool every point your pilots score under one banner — up to 10
                    seats a squad.
                  </p>
                  <Link
                    href="/teams"
                    className="mt-5 border border-[rgb(var(--lb-gold)/0.4)] bg-[rgb(var(--lb-gold)/0.07)] px-3 py-2 text-[9px] tracking-[0.25em] text-[rgb(var(--lb-gold))] transition-colors hover:bg-[rgb(var(--lb-gold)/0.14)]"
                  >
                    FIELD A TEAM
                  </Link>
                </li>
              )
            )}

            {!loading &&
              !failed &&
              displayed.map((team, i) => (
                <TeamRow
                  key={team.userId}
                  team={team}
                  displayRank={
                    lens === 'burn' ? (burnRanks.get(team.userId) ?? team.rank) : team.rank
                  }
                  index={i}
                  topScore={topScore}
                  topBurn={topBurn}
                  lens={lens}
                  open={openId === team.userId}
                  viewerId={viewerId}
                  onToggle={toggle}
                  setRef={setRowRef}
                />
              ))}
          </ul>
        </div>

        <p className="mt-3 text-center text-[9px] tracking-[0.3em] text-zinc-600">
          {lens === 'burn'
            ? 'RANKED BY OPT-IN SEASON BURN'
            : 'RANKED BY THE COMBINED SEASON SCORE OF ACTIVE AFFILIATES'}
        </p>
        <p className="mt-1 text-center text-[9px] tracking-[0.22em] text-zinc-700">
          BURN = OPT-IN AGENT ESTIMATES · NOT A COMPANY BILL
        </p>

        {/* ---------- sticky YOUR TEAM / recruit bar ---------- */}
        {myTeam ? (
          <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mt-4">
            <YourTeamBar
              team={myTeam}
              rank={
                lens === 'burn' ? (burnRanks.get(myTeam.userId) ?? myTeam.rank) : myTeam.rank
              }
              onJump={jumpToMyTeam}
            />
          </div>
        ) : viewerChecked && teams !== null && !failed ? (
          <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mt-4">
            <RecruitBar />
          </div>
        ) : null}
      </section>

      <style jsx global>{`
        .lbt-reveal {
          animation: lbt-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes lbt-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }
        .lbt-row-in {
          animation: lbt-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rd, 0ms);
        }
        @keyframes lbt-row-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
        }
        .lbt-bar-in {
          transform-origin: right;
          animation: lbt-bar-draw 700ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rd, 0ms);
        }
        @keyframes lbt-bar-draw {
          from {
            transform: scaleX(0);
          }
        }
        .lbt-member-in {
          animation: lbt-member-enter 420ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--md, 0ms);
        }
        @keyframes lbt-member-enter {
          from {
            opacity: 0;
            transform: translateX(-6px);
          }
        }
        .lbt-exp {
          transition:
            grid-template-rows 500ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 500ms cubic-bezier(0.22, 1, 0.36, 1),
            visibility 500ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .lbt-reveal,
          .lbt-row-in,
          .lbt-bar-in,
          .lbt-member-in {
            animation: none;
          }
          .lbt-exp {
            transition: none;
          }
        }
      `}</style>
    </>
  )
}

/* ================= stat strip cell ================= */

function StatCell({
  className = '',
  icon,
  label,
  hint,
  valueStyle,
  children
}: {
  className?: string
  icon: React.ReactNode
  label: string
  hint?: React.ReactNode
  valueStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <div className={`flex min-w-0 flex-col items-center overflow-hidden px-4 py-4 text-center ${className}`}>
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[9px] tracking-[0.16em] sm:tracking-[0.28em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div
        className="mt-2.5 max-w-full text-[clamp(11px,2.6vw,16px)] text-zinc-50 tabular-nums [font-family:var(--font-pixel)]"
        style={valueStyle}
      >
        {children}
      </div>
      {hint && (
        <div className="mt-1 max-w-full truncate text-[9px] tracking-[0.2em] text-zinc-600">{hint}</div>
      )}
    </div>
  )
}

/* ================= burn read-out ================= */

function formatUsdNumber(value: number): string {
  if (value >= 100_000) return formatCompact(value)
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value >= 1_000 ? 0 : 2,
    maximumFractionDigits: value >= 1_000 ? 0 : 2
  })
}

/** Same USD markup the Burn Board uses: optional "<" for sub-cent
 *  values, green dollar mark, exact-decimal display parts (an optional
 *  animated counter for the stat strip). */
function BurnValue({ value, animated = false }: { value: string; animated?: boolean }) {
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

/* ================= lens toggle ================= */

function LensToggle({
  lens,
  onChange
}: {
  lens: BoardLens
  onChange: (lens: BoardLens) => void
}) {
  return (
    <div
      className="lb-inset flex items-center gap-0.5 rounded-lg p-0.5"
      role="tablist"
      aria-label="Choose score or burn standings"
    >
      {LENSES.map((item) => {
        const active = item.id === lens
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.2em] transition-colors ${
              active
                ? item.id === 'burn'
                  ? 'text-[#39ff88]'
                  : 'text-[rgb(var(--lb-score))]'
                : 'text-zinc-600 hover:text-zinc-300'
            }`}
            style={
              active
                ? item.id === 'burn'
                  ? {
                      border: '1px solid rgb(57 255 136 / 0.3)',
                      background: 'rgb(57 255 136 / 0.05)'
                    }
                  : {
                      border: '1px solid rgb(var(--lb-score) / 0.3)',
                      background: 'rgb(var(--lb-score) / 0.06)'
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
}

/* ================= team rows ================= */

function TeamRow({
  team,
  displayRank,
  index,
  topScore,
  topBurn,
  lens,
  open,
  viewerId,
  onToggle,
  setRef
}: {
  team: TeamBoardRow
  displayRank: number
  index: number
  topScore: number
  topBurn: number
  lens: BoardLens
  open: boolean
  viewerId: number | null
  onToggle: (id: number) => void
  setRef: (id: number, el: HTMLLIElement | null) => void
}) {
  const medal = medalFor(displayRank)
  // The squad bar's hue — medal metal on the podium, score yellow below
  // it. Roster dots and share bars reuse it so the segments decode.
  const hue = medal ? medal.fg : 'rgb(var(--lb-score))'
  const pct = topScore > 0 ? Math.max(2, Math.round((team.score / topScore) * 100)) : 0
  const burnPct =
    topBurn > 0 && team.burnPilots > 0
      ? Math.max(2, Math.round((decimalToApproxNumber(team.burnUsd) / topBurn) * 100))
      : 0

  // Podium plate wash — a champion banner on rank 1, quieter silver and
  // bronze washes on 2–3. Plain medalA (never the glow var): backgrounds
  // must hold in both themes. Deliberately row-level, not a podium — it
  // has to look intentional even when one team stands alone.
  const wash = medal
    ? displayRank === 1
      ? `linear-gradient(90deg, ${medalA(medal.rgb, 0.09)}, ${medalA(medal.rgb, 0.02)} 55%, transparent)`
      : `linear-gradient(90deg, ${medalA(medal.rgb, 0.05)}, transparent 45%)`
    : undefined

  return (
    <li
      ref={(el) => setRef(team.userId, el)}
      className="lbt-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)] last:border-b-0"
      style={{
        ['--rd' as string]: `${Math.min(index, 12) * 34}ms`,
        background: wash,
        // Open marker: a 2px inset accent keyline spanning row + roster.
        // No extra shadow.
        boxShadow: open ? 'inset 2px 0 0 rgb(var(--accent-rgb))' : undefined
      }}
    >
      {/* The whole row is the expand control. The roster panel below is a
          SIBLING, never a child — member links must not nest inside a
          button. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(team.userId)}
        aria-label={`${open ? 'Collapse' : 'Expand'} roster — @${team.username}, rank ${displayRank}`}
        className={`${ROW_GRID} group w-full py-4 text-left transition-colors hover:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:outline-none`}
      >
        {/* Rank and podium chrome belong to the active standings lens. */}
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
              {displayRank}
            </span>
          ) : (
            <span className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
              {displayRank}
            </span>
          )}
        </div>

        {/* team identity — square avatar, gold seal, champion chip */}
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            src={team.profile_image}
            char={team.username[0]?.toUpperCase() ?? '?'}
            imgClassName="h-9 w-9 shrink-0 rounded-md border border-zinc-800 object-cover"
            fallbackClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 font-display text-[11px] text-zinc-400"
          />
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="truncate font-display text-[13px] font-medium tracking-tight"
              style={{ color: 'rgb(var(--z100))' }}
            >
              {team.display_name || `@${team.username}`}
            </span>
            <TeamBadge size={14} />
            {medal && displayRank === 1 && (
              <span
                className="hidden shrink-0 rounded px-1.5 py-[3px] text-[7px] leading-none tracking-[0.25em] md:inline"
                style={{
                  // Bright literal on a dark scrim — the plate stays dark
                  // in light mode too, so the metal hue never goes muddy.
                  color: `rgb(${medal.plate})`,
                  background: 'rgb(0 0 0 / 0.55)',
                  border: `1px solid rgb(${medal.plate} / 0.45)`,
                  textShadow: `0 0 10px ${medalGlow(medal.plate, 0.6)}`
                }}
              >
                {lens === 'burn' ? 'BURN CHAMPION' : medal.label}
              </span>
            )}
            <span className="hidden shrink-0 text-[10px] text-zinc-600 lg:inline">
              @{team.username}
            </span>
          </span>
        </div>

        {/* squad facepile — the member count lives in its tooltip/aria */}
        <Facepile members={team.members} count={team.memberCount} />

        {/* opt-in USD burn — display-only, never a rank input. Under the
            burn lens it wears the pixel face + relative bar instead of
            the score column. */}
        <div
          className="hidden text-right md:block"
          title={
            team.burnPilots > 0
              ? `Estimated agent spend of ${team.burnPilots} opted-in member${
                  team.burnPilots === 1 ? '' : 's'
                } — not a company bill`
              : 'No members sharing token usage'
          }
        >
          {team.burnPilots > 0 ? (
            lens === 'burn' ? (
              <>
                <div
                  className="text-[13px] leading-none tabular-nums text-zinc-100 [font-family:var(--font-pixel)]"
                  style={{
                    textShadow: '0 0 10px rgb(57 255 136 / calc(0.3 * var(--lb-glow, 1)))'
                  }}
                >
                  <BurnValue value={team.burnUsd} />
                </div>
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)]">
                  <div
                    className="lbt-bar-in ml-auto h-full rounded-full"
                    style={{
                      width: `${burnPct}%`,
                      background:
                        'linear-gradient(90deg, rgb(57 255 136 / 0.35), rgb(57 255 136 / 0.9))'
                    }}
                  />
                </div>
              </>
            ) : (
              <span className="text-[11px] tabular-nums text-zinc-400">
                <BurnValue value={team.burnUsd} />
              </span>
            )
          ) : (
            <span className="text-zinc-700">—</span>
          )}
        </div>

        {/* SCORE — the main thing. Mobile always keeps this emphasis;
            the burn lens only trades it away on desktop, where the burn
            column exists to receive it. */}
        <div
          className={`min-w-[7.5rem] text-right md:min-w-0 ${
            lens === 'burn' ? 'md:hidden' : ''
          }`}
        >
          <div
            className="text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)]"
            style={{
              color: 'rgb(var(--lb-score))',
              textShadow: medal
                ? '0 0 12px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
                : '0 0 10px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
            }}
          >
            {formatNumber(team.score)}
          </div>
          <SquadBar pct={pct} hue={hue} members={team.members} />
        </div>
        {lens === 'burn' && (
          <div className="hidden text-right text-[11px] tabular-nums text-zinc-500 md:block">
            {formatNumber(team.score)}
          </div>
        )}

        {/* chevron — affordance only, not a second target */}
        <div className="flex items-center justify-end text-zinc-600 transition-colors group-hover:text-zinc-400">
          <IconChevronDown
            size={12}
            className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* roster — the podium collapse trick: 0fr→1fr grid rows, opacity +
          visibility join the transition so a closed roster drops out of
          paint, tab order and screen readers. The transition itself lives
          in the styled-jsx block so its reduced-motion override always
          outranks it. */}
      <div
        className="lbt-exp grid"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          opacity: open ? 1 : 0,
          visibility: open ? 'visible' : 'hidden'
        }}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="border-t border-[rgb(var(--lb-panel-edge)/0.05)] bg-[rgb(var(--lb-panel-edge)/0.02)] py-1">
            {team.members.length === 0 && (
              <li className={`${MEMBER_GRID} py-3`}>
                <span aria-hidden />
                <span className="text-[10px] tracking-[0.2em] text-zinc-500">
                  No affiliates yet.
                </span>
              </li>
            )}
            {team.members.map((member, memberIndex) => (
              <MemberRow
                key={member.userId}
                member={member}
                index={memberIndex}
                isYou={member.userId === viewerId}
                mvp={memberIndex === 0 && member.score > 0}
                hue={hue}
                open={open}
              />
            ))}

            {/* seats footer — solo players see the open seats, owners see
                the empty pips they could fill */}
            <li
              className={`${MEMBER_GRID} border-t border-[rgb(var(--lb-panel-edge)/0.05)] py-2.5`}
            >
              <span aria-hidden />
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="flex items-center gap-1" aria-hidden>
                  {Array.from({ length: SEAT_LIMIT }, (_, seat) => (
                    <span
                      key={seat}
                      className="h-1 w-1 rounded-full"
                      style={
                        seat < team.memberCount
                          ? { background: hue, opacity: 0.75 }
                          : { background: 'rgb(var(--lb-panel-edge) / 0.18)' }
                      }
                    />
                  ))}
                </span>
                <span className="text-[8px] tracking-[0.25em] text-zinc-600 tabular-nums">
                  {team.memberCount} / {SEAT_LIMIT} SEATS FILLED
                  {team.memberCount < SEAT_LIMIT && (
                    <span className="text-zinc-700">
                      {' '}
                      · {SEAT_LIMIT - team.memberCount} OPEN
                    </span>
                  )}
                </span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </li>
  )
}

/* ================= segmented squad bar ================= */

/** The signature element: the team's gap-to-leader bar, sliced into
 *  member shares. Right-aligned like the old bar, 1px gaps between
 *  segments, brightness descending by contribution order. Roster rows
 *  echo their segment with a matching dot. */
function SquadBar({
  pct,
  hue,
  members
}: {
  pct: number
  hue: string
  members: TeamBoardMember[]
}) {
  // Members arrive sorted score desc and seat-capped at 10; sub-1% shares
  // round to 0 and would paint nothing, so they're dropped.
  const segments = members.filter((member) => member.share > 0).slice(0, SEAT_LIMIT)

  return (
    <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)]">
      <div className="lbt-bar-in ml-auto flex h-full gap-px" style={{ width: `${pct}%` }}>
        {segments.length > 0 ? (
          segments.map((member, i) => (
            <span
              key={member.userId}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                flexGrow: member.share,
                flexBasis: 0,
                background: hue,
                opacity: segmentAlpha(i)
              }}
            />
          ))
        ) : (
          // Zero-score team: keep the old bar's faint sliver.
          <span className="h-full w-full rounded-full" style={{ background: hue, opacity: 0.25 }} />
        )}
      </div>
    </div>
  )
}

/* ================= facepile ================= */

/** Replaces the bare MEMBERS count: up to 4 overlapping faces plus a
 *  "+N" chip, ringed in panel bg so the overlaps read. The exact count
 *  survives in the tooltip/aria. Desktop only, like the old column. */
function Facepile({ members, count }: { members: TeamBoardMember[]; count: number }) {
  const shown = members.slice(0, 4)
  const extra = count - shown.length
  const label = `${count} member${count === 1 ? '' : 's'}`

  return (
    <div
      className="hidden items-center justify-end md:flex"
      role="img"
      aria-label={label}
      title={label}
    >
      {count === 0 ? (
        <span className="text-[11px] text-zinc-700">—</span>
      ) : (
        <div className="flex items-center -space-x-1.5">
          {shown.map((member, i) => (
            // Contribution order stacks left-to-right with the top scorer
            // on top of the pile.
            <span
              key={member.userId}
              className="relative inline-flex rounded-full"
              style={{ zIndex: shown.length - i }}
            >
              <Avatar
                src={member.profile_image}
                char={member.username[0]?.toUpperCase() ?? '?'}
                imgClassName="h-5 w-5 rounded-full object-cover ring-2 ring-[rgb(var(--lb-panel-bg))]"
                fallbackClassName="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[8px] font-semibold text-zinc-400 ring-2 ring-[rgb(var(--lb-panel-bg))]"
              />
            </span>
          ))}
          {extra > 0 && (
            <span className="relative z-0 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[rgb(var(--lb-panel-edge)/0.12)] px-1 text-[8px] tabular-nums text-zinc-400 ring-2 ring-[rgb(var(--lb-panel-bg))]">
              +{extra}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ================= roster member row ================= */

function MemberRow({
  member,
  index,
  isYou,
  mvp,
  hue,
  open
}: {
  member: TeamBoardMember
  index: number
  isYou: boolean
  mvp: boolean
  hue: string
  open: boolean
}) {
  return (
    // The stagger class only rides an OPEN roster, so each expand replays
    // the cascade; closed rosters stay inert.
    <li
      className={open ? 'lbt-member-in' : undefined}
      style={{ ['--md' as string]: `${Math.min(index, 9) * 40}ms` }}
    >
      <Link
        href={`/u/${encodeURIComponent(member.username)}`}
        onClick={(e) => e.stopPropagation()}
        className={`${MEMBER_GRID} py-2.5 transition-colors hover:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:outline-none`}
      >
        {/* rank gutter — keeps the roster indented under the team identity */}
        <span aria-hidden />

        <span className="flex min-w-0 items-center gap-2.5">
          {/* segment dot — same hue and alpha as this member's slice of
              the squad bar, so the bar is decodable from the roster */}
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={
              member.share > 0
                ? { background: hue, opacity: segmentAlpha(index) }
                : { background: 'rgb(var(--lb-panel-edge) / 0.25)' }
            }
          />
          <Avatar
            src={member.profile_image}
            char={member.username[0]?.toUpperCase() ?? '?'}
            imgClassName="h-7 w-7 shrink-0 rounded-full border border-zinc-800 object-cover"
            fallbackClassName="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-display text-[10px] text-zinc-400"
          />
          <span
            className="truncate font-display text-[12px] font-medium tracking-tight"
            style={{ color: isYou ? 'rgb(var(--accent-rgb))' : 'rgb(var(--z100))' }}
          >
            {member.display_name || `@${member.username}`}
          </span>
          {isProTier(member.tier) && <VerifiedBadge size={12} />}
          {mvp && (
            <span
              className="shrink-0 border px-1 py-0.5 text-[7px] font-semibold leading-none tracking-[0.2em]"
              style={{
                color: GOLD.fg,
                borderColor: medalA(GOLD.rgb, 0.4),
                background: medalA(GOLD.rgb, 0.07)
              }}
            >
              MVP
            </span>
          )}
          <span className="hidden shrink-0 text-[10px] text-zinc-600 lg:inline">
            @{member.username}
          </span>
          {isYou && (
            <span className="shrink-0 text-[8px] tracking-[0.25em] text-accent">YOU</span>
          )}
        </span>

        {/* share of the team total — the percent always shows, the bar is
            desktop garnish. The 2.5rem slot is exactly "100%" in the pixel
            face, so every bar in a roster gets the same track. */}
        <span
          className="flex items-center gap-2"
          aria-label={`${member.share}% of the team score`}
          title={`${member.share}% of the team score`}
        >
          <span className="hidden h-0.5 flex-1 overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)] md:block">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${member.share}%`,
                background: hue,
                opacity: member.share > 0 ? segmentAlpha(index) : 0
              }}
            />
          </span>
          <span className="min-w-[2.5rem] shrink-0 text-right text-[10px] leading-none tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
            {member.share}%
          </span>
        </span>

        <span className="text-right">
          <span className="block text-[11px] leading-none tabular-nums text-zinc-200 [font-family:var(--font-pixel)]">
            {formatNumber(member.score)}
          </span>
          {member.burnUsd !== null && (
            <span
              className="mt-1 block text-[9px] leading-none tabular-nums text-zinc-500"
              title="Opt-in season burn estimate — not a bill"
            >
              <BurnValue value={member.burnUsd} />
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <li
      className="lbt-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)]"
      style={{ ['--rd' as string]: `${index * 50}ms` }}
    >
      {/* mirrors the live TeamRow geometry (py-4 + h-9 avatar ⇒ ~68px) so
          the table doesn't jump when data lands */}
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        <span className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-md bg-[rgb(var(--lb-panel-edge)/0.05)]" />
          <span className="h-3 w-32 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        </span>
        <span className="hidden h-5 w-14 justify-self-end rounded-full bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-12 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="h-3.5 w-24 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.06)]" />
        <span className="h-3 w-3 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)]" />
      </div>
    </li>
  )
}

/* ================= sticky YOUR TEAM bar ================= */

function YourTeamBar({
  team,
  rank,
  onJump
}: {
  team: TeamBoardRow
  rank: number
  onJump: () => void
}) {
  const medal = medalFor(rank)

  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Jump to your team — @${team.username}, rank ${rank}`}
      // blur-md, same budget note as the pilots' YouBar: this sticky bar
      // re-samples whatever scrolls under it every frame.
      className="block w-full text-left backdrop-blur-md"
      style={{
        // Same docked-row surface as the pilots' YouBar: flat accent wash,
        // 2px rail, quiet border — no glow, no gradient.
        background:
          'linear-gradient(0deg, rgb(var(--accent-rgb) / 0.045), rgb(var(--accent-rgb) / 0.045)), rgb(var(--lb-panel-bg) / 0.88)',
        border: '1px solid rgb(var(--accent-rgb) / 0.18)',
        boxShadow: 'inset 2px 0 0 rgb(var(--accent-rgb)), 0 16px 36px -20px rgb(0 0 0 / 0.5)'
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3 md:gap-4 md:px-5">
        {/* rank — the table's badge dialect */}
        {medal ? (
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[11px] [font-family:var(--font-pixel)]"
            style={{
              color: medal.fg,
              border: `1px solid ${medalA(medal.rgb, 0.5)}`,
              background: medalA(medal.rgb, 0.08),
              textShadow: `0 0 10px ${medalGlow(medal.rgb, 0.55)}`
            }}
          >
            {rank}
          </span>
        ) : (
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
            {rank}
          </span>
        )}

        <Avatar
          src={team.profile_image}
          char={team.username[0]?.toUpperCase() ?? '?'}
          imgClassName="h-9 w-9 shrink-0 rounded-md border border-zinc-800 object-cover"
          fallbackClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 font-display text-[11px] text-zinc-400"
        />

        {/* identity — accent name is the board's "yours" marker */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-display text-[13px] font-medium tracking-tight text-accent">
            {team.display_name || `@${team.username}`}
          </span>
          <TeamBadge size={14} />
        </div>

        <span
          className="shrink-0 text-[15px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: '0 0 10px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
          }}
        >
          {formatNumber(team.score)}
        </span>
      </div>
    </button>
  )
}

/* ================= sticky recruit bar ================= */

/** The docked slot for viewers with no team (including logged-out):
 *  the same surface the YOUR TEAM bar owns, retasked as a Team-plan
 *  pitch. CTA language matches the PlanChooser checkout. */
function RecruitBar() {
  return (
    <div
      className="w-full backdrop-blur-md"
      style={{
        background:
          'linear-gradient(0deg, rgb(var(--lb-gold) / 0.05), rgb(var(--lb-gold) / 0.05)), rgb(var(--lb-panel-bg) / 0.88)',
        border: '1px solid rgb(var(--lb-gold) / 0.2)',
        boxShadow: 'inset 2px 0 0 rgb(var(--lb-gold)), 0 16px 36px -20px rgb(0 0 0 / 0.5)'
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3 md:gap-4 md:px-5">
        <TeamBadge size={18} />
        <p className="min-w-0 flex-1 truncate text-[9px] leading-4 tracking-[0.18em] text-zinc-400">
          CRIBBLE IS BETTER WITH A SQUAD
          <span className="hidden text-zinc-600 sm:inline">
            {' '}
            — POOL EVERY POINT, UP TO {SEAT_LIMIT} PILOTS
          </span>
        </p>
        <Link
          href="/teams"
          className="shrink-0 border border-[rgb(var(--lb-gold)/0.4)] bg-[rgb(var(--lb-gold)/0.07)] px-3 py-2 text-[9px] tracking-[0.25em] text-[rgb(var(--lb-gold))] transition-colors hover:bg-[rgb(var(--lb-gold)/0.14)]"
        >
          FIELD A TEAM
        </Link>
      </div>
    </div>
  )
}

/* ================= search ================= */

function TeamSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="lb-inset flex w-full sm:max-w-xs items-center overflow-hidden rounded-lg">
      <span className="pl-3 pr-1 text-zinc-600">
        <IconSearch size={12} />
      </span>
      <input
        type="text"
        placeholder="hunt a team…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent px-2 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="border-l border-[rgb(var(--lb-panel-edge)/0.08)] px-3 py-2 text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200"
        >
          CLEAR
        </button>
      )}
    </div>
  )
}
