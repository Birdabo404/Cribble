'use client'

// The recruitment board. Approved live teams ranked like leaderboard
// rows (medal plates for the podium, square company marks, squad score,
// the ten-dot seat meter) with a RECRUITING / ROSTER CLOSED lamp and an
// APPLY action that files a transfer request through ApplyModal. A
// second read of GET /api/team/apply personalizes the rows: REQUESTED
// (withdrawable) where the viewer already applied, YOUR TEAM on their
// own squad, and no apply affordances at all when signed out. Two
// dressings: standalone with its own page chrome (header lockup,
// max-width section), or `embedded` inside the TEAMS leaderboard's
// HIRING tab, where the arena supplies the chrome and this component
// brings only the panel, its footnote, and the modal.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatNumber } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { medalA, medalFor, medalGlow } from '@/components/leaderboard/types'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { toast } from '@/components/Toaster'
import { ApplyModal } from './ApplyModal'

const GOLD = 'var(--lb-gold)'

// Mobile is two zones (rank+identity left, score+action right); the
// md+ grid adds the score / seats / action columns of the full table.
const ROW_GRID =
  'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] md:grid-cols-[4.2rem_minmax(0,1fr)_7rem_9.5rem_7.5rem] items-center gap-2.5 px-3.5 md:gap-3 md:px-5'

/* ================= payload (pinned /api/teams/directory contract) ================= */

interface DirectoryTeam {
  userId: number
  rank: number
  username: string
  name: string
  avatar: string | null
  score: number
  memberCount: number
  seatsUsed: number
  seatLimit: number
  openSeats: number
  recruiting: boolean
  burnUsd: string
  burnPilots: number
}

interface DirectoryTotals {
  teams: number
  members: number
  topScore: number
}

/** What GET /api/team/apply tells us about the viewer. Signed-out (401)
 *  collapses to the empty context, which hides every apply affordance. */
interface ViewerContext {
  signedIn: boolean
  /** teamUserId → open applicationId */
  applied: Map<number, number>
  membershipTeamId: number | null
}

const EMPTY_VIEWER: ViewerContext = {
  signedIn: false,
  applied: new Map(),
  membershipTeamId: null
}

function parseTeams(payload: unknown): { teams: DirectoryTeam[]; totals: DirectoryTotals } | null {
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as Record<string, unknown>
  if (!Array.isArray(body.teams)) return null
  const teams = (body.teams as Record<string, unknown>[]).map((row) => ({
    userId: Number(row.userId) || 0,
    rank: Number(row.rank) || 0,
    username: typeof row.username === 'string' ? row.username : '',
    name: typeof row.name === 'string' ? row.name : '',
    avatar: typeof row.avatar === 'string' ? row.avatar : null,
    score: Number(row.score) || 0,
    memberCount: Number(row.memberCount) || 0,
    seatsUsed: Number(row.seatsUsed) || 0,
    seatLimit: Number(row.seatLimit) || 10,
    openSeats: Number(row.openSeats) || 0,
    recruiting: row.recruiting === true,
    burnUsd: typeof row.burnUsd === 'string' ? row.burnUsd : '0',
    burnPilots: Number(row.burnPilots) || 0
  }))
  const totals = (body.totals ?? {}) as Record<string, unknown>
  return {
    teams,
    totals: {
      teams: Number(totals.teams) || teams.length,
      members: Number(totals.members) || 0,
      topScore: Number(totals.topScore) || 0
    }
  }
}

async function loadViewerContext(): Promise<ViewerContext> {
  try {
    const res = await fetch('/api/team/apply', {
      cache: 'no-store',
      credentials: 'include'
    })
    if (!res.ok) return EMPTY_VIEWER
    const data = await res.json().catch(() => null)
    if (!data?.success) return EMPTY_VIEWER
    const applied = new Map<number, number>()
    if (Array.isArray(data.applications)) {
      for (const row of data.applications as Record<string, unknown>[]) {
        const teamUserId = Number(row.teamUserId)
        const applicationId = Number(row.applicationId)
        if (teamUserId > 0 && applicationId > 0) applied.set(teamUserId, applicationId)
      }
    }
    const membershipTeamId = Number(data?.membership?.team?.userId)
    return {
      signedIn: true,
      applied,
      membershipTeamId: membershipTeamId > 0 ? membershipTeamId : null
    }
  } catch {
    return EMPTY_VIEWER
  }
}

/* ================= seat meter ================= */

function SeatDots({
  used,
  limit,
  className = ''
}: {
  used: number
  limit: number
  className?: string
}) {
  return (
    <span
      className={`flex gap-[3px] ${className}`}
      role="img"
      aria-label={`${used} of ${limit} seats used`}
    >
      {Array.from({ length: limit }, (_, i) => (
        <span
          key={i}
          className="h-2.5 w-[5px] rounded-[1px]"
          style={
            i < used
              ? {
                  background: `rgb(${GOLD} / 0.85)`,
                  boxShadow: `0 0 6px rgb(${GOLD} / 0.45)`
                }
              : { background: 'rgb(var(--lb-panel-edge) / 0.16)' }
          }
        />
      ))}
    </span>
  )
}

/* ================= per-row action ================= */

type RowAction =
  | 'yours'
  | 'requested'
  | 'apply'
  | 'closed'
  | 'full'
  | 'none'

function actionFor(team: DirectoryTeam, viewer: ViewerContext): RowAction {
  if (viewer.membershipTeamId === team.userId) return 'yours'
  // An existing request stays withdrawable even if the roster since
  // closed or filled — the pilot needs the exit.
  if (viewer.applied.has(team.userId)) return 'requested'
  if (!viewer.signedIn) return 'none'
  if (!team.recruiting) return 'closed'
  if (team.openSeats <= 0) return 'full'
  if (viewer.membershipTeamId !== null) return 'none'
  return 'apply'
}

function ActionCell({
  team,
  action,
  armed,
  busy,
  onApply,
  onArm,
  onWithdraw
}: {
  team: DirectoryTeam
  action: RowAction
  armed: boolean
  busy: boolean
  onApply: () => void
  onArm: () => void
  onWithdraw: () => void
}) {
  const plate =
    'inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-[9px] tracking-[0.25em]'
  switch (action) {
    case 'yours':
      return (
        <span
          className={plate}
          style={{
            color: `rgb(${GOLD})`,
            borderColor: `rgb(${GOLD} / 0.4)`,
            background: `rgb(${GOLD} / 0.06)`
          }}
        >
          YOUR TEAM
        </span>
      )
    case 'requested':
      return (
        <button
          type="button"
          disabled={busy}
          onClick={armed ? onWithdraw : onArm}
          title={armed ? undefined : 'Withdraw this transfer request'}
          className={`${plate} transition-colors disabled:cursor-wait disabled:opacity-60 ${
            armed
              ? 'border-rose-400/60 bg-rose-500/15 text-rose-200'
              : 'border-zinc-800 text-zinc-400 hover:border-rose-400/40 hover:text-rose-300'
          }`}
        >
          {busy ? '…' : armed ? 'WITHDRAW?' : 'REQUESTED'}
        </button>
      )
    case 'apply':
      return (
        <button
          type="button"
          onClick={onApply}
          className={`${plate} transition-colors hover:brightness-125`}
          style={{
            color: `rgb(${GOLD})`,
            borderColor: `rgb(${GOLD} / 0.45)`,
            background: `rgb(${GOLD} / 0.07)`
          }}
          aria-label={`Apply to ${team.name}`}
        >
          APPLY
        </button>
      )
    case 'closed':
      return (
        <span className={`${plate} cursor-not-allowed border-zinc-800 text-zinc-600`}>
          CLOSED
        </span>
      )
    case 'full':
      return (
        <span className={`${plate} cursor-not-allowed border-zinc-800 text-zinc-600`}>
          FULL
        </span>
      )
    case 'none':
      return null
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

/* ================= team row ================= */

function DirectoryRow({
  team,
  index,
  viewer,
  armed,
  busy,
  onApply,
  onArm,
  onWithdraw
}: {
  team: DirectoryTeam
  index: number
  viewer: ViewerContext
  armed: boolean
  busy: boolean
  onApply: () => void
  onArm: () => void
  onWithdraw: () => void
}) {
  const medal = medalFor(team.rank)
  const action = actionFor(team, viewer)
  const actionCell = (
    <ActionCell
      team={team}
      action={action}
      armed={armed}
      busy={busy}
      onApply={onApply}
      onArm={onArm}
      onWithdraw={onWithdraw}
    />
  )

  return (
    <li
      className={`tdr-row-in ${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.05)] py-4 last:border-b-0`}
      style={{
        ['--rd' as string]: `${Math.min(index, 12) * 34}ms`,
        ...(medal
          ? {
              background: `linear-gradient(90deg, ${medalA(medal.rgb, 0.07)}, ${medalA(medal.rgb, 0.02)} 30%, transparent 55%)`,
              boxShadow: `inset 2px 0 0 ${medalA(medal.rgb, 0.7)}`
            }
          : null)
      }}
    >
      {/* rank plate */}
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

      {/* identity — square company mark, recruiting lamp */}
      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
        <Avatar
          src={team.avatar}
          char={team.username[0]?.toUpperCase() ?? '?'}
          imgClassName="h-9 w-9 shrink-0 rounded-md border border-zinc-800 object-cover"
          fallbackClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 font-display text-[11px] text-zinc-400"
        />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              href={`/u/${encodeURIComponent(team.username)}`}
              className="truncate font-display text-[13px] font-medium tracking-tight text-zinc-100 transition-colors hover:text-white hover:underline underline-offset-2"
            >
              {team.name || `@${team.username}`}
            </Link>
            <TeamBadge size={13} />
            <span
              className="hidden shrink-0 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.2em] sm:inline"
              style={
                team.recruiting
                  ? {
                      color: `rgb(${GOLD})`,
                      borderColor: `rgb(${GOLD} / 0.4)`,
                      background: `rgb(${GOLD} / 0.06)`
                    }
                  : {
                      color: 'rgb(var(--lb-panel-edge) / 0.7)',
                      borderColor: 'rgb(var(--lb-panel-edge) / 0.2)'
                    }
              }
            >
              {team.recruiting ? 'RECRUITING' : 'ROSTER CLOSED'}
            </span>
          </span>
          {/* mobile sub-line — the seat story compressed. Wraps inside its
              grid track so the lamp word can never overflow into the
              score/action zone on narrow rows. */}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 md:hidden">
            <SeatDots used={team.seatsUsed} limit={team.seatLimit} />
            <span className="text-[9px] tabular-nums tracking-[0.15em] text-zinc-600">
              {team.seatsUsed}/{team.seatLimit}
            </span>
            <span
              className="text-[8px] tracking-[0.15em] sm:hidden"
              style={team.recruiting ? { color: `rgb(${GOLD})` } : { color: 'rgb(var(--lb-panel-edge) / 0.7)' }}
            >
              {team.recruiting ? 'RECRUITING' : 'CLOSED'}
            </span>
          </span>
        </span>
      </div>

      {/* score — desktop column */}
      <div className="hidden text-right md:block">
        <div
          className="text-[14px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: medal
              ? '0 0 12px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
              : '0 0 9px rgb(var(--lb-score) / calc(0.2 * var(--lb-glow, 1)))'
          }}
        >
          {formatNumber(team.score)}
        </div>
        <div className="mt-1 text-[7px] tracking-[0.16em] text-zinc-600">SQUAD SCORE</div>
      </div>

      {/* seats — desktop column */}
      <div className="hidden flex-col items-end gap-1 md:flex">
        <SeatDots used={team.seatsUsed} limit={team.seatLimit} />
        <span className="text-[8px] tabular-nums tracking-[0.2em] text-zinc-600">
          {formatNumber(team.memberCount)} {team.memberCount === 1 ? 'PILOT' : 'PILOTS'} ·{' '}
          {team.openSeats} OPEN
        </span>
      </div>

      {/* desktop action */}
      <div className="hidden justify-end md:flex">{actionCell}</div>

      {/* mobile metrics zone — score on top, action beneath */}
      <div className="flex flex-col items-end gap-1.5 md:hidden">
        <span
          className="text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{ color: 'rgb(var(--lb-score))' }}
        >
          {formatNumber(team.score)}
        </span>
        {actionCell}
      </div>
    </li>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <li
      className="tdr-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)]"
      style={{ ['--rd' as string]: `${index * 45}ms` }}
    >
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        <span className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-md bg-[rgb(var(--lb-panel-edge)/0.05)]" />
          <span className="h-3 w-32 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        </span>
        <span className="hidden h-4 w-16 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.06)] md:block" />
        <span className="hidden h-3 w-20 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="h-7 w-20 justify-self-end rounded-lg bg-[rgb(var(--lb-panel-edge)/0.05)]" />
      </div>
    </li>
  )
}

/* ================= the board ================= */

export function TeamsDirectory({ embedded = false }: { embedded?: boolean }) {
  const [teams, setTeams] = useState<DirectoryTeam[] | null>(null)
  const [totals, setTotals] = useState<DirectoryTotals | null>(null)
  const [viewer, setViewer] = useState<ViewerContext>(EMPTY_VIEWER)
  const [failed, setFailed] = useState(false)
  const [applyTarget, setApplyTarget] = useState<DirectoryTeam | null>(null)
  const [armedTeamId, setArmedTeamId] = useState<number | null>(null)
  const [busyTeamId, setBusyTeamId] = useState<number | null>(null)
  const fetchSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      const [dirRes, viewerCtx] = await Promise.all([
        fetch('/api/teams/directory', { cache: 'no-store' }),
        loadViewerContext()
      ])
      const payload = await dirRes.json().catch(() => null)
      if (seq !== fetchSeq.current) return
      const parsed = dirRes.ok && payload?.success ? parseTeams(payload) : null
      if (!parsed) {
        setFailed(true)
        return
      }
      setTeams(parsed.teams)
      setTotals(parsed.totals)
      setViewer(viewerCtx)
      setArmedTeamId(null)
      setFailed(false)
    } catch {
      if (seq === fetchSeq.current) setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const withdraw = useCallback(
    async (team: DirectoryTeam) => {
      const applicationId = viewer.applied.get(team.userId)
      if (!applicationId || busyTeamId !== null) return
      setBusyTeamId(team.userId)
      try {
        const res = await fetch(`/api/team/apply?applicationId=${applicationId}`, {
          method: 'DELETE',
          credentials: 'include'
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          // 404 = the row is already gone (withdrawn in another tab, or
          // the team passed) — quietly clear the stale REQUESTED state
          // instead of stranding the button.
          if (res.status === 404) {
            setViewer((prev) => {
              const applied = new Map(prev.applied)
              applied.delete(team.userId)
              return { ...prev, applied }
            })
            return
          }
          toast({
            kind: 'error',
            title: 'COULD NOT WITHDRAW',
            body: typeof data?.error === 'string' ? data.error : 'Try again in a moment.'
          })
          return
        }
        setViewer((prev) => {
          const applied = new Map(prev.applied)
          applied.delete(team.userId)
          return { ...prev, applied }
        })
        toast({
          kind: 'success',
          title: 'REQUEST WITHDRAWN',
          body: `Your transfer request to @${team.username} was pulled.`
        })
      } catch {
        toast({ kind: 'error', title: 'COULD NOT WITHDRAW', body: 'Try again in a moment.' })
      } finally {
        setBusyTeamId(null)
        setArmedTeamId(null)
      }
    },
    [busyTeamId, viewer.applied]
  )

  const handleApplied = useCallback(
    (team: DirectoryTeam, applicationId: number) => {
      if (applicationId > 0) {
        setViewer((prev) => {
          const applied = new Map(prev.applied)
          applied.set(team.userId, applicationId)
          return { ...prev, signedIn: true, applied }
        })
      }
      setApplyTarget(null)
    },
    []
  )

  const loading = teams === null && !failed

  // The board itself — panel, footnote, modal, entrance CSS — is shared
  // verbatim between the two dressings; only the page chrome around it
  // differs. (The style block is global-named, so hoisting it into a
  // const is safe for styled-jsx.)
  const panel = (
    <div className="lb-panel relative overflow-hidden">
      <div
        className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[9px] tracking-[0.3em] text-zinc-500`}
      >
        <div>
          <span className="md:hidden">#</span>
          <span className="hidden md:inline">RANK</span>
        </div>
        <div>TEAM</div>
        <div className="hidden text-right md:block">SQUAD SCORE</div>
        <div className="hidden text-right md:block">SEATS</div>
        <div className="hidden md:block" aria-hidden />
        <div className="text-right md:hidden">SCORE</div>
      </div>

      <ul className="relative">
        {loading &&
          Array.from({ length: 5 }, (_, index) => (
            <SkeletonRow key={index} index={index} />
          ))}

        {failed && (
          <li className="flex flex-col items-center gap-4 py-14 text-center">
            <span className="text-xs tracking-[0.15em] text-zinc-500">
              The recruitment board failed to load.
            </span>
            <button
              type="button"
              onClick={() => {
                setFailed(false)
                setTeams(null)
                void load()
              }}
              className="lb-inset rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100"
            >
              RETRY
            </button>
          </li>
        )}

        {!loading && !failed && (teams?.length ?? 0) === 0 && (
          <li className="flex flex-col items-center px-5 py-14 text-center">
            <TeamBadge size={24} />
            <p className="mt-4 text-[10px] tracking-[0.22em] text-zinc-400">
              NO TEAMS FIELDED YET
            </p>
            <p className="mt-2 max-w-md text-[11px] leading-5 text-zinc-600">
              The first companies to fly their colors will take applications right here.
            </p>
          </li>
        )}

        {!loading &&
          !failed &&
          teams?.map((team, index) => (
            <DirectoryRow
              key={team.userId}
              team={team}
              index={index}
              viewer={viewer}
              armed={armedTeamId === team.userId}
              busy={busyTeamId === team.userId}
              onApply={() => setApplyTarget(team)}
              onArm={() => setArmedTeamId(team.userId)}
              onWithdraw={() => void withdraw(team)}
            />
          ))}
      </ul>
    </div>
  )

  const footnote = (
    <p className="mt-3 text-center text-[9px] tracking-[0.25em] text-zinc-600">
      RANKED BY COMBINED SEASON SCORE · REQUESTS DON&apos;T HOLD A SEAT
    </p>
  )

  const modal = applyTarget && (
    <ApplyModal
      team={{
        userId: applyTarget.userId,
        username: applyTarget.username,
        name: applyTarget.name || `@${applyTarget.username}`,
        avatar: applyTarget.avatar
      }}
      onClose={() => setApplyTarget(null)}
      onApplied={(applicationId) => handleApplied(applyTarget, applicationId)}
    />
  )

  const styles = (
    <style jsx global>{`
      .tdr-rise {
        animation: tdr-rise-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        animation-delay: var(--rv, 0ms);
      }
      @keyframes tdr-rise-in {
        from {
          opacity: 0;
          transform: translateY(14px);
        }
      }
      .tdr-row-in {
        animation: tdr-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        animation-delay: var(--rd, 0ms);
      }
      @keyframes tdr-row-enter {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tdr-rise,
        .tdr-row-in {
          animation: none;
        }
      }
    `}</style>
  )

  // Embedded — the TEAMS leaderboard's HIRING tab. The arena owns the
  // section header, stat strip, page width and reveal, so no lockup, no
  // max-width wrapper, and no TEAMS HIRING strap (the tab already says
  // it; the strap's totals live on the stat strip).
  if (embedded) {
    return (
      <>
        {panel}
        {footnote}
        {modal}
        {styles}
      </>
    )
  }

  return (
    <section className="page-zoom-out relative mx-auto max-w-4xl px-6 pt-6">
      {/* ---------- header lockup ---------- */}
      <header className="tdr-rise mt-3 flex flex-col items-center">
        <span className="text-[9px] tracking-[0.5em] text-zinc-600">OPEN SEASON</span>
        <h2
          className="mt-3 select-none text-center text-2xl leading-none [font-family:var(--font-pixel)] md:text-3xl"
          style={{
            color: `rgb(${GOLD})`,
            textShadow: `0 0 22px rgb(${GOLD} / 0.4), 0 0 52px rgb(${GOLD} / 0.16)`
          }}
        >
          RECRUITMENT BOARD
        </h2>
        <p className="mt-3 text-center text-[10px] tracking-[0.3em] text-zinc-600">
          FILE A TRANSFER REQUEST — ONE TEAM PER PILOT
        </p>
      </header>

      {/* ---------- standings ---------- */}
      <div className="tdr-rise mt-8" style={{ ['--rv' as string]: '80ms' }}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
            TEAMS HIRING
          </h3>
          {totals && (
            <span className="text-[9px] tabular-nums tracking-[0.2em] text-zinc-600">
              {formatNumber(totals.teams)} TEAMS · {formatNumber(totals.members)} PILOTS ON
              ROSTERS
            </span>
          )}
        </div>

        {panel}
        {footnote}
      </div>

      {modal}
      {styles}
    </section>
  )
}
