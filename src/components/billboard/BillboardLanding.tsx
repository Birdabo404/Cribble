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
// overridden. claimSlot (the flipper cell, a rail cell, or a ?slot=
// deep link from a vacant rail CTA) jumps to the buy view and remounts
// the composer with the placement — and, for rails, the exact slot —
// preselected; the form reads `initial` at mount only, so the key must
// change on every claim.
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
    label: 'Pay over email',
    body: `Instructions go to your billing email. @${BILLBOARD_PAYMENT_X_HANDLE} on X is backup.`
  },
  {
    label: `Live ${BILLBOARD_DURATION_DAYS} days`,
    body: 'Once marked paid, the card runs around the clock. Clicks are counted.'
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

export function BillboardLanding() {
  // Avatar for the preview fallback; also the first signed-in signal.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // null = still resolving. Both fetches may settle it; a definitive 401
  // wins so the page degrades to its read-only pitch.
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [ads, setAds] = useState<MineAd[] | null>(null)
  const [adsError, setAdsError] = useState<string | null>(null)
  /** Public availability for both placements; null (loading or failed)
   *  keeps the strip's static codes and prices with placeholder
   *  occupancy rather than broken numbers. */
  const [board, setBoard] = useState<SlotBoard | null>(null)
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
    if (view !== null) return
    const resolved = adsError !== null || (signedIn !== null && (!signedIn || ads !== null))
    if (!resolved) return
    setView(signedIn === true && ads !== null && ads.length > 0 ? 'mine' : 'buy')
  }, [view, signedIn, ads, adsError])

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
              <div className="p-4 sm:p-5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-3 w-full max-w-xs" />
                <Skeleton className="mt-3 h-3 w-20" />
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
                {/* ---- flipper cell: one big claim button while open ---- */}
                {flipperClaimable ? (
                  <button
                    type="button"
                    aria-pressed={flipperSelected}
                    aria-label="Claim a flipper slot"
                    onClick={() => claimSlot('flipper')}
                    className={`flex flex-col p-4 text-left transition-colors sm:p-5 ${
                      flipperSelected
                        ? 'bg-[color:var(--st-panel-hover)] [box-shadow:inset_0_0_0_1px_var(--st-border-strong)]'
                        : 'hover:bg-[color:var(--st-panel-hover)]'
                    }`}
                  >
                    {flipperCellBody}
                  </button>
                ) : (
                  <div
                    className={`flex flex-col p-4 sm:p-5 ${
                      flipperSelected
                        ? 'bg-[color:var(--st-panel-hover)] [box-shadow:inset_0_0_0_1px_var(--st-border-strong)]'
                        : ''
                    }`}
                  >
                    {flipperCellBody}
                  </div>
                )}

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

            <p className="mt-2 text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
              {`Pitching a slot doesn't reserve it — the first confirmed payment takes it. If yours sells first, you can switch to any open slot.`}
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
              A human reviews every card before anything runs.
            </p>

            <div className={`mt-3 overflow-hidden ${PANEL}`}>
              <div className="grid grid-cols-2 lg:grid-cols-4">
                {HOW_IT_WORKS.map((step, i) => (
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
