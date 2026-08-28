'use client'

// The buyer's slot tracker on /sponsorship — every submission from GET
// /api/billboard/mine as one compact row inside a single hairline panel,
// sorted action-first. A row expands in place to the ad rendered on the
// shared compact preview stage, the stage-specific story beneath it,
// and — for PENDING / CHANGES_REQUESTED — the shared composer for edit /
// edit-and-resubmit. Admin feedback (review_note) stays the loudest
// element of a redo/reject row because it is the one thing the buyer
// must read.
//
// Money surfaces, per product:
//   - Flipper/rail (the weekly windows): an APPROVED row with no live
//     or scheduled window expands to the slot pay console (migration
//     061) — sticker price, rail slot picker, queue disclosure, and
//     the handoff to Polar's hosted checkout via POST
//     /api/billboard/checkout. The bb_checkout=success return leg is
//     handled by BillboardLanding, which syncs and reloads this list.
//   - Leaderboard creatives (placement 'leaderboard', migration 055)
//     ride the same rows but a different money story: no 7-day window
//     — liveness is APPROVED plus an active bid total from GET
//     /api/billboard/leaderboard/mine (fetched here whenever the list
//     carries one, refreshed on every parent reload). An APPROVED
//     row's expansion is the bid console: the live ranked board with
//     expirations, a target-total entry with the explicit charge
//     preview (leaderboardChargeCents — the math is never re-derived
//     here), and the handoff to Polar's hosted checkout. A 409 from
//     the checkout route means the board moved: the console refreshes
//     its displayed minimum from the response and re-asks — it never
//     silently re-submits.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BillboardPreviewStage } from '@/components/billboard/BillboardPreviewStage'
import {
  BillboardSubmitForm,
  type AdFormTarget
} from '@/components/billboard/BillboardSubmitForm'
import {
  SegmentedControl,
  SettingsButton,
  type SegmentedOption
} from '@/components/settings'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PAYMENT_X_URL,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  RAIL_SLOTS,
  RAIL_SLOT_PRICE_CENTS,
  billboardSlotGrossCents,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS,
  LEADERBOARD_SPONSOR_POLL_MS,
  formatSponsorUsd,
  leaderboardChargeCents,
  leaderboardMaxTargetCents,
  type LeaderboardSponsorBoard,
  type LeaderboardSponsorMine,
  type LeaderboardSponsorMineCreative
} from '@/lib/leaderboardSponsor'

/** One row of GET /api/billboard/mine — isLive computed server-side. */
export interface MineAd {
  id: number
  status: BillboardStatus
  /** Title line of the sub-banner; null on rows predating the field. */
  company_name: string | null
  text: string
  link_url: string
  logo_url: string | null
  /** #rrggbb extracted from the logo server-side; null = neutral strip. */
  accent_color: string | null
  /** Which product this card buys — the flipper strip or a profile rail. */
  placement: BillboardPlacement
  /** Rail slot code (L1-R4), assigned by the admin at activation; null
   *  until then and always null on flipper ads. */
  rail_slot: RailSlot | null
  /** The slot the buyer asked for at submission — a preference, not a
   *  hold (first confirmed payment wins). Null = any slot; always null
   *  on flipper ads. */
  requested_rail_slot: RailSlot | null
  /** Where the payment instructions are emailed on approval (migration
   *  040); null on rows predating the field. */
  billing_email: string | null
  review_note: string | null
  starts_at: string | null
  ends_at: string | null
  clicks: number
  created_at: string
  isLive: boolean
}

const AMBER = '252 211 77'
const ZINC = '161 161 170'

/** The redo amber is the one literal triple that can't stay literal:
 *  amber-300 text is illegible on the light surface, so it flips to
 *  amber-700 via a scoped var. The class strings must stay literal —
 *  Tailwind's JIT can't see dynamically built ones. */
const AMBER_FLIP_CLS = '[--bb-amber:252_211_77] [html.light_&]:[--bb-amber:180_83_9]'

interface ChipMeta {
  label: string
  rgb: string
  /** True only for the redo amber — the dot then reads its color from
   *  the theme-flipping --bb-amber var instead of the raw triple. */
  amber?: boolean
}

/** Lifecycle chip. APPROVED fans out by payment/window state: payment
 *  stamps the 7-day window (self-serve Polar checkout, or the admin's
 *  manual override), so a bare APPROVED row is one the buyer can pay
 *  right now, and a future window is a paid ad queued behind a full
 *  board. Leaderboard creatives never have a window — their APPROVED
 *  states read from the bid standing instead (on the board, or ready
 *  to bid); isLive is always false for them and must not be trusted
 *  here. */
function chipMeta(
  ad: MineAd,
  now: Date,
  lbStanding: LeaderboardSponsorMineCreative | null
): ChipMeta {
  switch (ad.status) {
    case 'PENDING':
      return { label: 'In review', rgb: ZINC }
    case 'CHANGES_REQUESTED':
      return { label: 'Redo requested', rgb: AMBER, amber: true }
    case 'APPROVED': {
      if (ad.placement === 'leaderboard') {
        if (lbStanding && lbStanding.rank !== null) {
          return { label: `On the board · #${lbStanding.rank}`, rgb: 'var(--lb-up)' }
        }
        return { label: 'Ready to bid', rgb: ZINC }
      }
      if (ad.isLive) return { label: 'Live', rgb: 'var(--lb-up)' }
      if (ad.ends_at && new Date(ad.ends_at).getTime() < now.getTime()) {
        return { label: 'Run complete', rgb: ZINC }
      }
      if (ad.starts_at && new Date(ad.starts_at).getTime() > now.getTime()) {
        return { label: `Queued · live ${fmtDate(ad.starts_at)}`, rgb: ZINC }
      }
      return { label: 'Ready to pay', rgb: ZINC }
    }
    case 'REJECTED':
      return { label: 'Rejected', rgb: 'var(--lb-down)' }
    case 'ARCHIVED':
      return { label: 'Archived', rgb: ZINC }
    default: {
      const exhaustive: never = ad.status
      return exhaustive
    }
  }
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

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** Countdown against the payload's server clock, never the client's —
 *  the board's rolling-24h expiries are derived server-side and a
 *  skewed local clock must not warp them. 'now' covers the sliver
 *  where an entry expired between derivation and paint. */
function fmtRemaining(targetIso: string, serverIso: string): string {
  const ms = new Date(targetIso).getTime() - new Date(serverIso).getTime()
  if (ms <= 0) return 'now'
  const totalMinutes = Math.ceil(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${String(minutes).padStart(2, '0')}m`
}

/** Dollars-as-typed -> integer cents; null when it isn't money. Accepts
 *  an optional leading $, thousands commas and up to two decimals —
 *  parsed digit-wise so float rounding can never shave a cent. */
function parseUsdInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [dollars, cents = ''] = cleaned.split('.')
  return Number(dollars) * 100 + Number(cents.padEnd(2, '0') || '0')
}

/** Cents -> the bid input's dollars text ('7.66', '14'). */
function centsToInputValue(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

/** Gold is reserved for price numbers — the sponsorship page's rule.
 *  --lb-gold flips with the theme on its own. */
const GOLD = { color: 'rgb(var(--lb-gold))' } as const

const daysLeft = (endsAt: string, now: Date) =>
  Math.max(0, Math.ceil((new Date(endsAt).getTime() - now.getTime()) / 86_400_000))

/** Sort groups, ascending rank: what needs the buyer's eyes (or money)
 *  first, history last. `onBoard` is the leaderboard liveness signal —
 *  a ranked creative sorts like a live ad, an approved-but-inactive
 *  one like a slot awaiting the buyer's money. */
function sortGroup(ad: MineAd, now: Date, onBoard: boolean): number {
  switch (ad.status) {
    case 'CHANGES_REQUESTED':
      return 0
    case 'APPROVED': {
      if (ad.placement === 'leaderboard') return onBoard ? 1 : 3
      if (ad.isLive) return 1
      if (ad.ends_at && new Date(ad.ends_at).getTime() < now.getTime()) return 4
      return 3
    }
    case 'PENDING':
      return 2
    case 'REJECTED':
    case 'ARCHIVED':
      return 4
    default: {
      const exhaustive: never = ad.status
      return exhaustive
    }
  }
}

/** Action-first ordering; newest submission first within a group. */
function sortAds(ads: MineAd[], now: Date, onBoard: (ad: MineAd) => boolean): MineAd[] {
  return [...ads].sort((a, b) => {
    const g = sortGroup(a, now, onBoard(a)) - sortGroup(b, now, onBoard(b))
    if (g !== 0) return g
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

type FilterId = 'all' | 'live' | 'review' | 'ended'

/** In review covers the redo loop too — a CHANGES_REQUESTED card is
 *  still the buyer's to fix, not history. `onBoard` folds leaderboard
 *  liveness into Live; an expired-off leaderboard creative is never
 *  Ended — it's a bid away from being live again. */
function matchesFilter(ad: MineAd, filter: FilterId, now: Date, onBoard: boolean): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'live':
      return ad.isLive || onBoard
    case 'review':
      return ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED'
    case 'ended':
      return (
        ad.status === 'REJECTED' ||
        ad.status === 'ARCHIVED' ||
        (ad.status === 'APPROVED' &&
          !ad.isLive &&
          ad.ends_at !== null &&
          new Date(ad.ends_at).getTime() < now.getTime())
      )
    default: {
      const exhaustive: never = filter
      return exhaustive
    }
  }
}

const FILTERS: readonly SegmentedOption<FilterId>[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'review', label: 'In review' },
  { value: 'ended', label: 'Ended' }
]

/** Compact lifecycle pill: colored dot + 12px label. */
function Chip({ meta }: { meta: ChipMeta }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--st-border)] px-2 py-0.5 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full${meta.amber ? ` ${AMBER_FLIP_CLS}` : ''}`}
        style={{ background: meta.amber ? 'rgb(var(--bb-amber))' : `rgb(${meta.rgb})` }}
      />
      {meta.label}
    </span>
  )
}

/** The admin's written feedback — the loudest element of a redo/reject
 *  row, because answering (or reading) it is the buyer's next move.
 *  `amber` swaps the raw triple for the theme-flipping --bb-amber var
 *  (amber-300 is illegible on the light surface). */
function FeedbackNote({
  note,
  rgb,
  title,
  amber
}: {
  note: string
  rgb: string
  title: string
  amber?: boolean
}) {
  const ink = amber ? 'var(--bb-amber)' : rgb
  return (
    <div
      className={`rounded-lg px-3 py-2.5${amber ? ` ${AMBER_FLIP_CLS}` : ''}`}
      style={{
        border: `1px solid rgb(${ink} / 0.35)`,
        background: `rgb(${ink} / 0.06)`
      }}
    >
      <span className="text-[12px] font-medium" style={{ color: `rgb(${ink})` }}>
        {title}
      </span>
      <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--st-text)]">{note}</p>
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-[color:var(--st-border)] rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] [box-shadow:var(--st-panel-shadow)]">
      {children}
    </div>
  )
}

function SkeletonRows() {
  return (
    <Panel>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <span className="block h-5 w-20 animate-pulse rounded-full bg-[color:var(--st-panel-hover)]" />
          <span className="block h-4 w-36 animate-pulse rounded bg-[color:var(--st-panel-hover)]" />
          <span className="ml-auto block h-4 w-28 animate-pulse rounded bg-[color:var(--st-panel-hover)]" />
        </div>
      ))}
    </Panel>
  )
}

/* ------------------------------------------------------------------ *
 * Leaderboard bid console — the money surface of an APPROVED
 * 'leaderboard' creative's expanded row. Polls the public board (GET
 * /api/billboard/leaderboard) on the shared 15s cadence while mounted,
 * pausing when the tab hides (BillboardTicker's stance), so the
 * displayed minimum tracks the live board. The charge preview is
 * leaderboardChargeCents against the buyer's fresh active total —
 * pricing math is never re-derived here, and the checkout route
 * re-prices server-side regardless. POST /leaderboard/checkout: 200
 * hands the browser to Polar's hosted page; a 409 carrying
 * minTargetCents means the board moved under the buyer — the console
 * refreshes its displayed minimum from the response, resets the target
 * to it, and asks again. It NEVER silently re-submits at a new price.
 * ------------------------------------------------------------------ */

function LeaderboardBidConsole({
  ad,
  standing,
  onChanged
}: {
  ad: MineAd
  /** Owner-side money row (pendingCents etc); null while loading. */
  standing: LeaderboardSponsorMineCreative | null
  /** Refreshes the parent creative list. */
  onChanged: () => void
}) {
  const [board, setBoard] = useState<LeaderboardSponsorBoard | null>(null)
  /** Dollars as typed. Tracks the fresh minimum until the buyer edits;
   *  a 409 resets the tracking so the re-asked price is the new min. */
  const [bidInput, setBidInput] = useState('')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The board-moved notice — the buyer must re-confirm the new price. */
  const [movedNotice, setMovedNotice] = useState<string | null>(null)

  // Poll the public board while the console is visible; pause on hidden
  // tabs and refetch immediately on return. Plain fetch on purpose —
  // the route's short CDN layer is what collapses everyone's polls.
  useEffect(() => {
    let cancelled = false
    let interval = 0
    const load = () => {
      fetch('/api/billboard/leaderboard')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: LeaderboardSponsorBoard | null) => {
          if (cancelled) return
          if (data && Array.isArray(data.board)) setBoard(data)
        })
        .catch(() => {
          // Keep the last board — the checkout re-prices server-side.
        })
    }
    const start = () => {
      if (interval === 0) {
        interval = window.setInterval(load, LEADERBOARD_SPONSOR_POLL_MS)
      }
    }
    const stop = () => {
      window.clearInterval(interval)
      interval = 0
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        load()
        start()
      } else {
        stop()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'visible') {
      load()
      start()
    }
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [])

  // Default the target to the fresh minimum until the buyer edits, so
  // the entry always opens on a price that would actually take #1.
  useEffect(() => {
    if (board === null || edited) return
    setBidInput(centsToInputValue(board.minTargetCents))
  }, [board, edited])

  const targetId = `lb-target-${ad.id}`

  if (board === null) {
    return (
      <div className="border-t border-[color:var(--st-border)] pt-3">
        <p className="text-[12.5px] text-[color:var(--st-text-faint)]">Loading the live board…</p>
      </div>
    )
  }

  const entry = board.board.find((boardEntry) => boardEntry.adId === ad.id) ?? null
  const activeCents = entry?.activeCents ?? 0
  const holdsTop = board.top !== null && board.top.adId === ad.id
  const targetCents = parseUsdInput(bidInput)
  const chargeCents = targetCents === null ? null : leaderboardChargeCents(targetCents, activeCents)
  const maxTargetCents = leaderboardMaxTargetCents(board.minTargetCents)

  // Client-side mirrors of the checkout route's gates — guidance only,
  // the server re-checks everything against the board it recomputes.
  let blocker: string | null = null
  if (targetCents === null) {
    blocker = 'Enter a dollar amount — e.g. 7.66'
  } else if (targetCents > maxTargetCents) {
    blocker = `Targets above ${formatSponsorUsd(maxTargetCents)} are refused.`
  } else if (targetCents <= activeCents) {
    blocker = `You already have ${formatSponsorUsd(activeCents)} active — set a higher target.`
  } else if (!holdsTop && targetCents < board.minTargetCents) {
    blocker = `Taking #1 needs at least ${formatSponsorUsd(board.minTargetCents)} right now.`
  }
  const chargeReady = blocker === null && chargeCents !== null && chargeCents > 0
  // The $2.00 floor overshot the difference — worth calling out because
  // the buyer pays more than the gap (and it all still counts).
  const floorApplied =
    chargeReady && targetCents !== null && chargeCents > targetCents - activeCents

  const submitBid = async () => {
    if (busy || targetCents === null) return
    setBusy(true)
    setError(null)
    setMovedNotice(null)
    let navigating = false
    try {
      const res = await fetch('/api/billboard/leaderboard/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId: ad.id, targetTotalCents: targetCents })
      })
      const data = await res.json().catch(() => null)

      if (res.status === 409 && typeof data?.minTargetCents === 'number') {
        // The board moved under the buyer. Refresh the displayed
        // minimum from the response (fresher than the CDN-cached
        // poll), reset the target to it, and re-ask.
        const freshMin = data.minTargetCents as number
        setBoard((prev) => (prev === null ? prev : { ...prev, minTargetCents: freshMin }))
        setEdited(false)
        setBidInput(centsToInputValue(freshMin))
        setMovedNotice(
          `Someone raised the board while you were deciding — taking #1 now starts at ${formatSponsorUsd(freshMin)}. The target below is updated; check the new charge and bid again if it still works for you.`
        )
        return
      }
      if (res.status === 409) {
        // The other 409: the creative slipped out of APPROVED under a
        // concurrent admin action — say so and refresh the tracker.
        setError(
          typeof data?.error === 'string' ? data.error : 'This creative can no longer bid.'
        )
        onChanged()
        return
      }
      if (!res.ok || typeof data?.url !== 'string') {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : 'Could not start the checkout — try again.'
        )
        return
      }

      // Hand the browser to Polar's hosted checkout. It returns to
      // /sponsorship?lb_checkout=success, where the landing runs the
      // bid sync so the rank shows without waiting for the webhook.
      navigating = true
      window.location.assign(data.url)
    } catch {
      setError('Network error — try again.')
    } finally {
      if (!navigating) setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-[color:var(--st-border)] pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
          Bid for the board
        </span>
        <span className="text-[12px] text-[color:var(--st-text-faint)]">
          Live — refreshes every {LEADERBOARD_SPONSOR_POLL_MS / 1000}s
        </span>
      </div>

      {/* ---- your standing, from the same payload the board paints ---- */}
      <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
        {entry !== null ? (
          <>
            {`You're `}
            <span className="font-medium text-[color:var(--st-text)]">#{entry.rank}</span>
            {' with '}
            <span className="font-data tabular-nums" style={GOLD}>
              {formatSponsorUsd(entry.activeCents)}
            </span>
            {' active — your total next drops in '}
            <span className="font-data tabular-nums">
              {fmtRemaining(entry.nextDropAt, board.serverTime)}
            </span>
            {' and leaves the board in '}
            <span className="font-data tabular-nums">
              {fmtRemaining(entry.expiresAt, board.serverTime)}
            </span>
            .
          </>
        ) : (
          <>
            Nothing active right now — each payment counts for 24 hours from the moment it
            lands, then drops off.
          </>
        )}
      </p>

      {/* ---- the active board with expirations ---- */}
      {board.board.length === 0 ? (
        <p className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          Nobody holds the board — the first bid takes #1 for{' '}
          <span className="font-data tabular-nums" style={GOLD}>
            {formatSponsorUsd(board.openingCents)}
          </span>
          .
        </p>
      ) : (
        <div className="space-y-1">
          {board.board.map((boardEntry) => (
            <p key={boardEntry.adId} className="flex items-baseline gap-2 text-[12px] leading-4">
              <span className="font-data w-6 shrink-0 tabular-nums text-[color:var(--st-text-faint)]">
                #{boardEntry.rank}
              </span>
              <span
                className={`min-w-0 truncate ${
                  boardEntry.adId === ad.id
                    ? 'font-medium text-[color:var(--st-text)]'
                    : 'text-[color:var(--st-text-muted)]'
                }`}
              >
                {boardEntry.companyName || boardEntry.linkHost || 'Sponsor'}
                {boardEntry.adId === ad.id ? ' — you' : ''}
              </span>
              <span className="ml-auto shrink-0 font-data tabular-nums" style={GOLD}>
                {formatSponsorUsd(boardEntry.activeCents)}
              </span>
              <span className="shrink-0 font-data tabular-nums text-[color:var(--st-text-faint)]">
                off in {fmtRemaining(boardEntry.expiresAt, board.serverTime)}
              </span>
            </p>
          ))}
        </div>
      )}

      {/* ---- an unfinished checkout is money in flight, not on the
          board — warn before the buyer double-charges blindly ---- */}
      {standing !== null && standing.pendingCents > 0 && (
        <div
          className={`rounded-lg px-3 py-2.5 text-[13px] leading-5 ${AMBER_FLIP_CLS}`}
          style={{
            color: 'rgb(var(--bb-amber))',
            border: '1px solid rgb(var(--bb-amber) / 0.35)',
            background: 'rgb(var(--bb-amber) / 0.06)'
          }}
          role="status"
        >
          <span className="mr-2 font-medium">Checkout in flight</span>
          {formatSponsorUsd(standing.pendingCents)} from an earlier checkout {`hasn't`} settled
          — if you finished paying, it lands on the board shortly. Bidding again starts a
          separate charge.
        </div>
      )}

      {movedNotice && (
        <div
          className={`rounded-lg px-3 py-2.5 text-[13px] leading-5 ${AMBER_FLIP_CLS}`}
          style={{
            color: 'rgb(var(--bb-amber))',
            border: '1px solid rgb(var(--bb-amber) / 0.35)',
            background: 'rgb(var(--bb-amber) / 0.06)'
          }}
          role="status"
        >
          <span className="mr-2 font-medium">The board moved</span>
          {movedNotice}
        </div>
      )}

      {/* ---- target entry + the explicit charge preview ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label
              htmlFor={targetId}
              className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]"
            >
              Target total
            </label>
            <span className="text-[12.5px] tabular-nums text-[color:var(--st-text-faint)]">
              {holdsTop
                ? `you hold #1 — anything above ${formatSponsorUsd(activeCents)}`
                : `min ${formatSponsorUsd(board.minTargetCents)}`}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span aria-hidden className="text-[15px] text-[color:var(--st-text-muted)]">
              $
            </span>
            <input
              id={targetId}
              value={bidInput}
              onChange={(event) => {
                setBidInput(event.target.value)
                setEdited(true)
              }}
              inputMode="decimal"
              className="st-input block w-full rounded-lg px-3 py-2.5 text-[16px] leading-6 tabular-nums md:py-1.5 md:text-[15px]"
            />
          </div>
        </div>

        <div className="rounded-lg border border-[color:var(--st-border)] px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] text-[color:var(--st-text-muted)]">You pay now</span>
            <span className="font-data text-[15px] tabular-nums" style={GOLD}>
              {chargeReady && chargeCents !== null ? formatSponsorUsd(chargeCents) : '—'}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-4 text-[color:var(--st-text-faint)]">
            {floorApplied
              ? `${formatSponsorUsd(LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS)} checkout minimum — the full charge still counts toward your total.`
              : `The difference between your target and your ${formatSponsorUsd(activeCents)} active total.`}
          </p>
        </div>
      </div>

      {blocker !== null && (
        <p className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">{blocker}</p>
      )}

      {error && (
        <p
          className="rounded-lg px-3 py-2.5 text-[13px] leading-5"
          style={{
            color: 'var(--st-danger)',
            border: '1px solid var(--st-danger-muted)',
            background: 'var(--st-danger-bg)'
          }}
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="space-y-2">
        <SettingsButton
          variant="solid"
          pending={busy}
          disabled={blocker !== null}
          onClick={submitBid}
        >
          {busy
            ? 'Starting checkout…'
            : chargeReady && chargeCents !== null
              ? `Bid — pay ${formatSponsorUsd(chargeCents)}`
              : 'Bid'}
        </SettingsButton>
        <p className="text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
          Card checkout by Polar. A bid buys ranked exposure, not guaranteed time at #1 —
          checkout {`doesn't`} reserve the spot, the minimum is re-checked when you bid, and
          anyone can outbid you after. Every payment counts for 24 hours from the moment it
          completes, then drops off.
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Slot pay console — the money surface of an APPROVED flipper/rail
 * row with no live or scheduled window (a first run or a renewal).
 * POST /api/billboard/checkout prices server-side and answers with the
 * hosted checkout URL plus the estimated window: an immediate start
 * hands the browser straight to Polar; queued: true means the board
 * (or the picked slot) is full, so the go-live date is disclosed in a
 * confirm step BEFORE anything is charged — the held checkout URL is
 * reused if the buyer re-asks for the same slot, since the server
 * refuses a second in-flight checkout per ad (409) for ~2 hours.
 * Rails pick their slot here and the choice is binding: the ladder
 * prices per slot, and the paid slot becomes the live one.
 * ------------------------------------------------------------------ */

function SlotPayConsole({
  ad,
  renews,
  onChanged
}: {
  ad: MineAd
  /** True when this books a fresh window after a completed run. */
  renews: boolean
  /** Refreshes the parent creative list. */
  onChanged: () => void
}) {
  const isRail = ad.placement === 'rail'
  /** The binding slot choice (rails only): the submission-time wish
   *  opens preselected, but the buyer can move before paying. */
  const [slot, setSlot] = useState<RailSlot | null>(isRail ? ad.requested_rail_slot : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A queued checkout awaiting the buyer's go-ahead. Kept after "Not
   *  now" so re-asking for the same slot reopens THIS checkout instead
   *  of 409ing against its own PENDING ledger row. */
  const [held, setHeld] = useState<{
    url: string
    startsAt: string
    slot: RailSlot | null
  } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const listCents = isRail
    ? slot !== null
      ? RAIL_SLOT_PRICE_CENTS[slot]
      : null
    : BILLBOARD_PRICE_CENTS
  const grossCents = listCents === null ? null : billboardSlotGrossCents(listCents)

  const pickSlot = (next: RailSlot) => {
    setSlot(next)
    setError(null)
    setConfirming(false)
  }

  const startCheckout = async () => {
    if (busy) return
    if (held !== null && held.slot === slot) {
      setError(null)
      setConfirming(true)
      return
    }
    setBusy(true)
    setError(null)
    let navigating = false
    try {
      const res = await fetch('/api/billboard/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isRail ? { adId: ad.id, slot } : { adId: ad.id })
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || typeof data?.url !== 'string') {
        const message =
          typeof data?.error === 'string'
            ? data.error
            : 'Could not start the checkout — try again.'
        // The 409s: an in-flight checkout (finish or wait out its ~2h
        // TTL), or the row changed under us (a paid window landed, or
        // review moved) — either way say so and refresh the truth.
        setError(
          res.status === 409
            ? `${message} If you just paid, it settles here shortly — otherwise retry in a moment.`
            : message
        )
        if (res.status === 409) onChanged()
        return
      }

      if (data.queued === true && typeof data.estimatedStartsAt === 'string') {
        // Full board / taken slot: hold the checkout and disclose the
        // go-live date. Nothing is charged until the buyer continues.
        setHeld({ url: data.url, startsAt: data.estimatedStartsAt, slot })
        setConfirming(true)
        return
      }

      // Hand the browser to Polar's hosted checkout. It returns to
      // /sponsorship?bb_checkout=success, where the landing runs the
      // slot sync so the window shows without waiting for the webhook.
      navigating = true
      window.location.assign(data.url)
    } catch {
      setError('Network error — try again.')
    } finally {
      if (!navigating) setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-[color:var(--st-border)] pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
          {renews ? 'Run it again' : 'Approved — pay to go live'}
        </span>
        <span className="font-data text-[12px] tabular-nums" style={GOLD}>
          {listCents !== null
            ? `$${listCents / 100}/wk`
            : `from $${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk`}
        </span>
      </div>

      <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
        {renews
          ? `The last run is done — pay below and a fresh ${BILLBOARD_DURATION_DAYS}-day window books itself.`
          : `Pay below and your ${BILLBOARD_DURATION_DAYS}-day run books itself, live the moment the payment lands.`}
        {isRail && ' The slot you pick here is the slot you get.'} If the spot is taken, the
        go-live date is shown before anything is charged.
      </p>

      {isRail && (
        <div className="grid auto-cols-fr grid-flow-col grid-rows-4 gap-2">
          {RAIL_SLOTS.map((railSlot) => {
            const selected = slot === railSlot
            return (
              <button
                key={railSlot}
                type="button"
                aria-pressed={selected}
                aria-label={`Pick rail slot ${railSlot}`}
                onClick={() => pickSlot(railSlot)}
                className={`min-w-0 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  selected
                    ? 'border-[color:var(--st-border-strong)] bg-[color:var(--st-panel-hover)]'
                    : 'border-[color:var(--st-border)] hover:border-[color:var(--st-border-strong)] hover:bg-[color:var(--st-panel-hover)]'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-data text-[12px] font-medium tabular-nums text-[color:var(--st-text)]">
                    {railSlot}
                  </span>
                  <span className="font-data text-[12px] tabular-nums" style={GOLD}>
                    ${RAIL_SLOT_PRICE_CENTS[railSlot] / 100}/wk
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {confirming && held !== null && (
        <div
          className={`rounded-lg px-3 py-2.5 text-[13px] leading-5 ${AMBER_FLIP_CLS}`}
          style={{
            color: 'rgb(var(--bb-amber))',
            border: '1px solid rgb(var(--bb-amber) / 0.35)',
            background: 'rgb(var(--bb-amber) / 0.06)'
          }}
          role="status"
        >
          <span className="mr-2 font-medium">
            {isRail ? `Slot ${held.slot} is taken right now` : 'The flipper is full right now'}
          </span>
          Paying queues this ad: it goes live {fmtDate(held.startsAt)} and runs{' '}
          {BILLBOARD_DURATION_DAYS} days from there.
        </div>
      )}

      {error && (
        <p
          className="rounded-lg px-3 py-2.5 text-[13px] leading-5"
          style={{
            color: 'var(--st-danger)',
            border: '1px solid var(--st-danger-muted)',
            background: 'var(--st-danger-bg)'
          }}
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="space-y-2">
        {confirming && held !== null ? (
          <div className="flex flex-wrap gap-2">
            <SettingsButton
              variant="solid"
              onClick={() => window.location.assign(held.url)}
            >
              Continue to payment — live {fmtDate(held.startsAt)}
            </SettingsButton>
            <SettingsButton variant="ghost" onClick={() => setConfirming(false)}>
              Not now
            </SettingsButton>
          </div>
        ) : (
          <SettingsButton
            variant="solid"
            pending={busy}
            disabled={isRail && slot === null}
            onClick={startCheckout}
          >
            {busy
              ? 'Starting checkout…'
              : listCents !== null
                ? `Pay $${listCents / 100}/wk`
                : 'Pick a slot to pay'}
          </SettingsButton>
        )}
        <p className="text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
          Card checkout by Polar — a processing fee is added at checkout
          {grossCents !== null ? `: $${grossCents / 100} total` : ''}. Stuck, or paying some
          other way? DM{' '}
          <a
            href={BILLBOARD_PAYMENT_X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[color:var(--st-text-muted)] transition-colors hover:text-[color:var(--st-text)]"
          >
            @{BILLBOARD_PAYMENT_X_HANDLE}
          </a>{' '}
          on X and it gets sorted by hand.
        </p>
      </div>
    </div>
  )
}

function AdRow({
  ad,
  lbStanding,
  initiallyOpen,
  fallbackLogoUrl,
  onChanged
}: {
  ad: MineAd
  /** This creative's row from /api/billboard/leaderboard/mine — null
   *  for non-leaderboard ads and while that fetch is in flight. */
  lbStanding: LeaderboardSponsorMineCreative | null
  initiallyOpen?: boolean
  fallbackLogoUrl: string | null
  onChanged: () => void
}) {
  const [open, setOpen] = useState(Boolean(initiallyOpen))
  const [editing, setEditing] = useState(false)
  const now = new Date()
  const meta = chipMeta(ad, now, lbStanding)
  const editable = ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED'

  // The weekly products' money states. A future window is a paid ad
  // queued behind a full board — sold, nothing to pay. Payable is the
  // checkout route's own gate mirrored: APPROVED, not live, no window
  // ahead of (or spanning) now — a bare first run or a completed one
  // ready to renew.
  const isWeekly = ad.placement === 'flipper' || ad.placement === 'rail'
  const queuedStartsAt =
    ad.status === 'APPROVED' &&
    isWeekly &&
    !ad.isLive &&
    ad.starts_at !== null &&
    new Date(ad.starts_at).getTime() > now.getTime()
      ? ad.starts_at
      : null
  const runComplete =
    ad.status === 'APPROVED' &&
    isWeekly &&
    !ad.isLive &&
    ad.ends_at !== null &&
    new Date(ad.ends_at).getTime() < now.getTime()
  const payable =
    ad.status === 'APPROVED' &&
    isWeekly &&
    !ad.isLive &&
    queuedStartsAt === null &&
    (ad.ends_at === null || runComplete)

  const editTarget: AdFormTarget = {
    mode: 'edit',
    adId: ad.id,
    resubmits: ad.status === 'CHANGES_REQUESTED'
  }

  const title = ad.company_name ?? hostOfLink(ad.link_url) ?? 'Untitled'
  // A rail ad wears its assigned slot once the admin stamps one; until
  // then the buyer's request shows as a wish ("wants R1"), never as if
  // the slot were already theirs.
  const placementLabel =
    ad.placement === 'leaderboard'
      ? 'Leaderboard'
      : ad.placement === 'rail'
        ? ad.rail_slot
          ? `Rail · ${ad.rail_slot}`
          : ad.requested_rail_slot
            ? `Rail · wants ${ad.requested_rail_slot}`
            : 'Rail'
        : 'Flipper'
  const regionId = `billboard-ad-${ad.id}`

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-[color:var(--st-panel-hover)]"
      >
        <Chip meta={meta} />
        <span className="min-w-0 truncate text-[13.5px] font-medium leading-5 text-[color:var(--st-text)]">
          {title}
        </span>
        <span className="font-data shrink-0 text-[11.5px] text-[color:var(--st-text-muted)]">
          {placementLabel}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className="text-[12px] tabular-nums text-[color:var(--st-text-muted)]">
            {ad.clicks.toLocaleString()} click{ad.clicks === 1 ? '' : 's'}
            {ad.isLive && ad.ends_at
              ? ` · ${daysLeft(ad.ends_at, now)}d left`
              : ` · ${fmtDate(ad.created_at)}`}
          </span>
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 text-[color:var(--st-text-faint)] motion-safe:transition-transform motion-safe:duration-150 ${open ? 'rotate-180' : ''}`}
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </button>

      {open && (
        <div id={regionId} className="space-y-3 px-4 pb-4 pt-1">
          <BillboardPreviewStage
            density="compact"
            title={ad.company_name ?? hostOfLink(ad.link_url) ?? 'Untitled'}
            text={ad.text}
            logoUrl={ad.logo_url ?? fallbackLogoUrl}
            accentColor={ad.accent_color}
            placement={ad.placement}
            slot={ad.rail_slot ?? ad.requested_rail_slot}
          />
          <p className="truncate text-[12px] text-[color:var(--st-text-faint)]">
            Links to <span className="text-[color:var(--st-text-muted)]">{ad.link_url}</span>
          </p>

          {ad.status === 'CHANGES_REQUESTED' && ad.review_note && (
            <FeedbackNote note={ad.review_note} rgb={AMBER} title="Admin feedback" amber />
          )}
          {ad.status === 'REJECTED' && (
            <FeedbackNote
              note={ad.review_note ?? 'No reason was recorded.'}
              rgb="var(--lb-down)"
              title="Rejected — why"
            />
          )}

          {ad.status === 'PENDING' && (
            <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
              In the review queue — a human checks every card. You can still edit it while it
              waits.
              {ad.placement === 'leaderboard' &&
                ' Approval is one-time — once it lands, bidding opens right here.'}
            </p>
          )}

          {queuedStartsAt !== null && (
            <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
              Paid and queued — the spot was taken when your payment landed, so this ad goes
              live{' '}
              <span className="font-medium text-[color:var(--st-text)]">
                {fmtDate(queuedStartsAt)}
              </span>{' '}
              and runs {BILLBOARD_DURATION_DAYS} days from there. Nothing left to do.
            </p>
          )}

          {ad.status === 'APPROVED' && ad.starts_at && ad.ends_at && (
            <p className="text-[12px] text-[color:var(--st-text-muted)]">
              <span className="tabular-nums">
                {fmtDate(ad.starts_at)} → {fmtDate(ad.ends_at)}
              </span>
              {ad.placement === 'rail' && ad.rail_slot && <span> · Slot {ad.rail_slot}</span>}
              {ad.isLive && <span> · {daysLeft(ad.ends_at, now)}d left</span>}
              <span className="tabular-nums">
                {' '}
                · {ad.clicks.toLocaleString()} click{ad.clicks === 1 ? '' : 's'}
              </span>
            </p>
          )}

          {ad.status === 'ARCHIVED' && (
            <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
              Retired by an admin. Its click stats are kept
              {ad.clicks > 0 ? ` — ${ad.clicks.toLocaleString()} total.` : '.'}
            </p>
          )}

          {/* An approved leaderboard creative's whole point: the bid
              console — live board, target entry, charge preview and the
              Polar handoff. */}
          {ad.status === 'APPROVED' && ad.placement === 'leaderboard' && (
            <LeaderboardBidConsole ad={ad} standing={lbStanding} onChanged={onChanged} />
          )}

          {/* The weekly products' money surface: self-serve checkout for
              a bare approved row, or a renewal after a completed run. */}
          {payable && <SlotPayConsole ad={ad} renews={runComplete} onChanged={onChanged} />}

          {editable && !editing && (
            <div>
              <SettingsButton variant="ghost" onClick={() => setEditing(true)}>
                {ad.status === 'CHANGES_REQUESTED' ? 'Edit & resubmit' : 'Edit'}
              </SettingsButton>
            </div>
          )}

          {editing && (
            <div className="border-t border-[color:var(--st-border)] pt-4">
              <BillboardSubmitForm
                target={editTarget}
                initial={{
                  company_name: ad.company_name ?? '',
                  text: ad.text,
                  link_url: ad.link_url,
                  logo_url: ad.logo_url ?? '',
                  placement: ad.placement,
                  requested_rail_slot: ad.requested_rail_slot,
                  billing_email: ad.billing_email ?? ''
                }}
                fallbackLogoUrl={fallbackLogoUrl}
                signedIn={true}
                onSaved={() => {
                  setEditing(false)
                  onChanged()
                }}
                onConflict={onChanged}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function BillboardStatusTracker({
  ads,
  loading,
  error,
  signedIn,
  fallbackLogoUrl,
  onChanged,
  onBrowseSlots,
  focusLeaderboardBid = false
}: {
  ads: MineAd[]
  loading: boolean
  error: string | null
  signedIn: boolean | null
  fallbackLogoUrl: string | null
  onChanged: () => void
  /** Hands the empty state's Browse slots button to the parent, which
   *  switches /sponsorship to the buy tab. Omitting it drops the button. */
  onBrowseSlots?: () => void
  /** Deep-linked OUTBID visitors land with their first leaderboard
   *  creative expanded so the payment action is immediately visible. */
  focusLeaderboardBid?: boolean
}) {
  const [filter, setFilter] = useState<FilterId>('all')

  /** The owner's leaderboard money standing (ranks, active/pending
   *  cents), refreshed on the live-board cadence while visible. This
   *  clears an in-flight warning when the webhook settles without a page
   *  reload and keeps row chips aligned with the public board. */
  const [lbMine, setLbMine] = useState<LeaderboardSponsorMine | null>(null)
  const hasLeaderboardAds = ads.some((ad) => ad.placement === 'leaderboard')
  useEffect(() => {
    if (!hasLeaderboardAds) {
      setLbMine(null)
      return
    }
    let cancelled = false
    let interval = 0
    const load = () => {
      fetch('/api/billboard/leaderboard/mine', {
        credentials: 'include',
        cache: 'no-store'
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: LeaderboardSponsorMine | null) => {
          if (cancelled) return
          if (data && Array.isArray(data.creatives)) setLbMine(data)
        })
        .catch(() => {
          // Degrade gracefully — the bid console's public board remains.
        })
    }
    const start = () => {
      if (interval === 0) interval = window.setInterval(load, LEADERBOARD_SPONSOR_POLL_MS)
    }
    const stop = () => {
      window.clearInterval(interval)
      interval = 0
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        load()
        start()
      } else {
        stop()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'visible') {
      load()
      start()
    }
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [hasLeaderboardAds])

  const lbByAd = useMemo(
    () => new Map((lbMine?.creatives ?? []).map((creative) => [creative.adId, creative])),
    [lbMine]
  )

  const visible = useMemo(() => {
    const now = new Date()
    const onBoard = (ad: MineAd) => (lbByAd.get(ad.id)?.rank ?? null) !== null
    return sortAds(ads, now, onBoard).filter((ad) =>
      matchesFilter(ad, filter, now, onBoard(ad))
    )
  }, [ads, filter, lbByAd])
  const focusedLeaderboardAdId = focusLeaderboardBid
    ? ads.find((ad) => ad.placement === 'leaderboard')?.id ?? null
    : null

  if (signedIn === false) {
    return (
      <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-4 py-4 text-left [box-shadow:var(--st-panel-shadow)]">
        <p className="text-[13.5px] font-medium leading-5 text-[color:var(--st-text)]">
          Track your slots here.
        </p>
        <p className="mt-1 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          Submissions, review feedback, live windows and clicks all land on this tab.
        </p>
        <Link
          href="/login"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-[color:var(--st-text)] transition-colors hover:text-[color:var(--st-text-muted)] md:min-h-0"
        >
          Sign in to track your slots <span aria-hidden>→</span>
        </Link>
      </div>
    )
  }

  if (loading) {
    return <SkeletonRows />
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-4 py-4 text-left [box-shadow:var(--st-panel-shadow)]">
        <p className="text-[13.5px] font-medium leading-5 text-[color:var(--st-danger)]">
          {error}
        </p>
        <div className="mt-3">
          <SettingsButton variant="ghost" onClick={onChanged}>
            Retry
          </SettingsButton>
        </div>
      </div>
    )
  }

  if (ads.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-4 py-4 text-left [box-shadow:var(--st-panel-shadow)]">
        <p className="text-[13.5px] font-medium leading-5 text-[color:var(--st-text)]">
          No submissions yet.
        </p>
        <p className="mt-1 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          Pitch a card and it lands here for tracking.
        </p>
        {onBrowseSlots && (
          <div className="mt-3">
            <SettingsButton variant="ghost" onClick={onBrowseSlots}>
              Browse slots
            </SettingsButton>
          </div>
        )}
      </div>
    )
  }

  // Leaderboard liveness (an active bid total) counts as live — isLive
  // is always false for that placement.
  const liveCount = ads.filter(
    (ad) => ad.isLive || (lbByAd.get(ad.id)?.rank ?? null) !== null
  ).length
  const reviewCount = ads.filter(
    (ad) => ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED'
  ).length
  const totalClicks = ads.reduce((sum, ad) => sum + ad.clicks, 0)
  const summaryParts: string[] = []
  if (liveCount > 0) summaryParts.push(`${liveCount} live`)
  if (reviewCount > 0) summaryParts.push(`${reviewCount} in review`)
  summaryParts.push(`${totalClicks.toLocaleString()} total clicks`)

  return (
    <div>
      {ads.length > 1 && (
        <p className="mb-3 text-[12.5px] tabular-nums text-[color:var(--st-text-muted)]">
          {summaryParts.join(' · ')}
        </p>
      )}

      <div className="mb-3">
        <SegmentedControl
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          aria-label="Filter your ads"
        />
      </div>

      <Panel>
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[color:var(--st-text-muted)]">
            Nothing in this view.
          </p>
        ) : (
          visible.map((ad) => (
            <AdRow
              key={ad.id}
              ad={ad}
              lbStanding={lbByAd.get(ad.id) ?? null}
              initiallyOpen={ad.id === focusedLeaderboardAdId}
              fallbackLogoUrl={fallbackLogoUrl}
              onChanged={onChanged}
            />
          ))
        )}
      </Panel>
    </div>
  )
}
