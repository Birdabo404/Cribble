'use client'

// THE TEAMS BOARD — the arena's third board. Approved company accounts
// ranked by the combined season score of their active affiliates (via
// /api/leaderboard/teams, one cached site-wide aggregate). Deliberately
// barer than the pilot standings, same register as the AI board: no
// plates, no player cards, no pagination. One interaction of its own —
// click a team row and its roster drops out under it. The payload is
// identical for every viewer and server-cached, so there is no 15s poll:
// fetch on mount and when the tab regains focus.

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
import {
  IconChevronDown,
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
import type {
  TeamBoardMember,
  TeamBoardRow,
  TeamBoardTotals
} from '@/lib/teamLeaderboard'

const ROW_GRID =
  'grid grid-cols-[3.6rem_minmax(0,1fr)_auto_1rem] md:grid-cols-[4.2rem_minmax(0,1fr)_6.5rem_10.5rem_1rem] items-center gap-3 px-4 md:px-5'

// Roster rows keep the team grid's gutters — col 1 stays an empty rank
// gutter so member identity sits exactly under the team identity, and the
// trailing 1rem track mirrors the chevron column so scores right-align
// with the team score above. The share track exists at every breakpoint
// (auto on mobile carries just the percent; 7.5rem on desktop fits
// bar + "100%").
const MEMBER_GRID =
  'grid grid-cols-[3.6rem_minmax(0,1fr)_auto_auto_1rem] md:grid-cols-[4.2rem_minmax(0,1fr)_7.5rem_auto_1rem] items-center gap-3 px-4 md:px-5'

// The champion team's roster wears the rank-1 medal on its share bars.
const GOLD = medalFor(1)!

export function TeamBoard() {
  const [teams, setTeams] = useState<TeamBoardRow[] | null>(null)
  const [totals, setTotals] = useState<TeamBoardTotals | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [viewerId, setViewerId] = useState<number | null>(null)

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
      if (!result.ok) return
      const id = result.data.user?.id
      if (id) setViewerId(Number(id))
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
    if (!el) return // row still filtered out — the next `filtered` commit retries
    pendingJumpId.current = null
    el.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    })
  }, [filtered, jumpNonce])

  return (
    <>
      {/* ---------- stat strip ---------- */}
      <section className="lbt-reveal">
        <div className="lb-panel grid grid-cols-2 overflow-hidden md:grid-cols-3">
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
            label="MEMBERS"
          >
            <AnimatedCounter
              value={totals?.members ?? 0}
              duration={1100}
              formatter={(v) => formatNumber(Math.round(v))}
            />
          </StatCell>

          <StatCell
            className="col-span-2 border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:col-span-1 md:border-l md:border-t-0"
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
        </div>
      </section>

      {/* ---------- team standings ---------- */}
      <section className="lbt-reveal relative" style={{ ['--rv' as string]: '120ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
              STANDINGS
            </h2>
            {!loading && !failed && filtered.length > 0 && (
              <span className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                {filtered.length} TEAMS
              </span>
            )}
          </div>
          <TeamSearch value={query} onChange={setQuery} />
        </div>

        <div className="lb-panel relative overflow-hidden">
          <div
            className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[9px] tracking-[0.35em] text-zinc-500`}
          >
            <div>RANK</div>
            <div>TEAM</div>
            <div className="hidden text-right md:block">MEMBERS</div>
            <div className="text-right text-zinc-300">SCORE</div>
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

            {!loading && !failed && filtered.length === 0 && (
              <li className="py-14 text-center text-xs tracking-[0.15em] text-zinc-500">
                {query
                  ? 'No teams match that callsign.'
                  : 'No verified teams on the board yet.'}
              </li>
            )}

            {!loading &&
              !failed &&
              filtered.map((team, i) => (
                <TeamRow
                  key={team.userId}
                  team={team}
                  index={i}
                  topScore={topScore}
                  open={openId === team.userId}
                  viewerId={viewerId}
                  onToggle={toggle}
                  setRef={setRowRef}
                />
              ))}
          </ul>
        </div>

        <p className="mt-3 text-center text-[9px] tracking-[0.3em] text-zinc-600">
          RANKED BY THE COMBINED SEASON SCORE OF ACTIVE AFFILIATES
        </p>

        {/* ---------- sticky YOUR TEAM bar ---------- */}
        {myTeam && (
          <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mt-4">
            <YourTeamBar team={myTeam} onJump={jumpToMyTeam} />
          </div>
        )}
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
        .lbt-exp {
          transition:
            grid-template-rows 500ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 500ms cubic-bezier(0.22, 1, 0.36, 1),
            visibility 500ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .lbt-reveal,
          .lbt-row-in {
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
    <div className={`px-4 py-4 ${className}`}>
      <div className="flex items-center gap-1.5 text-[9px] tracking-[0.35em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div
        className="mt-2.5 text-sm text-zinc-50 tabular-nums [font-family:var(--font-pixel)] md:text-base"
        style={valueStyle}
      >
        {children}
      </div>
      {hint && (
        <div className="mt-1 truncate text-[9px] tracking-[0.2em] text-zinc-600">{hint}</div>
      )}
    </div>
  )
}

/* ================= team rows ================= */

function TeamRow({
  team,
  index,
  topScore,
  open,
  viewerId,
  onToggle,
  setRef
}: {
  team: TeamBoardRow
  index: number
  topScore: number
  open: boolean
  viewerId: number | null
  onToggle: (id: number) => void
  setRef: (id: number, el: HTMLLIElement | null) => void
}) {
  const medal = medalFor(team.rank)
  const pct = topScore > 0 ? Math.max(2, Math.round((team.score / topScore) * 100)) : 0

  return (
    <li
      ref={(el) => setRef(team.userId, el)}
      className="lbt-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)] last:border-b-0"
      style={{
        ['--rd' as string]: `${Math.min(index, 12) * 34}ms`,
        // Open marker: a 2px inset accent keyline spanning row + roster.
        // No wash, no extra shadow.
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
        aria-label={`${open ? 'Collapse' : 'Expand'} roster — @${team.username}, rank ${team.rank}`}
        className={`${ROW_GRID} group w-full py-4 text-left transition-colors hover:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:outline-none`}
      >
        {/* rank */}
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
              {team.rank}
            </span>
          ) : (
            <span className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
              {team.rank}
            </span>
          )}
        </div>

        {/* team identity — square avatar, gold seal */}
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
            <span className="hidden shrink-0 text-[10px] text-zinc-600 lg:inline">
              @{team.username}
            </span>
          </span>
        </div>

        {/* members */}
        <div className="hidden text-right text-[11px] tabular-nums text-zinc-400 md:block">
          {formatNumber(team.memberCount)}
        </div>

        {/* SCORE — the main thing */}
        <div className="min-w-[7.5rem] text-right md:min-w-0">
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
            {team.members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                isYou={member.userId === viewerId}
                champion={team.rank === 1}
              />
            ))}
          </ul>
        </div>
      </div>
    </li>
  )
}

function MemberRow({
  member,
  isYou,
  champion
}: {
  member: TeamBoardMember
  isYou: boolean
  champion: boolean
}) {
  return (
    <li>
      <Link
        href={`/u/${encodeURIComponent(member.username)}`}
        onClick={(e) => e.stopPropagation()}
        className={`${MEMBER_GRID} py-2.5 transition-colors hover:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:bg-[rgb(var(--lb-panel-edge)/0.045)] focus-visible:outline-none`}
      >
        {/* rank gutter — keeps the roster indented under the team identity */}
        <span aria-hidden />

        <span className="flex min-w-0 items-center gap-2.5">
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
                background: champion
                  ? medalA(GOLD.rgb, 0.55)
                  : 'linear-gradient(90deg, rgb(var(--z700)), rgb(var(--z400)))'
              }}
            />
          </span>
          <span className="min-w-[2.5rem] shrink-0 text-right text-[10px] leading-none tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
            {member.share}%
          </span>
        </span>

        <span className="text-right text-[11px] leading-none tabular-nums text-zinc-200 [font-family:var(--font-pixel)]">
          {formatNumber(member.score)}
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
        <span className="hidden h-3 w-8 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="h-3.5 w-24 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.06)]" />
        <span className="h-3 w-3 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)]" />
      </div>
    </li>
  )
}

/* ================= sticky YOUR TEAM bar ================= */

function YourTeamBar({ team, onJump }: { team: TeamBoardRow; onJump: () => void }) {
  const medal = medalFor(team.rank)

  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Jump to your team — @${team.username}, rank ${team.rank}`}
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
            {team.rank}
          </span>
        ) : (
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
            {team.rank}
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
