'use client'

// The /sponsorship buyer page: a full-width (max-w-6xl) composition in
// the settings design system. A header band (title + the Your ads / Buy
// a slot segmented control), then either the status tracker or the buy
// flow in three bands — an inventory strip (flipper cell + rail map in
// one flush panel), a two-column studio (fields left, sticky live
// preview right), and a compact how-it-works. The .settings-scope
// wrapper and page font live in the sponsorship layout, not here.
// Signed-out visitors get the buy view — the composer swaps its submit
// button for a sign-in link, and the tracker shows a sign-in prompt if
// they switch tabs.
//
// The tab default is chosen once, when /api/user/me and
// /api/billboard/mine first resolve (signed-out or zero ads -> buy,
// existing ads -> mine); manual switches after that are never
// overridden. claimSlot (the flipper cell, the leaderboard cell, a
// rail cell, or a ?slot= deep link from a vacant rail CTA) jumps to
// the buy view and remounts the composer with the placement — and, for
// rails, the exact slot — preselected; the form reads `initial` at
// mount only, so the key must change on every claim.
//
// The leaderboard product (migration 055) also lives here: its
// inventory cell shows the current #1 and the live minimum to outbid
// from the public GET /api/billboard/leaderboard, polled on the shared
// 15s cadence while the buy view is visible (paused on hidden tabs —
// BillboardTicker's stance), and picking it swaps in the ranked board
// panel and the bid-flavored how-it-works. Bidding itself lives in the
// tracker (an approved creative's row); returning from Polar checkout
// lands back here as /sponsorship?lb_checkout=success, where a mount effect
// switches to Your ads and runs POST
// /api/billboard/leaderboard/sync so the buyer sees their rank without
// waiting for the webhook. Terminal results clear the checkout params;
// a still-pending result keeps them so refresh can retry safely.
//
// Flipper/rail slot payments (migration 061) mirror that shape: the
// tracker's slot pay console hands the buyer to Polar, and the return
// lands here as /sponsorship?bb_checkout=success&checkout_id=… where a
// twin mount effect runs POST /api/billboard/checkout/sync for that
// exact checkout and reloads the tracker. The two legs never coexist
// on one URL and each strips only its own params.
//
// The studio preview flows upward: the form owns placeholder / avatar /
// accent resolution and reports AdPreviewValues through onPreviewChange
// (on mount and on every preview-relevant change); this page forwards
// the latest snapshot into the sticky BillboardPreviewStage. claimSlot
// clears the snapshot so a remounting composer never paints stale
// values — the gap before the fresh mount's first callback (one paint
// at most) falls back to defaults derived here.

import { useCallback, useEffect, useState } from 'react'
import { BillboardPreviewStage } from '@/components/billboard/BillboardPreviewStage'
import {
  BillboardStatusTracker,
  type MineAd
} from '@/components/billboard/BillboardStatusTracker'
import {
  BillboardSubmitForm,
  type AdFormValues,
  type AdPreviewValues
} from '@/components/billboard/BillboardSubmitForm'
import {
  SegmentedControl,
  Skeleton,
  type SegmentedOption
} from '@/components/settings'
import { toast } from '@/components/Toaster'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  BILLBOARD_TEXT_MAX,
  RAIL_SLOTS,
  RAIL_SLOT_PRICE_CENTS,
  isRailSlot,
  type BillboardPlacement,
  type RailSlot,
  type SlotBoard
} from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_OPENING_CENTS,
  LEADERBOARD_SPONSOR_POLL_MS,
  formatSponsorUsd,
  type LeaderboardSponsorBoard
} from '@/lib/leaderboardSponsor'
import { fetchMe } from '@/lib/client/fetchMe'
import type { MeUser } from '@/types/dashboard'

type BillboardView = 'mine' | 'buy'

const VIEW_OPTIONS: readonly SegmentedOption<BillboardView>[] = [
  { value: 'mine', label: 'Your ads' },
  { value: 'buy', label: 'Buy a slot' }
]

/** Gold is reserved for weekly price numbers — nothing else on this page. */
const GOLD = { color: 'rgb(var(--lb-gold))' }

/** The flush panel skin shared by the inventory strip, the composer well
 *  and how-it-works. */
const PANEL =
  'rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] [box-shadow:var(--st-panel-shadow)]'

const HOW_IT_WORKS: { label: string; body: string }[] = [
  {
    label: 'Submit',
    body: 'Logo, one line, one link. A human reviews every card.'
  },
  {
    label: 'Human review',
    body: 'Approved, redo with notes, or rejected. Status lands in Your ads.'
  },
  {
    label: 'Pay by card',
    body: `Approved cards unlock checkout in Your ads. @${BILLBOARD_PAYMENT_X_HANDLE} on X stays the backup.`
  },
  {
    label: `Live ${BILLBOARD_DURATION_DAYS} days`,
    body: 'The window books itself the moment payment lands. Clicks are counted.'
  }
]

/** The leaderboard bid's own steps — its money story (card checkout,
 *  rolling 24h ranking) shares nothing with the weekly email flow, so
 *  the band swaps wholesale when that product is picked. */
const HOW_IT_WORKS_LEADERBOARD: { label: string; body: string }[] = [
  {
    label: 'Submit',
    body: 'Logo, one line, one link. A human reviews every card.'
  },
  {
    label: 'One-time review',
    body: 'Approval is once per card — edits send it back through review.'
  },
  {
    label: 'Bid by card',
    body: 'From Your ads: pick a target total, see the exact charge, pay through Polar.'
  },
  {
    label: 'Rolling 24h',
    body: 'Each payment counts for 24 hours, then drops off. Rank follows the money.'
  }
]

// How-it-works is 2-col below lg and 4-col at lg; divide-* utilities
// can't track the column count across that breakpoint, so each cell
// draws its own hairlines by index.
const HOW_IT_WORKS_DIVIDERS = [
  '',
  'border-l',
  'border-t lg:border-l lg:border-t-0',
  'border-l border-t lg:border-t-0'
]

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** Countdown against the board payload's server clock, never the
 *  client's (the rolling-24h expiries are server-derived). Local
 *  mirror of the tracker's rule — a display convention, not a module. */
function fmtRemaining(targetIso: string, serverIso: string): string {
  const ms = new Date(targetIso).getTime() - new Date(serverIso).getTime()
  if (ms <= 0) return 'now'
  const totalMinutes = Math.ceil(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${String(minutes).padStart(2, '0')}m`
}

export function BillboardLanding() {
  // Avatar for the preview fallback; also the first signed-in signal.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // null = still resolving. Both fetches may settle it; a definitive 401
  // wins so the page degrades to its read-only pitch.
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [ads, setAds] = useState<MineAd[] | null>(null)
  const [adsError, setAdsError] = useState<string | null>(null)
  /** Public availability for the weekly placements; null (loading or
   *  failed) keeps the strip's static codes and prices with placeholder
   *  occupancy rather than broken numbers. */
  const [board, setBoard] = useState<SlotBoard | null>(null)
  /** The public leaderboard sponsor board — the third cell's current #1
   *  and live minimum, and the ranked board panel when that product is
   *  picked. null (loading or failed) keeps the opening-price pitch. */
  const [sponsorBoard, setSponsorBoard] = useState<LeaderboardSponsorBoard | null>(null)
  /** null = not chosen yet — a skeleton holds the page until the first
   *  signed-in/ads resolution picks the default tab (no tab flash). */
  const [view, setView] = useState<BillboardView | null>(null)
  /** Placement (and, for rails, the exact slot) the composer mounts
   *  with after claimSlot; the nonce forces a remount even when the
   *  same claim is made twice. */
  const [placementIntent, setPlacementIntent] = useState<BillboardPlacement>('flipper')
  const [slotIntent, setSlotIntent] = useState<RailSlot | null>(null)
  const [composerNonce, setComposerNonce] = useState(0)
  /** Latest resolved snapshot from the composer, feeding the stage;
   *  null until the current composer mount's first onPreviewChange. */
  const [preview, setPreview] = useState<AdPreviewValues | null>(null)
  /** Deep link from the leaderboard KPI row. Existing leaderboard
   *  sponsors go straight to their expanded bid row; everyone else gets
   *  the leaderboard creative composer instead of the default Flipper. */
  const [leaderboardBidIntent, setLeaderboardBidIntent] = useState(false)
  /** Prevent the normal default-tab effect from winning the first mount
   *  before the URL intent effect has resolved. */
  const [bidIntentResolved, setBidIntentResolved] = useState(false)

  useEffect(() => {
    const intent = new URLSearchParams(window.location.search).get('intent')
    if (intent === 'leaderboard-bid') {
      setLeaderboardBidIntent(true)
      setPlacementIntent('leaderboard')
      setSlotIntent(null)
      setComposerNonce((nonce) => nonce + 1)
      setPreview(null)
    }
    setBidIntentResolved(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Shared /me client cache — never throws, resolves ok:false on
      // network failure so the page keeps its read-only pitch.
      const result = await fetchMe()
      if (cancelled) return
      if (!result.ok) {
        if (result.status === 401) setSignedIn(false)
        return
      }
      const user: MeUser | null = result.data.user ?? null
      setAvatarUrl(user?.twitter_profile_image || null)
      setSignedIn(true)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/billboard/slots')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SlotBoard | null) => {
        if (cancelled) return
        if (data && data.flipper && Array.isArray(data.rails)) setBoard(data)
      })
      .catch(() => {
        // Best effort — the pitch stands on its own without the board.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The leaderboard board is a live auction, so unlike the weekly slots
  // it polls: every LEADERBOARD_SPONSOR_POLL_MS while the buy view is
  // up, paused while the tab is hidden and refetched immediately on
  // return (BillboardTicker's visibility stance). Plain fetch on
  // purpose — the route's short CDN layer collapses everyone's polls.
  useEffect(() => {
    if (view !== 'buy') return
    let cancelled = false
    let interval = 0
    const load = () => {
      fetch('/api/billboard/leaderboard')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: LeaderboardSponsorBoard | null) => {
          if (cancelled) return
          if (data && Array.isArray(data.board)) setSponsorBoard(data)
        })
        .catch(() => {
          // Best effort — the cell keeps its opening-price pitch.
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
  }, [view])

  const loadMine = useCallback(async () => {
    setAdsError(null)
    try {
      const res = await fetch('/api/billboard/mine', {
        credentials: 'include',
        cache: 'no-store'
      })
      if (res.status === 401) {
        setSignedIn(false)
        setAds([])
        return
      }
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Load failed')
      }
      setAds(Array.isArray(data.ads) ? (data.ads as MineAd[]) : [])
      setSignedIn(true)
    } catch {
      setAdsError('Could not load your submissions.')
      setAds((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  // Choose the default tab once, when the signed-in/ads state first
  // resolves. An ads error still resolves (to buy — the composer works
  // without the list), so the skeleton can't outlive a failed fetch.
  useEffect(() => {
    if (view !== null || !bidIntentResolved) return
    const resolved = adsError !== null || (signedIn !== null && (!signedIn || ads !== null))
    if (!resolved) return
    if (leaderboardBidIntent) {
      const hasLeaderboardCreative = ads?.some((ad) => ad.placement === 'leaderboard') ?? false
      setView(signedIn === true && hasLeaderboardCreative ? 'mine' : 'buy')
      return
    }
    setView(signedIn === true && ads !== null && ads.length > 0 ? 'mine' : 'buy')
  }, [view, signedIn, ads, adsError, leaderboardBidIntent, bidIntentResolved])

  const claimSlot = useCallback((placement: BillboardPlacement, slot?: RailSlot) => {
    setView('buy')
    setPlacementIntent(placement)
    setSlotIntent(slot ?? null)
    setComposerNonce((n) => n + 1)
    // The composer remounts on the key change; drop the old snapshot so
    // the stage never paints stale values while the fresh mount's first
    // onPreviewChange is in flight.
    setPreview(null)
    // #pitch only exists in the buy view — the double rAF lets the view
    // swap commit and paint before scrolling.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('pitch')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }, [])

  // The vacant rail CTAs deep-link /sponsorship?slot=L2#pitch. Read
  // window.location directly in a mount effect — useSearchParams would
  // drag the whole page behind a Suspense boundary for one read — and
  // claim like a board click: buy view, rail placement, that slot.
  useEffect(() => {
    const slot = new URLSearchParams(window.location.search).get('slot')
    if (isRailSlot(slot)) claimSlot('rail', slot)
  }, [claimSlot])

  // Return leg of a leaderboard bid: Polar's successUrl lands on
  // /sponsorship?lb_checkout=success&checkout_id=... (via the
  // /billboard redirect, query intact). Strip the params so a refresh
  // can't replay this, park the buyer on Your ads, and run the
  // pull-based bid sync — the webhook twin — so the paid bid ranks
  // without waiting for delivery (or at all, on localhost). The sync
  // reconciles every PENDING bid for this user, so checkout_id rides
  // along only as noise to clean up. Same window.location stance as the
  // ?slot= effect above.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('lb_checkout') !== 'success') return
    const checkoutId = params.get('checkout_id')
    let cancelled = false
    setLeaderboardBidIntent(true)
    setView('mine')

    const clearCheckoutParams = () => {
      const fresh = new URLSearchParams(window.location.search)
      fresh.delete('lb_checkout')
      fresh.delete('checkout_id')
      const rest = fresh.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}`
      )
    }

    const run = async () => {
      try {
        let response: Response | null = null
        let data: Record<string, unknown> | null = null

        // A successful card return normally has its paid order ready,
        // but give Polar a few seconds for asynchronous order creation.
        // The checkout id stays in the URL while still pending, so a
        // manual refresh can safely retry after the bounded loop.
        for (let attempt = 0; attempt < 4; attempt++) {
          response = await fetch('/api/billboard/leaderboard/sync', {
            method: 'POST',
            credentials: 'include',
            headers: checkoutId ? { 'Content-Type': 'application/json' } : undefined,
            body: checkoutId ? JSON.stringify({ checkoutId }) : undefined
          })
          data = await response.json().catch(() => null)
          if (cancelled) return
          if (!response.ok || data?.status !== 'pending' || attempt === 3) break
          await new Promise((resolve) => window.setTimeout(resolve, 1_500))
          if (cancelled) return
        }

        if (!response) throw new Error('No sync response')

        const status = typeof data?.status === 'string' ? data.status : null
        if (
          response.ok &&
          data?.success &&
          (status === 'activated' || status === 'already_active' || Number(data.activated) > 0)
        ) {
          clearCheckoutParams()
          toast({
            kind: 'success',
            title: 'Bid placed',
            body: 'Payment confirmed — your bid is active on the board.'
          })
        } else if (response.ok && data?.success && status === 'refunded') {
          clearCheckoutParams()
          toast({
            kind: 'error',
            title: 'Bid refunded',
            body: 'This payment was refunded, so it is not active on the board.'
          })
        } else if (
          response.ok &&
          data?.success &&
          (status === 'refused' || status === 'not_found')
        ) {
          clearCheckoutParams()
          toast({
            kind: 'error',
            title: 'Bid could not be activated',
            body: 'The checkout did not match a qualifying paid bid. No rank credit was added.'
          })
        } else if (response.ok && data?.success) {
          toast({
            kind: 'info',
            title: 'Confirming payment',
            body: 'Polar is still settling this checkout. Refresh this page to re-check it.'
          })
        } else {
          toast({
            kind: 'error',
            title: 'Could not confirm the payment yet',
            body: 'The board updates as soon as it lands — check back in a moment.'
          })
        }
      } catch {
        if (cancelled) return
        toast({
          kind: 'error',
          title: 'Could not confirm the payment yet',
          body: 'The board updates as soon as it lands — check back in a moment.'
        })
      }
      // Reload the creative lifecycle either way; the owner standing has
      // its own live poll and runs immediately whenever the tracker mounts.
      if (!cancelled) void loadMine()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [loadMine])

  // Return leg of a flipper/rail slot payment: the slot checkout's
  // successUrl lands on /sponsorship?bb_checkout=success&checkout_id=…
  // — the twin of the lb_checkout effect above, but targeted: POST
  // /api/billboard/checkout/sync reconciles that exact checkout and
  // answers with the window verdict. The two legs can't interfere —
  // Polar sends exactly one of the params per product, and each effect
  // strips only its own. Terminal results clear the checkout params; a
  // still-pending result keeps them so refresh can retry safely.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('bb_checkout') !== 'success') return
    const checkoutId = params.get('checkout_id')
    let cancelled = false
    setView('mine')

    const clearCheckoutParams = () => {
      const fresh = new URLSearchParams(window.location.search)
      fresh.delete('bb_checkout')
      fresh.delete('checkout_id')
      const rest = fresh.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}`
      )
    }

    const run = async () => {
      // The template token should always be interpolated on a success
      // return; without it there is nothing to reconcile — the webhook
      // still books the window on its own.
      if (!checkoutId) {
        clearCheckoutParams()
        return
      }
      try {
        let response: Response | null = null
        let data: Record<string, unknown> | null = null

        // A successful card return normally has its paid order ready,
        // but give Polar a few seconds for asynchronous order creation.
        // The checkout id stays in the URL while still pending, so a
        // manual refresh can safely retry after the bounded loop.
        for (let attempt = 0; attempt < 4; attempt++) {
          response = await fetch('/api/billboard/checkout/sync', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkoutId })
          })
          data = await response.json().catch(() => null)
          if (cancelled) return
          if (!response.ok || data?.status !== 'pending' || attempt === 3) break
          await new Promise((resolve) => window.setTimeout(resolve, 1_500))
          if (cancelled) return
        }

        if (!response) throw new Error('No sync response')

        const status = typeof data?.status === 'string' ? data.status : null
        if (
          response.ok &&
          data?.success &&
          (status === 'activated' || status === 'already_active')
        ) {
          clearCheckoutParams()
          toast({
            kind: 'success',
            title: 'Payment received',
            body: `Your ${BILLBOARD_DURATION_DAYS}-day window is booked — the row below shows whether your ad is live now or queued behind a full board.`
          })
        } else if (response.ok && data?.success && status === 'refunded') {
          clearCheckoutParams()
          toast({
            kind: 'error',
            title: 'Payment refunded',
            body: 'This checkout was refunded, so no window was booked.'
          })
        } else if (
          response.ok &&
          data?.success &&
          (status === 'refused' || status === 'not_found')
        ) {
          clearCheckoutParams()
          toast({
            kind: 'error',
            title: 'Payment could not be confirmed',
            body: `The checkout did not match a qualifying payment — nothing was activated. DM @${BILLBOARD_PAYMENT_X_HANDLE} on X if money left your card.`
          })
        } else if (response.ok && data?.success) {
          toast({
            kind: 'info',
            title: 'Payment processing…',
            body: 'Polar is still settling this checkout. Refresh this page to re-check it.'
          })
        } else {
          toast({
            kind: 'error',
            title: 'Could not confirm the payment yet',
            body: 'Your window books as soon as the payment settles — check back in a moment.'
          })
        }
      } catch {
        if (cancelled) return
        toast({
          kind: 'error',
          title: 'Could not confirm the payment yet',
          body: 'Your window books as soon as the payment settles — check back in a moment.'
        })
      }
      // Reload the creative lifecycle either way — the freshly stamped
      // window (or its absence) is what the tracker rows read from.
      if (!cancelled) void loadMine()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [loadMine])

  const flipperSelected = placementIntent === 'flipper'
  const flipperFull = board !== null && board.flipper.taken >= board.flipper.max
  // Claimable while open — and while the board is unknown, so a slow
  // fetch never blocks the pitch.
  const flipperClaimable = !flipperFull
  const flipperCellBody = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
          Flipper
        </span>
        <span className="font-data text-[12px] tabular-nums" style={GOLD}>
          ${BILLBOARD_PRICE_CENTS / 100}/wk
        </span>
      </span>
      <span className="mt-1.5 block text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
        Rotates under the nav on the dashboard and leaderboard.
      </span>
      <span
        className={`mt-3 block font-data text-[12px] leading-4 tabular-nums ${
          board === null
            ? 'text-[color:var(--st-text-faint)]'
            : flipperFull
              ? 'text-[color:var(--st-text-muted)]'
              : 'text-[color:var(--st-text)]'
        }`}
      >
        {board === null
          ? '—'
          : flipperFull
            ? `Full${
                board.flipper.nextOpensAt
                  ? ` · next opens ${fmtDate(board.flipper.nextOpensAt)}`
                  : ''
              }`
            : `${board.flipper.max - board.flipper.taken}/${board.flipper.max} open`}
      </span>
    </>
  )

  const leaderboardSelected = placementIntent === 'leaderboard'
  const lbTop = sponsorBoard?.top ?? null
  // Always claimable — the board can't fill up, it can only get more
  // expensive. The gold price is the live minimum that takes #1 (the
  // opening on an empty or unknown board), from the polled public GET.
  const leaderboardCellBody = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
          Leaderboard bid
        </span>
        <span className="font-data text-[12px] tabular-nums text-[color:var(--st-text-muted)]">
          {sponsorBoard !== null && lbTop !== null ? (
            <>
              <span style={GOLD}>{formatSponsorUsd(sponsorBoard.minTargetCents)}</span> takes #1
            </>
          ) : (
            <>
              from{' '}
              <span style={GOLD}>{formatSponsorUsd(LEADERBOARD_SPONSOR_OPENING_CENTS)}</span>
            </>
          )}
        </span>
      </span>
      <span className="mt-1.5 block text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
        Outbid the top sponsor on the leaderboard page. Every dollar runs for 24 hours.
      </span>
      <span
        className={`mt-3 block font-data text-[12px] leading-4 tabular-nums ${
          sponsorBoard === null
            ? 'text-[color:var(--st-text-faint)]'
            : 'text-[color:var(--st-text)]'
        }`}
      >
        {sponsorBoard === null
          ? '—'
          : lbTop === null
            ? `Open — claim #1 for ${formatSponsorUsd(sponsorBoard.openingCents)}`
            : `#1 ${lbTop.companyName || lbTop.linkHost || 'Sponsor'} · ${formatSponsorUsd(lbTop.activeCents)} active`}
      </span>
    </>
  )

  const composerInitial: AdFormValues = {
    company_name: '',
    text: '',
    link_url: '',
    logo_url: '',
    placement: placementIntent,
    requested_rail_slot: slotIntent,
    billing_email: ''
  }

  // The stage paints the composer's latest snapshot; until the current
  // mount's first callback lands (one paint at most — the form fires on
  // mount) these local defaults stand in.
  const stage: AdPreviewValues = preview ?? {
    title: 'Your company',
    text: 'Your one line goes here',
    logoUrl: avatarUrl,
    accentColor: null,
    placement: placementIntent,
    requestedSlot: slotIntent,
    usingAvatarFallback: avatarUrl !== null
  }

  return (
    <div className="page-zoom-out mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 md:px-8 md:pt-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[21px] font-semibold leading-7 tracking-[-0.01em] text-[color:var(--st-text)]">
            Sponsorship
          </h1>
          <p className="mt-1 text-[13.5px] leading-5 text-[color:var(--st-text-muted)]">
            Your logo, one line, and one link — on the leaderboard, dashboard, and every
            profile page for {BILLBOARD_DURATION_DAYS} days.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view === null ? (
            <Skeleton aria-hidden className="h-[50px] w-60 rounded-lg md:h-[30px]" />
          ) : (
            <SegmentedControl
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
              aria-label="Sponsorship view"
            />
          )}
        </div>
      </header>

      {view === null ? (
        <div aria-hidden className="mt-8">
          {/* ---- inventory strip sketch ---- */}
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-full max-w-sm" />
          <div className={`mt-3 overflow-hidden ${PANEL}`}>
            <div className="grid lg:grid-cols-2">
              <div className="flex flex-col">
                <div className="flex-1 p-4 sm:p-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-3 w-full max-w-xs" />
                  <Skeleton className="mt-3 h-3 w-20" />
                </div>
                <div className="flex-1 border-t border-[color:var(--st-border)] p-4 sm:p-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-3 w-full max-w-xs" />
                  <Skeleton className="mt-3 h-3 w-20" />
                </div>
              </div>
              <div className="border-t border-[color:var(--st-border)] p-4 sm:p-5 lg:border-l lg:border-t-0">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-3 w-full max-w-xs" />
                <div className="mt-3 grid auto-cols-fr grid-flow-col grid-rows-4 gap-2">
                  {RAIL_SLOTS.map((slot) => (
                    <Skeleton key={slot} className="h-11 w-full rounded-lg" />
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* ---- studio sketch ---- */}
          <div className="mt-8 space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] lg:gap-8 lg:space-y-0">
            <div className="lg:order-2">
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
            <div className="lg:order-1">
              <Skeleton className="h-80 w-full rounded-xl" />
            </div>
          </div>
        </div>
      ) : view === 'mine' ? (
        <div className="mt-6">
          <BillboardStatusTracker
            ads={ads ?? []}
            loading={ads === null && !adsError}
            error={adsError}
            signedIn={signedIn}
            fallbackLogoUrl={avatarUrl}
            onChanged={loadMine}
            onBrowseSlots={() => setView('buy')}
            focusLeaderboardBid={leaderboardBidIntent}
          />
        </div>
      ) : (
        <>
          {/* ---------- band 1: inventory strip ---------- */}
          <section className="mt-8">
            <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
              Become a sponsor
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              Pick a placement — a human reviews every card before anything runs.
            </p>

            <div className={`mt-3 overflow-hidden ${PANEL}`}>
              <div className="grid lg:grid-cols-2">
                {/* ---- left column: the two single-card products
                     stacked — flipper on top, leaderboard bid under it
                     — so their heights together balance the rail map's
                     four rows on lg. ---- */}
                <div className="flex flex-col">
                  {/* ---- flipper cell: one big claim button while open ---- */}
                  {flipperClaimable ? (
                    <button
                      type="button"
                      aria-pressed={flipperSelected}
                      aria-label="Claim a flipper slot"
                      onClick={() => claimSlot('flipper')}
                      className={`flex flex-1 flex-col p-4 text-left transition-colors sm:p-5 ${
                        flipperSelected
                          ? 'bg-[color:var(--st-panel-hover)] [box-shadow:inset_0_0_0_1px_var(--st-border-strong)]'
                          : 'hover:bg-[color:var(--st-panel-hover)]'
                      }`}
                    >
                      {flipperCellBody}
                    </button>
                  ) : (
                    <div
                      className={`flex flex-1 flex-col p-4 sm:p-5 ${
                        flipperSelected
                          ? 'bg-[color:var(--st-panel-hover)] [box-shadow:inset_0_0_0_1px_var(--st-border-strong)]'
                          : ''
                      }`}
                    >
                      {flipperCellBody}
                    </div>
                  )}

                  {/* ---- leaderboard cell: always claimable — the
                       board never fills, the price just climbs. ---- */}
                  <button
                    type="button"
                    aria-pressed={leaderboardSelected}
                    aria-label="Claim the leaderboard sponsor board"
                    onClick={() => claimSlot('leaderboard')}
                    className={`flex flex-1 flex-col border-t border-[color:var(--st-border)] p-4 text-left transition-colors sm:p-5 ${
                      leaderboardSelected
                        ? 'bg-[color:var(--st-panel-hover)] [box-shadow:inset_0_0_0_1px_var(--st-border-strong)]'
                        : 'hover:bg-[color:var(--st-panel-hover)]'
                    }`}
                  >
                    {leaderboardCellBody}
                  </button>
                </div>

                {/* ---- rail map cell: static codes and ladder prices,
                     live occupancy layered on when the board lands ---- */}
                <div className="border-t border-[color:var(--st-border)] p-4 sm:p-5 lg:border-l lg:border-t-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
                      Profile rail
                    </span>
                    <span className="font-data text-[12px] tabular-nums" style={GOLD}>
                      from ${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                    Always-on beside every profile. First confirmed payment takes the slot.
                  </p>

                  {/* Real geometry: L1-L4 down the first column, R1-R4 down
                      the second, like the profile pages themselves. */}
                  <div className="mt-3 grid auto-cols-fr grid-flow-col grid-rows-4 gap-2">
                    {RAIL_SLOTS.map((slot) => {
                      const rail = board?.rails.find((entry) => entry.slot === slot)
                      const takenUntil = rail?.takenUntil ?? null
                      const selected = placementIntent === 'rail' && slotIntent === slot
                      return (
                        <button
                          key={slot}
                          type="button"
                          aria-pressed={selected}
                          aria-label={`Claim rail slot ${slot}`}
                          // Re-clicking the selected slot relaxes the pitch
                          // to "any open slot" — placement stays rail.
                          onClick={() =>
                            selected ? claimSlot('rail') : claimSlot('rail', slot)
                          }
                          className={`min-w-0 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            selected
                              ? 'border-[color:var(--st-border-strong)] bg-[color:var(--st-panel-hover)]'
                              : 'border-[color:var(--st-border)] hover:border-[color:var(--st-border-strong)] hover:bg-[color:var(--st-panel-hover)]'
                          }`}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span
                              className={`font-data text-[12px] font-medium tabular-nums ${
                                takenUntil
                                  ? 'text-[color:var(--st-text-faint)]'
                                  : 'text-[color:var(--st-text)]'
                              }`}
                            >
                              {slot}
                            </span>
                            {/* Taken cells go all-faint — a request against
                                them is a preference, not a hold. */}
                            <span
                              className={`font-data text-[12px] tabular-nums ${
                                takenUntil ? 'text-[color:var(--st-text-faint)]' : ''
                              }`}
                              style={takenUntil ? undefined : GOLD}
                            >
                              ${RAIL_SLOT_PRICE_CENTS[slot] / 100}/wk
                            </span>
                          </span>
                          {takenUntil ? (
                            <span className="mt-0.5 flex min-w-0 items-baseline gap-1 text-[12px] leading-4 text-[color:var(--st-text-faint)]">
                              {rail?.companyName ? (
                                <span className="min-w-0 truncate">{rail.companyName}</span>
                              ) : null}
                              <span className="shrink-0 font-data tabular-nums">
                                until {fmtDate(takenUntil)}
                              </span>
                            </span>
                          ) : (
                            <span
                              className={`mt-0.5 block text-[12px] leading-4 ${
                                board
                                  ? 'text-[color:var(--st-text-muted)]'
                                  : 'text-[color:var(--st-text-faint)]'
                              }`}
                            >
                              {board ? 'Open' : '—'}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* ---- picking the leaderboard swaps in the live ranked
                 board, so the buyer sees exactly what a bid is up
                 against — every active sponsor, their totals, and when
                 each drops off. ---- */}
            {placementIntent === 'leaderboard' && (
              <div className={`mt-3 overflow-hidden ${PANEL}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[color:var(--st-border)] px-4 py-2.5 sm:px-5">
                  <span className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
                    The board right now
                  </span>
                  <span className="text-[12px] text-[color:var(--st-text-faint)]">
                    Live — refreshes every {LEADERBOARD_SPONSOR_POLL_MS / 1000}s
                  </span>
                </div>
                {sponsorBoard === null ? (
                  <p className="px-4 py-3 text-[12.5px] text-[color:var(--st-text-faint)] sm:px-5">
                    Loading the board…
                  </p>
                ) : sponsorBoard.board.length === 0 ? (
                  <p className="px-4 py-3 text-[12.5px] leading-5 text-[color:var(--st-text-muted)] sm:px-5">
                    Nobody holds the board — the first bid takes #1 for{' '}
                    <span className="font-data tabular-nums" style={GOLD}>
                      {formatSponsorUsd(sponsorBoard.openingCents)}
                    </span>
                    .
                  </p>
                ) : (
                  <div className="divide-y divide-[color:var(--st-border)]">
                    {sponsorBoard.board.map((entry) => (
                      <div
                        key={entry.adId}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 sm:px-5"
                      >
                        <span className="font-data w-7 shrink-0 text-[12px] tabular-nums text-[color:var(--st-text-faint)]">
                          #{entry.rank}
                        </span>
                        <span className="min-w-0 truncate text-[13px] font-medium text-[color:var(--st-text)]">
                          {entry.companyName || entry.linkHost || 'Sponsor'}
                        </span>
                        <span className="text-[12px] tabular-nums text-[color:var(--st-text-muted)]">
                          {entry.clicks.toLocaleString()} click{entry.clicks === 1 ? '' : 's'}
                        </span>
                        <span className="ml-auto flex shrink-0 items-baseline gap-2.5">
                          <span className="font-data text-[12px] tabular-nums" style={GOLD}>
                            {formatSponsorUsd(entry.activeCents)}
                          </span>
                          <span className="font-data text-[11.5px] tabular-nums text-[color:var(--st-text-faint)]">
                            {/* nextDropAt = the soonest contribution
                                expiry, expiresAt = the last; equal for
                                a single-payment sponsor. */}
                            {entry.nextDropAt !== entry.expiresAt
                              ? `drops ${fmtRemaining(entry.nextDropAt, sponsorBoard.serverTime)} · `
                              : ''}
                            off in {fmtRemaining(entry.expiresAt, sponsorBoard.serverTime)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="mt-2 text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
              {placementIntent === 'leaderboard'
                ? 'A bid buys ranked exposure, not guaranteed time at #1 — anyone can outbid you, the minimum is re-checked at checkout, and each payment drops off 24 hours after it lands. Approved cards bid from Your ads.'
                : `Pitching a slot doesn't reserve it — the first confirmed payment takes it. If yours sells first, you can switch to any open slot.`}
            </p>
          </section>

          {/* ---------- band 2: the studio ---------- */}
          <section className="mt-8">
            <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
              Create your ad
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              {BILLBOARD_TEXT_MAX} characters, one link, one submission in review at a time.
            </p>

            <div
              id="pitch"
              className="scroll-mt-24 mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] lg:gap-8"
            >
              {/* Stage first in DOM so it stacks above the fields below lg;
                  order-2 sends it to the right column on lg. */}
              <div className="mb-6 lg:order-2 lg:sticky lg:top-[calc(var(--st-sticky-top)+16px)] lg:mb-0 lg:self-start">
                <BillboardPreviewStage
                  density="full"
                  title={stage.title}
                  text={stage.text}
                  logoUrl={stage.logoUrl}
                  accentColor={stage.accentColor}
                  placement={stage.placement}
                  slot={stage.requestedSlot}
                  note={stage.usingAvatarFallback ? 'Previewing with your avatar' : null}
                />
              </div>

              <div className="lg:order-1">
                <div className={`${PANEL} p-4 sm:p-5`}>
                  <BillboardSubmitForm
                    key={`${placementIntent}-${slotIntent ?? 'any'}-${composerNonce}`}
                    layout="studio"
                    target={{ mode: 'create' }}
                    initial={composerInitial}
                    fallbackLogoUrl={avatarUrl}
                    signedIn={signedIn}
                    onSaved={loadMine}
                    onConflict={loadMine}
                    onPreviewChange={setPreview}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ---------- band 3: how it works ---------- */}
          <section className="mt-8">
            <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
              How it works
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              {placementIntent === 'leaderboard'
                ? 'A human reviews every card — after that one approval, bidding is instant.'
                : 'A human reviews every card before anything runs.'}
            </p>

            <div className={`mt-3 overflow-hidden ${PANEL}`}>
              <div className="grid grid-cols-2 lg:grid-cols-4">
                {(placementIntent === 'leaderboard'
                  ? HOW_IT_WORKS_LEADERBOARD
                  : HOW_IT_WORKS
                ).map((step, i) => (
                  <div
                    key={step.label}
                    className={`border-[color:var(--st-border)] p-4 sm:p-5 ${HOW_IT_WORKS_DIVIDERS[i]}`}
                  >
                    <p className="font-data text-[10px] font-medium tracking-[0.14em] tabular-nums text-[color:var(--st-text-faint)]">
                      {String(i + 1).padStart(2, '0')}
                    </p>
                    <p className="mt-2 text-[13px] font-semibold text-[color:var(--st-text)]">
                      {step.label}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                      {step.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
