'use client'

// The /billboard buyer page, re-skinned in the settings design system:
// a plain header with a Your ads / Buy a slot segmented control over
// two views — the status tracker, and the buying flow (live
// availability, the composer, a compact how-it-works). The root carries
// .settings-scope because the --st-* tokens are scoped to it in
// globals.css (flipping with html.light); without it every var(--st-*)
// below resolves to nothing. Signed-out visitors get the buy view —
// the composer swaps its submit button for a sign-in link, and the
// tracker shows a sign-in prompt if they switch tabs.
//
// The tab default is chosen once, when /api/user/me and
// /api/billboard/mine first resolve (signed-out or zero ads -> buy,
// existing ads -> mine); manual switches after that are never
// overridden. claimSlot (an open rail cell, or a ?slot= deep link from
// a vacant rail CTA) jumps to the buy view and remounts the composer
// with the placement — and, for rails, the exact slot — preselected;
// the form reads `initial` at mount only, so the key must change on
// every claim.

import { useCallback, useEffect, useState } from 'react'
import {
  BillboardStatusTracker,
  type MineAd
} from '@/components/billboard/BillboardStatusTracker'
import {
  BillboardSubmitForm,
  type AdFormValues
} from '@/components/billboard/BillboardSubmitForm'
import {
  SegmentedControl,
  SettingsSection,
  Skeleton,
  type SegmentedOption
} from '@/components/settings'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  BILLBOARD_TEXT_MAX,
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

const STEPS: { label: string; body: string }[] = [
  {
    label: 'Submit',
    body: `Your logo, one line (up to ${BILLBOARD_TEXT_MAX} characters), and one link — pick the flipper or a rail slot. The live preview shows exactly what ships.`
  },
  {
    label: 'Human review',
    body: 'An admin approves it, asks for a redo with written feedback, or rejects it with the reason. It all shows up in Your ads.'
  },
  {
    label: 'Pay over DM',
    body: `Once approved, DM @${BILLBOARD_PAYMENT_X_HANDLE} on X to arrange payment. After it's confirmed, allow a few minutes to a few hours for your ad to be activated and go live.`
  },
  {
    label: `Live for ${BILLBOARD_DURATION_DAYS} days`,
    body: 'Marked paid, your card rides the flipper or holds its rail slot around the clock. Every click through it is counted.'
  }
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
   *  hides the availability cards rather than showing broken ones. */
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
    // #pitch only exists in the buy view — the double rAF lets the view
    // swap commit and paint before scrolling.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('pitch')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }, [])

  // The vacant rail CTAs deep-link /billboard?slot=L2#pitch. Read
  // window.location directly in a mount effect — useSearchParams would
  // drag the whole page behind a Suspense boundary for one read — and
  // claim like a board click: buy view, rail placement, that slot.
  useEffect(() => {
    const slot = new URLSearchParams(window.location.search).get('slot')
    if (isRailSlot(slot)) claimSlot('rail', slot)
  }, [claimSlot])

  const openRails = board ? board.rails.filter((rail) => !rail.takenUntil).length : 0
  const flipperLine = board
    ? `${board.flipper.taken}/${board.flipper.max} taken${
        board.flipper.taken >= board.flipper.max
          ? board.flipper.nextOpensAt
            ? ` — next opens ${fmtDate(board.flipper.nextOpensAt)}`
            : ''
          : ` — ${board.flipper.max - board.flipper.taken} open`
      }`
    : ''

  const composerInitial: AdFormValues = {
    company_name: '',
    text: '',
    link_url: '',
    logo_url: '',
    placement: placementIntent,
    requested_rail_slot: slotIntent
  }

  return (
    <div className="settings-scope">
      <div className="page-zoom-out mx-auto max-w-3xl px-6 pb-16 pt-8">
        <header>
          <h1 className="text-[20px] font-semibold leading-7 text-[color:var(--st-text)]">
            Billboard
          </h1>
          <p className="mt-1 max-w-xl text-[14px] leading-6 text-[color:var(--st-text-muted)]">
            Your logo, one line, and one link — on the leaderboard, dashboard, and every
            profile page for {BILLBOARD_DURATION_DAYS} days.
          </p>
        </header>

        {view === null ? (
          <div aria-hidden className="mt-6 space-y-6">
            <Skeleton className="h-[30px] w-60 rounded-lg" />
            <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] p-4 [box-shadow:var(--st-panel-shadow)] sm:p-5">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="mt-3 h-3 w-full max-w-md" />
              <Skeleton className="mt-2 h-3 w-full max-w-xs" />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6">
              <SegmentedControl
                options={VIEW_OPTIONS}
                value={view}
                onChange={setView}
                aria-label="Billboard view"
              />
            </div>

            {view === 'mine' ? (
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
              <div className="mt-8 space-y-10">
                {/* ---------- availability ---------- */}
                <section>
                  <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
                    Get on the Billboard
                  </h2>
                  <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                    Two placements, live availability below — submit a card and a human
                    reviews it before anything runs.
                  </p>

                  {board && (
                    <>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] p-4 [box-shadow:var(--st-panel-shadow)]">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="text-[13px] font-semibold text-[color:var(--st-text)]">
                              Flipper
                            </h3>
                            <span
                              className="text-[13px] font-medium"
                              style={{ color: 'rgb(var(--lb-gold))' }}
                            >
                              ${board.flipper.priceCents / 100}/wk
                            </span>
                          </div>
                          <p className="mt-1 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                            Rotates under the nav on the dashboard and leaderboard.
                          </p>
                          <p className="mt-2 text-[12px] leading-4 text-[color:var(--st-text-faint)]">
                            {flipperLine}
                          </p>
                        </div>

                        <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] p-4 [box-shadow:var(--st-panel-shadow)]">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="text-[13px] font-semibold text-[color:var(--st-text)]">
                              Rail
                            </h3>
                            <span
                              className="text-[13px] font-medium"
                              style={{ color: 'rgb(var(--lb-gold))' }}
                            >
                              from ${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk
                            </span>
                          </div>
                          <p className="mt-1 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                            An always-on card beside every profile page — no rotation.
                          </p>
                          <p className="mt-2 text-[12px] leading-4 text-[color:var(--st-text-faint)]">
                            {openRails}/{board.rails.length} slots open
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-4 gap-2">
                        {board.rails.map((rail) =>
                          rail.takenUntil ? (
                            <div
                              key={rail.slot}
                              className="rounded-lg border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-2.5 py-2"
                            >
                              <p className="text-[12px] font-medium text-[color:var(--st-text-faint)]">
                                {rail.slot}
                              </p>
                              <p className="mt-0.5 truncate text-[12px] font-medium text-[color:var(--st-text)]">
                                {rail.companyName ?? 'Taken'}
                              </p>
                              <p className="text-[12px] text-[color:var(--st-text-faint)]">
                                until {fmtDate(rail.takenUntil)}
                              </p>
                            </div>
                          ) : (
                            <button
                              key={rail.slot}
                              type="button"
                              aria-label={`Claim rail slot ${rail.slot}`}
                              onClick={() => claimSlot('rail', rail.slot)}
                              className="rounded-lg border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-2.5 py-2 text-left transition-colors hover:border-[color:var(--st-border-strong)] hover:bg-[color:var(--st-panel-hover)]"
                            >
                              <p className="text-[12px] font-medium text-[color:var(--st-text-faint)]">
                                {rail.slot}
                              </p>
                              <p
                                className="mt-0.5 text-[12px] font-medium"
                                style={{ color: 'rgb(var(--lb-gold))' }}
                              >
                                Open
                              </p>
                              <p className="text-[12px] text-[color:var(--st-text-faint)]">
                                ${rail.priceCents / 100}/wk
                              </p>
                            </button>
                          )
                        )}
                      </div>

                      <p className="mt-2 text-[12px] leading-4 text-[color:var(--st-text-faint)]">
                        {`Pitching a slot doesn't reserve it — the first confirmed payment takes it. If yours sells first, you can switch to any open slot.`}
                      </p>
                    </>
                  )}
                </section>

                {/* ---------- the composer ---------- */}
                <div id="pitch" className="scroll-mt-24">
                  <SettingsSection
                    title="Create your ad"
                    description={`${BILLBOARD_TEXT_MAX} characters, one link, one slot per account.`}
                  >
                    <div className="p-4 sm:p-5">
                      <BillboardSubmitForm
                        key={`${placementIntent}-${composerNonce}`}
                        target={{ mode: 'create' }}
                        initial={composerInitial}
                        fallbackLogoUrl={avatarUrl}
                        signedIn={signedIn}
                        onSaved={loadMine}
                        onConflict={loadMine}
                      />
                    </div>
                  </SettingsSection>
                </div>

                {/* ---------- how it works ---------- */}
                <div>
                  <SettingsSection
                    title="How it works"
                    description="A human reviews every card before anything runs."
                  >
                    {STEPS.map((step, i) => (
                      <div key={step.label} className="flex gap-3 px-4 py-3.5 sm:px-5">
                        <span className="w-4 shrink-0 text-[13px] font-medium text-[color:var(--st-text-faint)]">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[color:var(--st-text)]">
                            {step.label}
                          </p>
                          <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                            {step.body}
                          </p>
                        </div>
                      </div>
                    ))}
                  </SettingsSection>
                  <p className="mt-2 text-[12px] leading-5 text-[color:var(--st-text-faint)]">
                    No self-serve checkout — payment is arranged over DM after approval. Nothing
                    charges automatically.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        <footer className="mt-12 text-[12px] leading-5 text-[color:var(--st-text-faint)]">
          Seen by every pilot on the board.
        </footer>
      </div>
    </div>
  )
}
