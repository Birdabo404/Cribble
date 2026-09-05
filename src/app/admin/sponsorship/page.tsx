'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AdminAvatar,
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminList,
  AdminNotice,
  AdminSection,
  AdminSkeletonList,
  AdminTabs,
  ReasonDialog,
  SponsorshipBoardPreview,
  formatDate,
  useAdmin,
  type AdminChipTone,
  type AdminTabItem
} from '@/components/admin'
import { BillboardCard } from '@/components/billboard/BillboardCard'
import { BillboardPreviewStage } from '@/components/billboard/BillboardPreviewStage'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_MAX_LIVE,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  RAIL_SLOT_PRICE_CENTS,
  RAIL_SLOTS,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_OPENING_CENTS,
  formatSponsorUsd,
  leaderboardMinTargetCents
} from '@/lib/leaderboardSponsor'

// Billboard queue: a tabbed workspace over the buckets GET
// /api/admin/billboard serves — Review / Awaiting payment / Live /
// History, one on screen at a time under a sticky header carrying the
// server-computed counts (the same numbers the Overview KPIs render,
// so the two pages can never disagree) and flipper/rail occupancy.
// Acceptance (approve / reject / request changes) is moderator-floor
// work (billboard.review); the money levers — mark paid + go live,
// renew, archive — render for the owner only, matching the owner-only
// billboard.activate gate on their route. Three products share the
// queue. Flipper ads (capped at 8 concurrent) and profile-rail ads
// (one live ad per slot) close payment manually: approving emails the
// payment instructions to the ad's billing_email (X DM is the backup
// channel — the approve notice says which one to work); once payment
// closes, mark paid + go live. Rail activation picks a free slot from
// a picker whose occupancy derives client-side from the live bucket's
// rail_slot values — the server re-checks and answers 409 if the slot
// filled meanwhile. A rail ad may carry the buyer's
// requested_rail_slot — surfaced as a WANTS chip and preselected in
// the picker while free, but never binding: first confirmed payment
// wins the slot. Expired ads surface in History with the same
// activate controls relabelled as a renewal — payment is collected
// manually again and the activate route stamps a fresh window,
// keeping paid_at. Leaderboard creatives (migration 055) need review
// ONLY: approval opens self-serve Polar bidding and liveness derives
// from paid contributions in the rolling 24h window — no activate
// lever, no 7-day window, no slot. Their rows show the board standing
// the list route decorates them with (rank + active total), and
// archive stays the takedown; when every contribution has expired
// they ride the run-complete grace window at the top of History until
// the sweep archives them. The Review tab adds batch approval (the
// review-batch endpoint, one rate-limit hit for the whole selection)
// and a whole-board context preview staging queued creatives against
// what's live. Data silently refreshes every 60s and on window focus,
// paused while an action or dialog is in flight so form state never
// gets clobbered. Buyer-controlled fields (text, link_url, logo_url)
// are untrusted: text renders as plain text and link_url is shown
// verbatim for inspection, never as a clickable link.

interface AdOwner {
  userId: number
  username: string | null
  display_name: string
  avatar: string | null
}

interface AdRow {
  id: number
  owner_user_id: number | null
  /** Title line of the sub-banner; null on rows predating the field. */
  company_name: string | null
  text: string
  link_url: string
  logo_url: string | null
  /** #rrggbb extracted from the logo server-side; null = neutral strip. */
  accent_color: string | null
  /** Which product this card buys — the flipper strip or a profile rail. */
  placement: BillboardPlacement
  /** Rail slot code (L1-R4), stamped at activation; null until then and
   *  always null on flipper ads. */
  rail_slot: RailSlot | null
  /** The slot the buyer asked for at submission — a preference, never a
   *  hold. Null = any slot; always null on flipper ads. */
  requested_rail_slot: RailSlot | null
  /** Where the approval payment email goes; null (external sponsors,
   *  pre-040 rows) means no send — the deal closes on X instead. */
  billing_email: string | null
  status: BillboardStatus
  review_note: string | null
  reviewed_at: string | null
  paid_at: string | null
  starts_at: string | null
  ends_at: string | null
  clicks: number
  created_at: string
  updated_at: string
  owner: AdOwner | null
  /** Sponsor-board standing for leaderboard creatives — rank, active
   *  contribution total and the expiry pair, decorated by the list
   *  route from the same derivation the public board serves. Null
   *  while off the board (and on every leaderboard row when the board
   *  read degraded); always null on flipper/rail ads. */
  leaderboard: {
    rank: number
    activeCents: number
    nextDropAt: string
    expiresAt: string
  } | null
}

/** A leaderboard creative inside the run-complete grace window: still
 *  APPROVED and biddable, archived automatically at autoArchivesAt
 *  unless a new paid bid lands first. */
interface RunCompleteAdRow extends AdRow {
  autoArchivesAt: string
}

/** The server-computed number source both admin pages render verbatim. */
interface BillboardCounts {
  queue: number
  awaiting: number
  live: number
  runComplete: number
  flipperLive: number
  railLive: number
  maxFlipper: number
  maxRail: number
}

interface BillboardData {
  queue: AdRow[]
  awaiting: AdRow[]
  live: AdRow[]
  runComplete: RunCompleteAdRow[]
  recent: AdRow[]
  /** The sponsor-board decoration failed to load: bucketing is still
   *  correct (it derives from the bids aggregate) but leaderboard rows
   *  carry leaderboard: null — no rank facts. */
  boardDegraded: boolean
  /** Current total a challenger must reach to take #1. */
  leaderboardMinTargetCents: number
  counts: BillboardCounts
}

type DialogState =
  | { kind: 'reject'; ad: AdRow }
  | { kind: 'request_changes'; ad: AdRow }
  | { kind: 'archive'; ad: AdRow }

type BucketTab = 'review' | 'awaiting' | 'live' | 'history'

/** Why a fetch is running — initial paint owns the skeletons, action
 *  reloads surface errors, background refreshes stay silent. */
type LoadMode = 'initial' | 'action' | 'background'

/** Per-ad outcome roll-up of one review-batch call. */
interface BatchOutcome {
  approved: number
  emailsSent: number
  emailsFailed: number
  failures: Array<{ adId: number; error: string }>
}

const PAGE_DESCRIPTION = `Paid ad slots, three placements — the flipper train on the dashboard + leaderboard ($${BILLBOARD_PRICE_CENTS / 100}/wk, max ${BILLBOARD_MAX_LIVE} live), the always-on profile transmissions panel ($${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}–$${RAIL_SLOT_PRICE_CENTS.L1 / 100}/wk by row, ${RAIL_SLOTS.length} fixed slots), and the leaderboard sponsor board (rolling 24h Polar bids from ${formatSponsorUsd(LEADERBOARD_SPONSOR_OPENING_CENTS)}). Flipper + transmissions close payment manually: approving emails the instructions to the ad's billing address (X DM @${BILLBOARD_PAYMENT_X_HANDLE} as backup), then mark paid + go live — transmissions ads take their slot at activation. Leaderboard creatives only need review: bidding, payment and liveness run themselves.`

/** Mirrors the review-batch route's per-request ceiling. */
const BATCH_APPROVE_MAX = 25

const REFRESH_INTERVAL_MS = 60_000

function adChipMeta(ad: AdRow, expired: boolean): { label: string; tone: AdminChipTone } {
  if (expired) return { label: 'EXPIRED', tone: 'neutral' }
  switch (ad.status) {
    case 'PENDING':
      return { label: 'PENDING', tone: 'warn' }
    case 'CHANGES_REQUESTED':
      return { label: 'CHANGES REQUESTED', tone: 'info' }
    case 'APPROVED':
      return { label: 'APPROVED', tone: 'good' }
    case 'REJECTED':
      return { label: 'REJECTED', tone: 'danger' }
    case 'ARCHIVED':
      return { label: 'ARCHIVED', tone: 'neutral' }
    default: {
      const exhaustive: never = ad.status
      return exhaustive
    }
  }
}

/** FLIPPER / TRANSMISSIONS / LEADERBOARD placement badge; a
 *  transmissions ad with an assigned slot carries its code
 *  (TRANSMISSIONS · L2) so the live bucket reads at a glance. */
function PlacementChip({ ad }: { ad: AdRow }) {
  switch (ad.placement) {
    case 'flipper':
      return <AdminChip tone="neutral">FLIPPER</AdminChip>
    case 'rail':
      return (
        <AdminChip tone="neutral">
          {ad.rail_slot ? `TRANSMISSIONS · ${ad.rail_slot}` : 'TRANSMISSIONS'}
        </AdminChip>
      )
    case 'leaderboard':
      return <AdminChip tone="neutral">LEADERBOARD</AdminChip>
    default: {
      const exhaustive: never = ad.placement
      return exhaustive
    }
  }
}

/** A live leaderboard creative's board facts — rank and active
 *  contribution total straight off the standing the list route
 *  decorates, plus when its last contribution expires. The windowed
 *  "N days left / ends" pair is meaningless for this placement: the
 *  total (and the rank with it) decays contribution by contribution
 *  instead. Nothing to show while the creative is off the board. */
function LeaderboardStandingMeta({ ad }: { ad: AdRow }) {
  if (!ad.leaderboard) return null
  return (
    <>
      <AdminChip tone="good">RANK #{ad.leaderboard.rank}</AdminChip>
      <span className="tabular-nums text-[color:var(--st-text)]">
        {formatSponsorUsd(ad.leaderboard.activeCents)} active
      </span>
      <MetaDate label="off board" value={ad.leaderboard.expiresAt} />
    </>
  )
}

/** The buyer's slot wish with its exact price — worn by queue/awaiting
 *  (and expired-renewal) rows so the payment conversation about money can
 *  start from the list. Nothing to show on flipper ads or open-slot
 *  pitches. */
function RequestedSlotChip({ ad }: { ad: AdRow }) {
  if (ad.placement !== 'rail' || !ad.requested_rail_slot) return null
  return (
    <AdminChip tone="warn">
      WANTS {ad.requested_rail_slot} · ${RAIL_SLOT_PRICE_CENTS[ad.requested_rail_slot] / 100}/WK
    </AdminChip>
  )
}

/** Whether a payment email can go out for this ad: the billing address
 *  on file, or an amber NO BILLING EMAIL — the tell that this deal
 *  closes over X DM instead (external sponsors, pre-040 rows).
 *  Leaderboard creatives render nothing: no payment email ever goes
 *  out for them (bidding is self-serve Polar), so the address — still
 *  collected at submit — is neither a channel nor a warning here. */
function BillingEmailLine({ ad }: { ad: AdRow }) {
  if (ad.placement === 'leaderboard') return null
  if (!ad.billing_email) {
    return <AdminChip tone="warn">NO BILLING EMAIL</AdminChip>
  }
  return <span className="break-all text-[color:var(--st-text-faint)]">{ad.billing_email}</span>
}

/** Title fallback for rows predating company_name: the link's host,
 *  www-stripped, mirroring the public feed's linkHost. Guarded — a
 *  malformed stored URL just drops the title line. */
function hostOfLink(linkUrl: string): string | null {
  try {
    return new URL(linkUrl).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function daysRemaining(endsAt: string | null): number {
  if (!endsAt) return 0
  const ms = new Date(endsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.ceil(ms / 86_400_000)
}

function OwnerLine({ ad }: { ad: AdRow }) {
  if (!ad.owner) {
    return <AdminChip tone="neutral">EXTERNAL SPONSOR</AdminChip>
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <AdminAvatar src={ad.owner.avatar} alt={ad.owner.display_name} size={20} />
      <Link
        href={`/admin/users/${ad.owner.userId}`}
        className="font-data text-[12px] text-[color:var(--st-text)] hover:underline"
      >
        @{ad.owner.username ?? ad.owner.userId}
      </Link>
      {ad.owner.username && (
        <Link
          href={`/u/${encodeURIComponent(ad.owner.username)}`}
          className="text-[11px] text-[color:var(--st-text-faint)] transition-colors duration-150 hover:text-[color:var(--st-text)]"
        >
          Public ↗
        </Link>
      )}
    </span>
  )
}

/** Exact-render preview — in the placement's real shape — plus the
 *  untrusted destination shown as plain text. Flipper/rail render the
 *  same BillboardCard the public surfaces ship; leaderboard creatives
 *  have no card size, so they stage the sponsor face through the
 *  buyer page's compact preview stage instead. */
function AdPreview({
  ad,
  liveMinTargetCents
}: {
  ad: AdRow
  liveMinTargetCents: number
}) {
  // A live creative renders its actual rank and total. An approved
  // challenger with no contribution yet renders the state its minimum
  // payment would buy: current minimum active at #1, followed by the
  // next correctly incremented OUTBID target.
  const leaderboardPreview =
    ad.placement !== 'leaderboard'
      ? undefined
      : ad.leaderboard
        ? {
            rank: ad.leaderboard.rank,
            clicks: ad.clicks,
            activeCents: ad.leaderboard.activeCents,
            minTargetCents: liveMinTargetCents
          }
        : {
            rank: 1,
            clicks: ad.clicks,
            activeCents: liveMinTargetCents,
            minTargetCents: leaderboardMinTargetCents(liveMinTargetCents)
          }

  return (
    <div className="space-y-2">
      {ad.placement === 'leaderboard' ? (
        <BillboardPreviewStage
          density="compact"
          title={ad.company_name ?? hostOfLink(ad.link_url) ?? 'Untitled'}
          text={ad.text}
          logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
          accentColor={ad.accent_color ?? null}
          placement="leaderboard"
          slot={null}
          leaderboardPreview={leaderboardPreview}
        />
      ) : (
        <BillboardCard
          text={ad.text}
          title={ad.company_name ?? hostOfLink(ad.link_url)}
          logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
          accentColor={ad.accent_color ?? null}
          size={ad.placement === 'rail' ? 'rail' : 'lg'}
        />
      )}
      <p className="text-[12px] leading-5">
        <span className="mr-1.5 font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
          Links to
        </span>
        <span className="break-all text-[color:var(--st-text-muted)]">{ad.link_url}</span>
      </p>
    </div>
  )
}

/** Muted meta fragment with the timestamp itself in font-data. */
function MetaDate({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="text-[color:var(--st-text-faint)]">
      {label} <span className="font-data text-[12px]">{formatDate(value)}</span>
    </span>
  )
}

/** Quiet occupancy meter — live counts are the one place the brand
 *  accent appears on this page. */
function OccupancyMeter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-data text-[11px] font-medium tabular-nums text-[color:var(--st-text-muted)]">
        {label} {used}/{max}
      </span>
      <span
        aria-hidden
        className="h-1 w-12 overflow-hidden rounded-full bg-[color:var(--st-border)]"
      >
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

/** One cell of the sticky header's KPI strip: microlabel + tabular
 *  number, colored only when the number demands attention. */
function KpiStat({
  label,
  value,
  numberClass
}: {
  label: string
  value: number
  numberClass?: string
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
        {label}
      </span>
      <span
        className={`font-data text-[13px] font-semibold tabular-nums ${
          numberClass ?? 'text-[color:var(--st-text)]'
        }`}
      >
        {value}
      </span>
    </span>
  )
}

const railFullMsg = `All ${RAIL_SLOTS.length} transmissions slots are occupied — archive one or wait for a window to end.`

/** Narrows the review response's emailStatus. Anything unexpected reads
 *  as 'skipped' — the "no email went out, work it by hand" answer. */
function emailStatusOf(payload: unknown): 'sent' | 'failed' | 'skipped' {
  const value =
    payload && typeof payload === 'object' && 'emailStatus' in payload
      ? (payload as { emailStatus?: unknown }).emailStatus
      : undefined
  return value === 'sent' || value === 'failed' ? value : 'skipped'
}

/** Fills the buckets and counts a cached pre-redesign response may
 *  lack, so a mid-deploy fetch degrades to derived numbers instead of
 *  crashing — the fresh API always carries them. */
function shapeBillboardData(payload: Record<string, unknown>): BillboardData {
  const queue = (Array.isArray(payload.queue) ? payload.queue : []) as AdRow[]
  const awaiting = (Array.isArray(payload.awaiting) ? payload.awaiting : []) as AdRow[]
  const live = (Array.isArray(payload.live) ? payload.live : []) as AdRow[]
  const runComplete = (
    Array.isArray(payload.runComplete) ? payload.runComplete : []
  ) as RunCompleteAdRow[]
  const recent = (Array.isArray(payload.recent) ? payload.recent : []) as AdRow[]
  const counts =
    payload.counts && typeof payload.counts === 'object'
      ? (payload.counts as BillboardCounts)
      : {
          queue: queue.length,
          awaiting: awaiting.length,
          live: live.length,
          runComplete: runComplete.length,
          flipperLive: live.filter((ad) => ad.placement === 'flipper').length,
          railLive: live.filter((ad) => ad.placement === 'rail').length,
          maxFlipper: Number(payload.maxLive) || BILLBOARD_MAX_LIVE,
          maxRail: RAIL_SLOTS.length
        }
  return {
    queue,
    awaiting,
    live,
    runComplete,
    recent,
    boardDegraded: payload.boardDegraded === true,
    leaderboardMinTargetCents:
      Number(payload.leaderboardMinTargetCents) || LEADERBOARD_SPONSOR_OPENING_CENTS,
    counts
  }
}

function tabLabel(tab: BucketTab): string {
  switch (tab) {
    case 'review':
      return 'Review'
    case 'awaiting':
      return 'Awaiting payment'
    case 'live':
      return 'Live'
    case 'history':
      return 'History'
    default: {
      const exhaustive: never = tab
      return exhaustive
    }
  }
}

function tabCount(tab: BucketTab, data: BillboardData): number {
  switch (tab) {
    case 'review':
      return data.counts.queue
    case 'awaiting':
      return data.counts.awaiting
    case 'live':
      return data.counts.live
    case 'history':
      return data.counts.runComplete + data.recent.length
    default: {
      const exhaustive: never = tab
      return exhaustive
    }
  }
}

const BUCKET_TABS: readonly BucketTab[] = ['review', 'awaiting', 'live', 'history']

/** One line summarizing a batch approve; failures list separately. */
function batchSummary(outcome: BatchOutcome): string {
  const parts = [`${outcome.approved} ad${outcome.approved === 1 ? '' : 's'} approved`]
  if (outcome.emailsSent > 0) {
    parts.push(`${outcome.emailsSent} payment email${outcome.emailsSent === 1 ? '' : 's'} sent`)
  }
  if (outcome.emailsFailed > 0) {
    parts.push(
      `${outcome.emailsFailed} payment email${
        outcome.emailsFailed === 1 ? '' : 's'
      } failed — chase over X DM (@${BILLBOARD_PAYMENT_X_HANDLE})`
    )
  }
  if (outcome.failures.length > 0) {
    parts.push(`${outcome.failures.length} not approved`)
  }
  return parts.join(' · ')
}

/** The controls that put a paid ad on the board: rail ads get a slot
 *  picker (occupied slots disabled, defaulting to the ad's requested
 *  slot while it's free, else the first free one) plus the activate
 *  button, flipper ads just the button, disabled while the cap is
 *  full. Shared by Awaiting payment (first activation) and the expired
 *  rows of History (renewal — the same route keeps paid_at and stamps
 *  a fresh window); only the button label differs. */
function ActivateControls({
  ad,
  label,
  working,
  pick,
  occupiedSlots,
  firstFreeSlot,
  flipperFull,
  flipperFullMsg,
  onPickSlot,
  onActivate
}: {
  ad: AdRow
  label: string
  working: boolean
  /** This ad's picker choice; undefined until the admin touches it. */
  pick: RailSlot | undefined
  occupiedSlots: Set<RailSlot>
  firstFreeSlot: RailSlot | undefined
  flipperFull: boolean
  flipperFullMsg: string
  onPickSlot: (slot: RailSlot) => void
  onActivate: (ad: AdRow, slot?: RailSlot) => void
}) {
  // The picked slot, falling back to the buyer's requested slot while
  // it's free, then to the first free one; a pick (or request) that got
  // occupied since (activation, refresh) falls through rather than
  // aiming at a taken slot.
  const requestedFreeSlot =
    ad.requested_rail_slot !== null && !occupiedSlots.has(ad.requested_rail_slot)
      ? ad.requested_rail_slot
      : undefined
  const chosenSlot =
    pick !== undefined && !occupiedSlots.has(pick)
      ? pick
      : requestedFreeSlot ?? firstFreeSlot
  return ad.placement === 'rail' ? (
    <>
      <label className="flex items-center gap-2">
        <span className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
          Slot
        </span>
        <select
          value={chosenSlot ?? ''}
          disabled={working || chosenSlot === undefined}
          onChange={(e) => onPickSlot(e.target.value as RailSlot)}
          className="st-input h-11 rounded-lg px-2 font-data text-[12px] disabled:cursor-not-allowed disabled:opacity-50 md:h-8"
        >
          {chosenSlot === undefined && <option value="">All taken</option>}
          {RAIL_SLOTS.map((slot) => (
            <option key={slot} value={slot} disabled={occupiedSlots.has(slot)}>
              {slot} — ${RAIL_SLOT_PRICE_CENTS[slot] / 100}/wk
              {occupiedSlots.has(slot) ? ' — taken' : ''}
            </option>
          ))}
        </select>
      </label>
      <AdminButton
        variant="good"
        pending={working}
        disabled={chosenSlot === undefined}
        title={chosenSlot === undefined ? railFullMsg : undefined}
        onClick={() => chosenSlot && onActivate(ad, chosenSlot)}
      >
        {label}
      </AdminButton>
    </>
  ) : (
    <AdminButton
      variant="good"
      pending={working}
      disabled={flipperFull}
      title={flipperFull ? flipperFullMsg : undefined}
      onClick={() => onActivate(ad)}
    >
      {label}
    </AdminButton>
  )
}

export default function AdminBillboardPage() {
  const me = useAdmin()
  const [data, setData] = useState<BillboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  /** Per-ad slot choice for rail activations; unset falls back to the
   *  first free slot. */
  const [railSlotPick, setRailSlotPick] = useState<Record<number, RailSlot>>({})
  const [tab, setTab] = useState<BucketTab>('review')
  /** Review-tab multi-select for batch approval. */
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [batchWorking, setBatchWorking] = useState(false)
  const [batchOutcome, setBatchOutcome] = useState<BatchOutcome | null>(null)
  const [showBoardPreview, setShowBoardPreview] = useState(false)

  // The silent-refresh loop reads these through refs so the interval
  // survives without re-arming on every action.
  const busyRef = useRef(false)
  const hasDataRef = useRef(false)

  const load = useCallback(async (mode: LoadMode) => {
    if (mode === 'initial') setLoading(true)
    if (mode !== 'background') setError(null)
    try {
      const res = await fetch('/api/admin/billboard', { credentials: 'include' })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(payload?.queue)) {
        throw new Error(payload?.error ?? 'Failed to load sponsor ads.')
      }
      setData(shapeBillboardData(payload as Record<string, unknown>))
    } catch (err) {
      // A background refresh failing silently keeps the stale-but-
      // usable data on screen; the next tick (or any action) retries.
      if (mode === 'background') return
      setData(null)
      setError(err instanceof Error ? err.message : 'Failed to load sponsor ads.')
    } finally {
      if (mode === 'initial') setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load('initial')
  }, [load])

  useEffect(() => {
    busyRef.current = workingId !== null || batchWorking || dialog !== null
  }, [workingId, batchWorking, dialog])

  useEffect(() => {
    hasDataRef.current = data !== null
  }, [data])

  // Freshness: refetch every 60s and on window focus — silently (no
  // skeleton flash), and never while an action or dialog is in flight
  // so in-progress form state can't get clobbered. A failed initial
  // load stays on its Retry banner instead of quietly self-healing
  // under a stale error.
  useEffect(() => {
    const refresh = () => {
      if (busyRef.current || !hasDataRef.current) return
      void load('background')
    }
    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  // Selection hygiene: drop ids that left the queue (approved,
  // rejected, resubmitted elsewhere) so a recycled row can never
  // arrive pre-checked.
  useEffect(() => {
    if (!data) return
    setSelected((prev) => {
      const queueIds = new Set(data.queue.map((ad) => ad.id))
      const next = new Set([...prev].filter((id) => queueIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [data])

  /** One-click actions (approve / activate) — errors land in the banner. */
  const run = async (ad: AdRow, url: string, body: Record<string, unknown>, onOk: (data: unknown) => string) => {
    if (workingId !== null || batchWorking) return
    setWorkingId(ad.id)
    setError(null)
    setNotice(null)
    setBatchOutcome(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        // 409 = the board changed under us (a rail slot filled, the
        // flipper cap hit). Reload so the pickers reflect reality, then
        // re-raise the server's message — load() clears the banner.
        if (res.status === 409) {
          const message =
            typeof payload?.error === 'string' ? payload.error : 'Action failed.'
          await load('action')
          setError(message)
          return
        }
        throw new Error(payload?.error ?? 'Action failed.')
      }
      setNotice(onOk(payload))
      await load('action')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setWorkingId(null)
    }
  }

  const approve = (ad: AdRow) =>
    run(
      ad,
      `/api/admin/billboard/${ad.id}/review`,
      { action: 'approve' },
      (payload) => {
        // Leaderboard approval opens self-serve Polar bidding
        // (migration 055) — there is no payment thread to work and no
        // activation step, whatever emailStatus says (the review route
        // always skips the send for this placement).
        if (ad.placement === 'leaderboard') {
          return `Ad #${ad.id} approved — bidding is open. It goes live on the leaderboard by itself the moment the buyer pays a bid.`
        }
        // The notice names the channel the deal now lives on: the email
        // thread when the send went out, X DM when it didn't (failed
        // provider, unset env, or no address on file).
        const emailStatus = emailStatusOf(payload)
        switch (emailStatus) {
          case 'sent':
            return `Ad #${ad.id} approved — payment email sent to ${ad.billing_email}. Close it in that thread, then mark paid + go live.`
          case 'failed':
            return `Ad #${ad.id} approved — the payment email to ${ad.billing_email} failed. Chase over X DM (@${BILLBOARD_PAYMENT_X_HANDLE}), then mark paid + go live.`
          case 'skipped':
            return `Ad #${ad.id} approved — no payment email went out (${
              ad.billing_email ? 'email delivery is not configured' : 'no billing email on file'
            }). Arrange payment over X DM (@${BILLBOARD_PAYMENT_X_HANDLE}), then mark paid + go live.`
          default: {
            const exhaustive: never = emailStatus
            return exhaustive
          }
        }
      }
    )

  /** Flipper ads activate bare; rail ads must name the slot they take. */
  const activate = (ad: AdRow, slot?: RailSlot) =>
    run(
      ad,
      `/api/admin/billboard/${ad.id}/activate`,
      slot ? { action: 'activate', slot } : { action: 'activate' },
      (payload) => {
        const reminder =
          payload && typeof payload === 'object' && 'paymentReminder' in payload
            ? String((payload as { paymentReminder?: unknown }).paymentReminder ?? '')
            : ''
        return `Ad #${ad.id} is live${
          slot ? ` on slot ${slot}` : ''
        } for ${BILLBOARD_DURATION_DAYS} days. ${reminder}`.trim()
      }
    )

  /** Fires the whole selection at the batch endpoint — one rate-limit
   *  hit, per-ad results. Failed ads stay selected for an easy retry;
   *  approved ones leave the queue on reload. */
  const batchApprove = async () => {
    if (!data || workingId !== null || batchWorking) return
    const adIds = data.queue.filter((ad) => selected.has(ad.id)).map((ad) => ad.id)
    if (adIds.length === 0 || adIds.length > BATCH_APPROVE_MAX) return
    setBatchWorking(true)
    setError(null)
    setNotice(null)
    setBatchOutcome(null)
    try {
      const res = await fetch('/api/admin/billboard/review-batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adIds })
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(payload?.results)) {
        throw new Error(payload?.error ?? 'Batch approve failed.')
      }
      const results = payload.results as Array<{
        adId: number
        ok: boolean
        emailStatus?: unknown
        error?: string
      }>
      const failures = results
        .filter((row) => !row.ok)
        .map((row) => ({ adId: row.adId, error: row.error ?? 'Approve failed.' }))
      setBatchOutcome({
        approved: results.filter((row) => row.ok).length,
        emailsSent: results.filter((row) => row.ok && row.emailStatus === 'sent').length,
        emailsFailed: results.filter((row) => row.ok && row.emailStatus === 'failed').length,
        failures
      })
      setSelected(new Set(failures.map((failure) => failure.adId)))
      await load('action')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch approve failed.')
    } finally {
      setBatchWorking(false)
    }
  }

  /** Runs inside ReasonDialog: an error string keeps the dialog open. */
  const confirmDialog = async (state: DialogState, reason: string): Promise<string | null> => {
    const isArchive = state.kind === 'archive'
    const url = isArchive
      ? `/api/admin/billboard/${state.ad.id}/activate`
      : `/api/admin/billboard/${state.ad.id}/review`
    const action = isArchive ? 'archive' : state.kind
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason })
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      return payload?.error ?? 'Action failed.'
    }
    switch (state.kind) {
      case 'reject':
        setNotice(`Ad #${state.ad.id} rejected — the buyer sees the reason at /sponsorship.`)
        break
      case 'request_changes':
        setNotice(`Ad #${state.ad.id} sent back to the buyer for changes.`)
        break
      case 'archive':
        setNotice(`Ad #${state.ad.id} archived — its click stats are kept.`)
        break
      default: {
        const exhaustive: never = state
        return exhaustive
      }
    }
    await load('action')
    return null
  }

  // Gates the money levers (activate / renew / archive) — cosmetic, the
  // activate route's billboard.activate gate still 403s moderators. The
  // review-queue decision buttons render for every staff member.
  const isOwner = me.role === 'owner'
  const counts = data?.counts ?? null
  // Slot occupancy still derives client-side from the live bucket's
  // rail_slot codes — the picker needs which slots, not just how many.
  // The count KPIs render the server's counts verbatim. The activate
  // route re-checks everything and answers 409 on a race.
  const liveList = data?.live ?? []
  const flipperFull = counts !== null && counts.flipperLive >= counts.maxFlipper
  const flipperFullMsg = counts
    ? `All ${counts.maxFlipper} flipper slots are live — archive one or wait for a window to end.`
    : ''
  const occupiedSlots = new Set<RailSlot>(
    liveList.flatMap((ad) => (ad.placement === 'rail' && ad.rail_slot ? [ad.rail_slot] : []))
  )
  const firstFreeSlot = RAIL_SLOTS.find((slot) => !occupiedSlots.has(slot))

  const showFlipperWarn =
    flipperFull && (data?.awaiting.some((ad) => ad.placement === 'flipper') ?? false)
  const showRailWarn =
    firstFreeSlot === undefined && (data?.awaiting.some((ad) => ad.placement === 'rail') ?? false)

  // Batch selection, intersected with the queue at render so a stale
  // set can't inflate the button count between reload and prune.
  const queueIds = data?.queue.map((ad) => ad.id) ?? []
  const selectedIds = queueIds.filter((id) => selected.has(id))
  const allSelected = queueIds.length > 0 && selectedIds.length === queueIds.length
  const someSelected = selectedIds.length > 0 && !allSelected

  const tabItems: AdminTabItem<BucketTab>[] = BUCKET_TABS.map((id) => ({
    id,
    label: tabLabel(id),
    count: data ? tabCount(id, data) : undefined
  }))

  let tabPanel: ReactNode = null
  if (loading) {
    tabPanel = (
      <AdminSection flush>
        <AdminSkeletonList rows={4} />
      </AdminSection>
    )
  } else if (data) {
    switch (tab) {
      case 'review':
        tabPanel = (
          <div className="space-y-6">
            <AdminSection
              title="Review queue"
              count={data.queue.length}
              action={
                <AdminButton variant="ghost" onClick={() => setShowBoardPreview((v) => !v)}>
                  {showBoardPreview ? 'Hide board preview' : 'Preview board with queue'}
                </AdminButton>
              }
              flush
            >
              {data.queue.length === 0 ? (
                <AdminEmpty
                  title="Nothing waiting for review"
                  hint="New submissions from /sponsorship land here."
                />
              ) : (
                <>
                  {/* Batch toolbar: approval is the only decision that
                      batches — reject and request-changes need written
                      reasons, so they stay per ad. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[color:var(--st-border)] bg-[color:var(--st-panel-hover)] px-4 py-2.5">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected
                        }}
                        disabled={batchWorking}
                        onChange={() =>
                          setSelected(allSelected ? new Set() : new Set(queueIds))
                        }
                        className="h-4 w-4 accent-[color:var(--st-accent)]"
                      />
                      <span className="font-data text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--st-text-muted)]">
                        Select all
                      </span>
                    </label>
                    <AdminButton
                      variant="good"
                      pending={batchWorking}
                      disabled={
                        selectedIds.length === 0 ||
                        workingId !== null ||
                        selectedIds.length > BATCH_APPROVE_MAX
                      }
                      title={
                        selectedIds.length > BATCH_APPROVE_MAX
                          ? `Batch approve is capped at ${BATCH_APPROVE_MAX} ads per request.`
                          : undefined
                      }
                      onClick={() => void batchApprove()}
                    >
                      Approve selected ({selectedIds.length})
                    </AdminButton>
                    <span className="text-[12px] leading-4 text-[color:var(--st-text-faint)]">
                      Reject and request-changes stay per ad — they need a written reason.
                    </span>
                  </div>
                  <AdminList>
                    {data.queue.map((ad) => {
                      const chip = adChipMeta(ad, false)
                      const working = workingId === ad.id
                      return (
                        <li key={ad.id} className="flex gap-3 px-4 py-4">
                          <input
                            type="checkbox"
                            checked={selected.has(ad.id)}
                            disabled={batchWorking}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev)
                                if (next.has(ad.id)) next.delete(ad.id)
                                else next.add(ad.id)
                                return next
                              })
                            }
                            aria-label={`Select ad #${ad.id} for batch approval`}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--st-accent)]"
                          />
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                              <AdminChip tone={chip.tone}>{chip.label}</AdminChip>
                              <PlacementChip ad={ad} />
                              <RequestedSlotChip ad={ad} />
                              <span className="font-data text-[12px] text-[color:var(--st-text-faint)]">
                                #{ad.id}
                              </span>
                              <OwnerLine ad={ad} />
                              <BillingEmailLine ad={ad} />
                              <MetaDate label="submitted" value={ad.created_at} />
                            </div>
                            <AdPreview
                              ad={ad}
                              liveMinTargetCents={data.leaderboardMinTargetCents}
                            />
                            {ad.status === 'CHANGES_REQUESTED' && ad.review_note && (
                              <p className="text-[12.5px] leading-5 text-sky-600">
                                <span className="mr-1.5 font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
                                  Sent back
                                </span>
                                {ad.review_note}
                              </p>
                            )}
                            {/* Acceptance decisions sit at the moderator floor
                                (billboard.review) — every staff member sees
                                these; only the money levers below are owner
                                gated. */}
                            <div className="flex flex-wrap items-center gap-2">
                              <AdminButton
                                variant="good"
                                pending={working}
                                disabled={batchWorking}
                                onClick={() => approve(ad)}
                              >
                                Approve
                              </AdminButton>
                              {ad.status === 'PENDING' && (
                                <AdminButton
                                  variant="ghost"
                                  disabled={working || batchWorking}
                                  onClick={() => setDialog({ kind: 'request_changes', ad })}
                                >
                                  Request changes
                                </AdminButton>
                              )}
                              <AdminButton
                                variant="danger"
                                disabled={working || batchWorking}
                                onClick={() => setDialog({ kind: 'reject', ad })}
                              >
                                Reject
                              </AdminButton>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </AdminList>
                </>
              )}
            </AdminSection>

            {showBoardPreview && (
              <AdminSection
                title="Board preview"
                description="Each placement surface with queued and awaiting creatives staged against what's live — judge the whole board before approving."
              >
                <SponsorshipBoardPreview
                  ads={{ queue: data.queue, awaiting: data.awaiting, live: data.live }}
                  leaderboardMinTargetCents={data.leaderboardMinTargetCents}
                />
              </AdminSection>
            )}
          </div>
        )
        break
      case 'awaiting':
        tabPanel = (
          <AdminSection
            title="Awaiting payment"
            count={data.awaiting.length}
            description={`Payment closes in the email thread (X DM @${BILLBOARD_PAYMENT_X_HANDLE} as backup) — nothing here bills the buyer. Leaderboard creatives sit here only while bidding is open: their payment is self-serve Polar and they go live on their own.`}
            flush
          >
            {(showFlipperWarn || showRailWarn) && (
              <div className="space-y-2 border-b border-[color:var(--st-border)] p-3">
                {showFlipperWarn && <AdminNotice tone="warning">{flipperFullMsg}</AdminNotice>}
                {showRailWarn && <AdminNotice tone="warning">{railFullMsg}</AdminNotice>}
              </div>
            )}
            {data.awaiting.length === 0 ? (
              <AdminEmpty
                title="No approved ads waiting on payment"
                hint="Approve a submission in the Review tab to start a payment thread."
              />
            ) : (
              <AdminList>
                {data.awaiting.map((ad) => {
                  const working = workingId === ad.id
                  return (
                    <li key={ad.id} className="space-y-3 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                        <AdminChip tone="good">APPROVED</AdminChip>
                        <PlacementChip ad={ad} />
                        <RequestedSlotChip ad={ad} />
                        <span className="font-data text-[12px] text-[color:var(--st-text-faint)]">
                          #{ad.id}
                        </span>
                        <OwnerLine ad={ad} />
                        <BillingEmailLine ad={ad} />
                        <MetaDate label="approved" value={ad.reviewed_at} />
                      </div>
                      <AdPreview
                        ad={ad}
                        liveMinTargetCents={data.leaderboardMinTargetCents}
                      />
                      {isOwner && (
                        <div className="flex flex-wrap items-center gap-2">
                          {ad.placement === 'leaderboard' ? (
                            // No activate lever for this placement:
                            // payment is self-serve Polar and liveness
                            // derives from paid bids (the activate
                            // route hard-refuses it too) — the row just
                            // says what it's waiting for.
                            <span className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                              Bidding open — goes live by itself once the buyer pays a bid.
                            </span>
                          ) : (
                            <ActivateControls
                              ad={ad}
                              label="Mark paid + go live"
                              working={working}
                              pick={railSlotPick[ad.id]}
                              occupiedSlots={occupiedSlots}
                              firstFreeSlot={firstFreeSlot}
                              flipperFull={flipperFull}
                              flipperFullMsg={flipperFullMsg}
                              onPickSlot={(slot) =>
                                setRailSlotPick((prev) => ({ ...prev, [ad.id]: slot }))
                              }
                              onActivate={activate}
                            />
                          )}
                          <AdminButton
                            variant="ghost"
                            disabled={working}
                            onClick={() => setDialog({ kind: 'archive', ad })}
                          >
                            Archive
                          </AdminButton>
                        </div>
                      )}
                    </li>
                  )
                })}
              </AdminList>
            )}
          </AdminSection>
        )
        break
      case 'live':
        tabPanel = (
          <AdminSection title="Live now" count={data.live.length} flush>
            {data.live.length === 0 ? (
              <AdminEmpty
                title="No ads live right now"
                hint="Ads land here after mark paid + go live."
              />
            ) : (
              <AdminList>
                {data.live.map((ad) => {
                  const working = workingId === ad.id
                  const days = daysRemaining(ad.ends_at)
                  return (
                    <li key={ad.id} className="space-y-3 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                        <AdminChip tone="good">LIVE</AdminChip>
                        <PlacementChip ad={ad} />
                        <span className="font-data text-[12px] text-[color:var(--st-text-faint)]">
                          #{ad.id}
                        </span>
                        <OwnerLine ad={ad} />
                        {ad.placement === 'leaderboard' ? (
                          // Board standing instead of the 7-day window
                          // facts — leaderboard liveness decays with its
                          // contributions, not on an end date.
                          <LeaderboardStandingMeta ad={ad} />
                        ) : (
                          <>
                            <span className="tabular-nums text-[color:var(--st-text)]">
                              {days} day{days === 1 ? '' : 's'} left
                            </span>
                            <MetaDate label="ends" value={ad.ends_at} />
                          </>
                        )}
                        <span className="tabular-nums text-[color:var(--st-text)]">
                          {ad.clicks.toLocaleString('en-US')} click{ad.clicks === 1 ? '' : 's'}
                        </span>
                      </div>
                      <AdPreview
                        ad={ad}
                        liveMinTargetCents={data.leaderboardMinTargetCents}
                      />
                      {isOwner && (
                        <div className="flex flex-wrap items-center gap-2">
                          <AdminButton
                            variant="danger"
                            disabled={working}
                            onClick={() => setDialog({ kind: 'archive', ad })}
                          >
                            Archive
                          </AdminButton>
                        </div>
                      )}
                    </li>
                  )
                })}
              </AdminList>
            )}
          </AdminSection>
        )
        break
      case 'history':
        tabPanel = (
          <div className="space-y-6">
            {data.runComplete.length > 0 && (
              <AdminSection
                title="Run complete"
                count={data.runComplete.length}
                description="Leaderboard runs whose last paid bid expired. Bidding stays open through a 24h grace window, then the sweep archives them automatically — or archive now."
                flush
              >
                <AdminList>
                  {data.runComplete.map((ad) => {
                    const working = workingId === ad.id
                    return (
                      <li key={ad.id} className="space-y-1.5 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                          <AdminChip tone="warn">RUN COMPLETE</AdminChip>
                          <PlacementChip ad={ad} />
                          <span className="font-data text-[12px] text-[color:var(--st-text-faint)]">
                            #{ad.id}
                          </span>
                          <OwnerLine ad={ad} />
                          <span className="text-[color:var(--st-text-faint)]">
                            auto-archives{' '}
                            <span className="font-data text-[12px]">
                              {formatDate(ad.autoArchivesAt)}
                            </span>{' '}
                            unless a new bid lands
                          </span>
                          {ad.clicks > 0 && (
                            <span className="tabular-nums text-[color:var(--st-text-faint)]">
                              {ad.clicks.toLocaleString('en-US')} click
                              {ad.clicks === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <p className="break-words text-[13.5px] leading-5 text-[color:var(--st-text)]">
                          {ad.text}
                        </p>
                        {isOwner && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <AdminButton
                              variant="ghost"
                              disabled={working}
                              onClick={() => setDialog({ kind: 'archive', ad })}
                            >
                              Archive now
                            </AdminButton>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </AdminList>
              </AdminSection>
            )}

            <AdminSection title="Recent decisions" count={data.recent.length} flush>
              {data.recent.length === 0 ? (
                <AdminEmpty title="No past decisions yet" />
              ) : (
                <AdminList>
                  {data.recent.map((ad) => {
                    // APPROVED rows only land here when their window ran
                    // out — those get renew controls below. REJECTED and
                    // ARCHIVED rows stay read-only.
                    const expired = ad.status === 'APPROVED'
                    const chip = adChipMeta(ad, expired)
                    const working = workingId === ad.id
                    return (
                      <li key={ad.id} className="space-y-1.5 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                          <AdminChip tone={chip.tone}>{chip.label}</AdminChip>
                          <PlacementChip ad={ad} />
                          {expired && <RequestedSlotChip ad={ad} />}
                          <span className="font-data text-[12px] text-[color:var(--st-text-faint)]">
                            #{ad.id}
                          </span>
                          <OwnerLine ad={ad} />
                          <span className="font-data text-[12px] text-[color:var(--st-text-faint)]">
                            {formatDate(ad.updated_at)}
                          </span>
                          {ad.clicks > 0 && (
                            <span className="tabular-nums text-[color:var(--st-text-faint)]">
                              {ad.clicks.toLocaleString('en-US')} click
                              {ad.clicks === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <p className="break-words text-[13.5px] leading-5 text-[color:var(--st-text)]">
                          {ad.text}
                        </p>
                        {ad.review_note && (
                          <p className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                            {ad.review_note}
                          </p>
                        )}
                        {isOwner && expired && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <ActivateControls
                              ad={ad}
                              label="Renew — mark paid + go live"
                              working={working}
                              pick={railSlotPick[ad.id]}
                              occupiedSlots={occupiedSlots}
                              firstFreeSlot={firstFreeSlot}
                              flipperFull={flipperFull}
                              flipperFullMsg={flipperFullMsg}
                              onPickSlot={(slot) =>
                                setRailSlotPick((prev) => ({ ...prev, [ad.id]: slot }))
                              }
                              onActivate={activate}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </AdminList>
              )}
            </AdminSection>
          </div>
        )
        break
      default: {
        const exhaustive: never = tab
        tabPanel = exhaustive
      }
    }
  }

  return (
    <div className="space-y-5">
      {/* Sticky workspace header: title, the server-computed KPI strip,
          action banners and the bucket tabs — pinned from md up (the
          mobile console header already owns the small-screen top edge). */}
      <div className="z-20 -mx-4 border-b border-[color:var(--st-border)] bg-[color:var(--st-canvas)] px-4 sm:-mx-6 sm:px-6 md:sticky md:top-0 md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
          <h1 className="text-[21px] font-semibold leading-7 tracking-[-0.01em] text-[color:var(--st-text)]">
            Sponsorship
          </h1>
          {counts && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <KpiStat
                label="Queue"
                value={counts.queue}
                numberClass={
                  counts.queue > 0
                    ? 'text-[color:var(--ad-attention)]'
                    : 'text-[color:var(--st-text-muted)]'
                }
              />
              <KpiStat
                label="Awaiting"
                value={counts.awaiting}
                numberClass={
                  counts.awaiting > 0
                    ? 'text-[color:var(--ad-attention)]'
                    : 'text-[color:var(--st-text-muted)]'
                }
              />
              <KpiStat
                label="Live"
                value={counts.live}
                numberClass={
                  counts.live > 0 ? 'text-accent' : 'text-[color:var(--st-text-muted)]'
                }
              />
              <KpiStat
                label="Run complete"
                value={counts.runComplete}
                numberClass={
                  counts.runComplete > 0
                    ? 'text-amber-600'
                    : 'text-[color:var(--st-text-muted)]'
                }
              />
              <OccupancyMeter
                label="Flipper"
                used={counts.flipperLive}
                max={counts.maxFlipper}
              />
              <OccupancyMeter label="Transmissions" used={counts.railLive} max={counts.maxRail} />
            </div>
          )}
        </div>

        {(error || notice || batchOutcome || data?.boardDegraded) && (
          <div className="space-y-2 pb-3">
            {error && (
              <AdminNotice tone="danger">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{error}</span>
                  <AdminButton variant="ghost" onClick={() => void load('initial')}>
                    Retry
                  </AdminButton>
                </div>
              </AdminNotice>
            )}
            {notice && <AdminNotice tone="info">{notice}</AdminNotice>}
            {batchOutcome && (
              <AdminNotice tone={batchOutcome.failures.length > 0 ? 'warning' : 'info'}>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{batchSummary(batchOutcome)}</span>
                    <AdminButton variant="ghost" onClick={() => setBatchOutcome(null)}>
                      Dismiss
                    </AdminButton>
                  </div>
                  {batchOutcome.failures.map((failure) => (
                    <p key={failure.adId} className="text-[12.5px] leading-5">
                      <span className="font-data text-[12px]">#{failure.adId}</span> —{' '}
                      {failure.error}
                    </p>
                  ))}
                </div>
              </AdminNotice>
            )}
            {data?.boardDegraded && (
              <AdminNotice tone="warning">
                Sponsor board standing unavailable — leaderboard rows shown without rank
                facts.
              </AdminNotice>
            )}
          </div>
        )}

        <AdminTabs
          tabs={tabItems}
          active={tab}
          onSelect={setTab}
          label="Sponsorship buckets"
        />
      </div>

      {tabPanel}

      <p className="text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
        {PAGE_DESCRIPTION}
      </p>

      {dialog?.kind === 'reject' && (
        <ReasonDialog
          title={`Reject ad #${dialog.ad.id}`}
          description="Marks the submission rejected. The reason is stored on the ad, shown to the buyer at /sponsorship, and logged to the audit trail."
          confirmLabel="Reject ad"
          danger
          onConfirm={(reason) => confirmDialog(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'request_changes' && (
        <ReasonDialog
          title={`Request changes — ad #${dialog.ad.id}`}
          description="Sends the ad back to the buyer with this note. They edit and resubmit at /sponsorship, which returns it to the review queue."
          confirmLabel="Request changes"
          onConfirm={(reason) => confirmDialog(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ReasonDialog
          title={`Archive ad #${dialog.ad.id}`}
          description="Takes the ad down immediately. Click stats are kept; the slot is not refunded here — refunds are handled manually if owed."
          confirmLabel="Archive ad"
          danger
          onConfirm={(reason) => confirmDialog(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
