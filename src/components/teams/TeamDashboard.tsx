'use client'

// The command deck — what a TEAM-tier account, or a signed OWNER on a
// personal login, sees on /teams. One screen of squad telemetry (hero
// band with KPI cells, roster shares) plus the action center: the
// INBOUND TRANSFERS queue where pilots' applications get SIGNED or
// PASSED (each stamped against the published HIRING BAR — a soft
// signal, never a gate), the OPEN ROSTER lamp that gates new requests,
// and the HIRING BAR panel where the thresholds themselves are set.
// Owners get everything except the franchise-only controls
// (promote/demote lives behind the team login). Signed MEMBERS get the
// read-only TEAM CONSOLE cut: masthead, hero band and roster in a
// single centered column — no bar, queue, toggles or role controls
// (the server already strips applications and nulls the bar for them).
// Invite/revoke management stays on the /team console — this surface
// links out to it instead of duplicating that machinery.

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatNumber, formatRelative } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
import {
  HIRING_BAR_MAX_BURN_USD,
  HIRING_BAR_MAX_SCORE,
  HIRING_BAR_MAX_TOKENS,
  formatHiringScore,
  formatHiringTokens,
  formatHiringUsd,
  hasBar,
  hiringBarChips,
  type BarStamp,
  type HiringBar,
  type MetricStamp,
  type TeamRole
} from '@/lib/teamHiring'
import { TEAM_OWNER_LIMIT } from '@/lib/teams'
import { usdDisplayParts } from '@/lib/tokenLeaderboard'
import { useDeckMotion } from './useDeckMotion'

/* ================= payload (pinned /api/team/dashboard contract) ================= */

export interface DashboardRosterEntry {
  affiliationId: number
  status: 'pending' | 'active'
  role: TeamRole
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
  /** The applicant measured against the bar — display-only soft signal. */
  stamp: BarStamp
  message: string | null
  appliedAt: string
}

export interface TeamDashboardData {
  /** Whose keys opened the deck: the franchise login, a signed owner,
   *  or a signed member (read-only — the server returns the normal
   *  payload with applications emptied and the bar all-null). */
  authority: 'team-account' | 'owner' | 'member'
  team: { userId: number; username: string; name: string; avatar: string | null }
  reviewStatus: 'pending' | 'approved' | 'rejected' | null
  approved: boolean
  recruiting: boolean
  bar: HiringBar
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

const METRIC_STAMPS = ['met', 'missed', 'unverified'] as const

function parseThreshold(raw: unknown): number | null {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function parseMetricStamp(raw: unknown): MetricStamp | null {
  return typeof raw === 'string' && (METRIC_STAMPS as readonly string[]).includes(raw)
    ? (raw as MetricStamp)
    : null
}

/** Defensive stamp read — anything malformed reads as 'no-bar', which
 *  renders nothing rather than a wrong verdict. */
function parseBarStamp(raw: unknown): BarStamp {
  const stamp = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const overall =
    stamp.overall === 'clears' || stamp.overall === 'below' || stamp.overall === 'partial'
      ? stamp.overall
      : 'no-bar'
  return {
    score: parseMetricStamp(stamp.score),
    tokens: parseMetricStamp(stamp.tokens),
    burnUsd: parseMetricStamp(stamp.burnUsd),
    overall
  }
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
        role: row.role === 'owner' ? 'owner' : 'member',
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
        stamp: parseBarStamp(row.stamp),
        message: typeof row.message === 'string' ? row.message : null,
        appliedAt: typeof row.appliedAt === 'string' ? row.appliedAt : ''
      }))
    : []

  const rank = Number(board.rank)
  const rawBar = (typeof body.bar === 'object' && body.bar !== null ? body.bar : {}) as Record<
    string,
    unknown
  >

  return {
    authority:
      body.authority === 'owner'
        ? 'owner'
        : body.authority === 'member'
          ? 'member'
          : 'team-account',
    team: {
      userId: Number(team.userId) || 0,
      username: team.username,
      name: typeof team.name === 'string' ? team.name : team.username,
      avatar: typeof team.avatar === 'string' ? team.avatar : null
    },
    reviewStatus,
    approved: body.approved === true,
    recruiting: body.recruiting === true,
    bar: {
      minScore: parseThreshold(rawBar.minScore),
      minTokens: parseThreshold(rawBar.minTokens),
      minBurnUsd: parseThreshold(rawBar.minBurnUsd)
    },
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
      <span className="text-[rgb(var(--lb-up))]">$</span>
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

/** Tone → deck-chip modifier (globals.css) — the classes carry both
 *  themes, so light mode gets full borders instead of alpha washes. */
function toneClass(tone: ReviewTone): string {
  switch (tone) {
    case 'up':
      return 'deck-chip-up'
    case 'gold':
      return 'deck-chip-gold'
    case 'down':
      return 'deck-chip-down'
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}

/** The masthead reads COMMAND DECK for operators, TEAM CONSOLE for the
 *  read-only member cut. */
function deckTitle(authority: TeamDashboardData['authority']): string {
  switch (authority) {
    case 'team-account':
    case 'owner':
      return 'COMMAND DECK'
    case 'member':
      return 'TEAM CONSOLE'
    default: {
      const exhaustive: never = authority
      return exhaustive
    }
  }
}

/** Operators (franchise login or signed owner) get the action center —
 *  hiring bar, transfers queue, roster lamp, console link. Members get
 *  none of it. */
function isDeckOperator(authority: TeamDashboardData['authority']): boolean {
  switch (authority) {
    case 'team-account':
    case 'owner':
      return true
    case 'member':
      return false
    default: {
      const exhaustive: never = authority
      return exhaustive
    }
  }
}

function KpiCell({
  label,
  hint,
  valueStyle,
  tick,
  accent,
  children
}: {
  label: string
  hint?: string
  valueStyle?: React.CSSProperties
  tick?: boolean
  /** Gold index square — the headline instrument. */
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`deck-kpi ${accent ? 'deck-kpi-accent' : ''}`}>
      <div className="deck-kpi-label">{label}</div>
      <div className="deck-kpi-value" style={valueStyle} {...(tick ? { 'data-deck-score': '' } : {})}>
        {children}
      </div>
      {hint && <div className="deck-kpi-hint">{hint}</div>}
    </div>
  )
}

function FrameMarks() {
  return (
    <>
      <span aria-hidden className="deck-cross deck-cross-tl" />
      <span aria-hidden className="deck-cross deck-cross-tr" />
      <span aria-hidden className="deck-cross deck-cross-bl" />
      <span aria-hidden className="deck-cross deck-cross-br" />
      <span aria-hidden className="deck-grain" />
      <span aria-hidden className="deck-scan" />
    </>
  )
}

function DeckBand({ label, note }: { label: string; note?: React.ReactNode }) {
  return (
    <div className="deck-band">
      <span>[ {label} ]</span>
      {note && <span className="deck-band-note">{note}</span>}
    </div>
  )
}

/* ================= hiring bar controls ================= */

interface BarMetricSpec {
  key: keyof HiringBar
  label: string
  quickPicks: number[]
  max: number
  format: (value: number) => string
}

/** The three published thresholds with their quick-pick ladders. Maxima
 *  mirror hiringBarSchema so a custom entry can never 400 server-side. */
const BAR_METRICS: BarMetricSpec[] = [
  {
    key: 'minScore',
    label: 'GLOBAL SCORE',
    quickPicks: [10_000, 50_000, 100_000],
    max: HIRING_BAR_MAX_SCORE,
    format: formatHiringScore
  },
  {
    key: 'minTokens',
    label: 'TOKENS BURNED',
    quickPicks: [10_000_000, 100_000_000, 1_000_000_000],
    max: HIRING_BAR_MAX_TOKENS,
    format: formatHiringTokens
  },
  {
    key: 'minBurnUsd',
    label: 'USD BURNED',
    quickPicks: [100, 1_000, 10_000],
    max: HIRING_BAR_MAX_BURN_USD,
    format: formatHiringUsd
  }
]

function BarMetricControl({
  spec,
  value,
  busy,
  onSet
}: {
  spec: BarMetricSpec
  value: number | null
  busy: boolean
  onSet: (value: number | null) => void
}) {
  const [draft, setDraft] = useState('')
  const enabled = value !== null

  const submitDraft = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed < 1) return
    onSet(Math.min(spec.max, Math.trunc(parsed)))
    setDraft('')
  }

  const customHeld = value !== null && !spec.quickPicks.includes(value)

  return (
    <div className="deck-metric">
      {/* label doubles as the metric's lamp: on = last-touched value,
          off = metric cleared (NULL server-side) */}
      <button
        type="button"
        onClick={() => onSet(enabled ? null : spec.quickPicks[0])}
        disabled={busy}
        aria-pressed={enabled}
        title={enabled ? 'SWITCH THIS METRIC OFF' : 'SWITCH THIS METRIC ON'}
        className="deck-metric-lamp disabled:cursor-wait disabled:opacity-60"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 ${enabled ? 'deck-dot-on' : 'deck-dot-off'}`}
        />
        {spec.label}
        {enabled && <span className="deck-mute font-normal">· {spec.format(value)}</span>}
      </button>

      {/* one flush strip: three quick picks, then the custom entry and
          its SET key, all sharing hairlines instead of floating apart */}
      <form
        className="deck-seg"
        role="group"
        aria-label={`${spec.label} threshold`}
        onSubmit={(event) => {
          event.preventDefault()
          submitDraft()
        }}
      >
        {spec.quickPicks.map((pick) => (
          <button
            key={pick}
            type="button"
            disabled={busy}
            onClick={() => onSet(pick)}
            aria-pressed={value === pick}
            className="deck-seg-pick disabled:cursor-wait disabled:opacity-60"
          >
            {spec.format(pick)}
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          disabled={busy}
          placeholder={customHeld ? spec.format(value) : 'CUSTOM'}
          aria-label={`Custom ${spec.label} threshold`}
          className="deck-seg-input"
        />
        <button type="submit" disabled={busy || draft === ''} className="deck-seg-set">
          SET
        </button>
      </form>
    </div>
  )
}

/* ================= applicant stamps ================= */

function verdictWord(stamp: MetricStamp): string {
  switch (stamp) {
    case 'met':
      return 'MET'
    case 'missed':
      return 'BELOW BAR'
    case 'unverified':
      return 'UNVERIFIED'
    default: {
      const exhaustive: never = stamp
      return exhaustive
    }
  }
}

function stampMark(stamp: MetricStamp): string {
  switch (stamp) {
    case 'met':
      return '✓'
    case 'missed':
      return '✕'
    case 'unverified':
      return '?'
    default: {
      const exhaustive: never = stamp
      return exhaustive
    }
  }
}

function stampChipClass(stamp: MetricStamp): string {
  switch (stamp) {
    case 'met':
      return 'deck-chip-mute'
    case 'missed':
      return 'deck-chip-down'
    case 'unverified':
      return 'deck-chip-mute'
    default: {
      const exhaustive: never = stamp
      return exhaustive
    }
  }
}

function OverallStampPlate({ overall }: { overall: BarStamp['overall'] }) {
  switch (overall) {
    case 'clears':
      return <span className={`deck-chip shrink-0 ${toneClass('up')}`}>CLEARS BAR</span>
    case 'below':
      return <span className={`deck-chip shrink-0 ${toneClass('down')}`}>BELOW BAR</span>
    case 'partial':
      return <span className="deck-chip deck-chip-mute shrink-0">UNVERIFIED</span>
    case 'no-bar':
      return null
    default: {
      const exhaustive: never = overall
      return exhaustive
    }
  }
}

/** The published bar re-rendered per applicant, each threshold tinted by
 *  their stamp — a soft signal beside the SIGN/PASS buttons, never a gate. */
function QueueStamps({ bar, stamp }: { bar: HiringBar; stamp: BarStamp }) {
  const metrics: { label: string; amount: string; verdict: MetricStamp }[] = []
  if (bar.minScore !== null) {
    metrics.push({
      label: 'GLOBAL SCORE',
      amount: `${formatHiringScore(bar.minScore)} GS`,
      verdict: stamp.score ?? 'unverified'
    })
  }
  if (bar.minTokens !== null) {
    metrics.push({
      label: 'TOKENS BURNED',
      amount: `${formatHiringTokens(bar.minTokens)} TOKENS`,
      verdict: stamp.tokens ?? 'unverified'
    })
  }
  if (bar.minBurnUsd !== null) {
    metrics.push({
      label: 'USD BURNED',
      amount: `${formatHiringUsd(bar.minBurnUsd)} BURN`,
      verdict: stamp.burnUsd ?? 'unverified'
    })
  }
  if (metrics.length === 0) return null

  return (
    <div className="deck-app-stamps">
      <OverallStampPlate overall={stamp.overall} />
      {metrics.map((metric) => (
        <span
          key={metric.label}
          title={`${metric.label} — ${verdictWord(metric.verdict)}`}
          className={`deck-chip tabular-nums ${stampChipClass(metric.verdict)}`}
        >
          {metric.amount} {stampMark(metric.verdict)}
        </span>
      ))}
    </div>
  )
}

/* ================= roster row ================= */

function RosterRow({
  entry,
  index,
  selected,
  canManageRoles,
  ownersFull,
  roleBusy,
  onSelect,
  onRoleChange
}: {
  entry: DashboardRosterEntry
  index: number
  selected: boolean
  /** True only on the franchise login — owners never see role controls. */
  canManageRoles: boolean
  ownersFull: boolean
  roleBusy: boolean
  onSelect: () => void
  onRoleChange: (role: TeamRole) => void
}) {
  const pendingRow = entry.status === 'pending'
  return (
    <li>
      <div
        className={`deck-pilot ${selected ? 'deck-pilot-on' : ''} ${
          pendingRow ? 'opacity-60' : ''
        }`}
        aria-current={selected ? 'true' : undefined}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          // Only when the row itself has focus — the nested profile link
          // and role buttons keep their own Enter/Space.
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect()
          }
        }}
      >
        <span className="deck-rank">
          {pendingRow ? '··' : String(index + 1).padStart(2, '0')}
        </span>

        <span className="deck-avatar">
          <Avatar
            src={entry.avatar}
            char={entry.username[0]?.toUpperCase() ?? '?'}
            imgClassName="h-full w-full object-cover"
            fallbackClassName="deck-avatar-fallback"
          />
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-x-2.5">
          <Link
            href={`/u/${encodeURIComponent(entry.username)}`}
            onClick={(event) => event.stopPropagation()}
            className="deck-callsign"
          >
            @{entry.username}
          </Link>
          {pendingRow && <span className="deck-chip deck-chip-gold shrink-0">PENDING</span>}
          {!pendingRow && entry.role === 'owner' && (
            <span
              className="deck-chip deck-chip-mute shrink-0"
              title="Holds the front-office keys — full deck control from their own login"
            >
              OWNER
            </span>
          )}
        </div>

        <span className="deck-pilot-share" title={`${entry.share}% of the squad score`}>
          <span className="deck-share-track">
            <span
              className="deck-share-fill"
              style={{ width: `${entry.share}%`, opacity: entry.share > 0 ? 1 : 0 }}
            />
          </span>
          <span className="w-full shrink-0 text-right font-data text-[11px] leading-none tabular-nums sm:w-auto sm:min-w-[2.6rem]">
            {entry.share}%
          </span>
        </span>

        <span className="deck-pilot-score">{formatNumber(entry.score)}</span>

        {canManageRoles && !pendingRow && (
          entry.role === 'owner' ? (
            <button
              type="button"
              disabled={roleBusy}
              onClick={(event) => {
                event.stopPropagation()
                onRoleChange('member')
              }}
              className="deck-btn deck-btn-sm deck-btn-quiet w-[5.25rem] shrink-0 disabled:cursor-wait disabled:opacity-60"
            >
              DEMOTE
            </button>
          ) : (
            <button
              type="button"
              disabled={roleBusy || ownersFull}
              title={ownersFull ? `ALL ${TEAM_OWNER_LIMIT} OWNER SEATS HELD` : undefined}
              onClick={(event) => {
                event.stopPropagation()
                onRoleChange('owner')
              }}
              className="deck-btn deck-btn-sm deck-btn-quiet deck-btn-gold w-[5.25rem] shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
            >
              PROMOTE
            </button>
          )
        )}
      </div>
    </li>
  )
}

/* ================= unfilled seats ================= */

/** One ghost slot per seat the roster doesn't hold. The strip clips to
 *  whatever slack the compartment has (globals.css .deck-slots), so this
 *  can render every open seat without ever growing the column. */
function OpenSeats({ from, seatLimit }: { from: number; seatLimit: number }) {
  const open = Math.max(0, seatLimit - from)
  if (open === 0) return null
  return (
    <div className="deck-slots" aria-hidden>
      {Array.from({ length: open }, (_, i) => (
        <div key={i} className="deck-slot">
          <span className="deck-rank">{String(from + i + 1).padStart(2, '0')}</span>
          <span className="deck-slot-box" />
          <span className="deck-slot-line" />
          <span>OPEN SEAT</span>
        </div>
      ))}
    </div>
  )
}

/* ================= selected-pilot readout ================= */

function rosterRole(entry: DashboardRosterEntry): string {
  if (entry.status === 'pending') return 'INVITED · PENDING'
  switch (entry.role) {
    case 'owner':
      return 'OWNER'
    case 'member':
      return 'MEMBER'
    default: {
      const exhaustive: never = entry.role
      return exhaustive
    }
  }
}

/** The compartment's foot: whichever row is lit gets read out in full
 *  (NieR status-panel grammar — list left, dossier below). Pure display
 *  over roster fields the row already carries. */
function PilotDossier({ entry, rank }: { entry: DashboardRosterEntry; rank: number }) {
  const pending = entry.status === 'pending'
  const displayName = entry.name.trim() || entry.username
  return (
    <div className="deck-dossier" aria-live="polite">
      <div className="deck-dossier-body" key={entry.affiliationId}>
        <div className="min-w-0">
          <div className="deck-dossier-sub">
            PILOT {pending ? '··' : String(rank).padStart(2, '0')} · {rosterRole(entry)}
          </div>
          <p className="deck-dossier-name mt-1.5">{displayName}</p>
          <dl className="deck-dossier-grid">
            <div>
              <dt>Callsign</dt>
              <dd>@{entry.username}</dd>
            </div>
            <div>
              <dt>Season pts</dt>
              <dd>{formatNumber(entry.score)}</dd>
            </div>
            <div>
              <dt>Squad share</dt>
              <dd>{entry.share}%</dd>
            </div>
            <div>
              <dt>{pending ? 'Invited' : 'Signed'}</dt>
              <dd>{formatRelative(pending ? entry.invitedAt : entry.acceptedAt)}</dd>
            </div>
          </dl>
        </div>
        <Link
          href={`/u/${encodeURIComponent(entry.username)}`}
          className="deck-btn deck-btn-sm deck-btn-quiet shrink-0"
        >
          OPEN PROFILE →
        </Link>
      </div>
    </div>
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
  bar,
  seatsFull,
  approved,
  busyAction,
  onDecide
}: {
  app: DashboardApplication
  bar: HiringBar
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
    <li className="deck-app">
      <div className="deck-app-head">
        <span className="deck-avatar deck-avatar-lg">
          <Avatar
            src={app.avatar}
            char={app.username[0]?.toUpperCase() ?? '?'}
            imgClassName="h-full w-full object-cover"
            fallbackClassName="deck-avatar-fallback"
          />
        </span>

        <div className="deck-app-id">
          <div className="deck-app-line">
            <Link href={`/u/${encodeURIComponent(app.username)}`} className="deck-callsign">
              @{app.username}
            </Link>
            <span className="deck-app-score">{formatNumber(app.score)}</span>
            <span className="deck-mute shrink-0 font-data text-[10px] tracking-[0.18em]">
              SEASON PTS
            </span>
          </div>
          <div className="deck-app-meta">applied {formatRelative(app.appliedAt)}</div>
        </div>

        <div className="deck-app-actions">
          <button
            type="button"
            disabled={busy || seatsFull || !approved}
            title={signTitle}
            onClick={() => onDecide('accept')}
            className="deck-btn deck-btn-primary deck-btn-hard disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === 'accept' ? '…' : 'SIGN'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide('decline')}
            className="deck-btn deck-btn-quiet deck-btn-rose disabled:cursor-wait disabled:opacity-60"
          >
            {busyAction === 'decline' ? '…' : 'PASS'}
          </button>
        </div>
      </div>

      {hasBar(bar) && <QueueStamps bar={bar} stamp={app.stamp} />}

      {app.message ? (
        <p className="deck-app-note">&ldquo;{app.message}&rdquo;</p>
      ) : (
        <p className="deck-app-note deck-app-note-empty">— NO MESSAGE FILED</p>
      )}
    </li>
  )
}

/* ================= the deck ================= */

export function TeamDashboard({ initial }: { initial: TeamDashboardData }) {
  const [data, setData] = useState<TeamDashboardData>(initial)
  const [recruitingBusy, setRecruitingBusy] = useState(false)
  const [barBusy, setBarBusy] = useState(false)
  const [roleBusy, setRoleBusy] = useState<number | null>(null)
  const [appBusy, setAppBusy] = useState<{ id: number; action: SignAction } | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const seatsFull = data.seatsUsed >= data.seatLimit
  const activeCount = useMemo(
    () => data.roster.filter((entry) => entry.status === 'active').length,
    [data.roster]
  )
  const pendingCount = data.roster.length - activeCount
  const ownerCount = useMemo(
    () =>
      data.roster.filter((entry) => entry.status === 'active' && entry.role === 'owner')
        .length,
    [data.roster]
  )
  const ownersFull = ownerCount >= TEAM_OWNER_LIMIT

  // Actives ranked by contribution, pending invites trailing dimmed.
  const orderedRoster = useMemo(() => {
    const actives = data.roster
      .filter((entry) => entry.status === 'active')
      .sort((a, b) => b.score - a.score)
    const pendings = data.roster.filter((entry) => entry.status === 'pending')
    return [...actives, ...pendings]
  }, [data.roster])

  const selectedAffiliation =
    orderedRoster.some((entry) => entry.affiliationId === selectedId)
      ? selectedId
      : (orderedRoster[0]?.affiliationId ?? null)
  const selectedIndex = orderedRoster.findIndex(
    (entry) => entry.affiliationId === selectedAffiliation
  )
  const selectedEntry = selectedIndex >= 0 ? orderedRoster[selectedIndex] : null

  useDeckMotion(rootRef, {
    score: data.board.score,
    recruiting: data.recruiting,
    selectedKey: selectedAffiliation
  })

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

  /** One whole-bar write per interaction — the PATCH carries all three
   *  metrics, so an optimistic rollback restores exactly what stood. */
  const saveBar = useCallback(
    async (next: HiringBar) => {
      if (barBusy) return
      const previous = data.bar
      setBarBusy(true)
      setData((prev) => ({ ...prev, bar: next }))
      try {
        const res = await fetch('/api/team/dashboard', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bar: next })
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.success) {
          setData((prev) => ({ ...prev, bar: previous }))
          toast({
            kind: 'error',
            title: 'BAR STUCK',
            body:
              typeof payload?.error === 'string'
                ? payload.error
                : 'Could not update the hiring bar. Try again.'
          })
          return
        }
        toast({
          kind: 'success',
          title: hasBar(next) ? 'HIRING BAR SET' : 'HIRING BAR CLEARED',
          body: hasBar(next)
            ? hiringBarChips(next).join(' · ')
            : 'Applications flow unstamped while no bar is published.'
        })
      } catch {
        setData((prev) => ({ ...prev, bar: previous }))
        toast({ kind: 'error', title: 'BAR STUCK', body: 'Could not update the hiring bar. Try again.' })
      } finally {
        setBarBusy(false)
      }
    },
    [barBusy, data.bar]
  )

  const changeRole = useCallback(
    async (entry: DashboardRosterEntry, role: TeamRole) => {
      if (roleBusy !== null) return
      setRoleBusy(entry.affiliationId)
      try {
        const res = await fetch('/api/team/roster', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberUserId: entry.userId, role })
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.success) {
          toast({
            kind: 'error',
            title: 'ROLE CHANGE FAILED',
            body:
              typeof payload?.error === 'string'
                ? payload.error
                : 'Could not update the role. Try again.'
          })
          return
        }
        setData((prev) => ({
          ...prev,
          roster: prev.roster.map((row) =>
            row.affiliationId === entry.affiliationId ? { ...row, role } : row
          )
        }))
        toast({
          kind: 'success',
          ...(role === 'owner'
            ? { title: 'FRONT OFFICE', body: `@${entry.username} now holds the keys.` }
            : { title: 'KEYS RETURNED', body: `@${entry.username} is back to a member role.` })
        })
      } catch {
        toast({ kind: 'error', title: 'ROLE CHANGE FAILED', body: 'Could not update the role. Try again.' })
      } finally {
        setRoleBusy(null)
      }
    },
    [roleBusy]
  )

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
  const operator = isDeckOperator(data.authority)

  return (
    <div
      ref={rootRef}
      className={`command-deck page-zoom-out mx-auto px-4 pb-12 pt-5 sm:px-6 ${
        operator ? 'max-w-6xl' : 'max-w-4xl'
      }`}
    >
      <header className="deck-mast deck-boot">
        <div>
          <h1 className="deck-title select-none">{deckTitle(data.authority)}</h1>
          <div className="deck-kicker">COMPANY OPERATIONS</div>
        </div>
        {/* authority plate + jump links to the compartments below */}
        <nav className="deck-tabs" aria-label="Deck sectors">
          <span className="deck-tab deck-tab-plate">{operator ? 'OPERATOR' : 'READ ONLY'}</span>
          <a href="#deck-roster" className="deck-tab">
            ROSTER
          </a>
          {operator && (
            <>
              <a href="#deck-transfers" className="deck-tab">
                TRANSFERS
              </a>
              <a href="#deck-bar" className="deck-tab">
                HIRING BAR
              </a>
            </>
          )}
        </nav>
      </header>
      <span aria-hidden className="deck-rule deck-rule-gold mb-2.5" />

      <div className="relative">
        <FrameMarks />
        <div className="deck-shell">
          <div className="deck-cell deck-identity deck-boot">
          <span className="deck-mark">
            <Avatar
              src={data.team.avatar}
              char={data.team.username[0]?.toUpperCase() ?? '?'}
              imgClassName="h-full w-full object-cover"
              fallbackClassName="flex h-full w-full items-center justify-center font-display text-[15px] font-semibold text-current"
            />
          </span>

          <div className="min-w-0 flex-1 basis-48">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <span className="truncate font-display text-[16px] font-semibold tracking-tight">
                {data.team.name}
              </span>
              {data.approved && <TeamBadge size={14} />}
              <span className={`deck-chip shrink-0 ${toneClass(lamp.tone)}`}>{lamp.label}</span>
              {data.authority === 'owner' && (
                <span
                  className="deck-chip deck-chip-mute shrink-0"
                  title="You command this deck as a team owner — role changes and releases need the team login"
                >
                  FRONT OFFICE
                </span>
              )}
            </div>
            <div className="deck-mute mt-1 truncate font-data text-[11px] tracking-[0.16em]">
              @{data.team.username} · UP TO {data.seatLimit} PILOTS
            </div>
          </div>

          {operator && (
            <div className="deck-actions">
              <button
                type="button"
                onClick={() => void toggleRecruiting()}
                disabled={recruitingBusy}
                aria-pressed={data.recruiting}
                className={`deck-btn deck-btn-hard disabled:cursor-wait disabled:opacity-60 ${
                  data.recruiting ? 'deck-lamp-on' : 'deck-btn-quiet'
                }`}
              >
                <span
                  aria-hidden
                  className={`deck-lamp-live h-1.5 w-1.5 ${
                    data.recruiting ? 'deck-dot-on' : 'deck-dot-off'
                  }`}
                />
                {data.recruiting ? 'OPEN ROSTER' : 'ROSTER CLOSED'}
              </button>

              <Link href="/team" className="deck-btn deck-btn-quiet deck-btn-hard">
                ROSTER CONSOLE →
              </Link>
            </div>
          )}
        </div>

        <div className="deck-kpi-row deck-boot">
          <KpiCell
            label="SQUAD SCORE"
            valueStyle={{ color: 'rgb(var(--lb-score))' }}
            tick
            accent
          >
            {formatNumber(data.board.score)}
          </KpiCell>

          <KpiCell
            label="BOARD RANK"
            hint={data.board.teams > 0 ? `OF ${formatNumber(data.board.teams)} TEAMS` : undefined}
          >
            {data.board.rank !== null ? `#${data.board.rank}` : <span className="deck-faint">—</span>}
          </KpiCell>

          <KpiCell
            label="ACTIVE PILOTS"
            hint={
              pendingCount > 0
                ? `${pendingCount} PENDING HOLD SEATS`
                : `${Math.max(0, data.seatLimit - data.seatsUsed)} SEATS OPEN`
            }
          >
            {activeCount}/{data.seatLimit}
          </KpiCell>

          <KpiCell label="BURN" hint="OPT-IN ESTIMATES">
            {data.board.burnPilots > 0 ? (
              <BurnUsd value={data.board.burnUsd} />
            ) : (
              <span className="deck-faint">—</span>
            )}
          </KpiCell>
        </div>

        <div className={`deck-body ${operator ? 'deck-body-split' : ''}`}>
          <section
            id="deck-roster"
            className="deck-cell deck-cell-col deck-boot"
            aria-label="Squad roster"
          >
            <DeckBand
              label="SQUAD ROSTER"
              note={
                <>
                  <span
                    className="flex gap-px"
                    role="img"
                    aria-label={`${data.seatsUsed} of ${data.seatLimit} seats used`}
                  >
                    {Array.from({ length: data.seatLimit }, (_, i) => (
                      <span
                        key={i}
                        className={`h-3 w-2 ${i < data.seatsUsed ? 'deck-seat-on' : 'deck-seat-off'}`}
                      />
                    ))}
                  </span>
                  <span className="tabular-nums">
                    {activeCount} ACTIVE · {pendingCount} PENDING
                  </span>
                </>
              }
            />

            {orderedRoster.length === 0 ? (
              <div className="deck-empty">
                <div className="deck-empty-title">[ NO PILOTS SIGNED ]</div>
                <p className="deck-empty-copy">
                  Open the roster lamp so pilots can apply, or invite them by callsign from the
                  roster console.
                </p>
              </div>
            ) : (
              <ul aria-label="Squad roster">
                {orderedRoster.map((entry, index) => (
                  <RosterRow
                    key={entry.affiliationId}
                    entry={entry}
                    index={index}
                    selected={entry.affiliationId === selectedAffiliation}
                    canManageRoles={data.authority === 'team-account'}
                    ownersFull={ownersFull}
                    roleBusy={roleBusy !== null}
                    onSelect={() => setSelectedId(entry.affiliationId)}
                    onRoleChange={(role) => void changeRole(entry, role)}
                  />
                ))}
              </ul>
            )}

            {orderedRoster.length > 0 && (
              <OpenSeats from={orderedRoster.length} seatLimit={data.seatLimit} />
            )}

            {selectedEntry && <PilotDossier entry={selectedEntry} rank={selectedIndex + 1} />}
          </section>

          {operator && (
            <div className="deck-rail">
              <div id="deck-transfers" className="deck-cell deck-boot">
                <DeckBand
                  label="INBOUND TRANSFERS"
                  note={
                    seatsFull ? (
                      <span style={{ color: 'rgb(var(--lb-down))' }}>
                        ALL SEATS FILLED — FREE A SEAT TO SIGN
                      </span>
                    ) : (
                      <span className="tabular-nums">{data.applications.length} WAITING</span>
                    )
                  }
                />

                {data.applications.length === 0 ? (
                  <div className="deck-empty">
                    <div className="deck-empty-title">[ NO INBOUND TRANSFERS ]</div>
                    <p className="deck-empty-copy">
                      Pilots apply from the HIRING tab on the team board.
                      {!data.recruiting &&
                        ' Your roster lamp is dark — nobody can file one right now.'}
                    </p>
                  </div>
                ) : (
                  <ul className="max-h-[380px] overflow-y-auto overscroll-contain">
                    {data.applications.map((app) => (
                      <ApplicationRow
                        key={app.applicationId}
                        app={app}
                        bar={data.bar}
                        seatsFull={seatsFull}
                        approved={data.approved}
                        busyAction={appBusy?.id === app.applicationId ? appBusy.action : null}
                        onDecide={(action) => void decide(app, action)}
                      />
                    ))}
                  </ul>
                )}
              </div>

              <section id="deck-bar" className="deck-cell deck-boot" aria-label="Hiring bar">
                <DeckBand
                  label="HIRING BAR"
                  note={
                    hasBar(data.bar) ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {hiringBarChips(data.bar).map((chip) => (
                          <span key={chip} className="deck-chip deck-chip-mute tabular-nums">
                            {chip}
                          </span>
                        ))}
                      </span>
                    ) : (
                      'NO BAR SET'
                    )
                  }
                />

                {BAR_METRICS.map((spec) => (
                  <BarMetricControl
                    key={spec.key}
                    spec={spec}
                    value={data.bar[spec.key]}
                    busy={barBusy}
                    onSet={(value) => void saveBar({ ...data.bar, [spec.key]: value })}
                  />
                ))}

                <div className="deck-metric-note">
                  SOFT SIGNAL — APPLICANTS ARE STAMPED AGAINST THE BAR, NEVER BLOCKED BY IT
                </div>
              </section>
            </div>
          )}
        </div>

        <footer className="deck-cell deck-foot deck-boot">
          <span className="deck-foot-readouts">
            <span>SYS // NO ERROR</span>
            <span>
              SEATS {String(data.seatsUsed).padStart(2, '0')}/{data.seatLimit}
            </span>
            {operator && <span>QUEUE {String(data.applications.length).padStart(2, '0')}</span>}
          </span>
          {operator ? (
            <span className="deck-foot-note">
              TRANSFER REQUESTS DON&apos;T HOLD A SEAT — CAP CHECKED ON SIGN
            </span>
          ) : (
            <span className="deck-foot-note">READ ONLY</span>
          )}
        </footer>
        </div>
      </div>
    </div>
  )
}
