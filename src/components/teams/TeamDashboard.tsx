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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  clampShare,
  deckTitle,
  initialSector,
  isDeckOperator,
  kpiChars,
  kpiText,
  nextTabIndex,
  orderRoster,
  pad2,
  resolveSector,
  resolveSelection,
  seatMap,
  sectorLabel,
  sectorsFor,
  type DeckAuthority,
  type DeckSector
} from './deckModel'
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
  authority: DeckAuthority
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

  // The server never emits a blank callsign (teamRoster falls back to
  // User<id>), but a bare "@" with an href of /u/ is worth guarding.
  const callsign = (row: Record<string, unknown>) =>
    typeof row.username === 'string' && row.username.trim() !== ''
      ? row.username
      : `User${Number(row.userId) || 0}`

  const roster: DashboardRosterEntry[] = Array.isArray(body.roster)
    ? (body.roster as Record<string, unknown>[]).map((row) => ({
        affiliationId: Number(row.affiliationId) || 0,
        status: row.status === 'active' ? 'active' : 'pending',
        role: row.role === 'owner' ? 'owner' : 'member',
        userId: Number(row.userId) || 0,
        username: callsign(row),
        name: typeof row.name === 'string' ? row.name : '',
        avatar: typeof row.avatar === 'string' ? row.avatar : null,
        score: Number(row.score) || 0,
        share: clampShare(Number(row.share)),
        invitedAt: typeof row.invitedAt === 'string' ? row.invitedAt : '',
        acceptedAt: typeof row.acceptedAt === 'string' ? row.acceptedAt : null
      }))
    : []

  const applications: DashboardApplication[] = Array.isArray(body.applications)
    ? (body.applications as Record<string, unknown>[]).map((row) => ({
        applicationId: Number(row.applicationId) || 0,
        userId: Number(row.userId) || 0,
        username: callsign(row),
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
    seatLimit: Math.max(1, Math.floor(Number(body.seatLimit) || 10)),
    seatsUsed: Math.max(0, Math.floor(Number(body.seatsUsed) || 0)),
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

/* ================= sectors (the rail's tablist) ================= */

/** Members only ever hold the roster sector, so they get no tablist at
 *  all (a one-tab strip is a button that does nothing). On phones the
 *  columns stack and the non-roster sectors take the whole body, so the
 *  same tabs drive both layouts. Sector model: deckModel.ts. */
function SectorTabs({
  sectors,
  active,
  queue,
  onChange
}: {
  sectors: DeckSector[]
  active: DeckSector
  /** Waiting transfer requests — lit as a count on the TRANSFERS tab. */
  queue: number
  onChange: (sector: DeckSector) => void
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // WAI-ARIA tabs with automatic activation: arrows move focus AND
  // selection so a keyboard user never lands on an inert tab.
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(event.key, index, sectors.length)
    if (next === null) return
    event.preventDefault()
    onChange(sectors[next])
    tabRefs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label="Deck sectors" className="deck-tabs">
      {sectors.map((sector, index) => {
        const selected = sector === active
        const count = sector === 'transfers' ? queue : 0
        return (
          <button
            key={sector}
            ref={(el) => {
              tabRefs.current[index] = el
            }}
            type="button"
            role="tab"
            id={`deck-tab-${sector}`}
            aria-selected={selected}
            aria-controls="deck-sector-panel"
            tabIndex={selected ? 0 : -1}
            className={`deck-tab ${selected ? 'deck-tab-on' : ''}`}
            onClick={() => onChange(sector)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span aria-hidden className="deck-tab-dot" />
            {sectorLabel(sector)}
            {count > 0 && (
              <span className="deck-tab-count" aria-label={`${count} waiting`}>
                {pad2(count)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ================= KPI cells ================= */

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
    </>
  )
}

/** Section band. The bracketed label is a real heading so screen-reader
 *  users can jump between sectors; `id` lets a panel point aria-labelledby
 *  at it and lets a mutation return focus here after its button unmounts. */
function DeckBand({
  id,
  label,
  note,
  headingRef
}: {
  id?: string
  label: string
  note?: React.ReactNode
  headingRef?: React.Ref<HTMLHeadingElement>
}) {
  return (
    <div className="deck-band">
      <h2 id={id} ref={headingRef} tabIndex={-1} className="deck-band-title">
        [ {label} ]
      </h2>
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
          its SET key, all sharing hairlines instead of floating apart.
          The picks are mutually exclusive, so they're a radiogroup rather
          than three independent toggles. */}
      <form
        className="deck-seg"
        aria-label={`${spec.label} threshold`}
        onSubmit={(event) => {
          event.preventDefault()
          submitDraft()
        }}
      >
        <div role="radiogroup" aria-label={`${spec.label} quick picks`} className="deck-seg-picks">
          {spec.quickPicks.map((pick) => (
            <button
              key={pick}
              type="button"
              role="radio"
              disabled={busy}
              onClick={() => onSet(pick)}
              aria-checked={value === pick}
              className="deck-seg-pick disabled:cursor-wait disabled:opacity-60"
            >
              {spec.format(pick)}
            </button>
          ))}
        </div>
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
      return 'deck-chip-up'
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

/** One roster line. Role controls live in the dossier rail, not here —
 *  the row stays a pure readout so every line shares one width budget
 *  and the franchise login sees the same list the owners do. */
function RosterRow({
  entry,
  index,
  selected,
  onSelect
}: {
  entry: DashboardRosterEntry
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const pendingRow = entry.status === 'pending'
  const share = clampShare(entry.share)
  const monogram = entry.username.charAt(0).toUpperCase() || '?'
  return (
    <li>
      <div
        className={`deck-pilot ${selected ? 'deck-pilot-on' : ''} ${
          pendingRow ? 'deck-pilot-pending' : ''
        }`}
        role="button"
        aria-pressed={selected}
        aria-label={`${pendingRow ? 'Pending invite' : `Pilot ${pad2(index + 1)}`} @${entry.username} — read out dossier`}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          // Only when the row itself has focus — the nested profile link
          // keeps its own Enter/Space.
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect()
          }
        }}
      >
        <span className="deck-rank">{pendingRow ? '··' : pad2(index + 1)}</span>

        <span className="deck-avatar">
          <Avatar
            src={entry.avatar}
            char={monogram}
            handle={entry.username}
            imgClassName="h-full w-full object-cover"
            fallbackClassName="deck-avatar-fallback"
          />
        </span>

        <div className="deck-pilot-id">
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

        {/* the share bar soaks up the row's slack so the list reads as a
            contribution chart, not a table with a hole in it */}
        <span
          className="deck-pilot-share"
          role="img"
          aria-label={`${share}% of the squad score`}
          title={`${share}% of the squad score`}
        >
          <span className="deck-share-track">
            <span
              className="deck-share-fill"
              style={{ width: `${share}%`, opacity: share > 0 ? 1 : 0 }}
            />
          </span>
          <span className="deck-share-pct">{share}%</span>
        </span>

        <span className="deck-pilot-score">{formatNumber(entry.score)}</span>
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
  const ref = useRef<HTMLDivElement>(null)
  // The bottom fade only earns its place when slots are actually clipped;
  // on a short roster the strip has room and a fade would just look like
  // a rendering glitch over the last seat.
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])
  if (open === 0) return null
  return (
    <div ref={ref} className={`deck-slots ${clipped ? 'deck-slots-clipped' : ''}`} aria-hidden>
      {Array.from({ length: open }, (_, i) => (
        <div key={i} className="deck-slot">
          <span className="deck-rank">{pad2(from + i + 1)}</span>
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

/** The ROSTER sector's rail: whichever row is lit gets read out in full
 *  (NieR status-panel grammar — list left, dossier right). Pure display
 *  over roster fields the row already carries. */
function DossierPanel({
  entry,
  rank,
  canManageRoles,
  approved,
  ownersFull,
  roleBusy,
  onRoleChange
}: {
  entry: DashboardRosterEntry | null
  rank: number
  /** True only on the franchise login — owners never see role controls. */
  canManageRoles: boolean
  approved: boolean
  ownersFull: boolean
  roleBusy: boolean
  onRoleChange: (role: TeamRole) => void
}) {
  if (!entry) {
    return (
      <section className="deck-cell deck-cell-col" aria-labelledby="deck-dossier-title">
        <DeckBand id="deck-dossier-title" label="PILOT DOSSIER" />
        <div className="deck-empty">
          <div className="deck-empty-title">[ NO PILOT LIT ]</div>
          <p className="deck-empty-copy">Sign a pilot and their record reads out here.</p>
        </div>
      </section>
    )
  }

  const pending = entry.status === 'pending'
  const displayName = entry.name.trim() || entry.username
  const share = clampShare(entry.share)
  const monogram = entry.username.charAt(0).toUpperCase() || '?'
  // Mirrors /api/team/roster: franchise login only, and the API 403s
  // until review clears — so the key is absent, not a button that
  // always fails. The lock reason reads out under the actions instead.
  const roleControl =
    canManageRoles && approved && !pending ? (
      entry.role === 'owner' ? (
        <button
          type="button"
          disabled={roleBusy}
          aria-busy={roleBusy}
          onClick={() => onRoleChange('member')}
          className={`deck-btn deck-btn-quiet deck-btn-hard deck-dossier-cta disabled:cursor-wait disabled:opacity-60 ${
            roleBusy ? 'deck-btn-busy' : ''
          }`}
        >
          DEMOTE TO MEMBER
        </button>
      ) : (
        <button
          type="button"
          disabled={roleBusy || ownersFull}
          aria-busy={roleBusy}
          aria-label={
            ownersFull
              ? `Promote @${entry.username} to owner — all ${TEAM_OWNER_LIMIT} owner seats held`
              : `Promote @${entry.username} to owner`
          }
          title={ownersFull ? `ALL ${TEAM_OWNER_LIMIT} OWNER SEATS HELD` : undefined}
          onClick={() => onRoleChange('owner')}
          className={`deck-btn deck-btn-quiet deck-btn-hard deck-btn-gold deck-dossier-cta disabled:cursor-not-allowed disabled:opacity-40 ${
            roleBusy ? 'deck-btn-busy' : ''
          }`}
        >
          PROMOTE TO OWNER
        </button>
      )
    ) : null
  const roleLock =
    canManageRoles && !approved && !pending
      ? 'ROLE KEYS UNLOCK ONCE THE TEAM PASSES REVIEW'
      : canManageRoles && approved && !pending && entry.role !== 'owner' && ownersFull
        ? `ALL ${TEAM_OWNER_LIMIT} OWNER SEATS HELD`
        : null

  // A region, not a live region: the row that lit this panel is a
  // toggle button, so the reader already announced the change — echoing
  // the whole dossier on every click is noise.
  return (
    <section
      className="deck-cell deck-cell-col deck-dossier"
      aria-labelledby="deck-dossier-title"
    >
      <DeckBand
        id="deck-dossier-title"
        label="PILOT DOSSIER"
        note={
          <span className="tabular-nums">
            PILOT {pending ? '··' : pad2(rank)} · {rosterRole(entry)}
          </span>
        }
      />
      <div className="deck-dossier-body" key={entry.affiliationId}>
        <div className="deck-dossier-head">
          <span className="deck-avatar deck-avatar-xl">
            <Avatar
              src={entry.avatar}
              char={monogram}
              handle={entry.username}
              px={160}
              imgClassName="h-full w-full object-cover"
              fallbackClassName="deck-avatar-fallback"
            />
          </span>
          <div className="min-w-0">
            <p className="deck-dossier-name">{displayName}</p>
            <div className="deck-dossier-sub">
              @{entry.username} · {pending ? 'INVITED' : 'SIGNED'}{' '}
              {formatRelative(pending ? entry.invitedAt : entry.acceptedAt)}
            </div>
          </div>
        </div>

        <dl className="deck-dossier-grid">
          <div>
            <dt>Season pts</dt>
            <dd>{formatNumber(entry.score)}</dd>
          </div>
          <div>
            <dt>Squad share</dt>
            <dd>{share}%</dd>
          </div>
          <div>
            <dt>Seat</dt>
            <dd>{pending ? '··' : pad2(rank)}</dd>
          </div>
        </dl>

        <div className="deck-dossier-bar" role="img" aria-label={`${share}% of the squad score`}>
          <span className="deck-share-track">
            <span className="deck-share-fill" style={{ width: `${share}%` }} />
          </span>
        </div>

        <div className="deck-dossier-actions">
          <Link
            href={`/u/${encodeURIComponent(entry.username)}`}
            className="deck-btn deck-btn-quiet deck-btn-hard deck-dossier-cta"
          >
            OPEN PROFILE →
          </Link>
          {roleControl}
          {roleLock && <span className="deck-dossier-lock">{roleLock}</span>}
        </div>
      </div>
    </section>
  )
}

/* ================= squad telemetry (roster sector, lower rail) ================= */

/** Squad-level readouts under the dossier: the contribution split as one
 *  segmented bar (lit pilot in gold) and the seat map. Both are pure
 *  functions of the roster the list already renders — no extra fetch. */
function TelemetryPanel({
  roster,
  selectedId,
  seatLimit,
  seatsUsed,
  onSelect
}: {
  roster: DashboardRosterEntry[]
  selectedId: number | null
  seatLimit: number
  seatsUsed: number
  onSelect: (affiliationId: number) => void
}) {
  // `roster` arrives already ordered (actives by score, then pendings).
  const actives = roster.filter((entry) => entry.status === 'active')
  const splitTotal = actives.reduce((sum, entry) => sum + clampShare(entry.share), 0)
  const openSeats = Math.max(0, seatLimit - seatsUsed)
  const seats = seatMap(roster, seatLimit)

  return (
    <div className="deck-cell deck-cell-col deck-telemetry">
      <DeckBand
        label="SQUAD TELEMETRY"
        note={<span className="tabular-nums">{actives.length} CONTRIBUTING</span>}
      />

      <div className="deck-tele-block">
        <div className="deck-tele-head">
          <span>SQUAD SPLIT</span>
          <span className="tabular-nums">{splitTotal > 0 ? `${splitTotal}%` : '—'}</span>
        </div>
        {actives.length > 0 && splitTotal > 0 ? (
          <>
            <div className="deck-split" role="img" aria-label="Contribution split across signed pilots">
              {actives.map((entry, index) => {
                const share = clampShare(entry.share)
                return share > 0 ? (
                  <span
                    key={entry.affiliationId}
                    className={`deck-split-seg ${
                      entry.affiliationId === selectedId ? 'deck-split-seg-on' : ''
                    }`}
                    style={{ flexGrow: share }}
                    title={`${pad2(index + 1)} @${entry.username} · ${share}%`}
                  />
                ) : null
              })}
            </div>
            <div className="deck-split-legend">
              {actives.map((entry, index) => (
                <button
                  key={entry.affiliationId}
                  type="button"
                  onClick={() => onSelect(entry.affiliationId)}
                  aria-pressed={entry.affiliationId === selectedId}
                  className={`deck-split-key ${
                    entry.affiliationId === selectedId ? 'deck-split-key-on' : ''
                  }`}
                >
                  <span aria-hidden className="deck-split-swatch" />
                  {pad2(index + 1)} · {clampShare(entry.share)}%
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="deck-tele-empty">NO SEASON POINTS ON THE BOARD YET</div>
        )}
      </div>

      <div className="deck-tele-block">
        <div className="deck-tele-head">
          <span>SEAT MAP</span>
          <span className="tabular-nums">
            {pad2(seatsUsed)}/{seatLimit} · {openSeats} OPEN
          </span>
        </div>
        <ul className="deck-seatmap" aria-label="Seat map">
          {seats.map((seat, index) => {
            const entry = seat.entry
            if (!entry) {
              return (
                <li key={`open-${index}`}>
                  <span aria-label={`Seat ${pad2(index + 1)} open`} className="deck-seat deck-seat-open">
                    {pad2(index + 1)}
                  </span>
                </li>
              )
            }
            const lit = entry.affiliationId === selectedId
            return (
              <li key={entry.affiliationId}>
                <button
                  type="button"
                  aria-label={`Seat ${pad2(index + 1)} · @${entry.username} · ${
                    seat.kind === 'pending' ? 'pending invite' : 'signed'
                  }`}
                  aria-pressed={lit}
                  onClick={() => onSelect(entry.affiliationId)}
                  className={`deck-seat deck-seat-${seat.kind} ${lit ? 'deck-seat-lit' : ''}`}
                >
                  {pad2(index + 1)}
                </button>
              </li>
            )
          })}
        </ul>
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
      return { title: 'TRANSFER PASSED', body: `@${username}’s request was declined.` }
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
  // stays live either way — clearing dead requests needs no review. The
  // reason also rides in the aria-label: `title` never reaches a disabled
  // button's reader or a touch screen.
  const signLock = !approved
    ? 'SIGNING UNLOCKS ONCE YOUR TEAM PASSES REVIEW'
    : seatsFull
      ? 'ALL SEATS FILLED'
      : null
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

        {/* labels stay constant while busy (the ellipsis was a mid-flight
            name change for readers); aria-busy carries the state instead */}
        <div className="deck-app-actions">
          <button
            type="button"
            disabled={busy || signLock !== null}
            aria-busy={busyAction === 'accept'}
            aria-label={`Sign @${app.username}${signLock ? ` — ${signLock.toLowerCase()}` : ''}`}
            title={signLock ?? undefined}
            onClick={() => onDecide('accept')}
            className={`deck-btn deck-btn-primary deck-btn-hard disabled:cursor-not-allowed disabled:opacity-40 ${
              busyAction === 'accept' ? 'deck-btn-busy' : ''
            }`}
          >
            SIGN
          </button>
          <button
            type="button"
            disabled={busy}
            aria-busy={busyAction === 'decline'}
            aria-label={`Pass on @${app.username}`}
            onClick={() => onDecide('decline')}
            className={`deck-btn deck-btn-quiet deck-btn-rose disabled:cursor-wait disabled:opacity-60 ${
              busyAction === 'decline' ? 'deck-btn-busy' : ''
            }`}
          >
            PASS
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
  // Per-application, so two SIGNs in flight each show their own cursor.
  const [appBusy, setAppBusy] = useState<ReadonlyMap<number, SignAction>>(() => new Map())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  /** Last mutation that failed to settle — the footer's SYS readout goes
   *  red on it, so a swallowed refresh never leaves the deck lying. */
  const [sysError, setSysError] = useState<string | null>(null)
  const operator = isDeckOperator(data.authority)
  const sectors = useMemo(() => sectorsFor(operator), [operator])
  const [sector, setSector] = useState<DeckSector>(() =>
    initialSector(operator, initial.applications.length)
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const transfersHeadingRef = useRef<HTMLHeadingElement>(null)
  // Monotonic counter: any mutation started after a refresh was fired
  // makes that refresh's payload stale, so it is dropped on arrival.
  const mutationSeq = useRef(0)

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
  const orderedRoster = useMemo(() => orderRoster(data.roster), [data.roster])
  const { entry: selectedEntry, index: selectedIndex } = resolveSelection(
    orderedRoster,
    selectedId
  )
  const selectedAffiliation = selectedEntry?.affiliationId ?? null
  const activeSector = resolveSector(sector, sectors)

  /** Lighting a pilot always brings the dossier up — the row IS the
   *  master, the rail its detail. */
  const lightPilot = useCallback((affiliationId: number) => {
    setSelectedId(affiliationId)
    setSector('roster')
  }, [])

  useDeckMotion(rootRef, {
    score: data.board.score,
    recruiting: data.recruiting,
    selectedKey: selectedAffiliation,
    sector: activeSector
  })

  // KPI numerals share one pixel-font size fitted to the longest value,
  // so the four cells read as one instrument and nothing ever ellipsizes
  // (the old vw clamp cut "81,533" to "81,5…" on a 4xl deck).
  const kpi = kpiText({
    score: data.board.score,
    rank: data.board.rank,
    activeCount,
    seatLimit: data.seatLimit,
    burnUsd: data.board.burnUsd,
    burnPilots: data.board.burnPilots
  })
  const kpiFit = kpiChars(kpi)

  /** Resync after a SIGN — the accept response carries seatsUsed but not
   *  the new member's roster share, so refetch. Only the roster-side
   *  fields are merged: a stale read must never clobber an optimistic
   *  lamp or bar flip that landed while this request was in flight, and
   *  any mutation started after the fetch makes the whole payload stale. */
  const refresh = useCallback(async () => {
    const seq = mutationSeq.current
    try {
      const res = await fetch('/api/team/dashboard', {
        cache: 'no-store',
        credentials: 'include'
      })
      const payload = res.ok ? await res.json().catch(() => null) : null
      const next = payload?.success ? parseTeamDashboard(payload) : null
      if (!next) {
        setSysError('ROSTER RESYNC FAILED')
        return
      }
      if (mutationSeq.current !== seq) return
      setData((prev) => ({
        ...prev,
        roster: next.roster,
        applications: next.applications,
        seatsUsed: next.seatsUsed,
        seatLimit: next.seatLimit,
        board: next.board
      }))
      setSysError(null)
    } catch {
      setSysError('ROSTER RESYNC FAILED')
    }
  }, [])

  const toggleRecruiting = useCallback(async () => {
    if (recruitingBusy) return
    const next = !data.recruiting
    mutationSeq.current += 1
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
          ? data.approved
            ? 'Pilots can file transfer requests from the HIRING tab on the team board.'
            : 'Requests queue here; signing unlocks once your team passes review.'
          : 'New transfer requests are refused while the lamp is dark.'
      })
    } catch {
      setData((prev) => ({ ...prev, recruiting: !next }))
      toast({ kind: 'error', title: 'LAMP STUCK', body: 'Could not flip the roster lamp. Try again.' })
    } finally {
      setRecruitingBusy(false)
    }
  }, [data.approved, data.recruiting, recruitingBusy])

  /** One whole-bar write per interaction — the PATCH carries all three
   *  metrics, so an optimistic rollback restores exactly what stood. */
  const saveBar = useCallback(
    async (next: HiringBar) => {
      if (barBusy) return
      const previous = data.bar
      mutationSeq.current += 1
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
      mutationSeq.current += 1
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
      if (appBusy.has(app.applicationId)) return
      mutationSeq.current += 1
      setAppBusy((prev) => new Map(prev).set(app.applicationId, action))
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
            action === 'accept' && Number.isFinite(nextSeats) && nextSeats >= 0
              ? nextSeats
              : prev.seatsUsed
        }))
        toast({ kind: 'success', ...decisionToast(action, app.username) })
        requestNotificationsRefresh()
        // The button that had focus is about to unmount with its row;
        // park focus on the sector heading so keyboard users don't get
        // dumped at <body>.
        transfersHeadingRef.current?.focus({ preventScroll: true })
        // The signed pilot's roster row (score, share) needs a real read.
        if (action === 'accept') void refresh()
      } catch {
        toast({ kind: 'error', title: 'ACTION FAILED', body: 'Could not update the transfer. Try again.' })
      } finally {
        setAppBusy((prev) => {
          const next = new Map(prev)
          next.delete(app.applicationId)
          return next
        })
      }
    },
    [appBusy, refresh]
  )

  const lamp = reviewLamp(data.reviewStatus)
  const teamMonogram = data.team.username.charAt(0).toUpperCase() || '?'

  /** The rail's content for the lit sector. Keyed by sector in the JSX so
   *  a switch remounts the panel and the motion hook can slide it in. */
  const railPanel = (() => {
    switch (activeSector) {
      case 'roster':
        return (
          <>
            <DossierPanel
              entry={selectedEntry}
              rank={selectedIndex + 1}
              canManageRoles={data.authority === 'team-account'}
              approved={data.approved}
              ownersFull={ownersFull}
              roleBusy={roleBusy !== null}
              onRoleChange={(role) => {
                if (selectedEntry) void changeRole(selectedEntry, role)
              }}
            />
            <TelemetryPanel
              roster={orderedRoster}
              selectedId={selectedAffiliation}
              seatLimit={data.seatLimit}
              seatsUsed={data.seatsUsed}
              onSelect={lightPilot}
            />
          </>
        )
      case 'transfers':
        return (
          <section className="deck-cell deck-cell-col" aria-labelledby="deck-transfers-title">
            <DeckBand
              id="deck-transfers-title"
              headingRef={transfersHeadingRef}
              label="INBOUND TRANSFERS"
              note={
                // the two SIGN locks, surfaced where the whole queue can
                // see them instead of only in a disabled button's tooltip
                !data.approved ? (
                  <span style={{ color: 'rgb(var(--lb-gold))' }}>
                    SIGNING LOCKED UNTIL REVIEW CLEARS · PASS STAYS LIVE
                  </span>
                ) : seatsFull ? (
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
                  {!data.recruiting && ' Your roster lamp is dark — nobody can file one right now.'}
                </p>
              </div>
            ) : (
              <ul className="deck-queue" aria-label="Transfer requests">
                {data.applications.map((app) => (
                  <ApplicationRow
                    key={app.applicationId}
                    app={app}
                    bar={data.bar}
                    seatsFull={seatsFull}
                    approved={data.approved}
                    busyAction={appBusy.get(app.applicationId) ?? null}
                    onDecide={(action) => void decide(app, action)}
                  />
                ))}
              </ul>
            )}
            {/* the bar every request above is stamped against, one tap
                from editing it — sits at the compartment's foot */}
            <div className="deck-panel-foot">
              <span className="deck-panel-foot-label">
                {hasBar(data.bar) ? 'STAMPED AGAINST' : 'NO BAR PUBLISHED'}
              </span>
              <span className="deck-panel-foot-chips">
                {hasBar(data.bar) ? (
                  hiringBarChips(data.bar).map((chip) => (
                    <span key={chip} className="deck-chip deck-chip-mute tabular-nums">
                      {chip}
                    </span>
                  ))
                ) : (
                  <span className="deck-faint">REQUESTS ARRIVE UNSTAMPED</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setSector('bar')}
                className="deck-btn deck-btn-sm deck-btn-quiet"
              >
                {hasBar(data.bar) ? 'EDIT BAR →' : 'SET A BAR →'}
              </button>
            </div>
          </section>
        )
      case 'bar':
        return (
          <section className="deck-cell deck-cell-col" aria-labelledby="deck-bar-title">
            <DeckBand
              id="deck-bar-title"
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
        )
      default: {
        const exhaustive: never = activeSector
        return exhaustive
      }
    }
  })()

  return (
    <div
      ref={rootRef}
      className="command-deck page-zoom-out mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6"
    >
      {/* masthead: what this screen is (left) and whose it is (right) */}
      <header className="deck-mast deck-boot">
        <div className="min-w-0">
          <h1 className="deck-title select-none">{deckTitle(data.authority)}</h1>
          <div className="deck-kicker">COMPANY OPERATIONS</div>
        </div>

        <div className="deck-nameplate">
          <span className="deck-mark">
            <Avatar
              src={data.team.avatar}
              char={teamMonogram}
              handle={data.team.username}
              px={120}
              imgClassName="h-full w-full object-cover"
              fallbackClassName="deck-mark-fallback"
            />
          </span>
          <div className="min-w-0">
            <div className="deck-nameplate-line">
              <span className="deck-nameplate-name">{data.team.name}</span>
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
            <div className="deck-nameplate-sub">
              @{data.team.username} · UP TO {data.seatLimit} PILOTS
            </div>
          </div>
        </div>
      </header>
      <span aria-hidden className="deck-rule deck-rule-gold" />

      <div className="relative">
        <FrameMarks />
        <div className="deck-shell">
          {/* ---- instrument band ---- */}
          <div
            className="deck-kpi-row deck-boot"
            style={{ '--kpi-chars': kpiFit } as React.CSSProperties}
          >
            <KpiCell
              label="SQUAD SCORE"
              valueStyle={{ color: 'rgb(var(--lb-score))' }}
              hint={data.board.rank !== null ? 'SEASON TO DATE' : 'NOT ON THE BOARD YET'}
              tick
              accent
            >
              {kpi.score}
            </KpiCell>

            <KpiCell
              label="BOARD RANK"
              hint={data.board.teams > 0 ? `OF ${formatNumber(data.board.teams)} TEAMS` : 'NO TEAMS RANKED'}
            >
              {data.board.rank !== null ? kpi.rank : <span className="deck-faint">—</span>}
            </KpiCell>

            <KpiCell
              label="ACTIVE PILOTS"
              hint={
                pendingCount > 0
                  ? `${pendingCount} PENDING · ${Math.max(0, data.seatLimit - data.seatsUsed)} OPEN`
                  : `${Math.max(0, data.seatLimit - data.seatsUsed)} SEATS OPEN`
              }
            >
              {kpi.pilots}
            </KpiCell>

            <KpiCell label="BURN" hint="OPT-IN ESTIMATES">
              {data.board.burnPilots > 0 ? (
                <BurnUsd value={data.board.burnUsd} />
              ) : (
                <span className="deck-faint">—</span>
              )}
            </KpiCell>
          </div>

          {/* ---- control row: authority + actions, and the sector tabs
                  sitting over the rail they drive ---- */}
          <div className={`deck-control deck-boot ${sectors.length > 1 ? '' : 'deck-control-solo'}`}>
            <div className="deck-control-lead">
              <span className="deck-plate">{operator ? 'OPERATOR' : 'READ ONLY'}</span>
              {operator ? (
                <div className="deck-actions">
                  {/* the label already names the state (OPEN ROSTER /
                      ROSTER CLOSED), so no aria-pressed — a reader would
                      otherwise say "ROSTER CLOSED, not pressed" */}
                  <button
                    type="button"
                    onClick={() => void toggleRecruiting()}
                    disabled={recruitingBusy}
                    aria-busy={recruitingBusy}
                    aria-label={
                      data.recruiting
                        ? 'Roster open — close it to refuse new transfer requests'
                        : 'Roster closed — open it so pilots can file transfer requests'
                    }
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
              ) : (
                <div className="deck-actions">
                  <Link href="/leaderboard?view=teams" className="deck-btn deck-btn-quiet deck-btn-hard">
                    TEAMS BOARD →
                  </Link>
                </div>
              )}
            </div>
            {sectors.length > 1 && (
              <div className="deck-control-tabs">
                <SectorTabs
                  sectors={sectors}
                  active={activeSector}
                  queue={data.applications.length}
                  onChange={setSector}
                />
              </div>
            )}
          </div>

          {/* ---- body: roster list pinned left, lit sector on the rail ---- */}
          <div className="deck-body deck-body-split" data-sector={activeSector}>
            <section
              className="deck-cell deck-cell-col deck-roster deck-boot"
              aria-labelledby="deck-roster-title"
            >
              <DeckBand
                id="deck-roster-title"
                label="SQUAD ROSTER"
                note={
                  <>
                    <span
                      className="deck-gauge"
                      role="img"
                      aria-label={`${data.seatsUsed} of ${data.seatLimit} seats used`}
                    >
                      {Array.from({ length: data.seatLimit }, (_, i) => (
                        <span key={i} className={i < data.seatsUsed ? 'deck-seat-on' : 'deck-seat-off'} />
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
                    {operator
                      ? 'Open the roster lamp so pilots can apply, or invite them by callsign from the roster console.'
                      : 'Nobody has signed with this team yet.'}
                  </p>
                </div>
              ) : (
                <ul aria-label="Signed pilots">
                  {orderedRoster.map((entry, index) => (
                    <RosterRow
                      key={entry.affiliationId}
                      entry={entry}
                      index={index}
                      selected={entry.affiliationId === selectedAffiliation}
                      onSelect={() => lightPilot(entry.affiliationId)}
                    />
                  ))}
                </ul>
              )}

              <OpenSeats from={orderedRoster.length} seatLimit={data.seatLimit} />
            </section>

            <div
              key={activeSector}
              id="deck-sector-panel"
              className="deck-rail deck-boot"
              data-deck-rail
              {...(sectors.length > 1
                ? { role: 'tabpanel', 'aria-labelledby': `deck-tab-${activeSector}` }
                : {})}
            >
              {railPanel}
            </div>
          </div>

          {/* a div, not <footer>: the page already owns a contentinfo
              landmark in the shell, and this strip is deck status, not
              site-level information */}
          <div className="deck-cell deck-foot deck-boot">
            <span className="deck-foot-readouts">
              {/* SYS is the one honest line on the deck: a swallowed
                  resync turns it red rather than pretending NO ERROR */}
              <span
                role="status"
                className={sysError ? 'deck-foot-alarm' : undefined}
                title={sysError ? 'The last roster resync did not land; the deck may be behind.' : undefined}
              >
                SYS // {sysError ?? 'NO ERROR'}
              </span>
              <span>SEATS {pad2(data.seatsUsed)}/{data.seatLimit}</span>
              {operator && <span>QUEUE {pad2(data.applications.length)}</span>}
              <span>SECTOR {sectorLabel(activeSector)}</span>
            </span>
            {operator ? (
              <span className="deck-foot-note">
                TRANSFER REQUESTS DON’T HOLD A SEAT — CAP CHECKED ON SIGN
              </span>
            ) : (
              <span className="deck-foot-note">READ ONLY</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
