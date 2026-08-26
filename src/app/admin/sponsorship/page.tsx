'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AdminAvatar,
  AdminButton,
  AdminChip,
  AdminEmpty,
  AdminList,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  AdminSkeletonList,
  ReasonDialog,
  formatDate,
  useAdmin,
  type AdminChipTone
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

// Billboard queue: review paid ad submissions with an exact-render
// preview (the same components the public surfaces ship). Acceptance
// (approve / reject / request changes) is moderator-floor work
// (billboard.review); the money levers — mark paid + go live, renew,
// archive — render for the owner only, matching the owner-only
// billboard.activate gate on their route. Three
// products share the queue. Flipper ads (capped at 8 concurrent) and
// profile-rail ads (one live ad per slot) close payment manually:
// approving emails the payment instructions to the ad's billing_email
// (X DM is the backup channel — the approve notice says which one to
// work); once payment closes, mark paid + go live. Rail activation
// picks a free slot from a picker whose occupancy derives client-side
// from the live bucket's rail_slot values — the server re-checks and
// answers 409 if the slot filled meanwhile. A rail ad may carry the
// buyer's requested_rail_slot — surfaced as a WANTS chip and
// preselected in the picker while free, but never binding: first
// confirmed payment wins the slot. Expired ads surface in Recent
// decisions with the same activate controls relabelled as a renewal —
// payment is collected manually again and the activate route stamps a
// fresh window, keeping paid_at. Leaderboard creatives (migration 055)
// need review ONLY: approval opens self-serve Polar bidding and
// liveness derives from paid contributions in the rolling 24h window —
// no activate lever, no 7-day window, no slot. Their rows show the
// board standing the list route decorates them with (rank + active
// total), and archive stays the takedown. Buyer-controlled fields
// (text, link_url, logo_url) are untrusted: text renders as plain text
// and link_url is shown verbatim for inspection, never as a clickable
// link.

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
   *  while off the board; always null on flipper/rail ads. */
  leaderboard: {
    rank: number
    activeCents: number
    nextDropAt: string
    expiresAt: string
  } | null
}

interface BillboardData {
  queue: AdRow[]
  awaiting: AdRow[]
  live: AdRow[]
  recent: AdRow[]
  /** Current total a challenger must reach to take #1. */
  leaderboardMinTargetCents: number
  liveCount: number
  maxLive: number
}

type DialogState =
  | { kind: 'reject'; ad: AdRow }
  | { kind: 'request_changes'; ad: AdRow }
  | { kind: 'archive'; ad: AdRow }

const PAGE_DESCRIPTION = `Paid ad slots, three placements — the flipper train on the dashboard + leaderboard ($${BILLBOARD_PRICE_CENTS / 100}/wk, max ${BILLBOARD_MAX_LIVE} live), the always-on profile rails ($${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}–$${RAIL_SLOT_PRICE_CENTS.L1 / 100}/wk by row, ${RAIL_SLOTS.length} fixed slots), and the leaderboard sponsor board (rolling 24h Polar bids from ${formatSponsorUsd(LEADERBOARD_SPONSOR_OPENING_CENTS)}). Flipper + rail close payment manually: approving emails the instructions to the ad's billing address (X DM @${BILLBOARD_PAYMENT_X_HANDLE} as backup), then mark paid + go live — rail ads take their slot at activation. Leaderboard creatives only need review: bidding, payment and liveness run themselves.`

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

/** FLIPPER / RAIL / LEADERBOARD placement badge; a rail ad with an
 *  assigned slot carries its code (RAIL · L2) so the live bucket reads
 *  at a glance. */
function PlacementChip({ ad }: { ad: AdRow }) {
  switch (ad.placement) {
    case 'flipper':
      return <AdminChip tone="neutral">FLIPPER</AdminChip>
    case 'rail':
      return (
        <AdminChip tone="neutral">
          {ad.rail_slot ? `RAIL · ${ad.rail_slot}` : 'RAIL'}
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

const railFullMsg = `All ${RAIL_SLOTS.length} rail slots are occupied — archive one or wait for a window to end.`

/** Narrows the review response's emailStatus. Anything unexpected reads
 *  as 'skipped' — the "no email went out, work it by hand" answer. */
function emailStatusOf(payload: unknown): 'sent' | 'failed' | 'skipped' {
  const value =
    payload && typeof payload === 'object' && 'emailStatus' in payload
      ? (payload as { emailStatus?: unknown }).emailStatus
      : undefined
  return value === 'sent' || value === 'failed' ? value : 'skipped'
}

/** The controls that put a paid ad on the board: rail ads get a slot
 *  picker (occupied slots disabled, defaulting to the ad's requested
 *  slot while it's free, else the first free one) plus the activate
 *  button, flipper ads just the button, disabled while the cap is
 *  full. Shared by Awaiting payment (first activation) and the expired
 *  rows of Recent decisions (renewal — the same route keeps paid_at
 *  and stamps a fresh window); only the button label differs. */
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/billboard', { credentials: 'include' })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(payload?.queue)) {
        throw new Error(payload?.error ?? 'Failed to load sponsor ads.')
      }
      setData(payload as BillboardData)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Failed to load sponsor ads.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** One-click actions (approve / activate) — errors land in the banner. */
  const run = async (ad: AdRow, url: string, body: Record<string, unknown>, onOk: (data: unknown) => string) => {
    if (workingId !== null) return
    setWorkingId(ad.id)
    setError(null)
    setNotice(null)
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
          await load()
          setError(message)
          return
        }
        throw new Error(payload?.error ?? 'Action failed.')
      }
      setNotice(onOk(payload))
      await load()
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
    await load()
    return null
  }

  // Gates the money levers (activate / renew / archive) — cosmetic, the
  // activate route's billboard.activate gate still 403s moderators. The
  // review-queue decision buttons render for every staff member.
  const isOwner = me.role === 'owner'
  // Occupancy derives client-side from the live bucket: flipper fullness
  // against the 8-cap, rail occupancy from the live rail ads' slot codes.
  // The activate route re-checks both and answers 409 on a race.
  const liveList = data?.live ?? []
  const flipperLiveCount = liveList.filter((ad) => ad.placement === 'flipper').length
  const flipperFull = data !== null && flipperLiveCount >= data.maxLive
  const flipperFullMsg = data
    ? `All ${data.maxLive} flipper slots are live — archive one or wait for a window to end.`
    : ''
  const occupiedSlots = new Set<RailSlot>(
    liveList.flatMap((ad) => (ad.placement === 'rail' && ad.rail_slot ? [ad.rail_slot] : []))
  )
  const firstFreeSlot = RAIL_SLOTS.find((slot) => !occupiedSlots.has(slot))

  const showFlipperWarn =
    flipperFull && (data?.awaiting.some((ad) => ad.placement === 'flipper') ?? false)
  const showRailWarn =
    firstFreeSlot === undefined && (data?.awaiting.some((ad) => ad.placement === 'rail') ?? false)

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Sponsorship" description={PAGE_DESCRIPTION} />

      {error && (
        <AdminNotice tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <AdminButton variant="ghost" onClick={() => void load()}>
              Retry
            </AdminButton>
          </div>
        </AdminNotice>
      )}
      {notice && <AdminNotice tone="info">{notice}</AdminNotice>}

      {loading ? (
        <>
          {['Review queue', 'Awaiting payment', 'Live now', 'Recent decisions'].map((title) => (
            <AdminSection key={title} title={title} flush>
              <AdminSkeletonList rows={2} />
            </AdminSection>
          ))}
        </>
      ) : !data ? null : (
        <>
          <AdminSection title="Review queue" count={data.queue.length} flush>
            {data.queue.length === 0 ? (
              <AdminEmpty
                title="Nothing waiting for review"
                hint="New submissions from /sponsorship land here."
              />
            ) : (
              <AdminList>
                {data.queue.map((ad) => {
                  const chip = adChipMeta(ad, false)
                  const working = workingId === ad.id
                  return (
                    <li key={ad.id} className="space-y-3 px-4 py-4">
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
                        <AdminButton variant="good" pending={working} onClick={() => approve(ad)}>
                          Approve
                        </AdminButton>
                        {ad.status === 'PENDING' && (
                          <AdminButton
                            variant="ghost"
                            disabled={working}
                            onClick={() => setDialog({ kind: 'request_changes', ad })}
                          >
                            Request changes
                          </AdminButton>
                        )}
                        <AdminButton
                          variant="danger"
                          disabled={working}
                          onClick={() => setDialog({ kind: 'reject', ad })}
                        >
                          Reject
                        </AdminButton>
                      </div>
                    </li>
                  )
                })}
              </AdminList>
            )}
          </AdminSection>

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
                hint="Approve a submission above to start a payment thread."
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

          <AdminSection
            title="Live now"
            count={data.live.length}
            action={
              // The windowed products' occupancy, derived from the live
              // list. Leaderboard has no cap to meter — its live rows
              // carry their board rank instead.
              <div className="flex flex-wrap items-center gap-4">
                <OccupancyMeter label="Flipper" used={flipperLiveCount} max={data.maxLive} />
                <OccupancyMeter label="Rail" used={occupiedSlots.size} max={RAIL_SLOTS.length} />
              </div>
            }
            flush
          >
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
        </>
      )}

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
