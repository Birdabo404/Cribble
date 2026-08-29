'use client'

// The command deck — what a TEAM-tier account sees on /teams. One screen
// of squad telemetry (KPI strip, roster shares) plus the action center:
// the INBOUND TRANSFERS queue where pilots' applications get SIGNED or
// PASSED, and the OPEN ROSTER lamp that gates new requests. Invite/revoke
// management stays on the /team console — this surface links out to it
// instead of duplicating that machinery.

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatNumber, formatRelative } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
import { usdDisplayParts } from '@/lib/tokenLeaderboard'
import { GoldPanel } from './chrome'

const GOLD = 'var(--lb-gold)'

/* ================= payload (pinned /api/team/dashboard contract) ================= */

export interface DashboardRosterEntry {
  affiliationId: number
  status: 'pending' | 'active'
  userId: number
  username: string
  name: string
  avatar: string | null
  score: number
  /** Integer 0–100 slice of the squad score. */
  share: number
  invitedAt: string
  acceptedAt: string | null
}

export interface DashboardApplication {
  applicationId: number
  userId: number
  username: string
  name: string
  avatar: string | null
  score: number
  message: string | null
  appliedAt: string
}

export interface TeamDashboardData {
  team: { userId: number; username: string; name: string; avatar: string | null }
  reviewStatus: 'pending' | 'approved' | 'rejected' | null
  approved: boolean
  recruiting: boolean
  seatLimit: number
  seatsUsed: number
  board: {
    rank: number | null
    teams: number
    score: number
    burnUsd: string
    burnPilots: number
  }
  roster: DashboardRosterEntry[]
  applications: DashboardApplication[]
}

/** Defensive read of the GET payload — the hub probes with this, and the
 *  deck reuses it for its post-SIGN roster refresh. */
export function parseTeamDashboard(payload: unknown): TeamDashboardData | null {
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as Record<string, unknown>
  const team = body.team as Record<string, unknown> | null | undefined
  if (!team || typeof team.username !== 'string') return null
  const board = (body.board ?? {}) as Record<string, unknown>

  const reviewStatus =
    body.reviewStatus === 'pending' ||
    body.reviewStatus === 'approved' ||
    body.reviewStatus === 'rejected'
      ? body.reviewStatus
      : null

  const roster: DashboardRosterEntry[] = Array.isArray(body.roster)
    ? (body.roster as Record<string, unknown>[]).map((row) => ({
        affiliationId: Number(row.affiliationId) || 0,
        status: row.status === 'active' ? 'active' : 'pending',
        userId: Number(row.userId) || 0,
        username: typeof row.username === 'string' ? row.username : '',
        name: typeof row.name === 'string' ? row.name : '',
        avatar: typeof row.avatar === 'string' ? row.avatar : null,
        score: Number(row.score) || 0,
        share: Number(row.share) || 0,
        invitedAt: typeof row.invitedAt === 'string' ? row.invitedAt : '',
        acceptedAt: typeof row.acceptedAt === 'string' ? row.acceptedAt : null
      }))
    : []

  const applications: DashboardApplication[] = Array.isArray(body.applications)
    ? (body.applications as Record<string, unknown>[]).map((row) => ({
        applicationId: Number(row.applicationId) || 0,
        userId: Number(row.userId) || 0,
        username: typeof row.username === 'string' ? row.username : '',
        name: typeof row.name === 'string' ? row.name : '',
        avatar: typeof row.avatar === 'string' ? row.avatar : null,
        score: Number(row.score) || 0,
        message: typeof row.message === 'string' ? row.message : null,
        appliedAt: typeof row.appliedAt === 'string' ? row.appliedAt : ''
      }))
    : []

  const rank = Number(board.rank)

  return {
    team: {
      userId: Number(team.userId) || 0,
      username: team.username,
      name: typeof team.name === 'string' ? team.name : team.username,
      avatar: typeof team.avatar === 'string' ? team.avatar : null
    },
    reviewStatus,
    approved: body.approved === true,
    recruiting: body.recruiting === true,
    seatLimit: Number(body.seatLimit) || 10,
    seatsUsed: Number(body.seatsUsed) || 0,
    board: {
      rank: Number.isFinite(rank) && rank > 0 ? rank : null,
      teams: Number(board.teams) || 0,
      score: Number(board.score) || 0,
      burnUsd: typeof board.burnUsd === 'string' ? board.burnUsd : '0',
      burnPilots: Number(board.burnPilots) || 0
    },
    roster,
    applications
  }
}

/* ================= small readouts ================= */

/** Same USD grammar as the TEAMS board: signal-green dollar mark,
 *  exact-decimal display parts, "<" for sub-cent values. */
function BurnUsd({ value }: { value: string }) {
  const display = usdDisplayParts(value)
  return (
    <>
      {display.tiny ? '<' : null}
      <span className="text-[#39ff88]">$</span>
      {display.number}
    </>
  )
}

type ReviewTone = 'up' | 'gold' | 'down'

function reviewLamp(status: TeamDashboardData['reviewStatus']): {
  label: string
  tone: ReviewTone
} {
  switch (status) {
    case 'approved':
      return { label: 'APPROVED', tone: 'up' }
    case 'rejected':
      return { label: 'REVIEW REJECTED', tone: 'down' }
    case 'pending':
      return { label: 'UNDER REVIEW', tone: 'gold' }
    case null:
      return { label: 'UNDER REVIEW', tone: 'gold' }
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

function toneStyle(tone: ReviewTone): React.CSSProperties {
  switch (tone) {
    case 'up':
      return {
        color: 'rgb(var(--lb-up))',
        borderColor: 'rgb(var(--lb-up) / 0.4)',
        background: 'rgb(var(--lb-up) / 0.06)'
      }
    case 'gold':
      return {
        color: `rgb(${GOLD})`,
        borderColor: `rgb(${GOLD} / 0.4)`,
        background: `rgb(${GOLD} / 0.06)`
      }
    case 'down':
      return {
        color: 'rgb(var(--lb-down))',
        borderColor: 'rgb(var(--lb-down) / 0.4)',
        background: 'rgb(var(--lb-down) / 0.06)'
      }
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}

function KpiCell({
  className = '',
  label,
  hint,
  valueStyle,
  children
}: {
  className?: string
  label: string
  hint?: string
  valueStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 flex-col items-center overflow-hidden px-4 py-4 text-center ${className}`}
    >
      <div className="text-[9px] tracking-[0.16em] text-zinc-500 sm:tracking-[0.28em]">
        {label}
      </div>
      <div
        className="mt-2.5 max-w-full truncate text-[clamp(12px,2.6vw,16px)] text-zinc-50 tabular-nums [font-family:var(--font-pixel)]"
        style={valueStyle}
      >
        {children}
      </div>
      {hint && (
        <div className="mt-1 max-w-full truncate text-[9px] tracking-[0.16em] text-zinc-600">
          {hint}
        </div>
      )}
    </div>
  )
}

/* ================= roster row ================= */

function RosterRow({ entry, index }: { entry: DashboardRosterEntry; index: number }) {
  const pendingRow = entry.status === 'pending'
  return (
    <li
      className={`flex items-center gap-3 border-b border-[rgb(var(--lb-panel-edge)/0.06)] px-4 py-3 last:border-b-0 ${
        pendingRow ? 'opacity-60' : ''
      }`}
    >
      <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-zinc-600 [font-family:var(--font-pixel)]">
        {pendingRow ? '·' : index + 1}
      </span>

      <Avatar
        src={entry.avatar}
        char={entry.username[0]?.toUpperCase() ?? '?'}
        imgClassName="h-8 w-8 shrink-0 rounded-full border border-zinc-800 object-cover"
        fallbackClassName="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-display text-[10px] text-zinc-400"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            href={`/u/${encodeURIComponent(entry.username)}`}
            className="truncate text-xs text-zinc-100 transition-colors hover:text-white hover:underline underline-offset-2"
          >
            @{entry.username}
          </Link>
          {pendingRow && (
            <span
              className="shrink-0 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
              style={toneStyle('gold')}
            >
              PENDING
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[10px] tracking-[0.15em] text-zinc-600">
          {pendingRow
            ? `invited ${formatRelative(entry.invitedAt)}`
            : `signed ${formatRelative(entry.acceptedAt)}`}
        </div>
      </div>

      {/* contribution share — the percent always shows, the bar is
          desktop garnish (same trade as the TEAMS board roster) */}
      <span
        className="flex w-10 shrink-0 items-center gap-2 sm:w-28"
        title={`${entry.share}% of the squad score`}
      >
        <span className="hidden h-0.5 flex-1 overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)] sm:block">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${entry.share}%`,
              background: `rgb(${GOLD})`,
              opacity: entry.share > 0 ? 0.8 : 0
            }}
          />
        </span>
        <span className="w-full shrink-0 text-right text-[10px] leading-none tabular-nums text-zinc-500 [font-family:var(--font-pixel)] sm:w-auto sm:min-w-[2.5rem]">
          {entry.share}%
        </span>
      </span>

      <span className="w-16 shrink-0 text-right text-[11px] leading-none tabular-nums text-zinc-200 [font-family:var(--font-pixel)]">
        {formatNumber(entry.score)}
      </span>
    </li>
  )
}

/* ================= transfers queue row ================= */

type SignAction = 'accept' | 'decline'

function decisionToast(action: SignAction, username: string): { title: string; body: string } {
  switch (action) {
    case 'accept':
      return { title: 'PILOT SIGNED', body: `@${username} now flies your colors.` }
    case 'decline':
      return { title: 'TRANSFER PASSED', body: `@${username}'s request was declined.` }
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

function ApplicationRow({
  app,
  seatsFull,
  approved,
  busyAction,
  onDecide
}: {
  app: DashboardApplication
  seatsFull: boolean
  approved: boolean
  busyAction: SignAction | null
  onDecide: (action: SignAction) => void
}) {
  const busy = busyAction !== null
  // SIGN mirrors the server's split gate: review-locked (with the same
  // register as the invite console's unlock copy) or seat-locked. PASS
  // stays live either way — clearing dead requests needs no review.
  const signTitle = !approved
    ? 'SIGNING UNLOCKS ONCE YOUR TEAM PASSES REVIEW'
    : seatsFull
      ? 'ALL SEATS FILLED'
      : undefined
  return (
    <li className="border-b border-[rgb(var(--lb-panel-edge)/0.06)] px-4 py-3.5 last:border-b-0 md:px-5">
      <div className="flex items-center gap-3">
        <Avatar
          src={app.avatar}
          char={app.username[0]?.toUpperCase() ?? '?'}
          imgClassName="h-9 w-9 shrink-0 rounded-full border border-zinc-800 object-cover"
          fallbackClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-display text-[11px] text-zinc-400"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              href={`/u/${encodeURIComponent(app.username)}`}
              className="truncate text-xs text-zinc-100 transition-colors hover:text-white hover:underline underline-offset-2"
            >
              @{app.username}
            </Link>
            <span
              className="shrink-0 text-[10px] leading-none tabular-nums [font-family:var(--font-pixel)]"
              style={{ color: 'rgb(var(--lb-score))' }}
            >
              {formatNumber(app.score)}
            </span>
            <span className="shrink-0 text-[8px] tracking-[0.2em] text-zinc-600">
              SEASON PTS
            </span>
          </div>
          <div className="mt-0.5 truncate text-[10px] tracking-[0.15em] text-zinc-600">
            applied {formatRelative(app.appliedAt)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy || seatsFull || !approved}
            title={signTitle}
            onClick={() => onDecide('accept')}
            className="rounded-lg border px-3 py-1.5 text-[9px] tracking-[0.3em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: `rgb(${GOLD})`,
              borderColor: `rgb(${GOLD} / 0.45)`,
              background: `rgb(${GOLD} / 0.07)`
            }}
          >
            {busyAction === 'accept' ? '…' : 'SIGN'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide('decline')}
            className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[9px] tracking-[0.3em] text-zinc-500 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:cursor-wait disabled:opacity-60"
          >
            {busyAction === 'decline' ? '…' : 'PASS'}
          </button>
        </div>
      </div>

      <div className="mt-2 pl-12">
        {app.message ? (
          <p className="font-data text-[11px] leading-relaxed text-zinc-400">
            &ldquo;{app.message}&rdquo;
          </p>
        ) : (
          <p className="font-data text-[11px] text-zinc-700">—</p>
        )}
      </div>
    </li>
  )
}

/* ================= the deck ================= */

export function TeamDashboard({ initial }: { initial: TeamDashboardData }) {
  const [data, setData] = useState<TeamDashboardData>(initial)
  const [recruitingBusy, setRecruitingBusy] = useState(false)
  const [appBusy, setAppBusy] = useState<{ id: number; action: SignAction } | null>(null)

  const seatsFull = data.seatsUsed >= data.seatLimit
  const activeCount = useMemo(
    () => data.roster.filter((entry) => entry.status === 'active').length,
    [data.roster]
  )
  const pendingCount = data.roster.length - activeCount

  // Actives ranked by contribution, pending invites trailing dimmed.
  const orderedRoster = useMemo(() => {
    const actives = data.roster
      .filter((entry) => entry.status === 'active')
      .sort((a, b) => b.score - a.score)
    const pendings = data.roster.filter((entry) => entry.status === 'pending')
    return [...actives, ...pendings]
  }, [data.roster])

  /** Quiet resync after a SIGN — the accept response carries seatsUsed but
   *  not the new member's roster share, so refetch the whole payload. */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/team/dashboard', {
        cache: 'no-store',
        credentials: 'include'
      })
      if (!res.ok) return
      const payload = await res.json().catch(() => null)
      if (!payload?.success) return
      const next = parseTeamDashboard(payload)
      if (next) setData(next)
    } catch {
      // Silent — the optimistic state stands until the next visit.
    }
  }, [])

  const toggleRecruiting = useCallback(async () => {
    if (recruitingBusy) return
    const next = !data.recruiting
    setRecruitingBusy(true)
    setData((prev) => ({ ...prev, recruiting: next }))
    try {
      const res = await fetch('/api/team/dashboard', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiting: next })
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !payload?.success) {
        setData((prev) => ({ ...prev, recruiting: !next }))
        toast({
          kind: 'error',
          title: 'LAMP STUCK',
          body:
            typeof payload?.error === 'string'
              ? payload.error
              : 'Could not flip the roster lamp. Try again.'
        })
        return
      }
      setData((prev) => ({ ...prev, recruiting: payload.recruiting === true }))
      toast({
        kind: 'success',
        title: next ? 'ROSTER OPEN' : 'ROSTER CLOSED',
        body: next
          ? 'Pilots can file transfer requests from the HIRING tab on the team board.'
          : 'New transfer requests are refused while the lamp is dark.'
      })
    } catch {
      setData((prev) => ({ ...prev, recruiting: !next }))
      toast({ kind: 'error', title: 'LAMP STUCK', body: 'Could not flip the roster lamp. Try again.' })
    } finally {
      setRecruitingBusy(false)
    }
  }, [data.recruiting, recruitingBusy])

  const decide = useCallback(
    async (app: DashboardApplication, action: SignAction) => {
      if (appBusy) return
      setAppBusy({ id: app.applicationId, action })
      try {
        const res = await fetch('/api/team/applications', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicationId: app.applicationId, action })
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.success) {
          // A signed-elsewhere 409 means the row is dead server-side —
          // drop it from the queue instead of stranding a request
          // nobody can action.
          if (res.status === 409 && payload?.applicationGone === true) {
            setData((prev) => ({
              ...prev,
              applications: prev.applications.filter(
                (row) => row.applicationId !== app.applicationId
              )
            }))
          }
          toast({
            kind: 'error',
            title: 'ACTION FAILED',
            body:
              typeof payload?.error === 'string'
                ? payload.error
                : 'Could not update the transfer. Try again.'
          })
          return
        }
        const nextSeats = Number(payload.seatsUsed)
        setData((prev) => ({
          ...prev,
          applications: prev.applications.filter(
            (row) => row.applicationId !== app.applicationId
          ),
          seatsUsed:
            action === 'accept' && Number.isFinite(nextSeats) && nextSeats > 0
              ? nextSeats
              : prev.seatsUsed
        }))
        toast({ kind: 'success', ...decisionToast(action, app.username) })
        requestNotificationsRefresh()
        // The signed pilot's roster row (score, share) needs a real read.
        if (action === 'accept') void refresh()
      } catch {
        toast({ kind: 'error', title: 'ACTION FAILED', body: 'Could not update the transfer. Try again.' })
      } finally {
        setAppBusy(null)
      }
    },
    [appBusy, refresh]
  )

  const lamp = reviewLamp(data.reviewStatus)

  return (
    <div className="page-zoom-out mx-auto max-w-3xl px-6 pb-16 pt-6">
      {/* ---------- title lockup ---------- */}
      <header className="tdb-rise mt-3 flex flex-col items-center">
        <span className="text-[9px] tracking-[0.5em] text-zinc-600">COMPANY OPERATIONS</span>
        <h1
          className="mt-3 select-none text-center text-2xl leading-none [font-family:var(--font-pixel)] md:text-3xl"
          style={{
            color: `rgb(${GOLD})`,
            textShadow: `0 0 22px rgb(${GOLD} / 0.4), 0 0 52px rgb(${GOLD} / 0.16)`
          }}
        >
          COMMAND DECK
        </h1>
        <p className="mt-3 text-center text-[10px] tracking-[0.3em] text-zinc-600">
          SQUAD TELEMETRY · INBOUND TRANSFERS · UP TO {data.seatLimit} PILOTS
        </p>
      </header>

      <main className="mt-8 space-y-4">
        {/* ---------- identity header ---------- */}
        <div className="tdb-rise" style={{ ['--rv' as string]: '60ms' }}>
          <GoldPanel>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 md:px-6">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg glass-inset-lite">
                <Avatar
                  src={data.team.avatar}
                  char={data.team.username[0]?.toUpperCase() ?? '?'}
                  imgClassName="h-full w-full object-cover"
                  fallbackClassName="flex h-full w-full items-center justify-center font-display text-[14px] text-yellow-300"
                />
              </span>

              <div className="min-w-0 flex-1 basis-40">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate font-display text-[15px] font-medium tracking-tight text-zinc-100">
                    {data.team.name}
                  </span>
                  {data.approved && <TeamBadge size={15} />}
                  <span
                    className="shrink-0 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
                    style={toneStyle(lamp.tone)}
                  >
                    {lamp.label}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] tracking-[0.15em] text-zinc-600">
                  @{data.team.username}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleRecruiting()}
                  disabled={recruitingBusy}
                  aria-pressed={data.recruiting}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[9px] tracking-[0.25em] transition-colors disabled:cursor-wait disabled:opacity-60 ${
                    data.recruiting ? '' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                  style={
                    data.recruiting
                      ? {
                          color: `rgb(${GOLD})`,
                          borderColor: `rgb(${GOLD} / 0.45)`,
                          background: `rgb(${GOLD} / 0.07)`
                        }
                      : undefined
                  }
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={
                      data.recruiting
                        ? {
                            background: `rgb(${GOLD})`,
                            boxShadow: `0 0 8px rgb(${GOLD} / 0.6)`
                          }
                        : { background: 'rgb(var(--lb-panel-edge) / 0.35)' }
                    }
                  />
                  {data.recruiting ? 'OPEN ROSTER' : 'ROSTER CLOSED'}
                </button>

                <Link
                  href="/team"
                  className="rounded-lg border border-zinc-800 px-3 py-2 text-[9px] tracking-[0.25em] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                >
                  ROSTER CONSOLE →
                </Link>
              </div>
            </div>
          </GoldPanel>
        </div>

        {/* ---------- KPI strip ---------- */}
        <div
          className="tdb-rise lb-panel grid grid-cols-2 overflow-hidden rounded-2xl md:grid-cols-4"
          style={{ ['--rv' as string]: '120ms' }}
        >
          <KpiCell
            label="SQUAD SCORE"
            valueStyle={{
              color: 'rgb(var(--lb-score))',
              textShadow: '0 0 12px rgb(var(--lb-score) / calc(0.3 * var(--lb-glow, 1)))'
            }}
          >
            {formatNumber(data.board.score)}
          </KpiCell>

          <KpiCell
            className="border-l border-[rgb(var(--lb-panel-edge)/0.08)]"
            label="BOARD RANK"
            hint={data.board.teams > 0 ? `OF ${formatNumber(data.board.teams)} TEAMS` : undefined}
          >
            {data.board.rank !== null ? `#${data.board.rank}` : <span className="text-zinc-700">—</span>}
          </KpiCell>

          <KpiCell
            className="border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-l md:border-t-0"
            label="ACTIVE PILOTS"
            hint={
              pendingCount > 0
                ? `${pendingCount} PENDING HOLD SEATS`
                : `${Math.max(0, data.seatLimit - data.seatsUsed)} SEATS OPEN`
            }
          >
            {activeCount}/{data.seatLimit}
          </KpiCell>

          <KpiCell
            className="border-l border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0"
            label="BURN"
            hint="OPT-IN ESTIMATES"
          >
            {data.board.burnPilots > 0 ? (
              <BurnUsd value={data.board.burnUsd} />
            ) : (
              <span className="text-zinc-700">—</span>
            )}
          </KpiCell>
        </div>

        {/* ---------- squad roster ---------- */}
        <div
          className="tdb-rise lb-panel overflow-hidden rounded-2xl"
          style={{ ['--rv' as string]: '180ms' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[rgb(var(--lb-panel-edge)/0.08)] px-4 py-3">
            <span className="text-[9px] tracking-[0.35em] text-zinc-500">SQUAD ROSTER</span>
            <div className="flex items-center gap-3">
              <span
                className="flex gap-1"
                role="img"
                aria-label={`${data.seatsUsed} of ${data.seatLimit} seats used`}
              >
                {Array.from({ length: data.seatLimit }, (_, i) => (
                  <span
                    key={i}
                    className="h-3 w-2 rounded-[2px]"
                    style={
                      i < data.seatsUsed
                        ? {
                            background: `rgb(${GOLD} / 0.85)`,
                            boxShadow: `0 0 8px rgb(${GOLD} / 0.5)`
                          }
                        : { background: 'rgb(var(--lb-panel-edge) / 0.14)' }
                    }
                  />
                ))}
              </span>
              <span className="text-[9px] tabular-nums tracking-[0.2em] text-zinc-600">
                {activeCount} ACTIVE · {pendingCount} PENDING
              </span>
            </div>
          </div>

          {orderedRoster.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="text-[10px] tracking-[0.35em] text-zinc-300">NO PILOTS SIGNED</div>
              <p className="mx-auto mt-2 max-w-[300px] text-[11px] leading-relaxed text-zinc-500">
                Open the roster lamp so pilots can apply, or invite them by callsign from the
                roster console.
              </p>
            </div>
          ) : (
            <ul>
              {orderedRoster.map((entry, index) => (
                <RosterRow key={entry.affiliationId} entry={entry} index={index} />
              ))}
            </ul>
          )}
        </div>

        {/* ---------- inbound transfers ---------- */}
        <div className="tdb-rise" style={{ ['--rv' as string]: '240ms' }}>
          <GoldPanel>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[rgb(var(--lb-panel-edge)/0.08)] px-4 py-3 md:px-5">
              <span className="text-[9px] tracking-[0.35em] text-zinc-500">
                INBOUND TRANSFERS
              </span>
              <span className="text-[9px] tabular-nums tracking-[0.2em]">
                {seatsFull ? (
                  <span style={{ color: 'rgb(var(--lb-down))' }}>
                    ALL SEATS FILLED — FREE A SEAT TO SIGN
                  </span>
                ) : (
                  <span className="text-zinc-600">
                    {data.applications.length} WAITING
                  </span>
                )}
              </span>
            </div>

            {data.applications.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="text-[10px] tracking-[0.35em] text-zinc-300">
                  NO INBOUND TRANSFERS
                </div>
                <p className="mx-auto mt-2 max-w-[300px] text-[11px] leading-relaxed text-zinc-500">
                  Pilots apply from the HIRING tab on the team board.
                  {!data.recruiting && ' Your roster lamp is dark — nobody can file one right now.'}
                </p>
              </div>
            ) : (
              <ul>
                {data.applications.map((app) => (
                  <ApplicationRow
                    key={app.applicationId}
                    app={app}
                    seatsFull={seatsFull}
                    approved={data.approved}
                    busyAction={appBusy?.id === app.applicationId ? appBusy.action : null}
                    onDecide={(action) => void decide(app, action)}
                  />
                ))}
              </ul>
            )}
          </GoldPanel>
        </div>

        <p className="text-center text-[9px] tracking-[0.25em] text-zinc-700">
          TRANSFER REQUESTS DON&apos;T HOLD A SEAT — THE CAP IS CHECKED WHEN YOU SIGN
        </p>
      </main>

      <style jsx global>{`
        .tdb-rise {
          animation: tdb-rise-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes tdb-rise-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tdb-rise {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
