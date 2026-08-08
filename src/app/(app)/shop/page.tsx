'use client'

// The Supply Depot — Cribble's storefront. The page is the composition
// layer: the sections themselves live in src/components/shop/ — the
// marquee fan hero (five fanned plate cards that scroll to their buy
// surfaces), the Cribble Pro pricing cards (monthly/yearly), the Reserve
// and Rack scroll-snap shelves, and the gold Vault + Trophy row. This
// file keeps the cosmetics/sync state machine, the query-flag notices,
// the title lockup, the section order + reveal cascade, and the small
// print.
//
// Checkout and the customer portal are plain browser navigations to
// /api/checkout and /api/portal — those routes resolve Polar products
// server-side and redirect to the hosted pages. Both bounce back here
// with query flags (?checkout=success|error, ?portal=none|error) which
// render as a dismissable notice strip. Fulfillment normally arrives via
// webhook, but webhooks can't reach localhost — so both the success
// bounce and the RE-CHECK button also POST /api/user/subscription/sync,
// which reconciles the tier straight from Polar. When that call is the
// one that flips the account to PRO, the Premium welcome modal fires.
//
// The catalog is static (src/lib/cosmetics/plates.ts, sliced into
// storefront views by components/shop/catalog.ts) so the storefront
// paints immediately; only ownership state (/api/user/cosmetics) hydrates
// async. A signed-out or failed fetch degrades to a browsable neutral
// storefront — the checkout route enforces auth itself.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { IconClose, IconRefresh, IconSwords } from '@/components/leaderboard/icons'
import { PremiumWelcomeModal } from '@/components/premium/PremiumWelcomeModal'
import { RESERVE_PLATES, SHOP_PLATES } from '@/components/shop/catalog'
import { GoldRow } from '@/components/shop/GoldRow'
import { MarqueeFan } from '@/components/shop/MarqueeFan'
import { PlateCard } from '@/components/shop/PlateCard'
import { ProCards } from '@/components/shop/ProCards'
import { ReserveCard } from '@/components/shop/ReserveCard'
import { Shelf } from '@/components/shop/Shelf'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
import { BILLBOARD_PRICE_CENTS, BILLBOARD_RAIL_PRICE_MIN_CENTS } from '@/lib/billboard'

/* ================= cosmetics state ================= */

interface CosmeticsData {
  tier: string
  isPro: boolean
  owned: ReadonlySet<string>
  premiumSince: string | null
}

/** Signed-out / failed-fetch mode: browsable, nothing owned, no Pro. */
const NEUTRAL_COSMETICS: CosmeticsData = {
  tier: 'FREE',
  isPro: false,
  owned: new Set(),
  premiumSince: null
}

/** POST /api/user/subscription/sync — reconcile tier straight from Polar.
 * `changed: true` means this call just flipped the account to PRO.
 * A fresh-from-checkout bounce passes the checkout id so the route can
 * verify the session and drop the purchase-ack notification.
 * Null on any failure; the caller falls back to the plain cosmetics read. */
async function syncSubscription(
  checkoutId?: string
): Promise<{ isPro: boolean; changed: boolean } | null> {
  try {
    const res = await fetch('/api/user/subscription/sync', {
      method: 'POST',
      credentials: 'include',
      ...(checkoutId
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkoutId })
          }
        : {})
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.success) return null
    return { isPro: Boolean(data.isPro), changed: Boolean(data.changed) }
  } catch {
    return null
  }
}

/* ================= query-flag notices ================= */

type ShopNotice =
  | 'checkout-success'
  | 'checkout-owned'
  | 'checkout-error'
  | 'portal-none'
  | 'portal-error'

type NoticeTone = 'up' | 'down' | 'info'

const NOTICE_TONES: Record<NoticeTone, { fg: string; border: string; wash: string }> = {
  up: {
    fg: 'rgb(var(--lb-up))',
    border: 'rgb(var(--lb-up) / 0.35)',
    wash: 'rgb(var(--lb-up) / 0.07)'
  },
  down: {
    fg: 'rgb(var(--lb-down))',
    border: 'rgb(var(--lb-down) / 0.35)',
    wash: 'rgb(var(--lb-down) / 0.07)'
  },
  info: {
    fg: 'rgb(var(--lb-panel-edge) / 0.75)',
    border: 'rgb(var(--lb-panel-edge) / 0.2)',
    wash: 'rgb(var(--lb-panel-edge) / 0.05)'
  }
}

function noticeMeta(notice: ShopNotice): { tone: NoticeTone; title: string; body: string } {
  switch (notice) {
    case 'checkout-success':
      return {
        tone: 'up',
        title: 'ORDER CONFIRMED',
        body: 'Polar is processing the purchase — perks unlock in a few seconds. Re-check if nothing has changed yet.'
      }
    case 'checkout-owned':
      return {
        tone: 'info',
        title: 'ALREADY IN YOUR HANGAR',
        body: 'You already own that plate, so checkout stopped itself — nothing was charged.'
      }
    case 'checkout-error':
      return {
        tone: 'down',
        title: 'CHECKOUT FAILED',
        body: 'Nothing was charged. Give it a moment and try again.'
      }
    case 'portal-none':
      return {
        tone: 'info',
        title: 'NO PURCHASES YET',
        body: 'The customer portal opens after your first checkout.'
      }
    case 'portal-error':
      return {
        tone: 'down',
        title: 'PORTAL UNAVAILABLE',
        body: 'Could not reach the customer portal. Try again shortly.'
      }
    default: {
      const exhaustive: never = notice
      return exhaustive
    }
  }
}

function NoticeBanner({
  notice,
  refreshing,
  onRefresh,
  onDismiss
}: {
  notice: ShopNotice
  refreshing: boolean
  onRefresh: () => void
  onDismiss: () => void
}) {
  const meta = noticeMeta(notice)
  const tone = NOTICE_TONES[meta.tone]

  return (
    <div
      role="status"
      className="shp-notice flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3"
      style={{
        border: `1px solid ${tone.border}`,
        background: `linear-gradient(180deg, ${tone.wash}, transparent 70%), rgb(var(--lb-panel-bg))`
      }}
    >
      <span className="text-[10px] tracking-[0.3em]" style={{ color: tone.fg }}>
        {meta.title}
      </span>
      <span className="min-w-0 flex-1 basis-52 text-[11px] leading-relaxed text-zinc-400">
        {meta.body}
      </span>
      {notice === 'checkout-success' && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="lb-inset flex items-center gap-2 rounded-lg px-3 py-1.5 text-[9px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100 disabled:cursor-wait"
        >
          <IconRefresh size={10} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'CHECKING' : 'RE-CHECK'}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="p-1 text-zinc-600 transition-colors hover:text-zinc-200"
      >
        <IconClose size={12} />
      </button>
    </div>
  )
}

/* ================= Team pointer ================= */

/** The Team plan sells from its own page now (/teams) — the shop keeps a
 * slim gold pointer band in the old card's slot. Default variant walks
 * visitors to the pitch; TEAM-active accounts get the console/portal
 * links the removed card used to carry. */
function TeamPointerBand({ loading, isTeam }: { loading: boolean; isTeam: boolean }) {
  const chip = (
    <span
      className="shrink-0 rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]"
      style={{
        color: 'rgb(var(--lb-gold))',
        border: '1px solid rgb(var(--lb-gold) / 0.45)',
        background: 'rgb(var(--lb-gold) / 0.07)',
        textShadow: '0 0 10px rgb(var(--lb-gold) / 0.5)'
      }}
    >
      CRIBBLE TEAM
    </span>
  )

  if (isTeam) {
    return (
      <div className="shp-teamband flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3">
        {chip}
        <span
          className="shrink-0 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
          style={{
            color: 'rgb(var(--lb-gold))',
            borderColor: 'rgb(var(--lb-gold) / 0.4)',
            background: 'rgb(var(--lb-gold) / 0.05)'
          }}
        >
          TEAM ACTIVE
        </span>
        <span className="min-w-0 flex-1 basis-40 text-[11px] leading-relaxed text-zinc-400">
          This account flies company colors.
        </span>
        <Link
          href="/team"
          className="inline-flex shrink-0 items-center gap-1.5 text-[9px] tracking-[0.3em] transition-opacity hover:opacity-80"
          style={{ color: 'rgb(var(--lb-gold))' }}
        >
          OPEN TEAM CONSOLE <span aria-hidden>→</span>
        </Link>
        <a
          href="/api/portal"
          className="inline-flex shrink-0 items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-200"
        >
          MANAGE SUBSCRIPTION <span aria-hidden>→</span>
        </a>
      </div>
    )
  }

  return (
    <Link
      href="/teams"
      className="shp-teamband group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3"
    >
      {chip}
      <span className="min-w-0 flex-1 basis-40 text-[11px] leading-relaxed text-zinc-400">
        Fly company colors — the gold badge, the square mark, ten seats.
      </span>
      {loading ? (
        <span className="h-3 w-32 shrink-0 animate-pulse rounded bg-white/[0.05]" />
      ) : (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[9px] tracking-[0.3em]"
          style={{ color: 'rgb(var(--lb-gold))' }}
        >
          SEE THE TEAM PLAN{' '}
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </span>
      )}
    </Link>
  )
}

/* ================= Billboard pointer ================= */

/** Billboard sells sponsor slots from its own page (/billboard) — the
 * shop carries a slim neutral pointer band beside the Team one. No
 * tier-gated variant: slots are bought with dollars, not tiers, so
 * everyone gets the same door. Neutral panel-edge ink, not gold — gold
 * is reserved for the Team band. */
function BillboardPointerBand() {
  return (
    <Link
      href="/billboard#pitch"
      className="shp-billband group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3"
    >
      <span
        className="shrink-0 rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]"
        style={{
          color: 'rgb(var(--lb-panel-edge) / 0.85)',
          border: '1px solid rgb(var(--lb-panel-edge) / 0.3)',
          background: 'rgb(var(--lb-panel-edge) / 0.05)',
          textShadow: '0 0 10px rgb(var(--lb-panel-edge) / 0.35)'
        }}
      >
        BILLBOARD
      </span>
      <span className="min-w-0 flex-1 basis-40 text-[11px] leading-relaxed text-zinc-400">
        Your logo on the board — flipper ads from ${BILLBOARD_PRICE_CENTS / 100}/wk,
        profile rails from ${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk.
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-200">
        GET A SLOT{' '}
        <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </Link>
  )
}

/* ================= the depot ================= */

function ShopDepot() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [cosmetics, setCosmetics] = useState<CosmeticsData | null>(null)
  const [notice, setNotice] = useState<ShopNotice | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Non-null while the post-purchase celebration is up; holds premiumSince.
  const [welcome, setWelcome] = useState<{ premiumSince: string | null } | null>(null)

  // Monotonic guard — a slow initial load must not overwrite a re-check.
  const fetchSeq = useRef(0)

  // Low-end tier: a one-shot client heuristic (≤4GB reported device memory
  // or ≤4 cores) flips `data-perf="low"` on the depot root — the CSS tier
  // in the style block below then parks every ambient scene, drops the
  // hover-glow pseudos and skips the fan's layer promotion. Hover-wake
  // stays. setAttribute (not state): purely presentational, no re-render.
  const depotRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const low = (nav.deviceMemory ?? 8) <= 4 || navigator.hardwareConcurrency <= 4
    if (low) depotRef.current?.setAttribute('data-perf', 'low')
  }, [])

  // Returns the snapshot it applied (null when superseded by a newer call),
  // so sync flows can read premiumSince without waiting on a state round-trip.
  const loadCosmetics = useCallback(async (): Promise<CosmeticsData | null> => {
    const seq = ++fetchSeq.current
    const apply = (next: CosmeticsData): CosmeticsData => {
      setCosmetics(next)
      return next
    }
    try {
      const res = await fetch('/api/user/cosmetics', {
        cache: 'no-store',
        credentials: 'include'
      })
      if (seq !== fetchSeq.current) return null
      if (!res.ok) {
        // 401 (signed out) or any failure: neutral, still browsable.
        return apply(NEUTRAL_COSMETICS)
      }
      const data = await res.json()
      if (seq !== fetchSeq.current) return null
      if (!data?.success) {
        return apply(NEUTRAL_COSMETICS)
      }
      return apply({
        tier: typeof data.tier === 'string' ? data.tier : 'FREE',
        isPro: Boolean(data.isPro),
        owned: new Set(
          Array.isArray(data.ownedPlateIds) ? data.ownedPlateIds.map(String) : []
        ),
        premiumSince: typeof data.premiumSince === 'string' ? data.premiumSince : null
      })
    } catch {
      if (seq === fetchSeq.current) return apply(NEUTRAL_COSMETICS)
      return null
    }
  }, [])

  useEffect(() => {
    void loadCosmetics()
  }, [loadCosmetics])

  // Post-purchase bell nudges: the ack notification lands with the sync
  // response, but the "delivered" one arrives on webhook timing — so poke
  // the bell now and again shortly after, instead of waiting on the 60s
  // poll. The timer array is mutated in place so the unmount cleanup
  // (which captures it once) always sees the live set.
  const notifNudgeTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  const nudgeNotifications = useCallback(() => {
    const timers = notifNudgeTimers.current
    timers.forEach(clearTimeout)
    timers.length = 0
    requestNotificationsRefresh()
    for (const delay of [5_000, 15_000]) {
      timers.push(setTimeout(requestNotificationsRefresh, delay))
    }
  }, [])

  useEffect(() => {
    const timers = notifNudgeTimers.current
    return () => timers.forEach(clearTimeout)
  }, [])

  // Reconcile with Polar, then re-read cosmetics. Only the call that
  // actually flips the tier (changed && isPro) earns the celebration —
  // a plate purchase by an existing subscriber stays quiet.
  const syncAndLoad = useCallback(
    async (checkoutId?: string) => {
      const sync = await syncSubscription(checkoutId)
      const fresh = await loadCosmetics()
      if (sync?.changed && sync.isPro) {
        setWelcome({ premiumSince: fresh?.premiumSince ?? null })
        toast({
          kind: 'success',
          title: 'PREMIUM ACTIVE',
          body: "You're verified. The blue check is live on your callsign."
        })
      }
      nudgeNotifications()
    },
    [loadCosmetics, nudgeNotifications]
  )

  // Webhook fulfillment lag: the success notice offers a manual re-check,
  // which is also how localhost (unreachable by webhooks) flips the tier.
  // Minimum spin so the control visibly reacts even on instant responses.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([syncAndLoad(), new Promise((r) => setTimeout(r, 650))])
    setRefreshing(false)
  }, [syncAndLoad])

  // Capture checkout/portal flags into state, then scrub the URL so a
  // reload or share doesn't replay the notice. Dismissal is manual.
  useEffect(() => {
    const checkout = searchParams.get('checkout')
    const checkoutId = searchParams.get('checkout_id')
    const portal = searchParams.get('portal')
    const next: ShopNotice | null =
      checkout === 'success'
        ? 'checkout-success'
        : checkout === 'owned'
          ? 'checkout-owned'
          : checkout === 'error'
            ? 'checkout-error'
            : portal === 'none'
              ? 'portal-none'
              : portal === 'error'
                ? 'portal-error'
                : null
    if (!next) return
    setNotice(next)
    // Fresh from Polar checkout: reconcile immediately instead of waiting
    // on a webhook that can't reach localhost anyway. The checkout id
    // rides along so the sync route can drop the purchase-ack
    // notification; the scrub below removes it with the rest.
    if (next === 'checkout-success') void syncAndLoad(checkoutId ?? undefined)
    router.replace('/shop', { scroll: false })
  }, [searchParams, router, syncAndLoad])

  const loading = cosmetics === null
  const isPro = cosmetics?.isPro ?? false
  const isTeam = (cosmetics?.tier ?? 'FREE').toUpperCase() === 'TEAM'
  const owned = cosmetics?.owned ?? NEUTRAL_COSMETICS.owned

  return (
    // overflow-x is clipped (not hidden — the fan must never gain a scroll
    // container ancestor) because the marquee's rotated card corners poke
    // past the content column between ~640 and 1024px.
    <div
      ref={depotRef}
      className="page-zoom-out relative mx-auto max-w-5xl px-6 pb-16 pt-6"
      style={{ overflowX: 'clip' }}
    >
      {welcome && (
        <PremiumWelcomeModal
          premiumSince={welcome.premiumSince}
          onClose={() => setWelcome(null)}
        />
      )}

      {/* depot atmosphere — synthwave washes instead of the arena's gold */}
      <div
        aria-hidden
        className="shp-arena pointer-events-none absolute inset-x-0 top-0 h-[620px]"
      />

      {/* ---------- title lockup ---------- */}
      <header
        className="shp-reveal relative mt-3 flex flex-col items-center"
        style={{ ['--rv' as string]: '0ms' }}
      >
        <div className="flex items-center gap-2.5 text-[rgb(var(--banner-a))]">
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-[rgb(var(--banner-a)/0.6)]" />
          <IconSwords size={13} />
          <span className="font-display text-[10px] font-semibold tracking-[0.55em]">
            OUTFITTING
          </span>
          <IconSwords size={13} className="-scale-x-100" />
          <span className="h-px w-8 bg-gradient-to-l from-transparent to-[rgb(var(--banner-a)/0.6)]" />
        </div>
        <h1 className="shp-title mt-4 select-none text-center leading-none [font-family:var(--font-pixel)]">
          SUPPLY DEPOT
        </h1>
        <p className="mt-4 text-center text-[10px] tracking-[0.3em] text-zinc-600">
          <span className="text-[rgb(var(--banner-a)/0.85)]">STRICTLY COSMETIC</span>
          <span className="mx-2 text-zinc-800">·</span>
          rank is earned, never bought
          <span className="mx-2 text-zinc-800">·</span>
          payments by Polar
        </p>
      </header>

      <main className="mt-4 space-y-6">
        {notice && (
          <NoticeBanner
            notice={notice}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onDismiss={() => setNotice(null)}
          />
        )}

        {/* ---------- the marquee — fan hero, part of the title lockup ---------- */}
        <section className="shp-reveal" style={{ ['--rv' as string]: '60ms' }}>
          <MarqueeFan loading={loading} isPro={isPro} owned={owned} />
        </section>

        {/* ---------- Cribble Pro — pricing cards ---------- */}
        <section className="shp-reveal" style={{ ['--rv' as string]: '120ms' }}>
          <ProCards loading={loading} isPro={isPro} />
        </section>

        {/* ---------- Cribble Team — sold from /teams now ---------- */}
        <section className="shp-reveal" style={{ ['--rv' as string]: '160ms' }}>
          <TeamPointerBand loading={loading} isTeam={isTeam} />
        </section>

        {/* ---------- Billboard — sponsor slots, sold from /billboard ---------- */}
        <section className="shp-reveal" style={{ ['--rv' as string]: '180ms' }}>
          <BillboardPointerBand />
        </section>

        {/* ---------- The Reserve — mythic class, shelf in the band ---------- */}
        {RESERVE_PLATES.length > 0 && (
          <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '200ms' }}>
            <div className="shp-reserve relative overflow-hidden rounded-2xl">
              {/* iridescent keyline — the Reserve signature, one class above gold */}
              <span
                aria-hidden
                className="shp-reserve-keyline absolute inset-x-0 top-0 z-10 h-[2px]"
              />

              <div className="px-6 pb-6 pt-5 md:px-8">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="shp-reserve-title rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]">
                    THE RESERVE
                  </span>
                  <span className="text-[9px] tracking-[0.3em] text-zinc-500">
                    MYTHIC CLASS · A TIER ABOVE LEGENDARY
                  </span>
                  <span className="ml-auto text-[9px] tracking-[0.25em] text-zinc-600">
                    ONE-TIME BUY · YOURS FOREVER
                    {isPro && ' · -25% APPLIED'}
                  </span>
                </div>
                <p className="mt-2.5 max-w-xl text-xs leading-relaxed text-zinc-400">
                  Three <span className="text-zinc-200">living scenes</span> engineered past
                  the legendary line: a pond where koi actually swim, a black hole that keeps
                  eating, a sky that tears open when it thinks nobody&apos;s watching.
                </p>

                <div className="mt-4">
                  <Shelf ariaLabel="The Reserve — mythic plates">
                    {RESERVE_PLATES.map((plate) => (
                      <ReserveCard
                        key={plate.id}
                        plate={plate}
                        loading={loading}
                        isPro={isPro}
                        owned={owned.has(plate.id)}
                      />
                    ))}
                  </Shelf>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---------- the rack — leaderboard plates shelf ---------- */}
        <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '240ms' }}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-baseline gap-3">
              <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
                LEADERBOARD PLATES
              </h2>
              <span className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                {SHOP_PLATES.length} ON THE RACK
              </span>
            </div>
            <span className="text-[9px] tracking-[0.25em] text-zinc-600">
              ONE-TIME BUY · YOURS FOREVER
              {isPro && ' · -25% APPLIED AT CHECKOUT'}
            </span>
          </div>

          <Shelf ariaLabel="Leaderboard plates">
            {SHOP_PLATES.map((plate, i) => (
              <PlateCard
                key={plate.id}
                plate={plate}
                index={i}
                loading={loading}
                isPro={isPro}
                owned={owned.has(plate.id)}
              />
            ))}
          </Shelf>
        </section>

        {/* ---------- gold row — the vault + the trophy case ---------- */}
        <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '300ms' }}>
          <GoldRow loading={loading} isPro={isPro} owned={owned} />
        </section>

        {/* ---------- small print ---------- */}
        <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '350ms' }}>
          <div className="lb-panel flex flex-col gap-3 rounded-xl px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[9px] leading-relaxed tracking-[0.25em] text-zinc-600">
              PURCHASES ARE COSMETIC ONLY
              <span className="mx-2 text-zinc-800">·</span>
              PRICES IN USD
              <span className="mx-2 text-zinc-800">·</span>
              PAYMENTS BY POLAR
            </p>
            <a
              href="/api/portal"
              className="shrink-0 text-[9px] tracking-[0.3em] text-zinc-500 transition-colors hover:text-zinc-200"
            >
              MANAGE SUBSCRIPTION <span aria-hidden>→</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="mt-10 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
        <span>CRIBBLE · {new Date().getFullYear()}</span>
        <span className="text-zinc-700">{'// fly it on the board'}</span>
      </footer>

      <style jsx global>{`
        /* depot atmosphere — pink/purple synthwave washes with a gold hint */
        .shp-arena {
          background:
            radial-gradient(46% 340px at 50% -40px, rgb(var(--banner-a) / 0.09), transparent 70%),
            radial-gradient(30% 300px at 12% 60px, rgb(var(--lb-gold) / 0.05), transparent 70%),
            radial-gradient(30% 300px at 88% 60px, rgb(var(--banner-b) / 0.06), transparent 70%);
          mask-image: linear-gradient(180deg, black 55%, transparent);
          -webkit-mask-image: linear-gradient(180deg, black 55%, transparent);
        }
        html.light .shp-arena {
          background: radial-gradient(46% 320px at 50% -40px, rgb(var(--banner-a) / 0.08), transparent 70%);
        }

        /* retro-arcade title: white face, magenta drop, gold echo */
        .shp-title {
          font-size: clamp(19px, 4.4vw, 42px);
          color: rgb(var(--z50));
          letter-spacing: 0.03em;
          text-shadow:
            0 0 26px rgb(var(--banner-a) / 0.3),
            0.09em 0.09em 0 rgb(var(--banner-a) / 0.5),
            0.18em 0.18em 0 rgb(var(--lb-gold) / 0.22);
        }
        html.light .shp-title {
          text-shadow:
            0.09em 0.09em 0 rgb(var(--banner-a) / 0.45),
            0.18em 0.18em 0 rgb(var(--lb-gold) / 0.16);
        }

        /* first-paint cascade */
        .shp-reveal {
          animation: shp-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes shp-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }

        /* notice strip slides in on arrival from checkout/portal */
        .shp-notice {
          animation: shp-notice-in 420ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes shp-notice-in {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
        }

        /* ---- The Reserve — obsidian band, iridescent chrome ----------- */

        /* Obsidian in BOTH themes: the Reserve is a product showcase —
           plate art is authored against black, so the band re-pins the
           dark surface + type tokens in light mode. --background is
           pinned too (hex, like the token it shadows): the Shelf's edge
           fades paint var(--background) directly, and the light value
           would smear white over the obsidian band. */
        html.light .shp-reserve {
          --lb-panel-bg: 9 10 13;
          --lb-panel-edge: 255 255 255;
          --lb-up: 74 222 128;
          --c-black: 0 0 0;
          --c-white: 255 255 255;
          --z50: 250 250 250;
          --z100: 244 244 245;
          --z200: 228 228 231;
          --z300: 212 212 216;
          --z400: 161 161 170;
          --z500: 113 113 122;
          --z600: 82 82 91;
          --z700: 63 63 70;
          --z800: 39 39 42;
          --z900: 24 24 27;
          --z950: 9 9 11;
          --r-mythic: 205 190 255;
          --background: #000000;
        }
        .shp-reserve {
          border: 1px solid rgb(160 150 255 / 0.22);
          background:
            radial-gradient(60% 220px at 18% -60px, rgb(125 232 255 / 0.05), transparent 70%),
            radial-gradient(60% 220px at 82% -60px, rgb(255 148 224 / 0.05), transparent 70%),
            linear-gradient(180deg, rgb(255 255 255 / 0.025), transparent 36%),
            rgb(var(--lb-panel-bg));
          box-shadow:
            0 24px 70px -30px rgb(150 140 255 / 0.32),
            0 18px 50px -24px rgb(0 0 0 / 0.75);
        }
        .shp-reserve-keyline {
          background: linear-gradient(
            90deg,
            transparent 3%,
            rgb(125 232 255 / 0.9) 18%,
            rgb(178 166 255 / 0.9) 38%,
            rgb(255 154 222 / 0.9) 58%,
            rgb(255 233 166 / 0.9) 78%,
            transparent 97%
          );
          box-shadow: 0 0 12px rgb(178 166 255 / 0.5);
        }
        .shp-reserve-title {
          color: rgb(226 220 255);
          border: 1px solid rgb(178 166 255 / 0.45);
          background: rgb(178 166 255 / 0.08);
          text-shadow: 0 0 10px rgb(178 166 255 / 0.55);
        }

        /* Team pointer band — slim gold keyline strip under the Pro cards.
           The hover glow is a pre-painted pseudo whose opacity transitions
           (compositor-only; was a per-frame box-shadow repaint); isolation
           scopes its z-index: -1 to the band. */
        .shp-teamband {
          position: relative;
          isolation: isolate;
          border: 1px solid rgb(var(--lb-gold) / 0.28);
          background:
            linear-gradient(90deg, rgb(var(--lb-gold) / 0.06), rgb(var(--lb-gold) / 0.015) 55%, transparent),
            rgb(var(--lb-panel-bg));
          transition: border-color 220ms ease;
        }
        .shp-teamband::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: 0 0 30px -12px rgb(var(--lb-gold) / 0.45);
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
          z-index: -1;
        }
        a.shp-teamband:hover,
        a.shp-teamband:focus-visible {
          border-color: rgb(var(--lb-gold) / 0.55);
        }
        a.shp-teamband:hover::after,
        a.shp-teamband:focus-visible::after {
          opacity: 1;
        }

        /* Billboard pointer band — the Team band's neutral sibling: same
           pre-painted hover-glow pseudo, keyed to the panel-edge ink
           instead of gold so the two monetization bands don't compete. */
        .shp-billband {
          position: relative;
          isolation: isolate;
          border: 1px solid rgb(var(--lb-panel-edge) / 0.14);
          background:
            linear-gradient(90deg, rgb(var(--lb-panel-edge) / 0.04), rgb(var(--lb-panel-edge) / 0.01) 55%, transparent),
            rgb(var(--lb-panel-bg));
          transition: border-color 220ms ease;
        }
        .shp-billband::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: 0 0 30px -12px rgb(var(--lb-panel-edge) / 0.3);
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
          z-index: -1;
        }
        a.shp-billband:hover,
        a.shp-billband:focus-visible {
          border-color: rgb(var(--lb-panel-edge) / 0.32);
        }
        a.shp-billband:hover::after,
        a.shp-billband:focus-visible::after {
          opacity: 1;
        }

        /* ---- animation stage budget --------------------------------- */

        /* Cards flip data-offstage via the shared IntersectionObserver in
           components/shop/stage.ts; every scene animation under one pauses
           wholesale (the shelves/gold/pro cards — the fan runs its own
           center-live ambience in MarqueeFan.tsx). This rule lives here
           because it spans components. !important is required: the
           scenes' animation shorthands implicitly reset play-state to
           running. */
        [data-offstage] [data-plate-fx] *,
        [data-offstage] .shpc-mythic-chip {
          animation-play-state: paused !important;
        }

        /* ---- low-end tier ------------------------------------------- */
        /* data-perf="low" is set on the depot root by the one-shot device
           heuristic in ShopDepot (≤4GB memory or ≤4 cores). */

        /* every ambient scene parks, the fan's center card included… */
        [data-perf='low'] [data-plate-fx] * {
          animation-play-state: paused !important;
        }
        /* …but hovering (or keyboard-focusing into) a card still wakes
           that card's scene — higher specificity than every pause rule */
        [data-perf='low'] .shpc-hoverable:hover [data-plate-fx] *,
        [data-perf='low'] .shpc-hoverable:focus-within [data-plate-fx] * {
          animation-play-state: running !important;
        }
        /* hover-glow pseudos off — accent borders carry the emphasis */
        [data-perf='low'] .shpm-card::after,
        [data-perf='low'] .shpk-card::after,
        [data-perf='low'] .shpv-card::after,
        [data-perf='low'] .shpc-buy::after,
        [data-perf='low'] .shpp-go::before,
        [data-perf='low'] .shpg-founder::after,
        [data-perf='low'] .shp-teamband::after,
        [data-perf='low'] .shp-billband::after {
          display: none;
        }
        /* the fan's rest shadow lives on ::before (static paint — keep
           it), pinned fully opaque so hover can't fade it toward the
           now-hidden hover glow */
        [data-perf='low'] .shpm-card::before {
          opacity: 1 !important;
        }
        /* mythic chip shimmer off (the static spectrum frame stays) */
        [data-perf='low'] .shpc-hoverable:hover .shpc-mythic-chip {
          animation: none !important;
        }
        /* no fan layer promotion on weak hardware */
        [data-perf='low'] .shpm-card {
          will-change: auto;
        }

        @media (prefers-reduced-motion: reduce) {
          .shp-reveal,
          .shp-notice {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}

/* ================= page shell ================= */

// useSearchParams requires a Suspense boundary at prerender time; the
// depot itself paints instantly (static catalog), so a null fallback is
// never visible in practice.
export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopDepot />
    </Suspense>
  )
}
