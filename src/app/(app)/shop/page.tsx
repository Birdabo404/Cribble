'use client'

// Shop — Cribble's storefront. The page is the composition layer: fan
// hero, Pro, mythic + plate grids, Founder / Champion. This file keeps
// the cosmetics/sync state machine, query-flag notices, section order
// and the reveal cascade.
//
// Checkout and the customer portal are plain browser navigations to
// /api/checkout and /api/portal — those routes resolve Polar products
// server-side and redirect to the hosted pages. Both bounce back here
// with query flags (?checkout=success|error, ?portal=none|error) which
// render as a dismissable notice strip. Fulfillment normally arrives via
// webhook, but webhooks can't reach localhost — so both the success
// bounce and the Re-check button also POST /api/user/subscription/sync,
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
import { IconClose, IconRefresh } from '@/components/leaderboard/icons'
import { PremiumWelcomeModal } from '@/components/premium/PremiumWelcomeModal'
import { RESERVE_PLATES, SHOP_PLATES } from '@/components/shop/catalog'
import { GoldRow } from '@/components/shop/GoldRow'
import { MarqueeFan } from '@/components/shop/MarqueeFan'
import { PlateCard } from '@/components/shop/PlateCard'
import { ProCards } from '@/components/shop/ProCards'
import { ReserveCard } from '@/components/shop/ReserveCard'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'

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
    border: 'rgb(var(--lb-up) / 0.28)',
    wash: 'rgb(var(--lb-up) / 0.05)'
  },
  down: {
    fg: 'rgb(var(--lb-down))',
    border: 'rgb(var(--lb-down) / 0.28)',
    wash: 'rgb(var(--lb-down) / 0.05)'
  },
  info: {
    fg: 'rgb(var(--lb-panel-edge) / 0.7)',
    border: 'rgb(var(--lb-panel-edge) / 0.14)',
    wash: 'rgb(var(--lb-panel-edge) / 0.04)'
  }
}

function noticeMeta(notice: ShopNotice): { tone: NoticeTone; title: string; body: string } {
  switch (notice) {
    case 'checkout-success':
      return {
        tone: 'up',
        title: 'Order confirmed',
        body: 'Polar is processing the purchase — perks unlock in a few seconds. Re-check if nothing has changed yet.'
      }
    case 'checkout-owned':
      return {
        tone: 'info',
        title: 'Already owned',
        body: 'You already own that plate. Nothing was charged.'
      }
    case 'checkout-error':
      return {
        tone: 'down',
        title: 'Checkout failed',
        body: 'Nothing was charged. Give it a moment and try again.'
      }
    case 'portal-none':
      return {
        tone: 'info',
        title: 'No purchases yet',
        body: 'The customer portal opens after your first checkout.'
      }
    case 'portal-error':
      return {
        tone: 'down',
        title: 'Portal unavailable',
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
      className="shp-notice flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3"
      style={{
        border: `1px solid ${tone.border}`,
        background: tone.wash
      }}
    >
      <span className="text-[12px] font-medium" style={{ color: tone.fg }}>
        {meta.title}
      </span>
      <span className="min-w-0 flex-1 basis-52 text-[12px] leading-relaxed text-zinc-400">
        {meta.body}
      </span>
      {notice === 'checkout-success' && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex min-h-11 items-center gap-2 rounded-[10px] px-3 py-1.5 text-[12px] text-zinc-400 transition-colors hover:text-zinc-100 disabled:cursor-wait md:min-h-0"
        >
          <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Checking' : 'Re-check'}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-600 transition-colors hover:text-zinc-200 md:h-auto md:w-auto md:p-1"
      >
        <IconClose size={12} />
      </button>
    </div>
  )
}

function SectionHead({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="font-display text-[13px] font-semibold tracking-[0.12em] text-zinc-400">
        {title}
      </h2>
      <span className="text-[11px] tabular-nums text-zinc-600">{count}</span>
    </div>
  )
}

/* ================= the shop ================= */

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
  // or ≤4 cores) flips `data-perf="low"` on the shop root — the CSS tier
  // in the style block below then parks every ambient scene and skips the
  // fan's layer promotion. Hover-wake stays. setAttribute (not state):
  // purely presentational, no re-render.
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
      className="page-zoom-out relative mx-auto max-w-6xl px-6 pb-16 pt-6"
      style={{ overflowX: 'clip' }}
    >
      {welcome && (
        <PremiumWelcomeModal
          premiumSince={welcome.premiumSince}
          onClose={() => setWelcome(null)}
        />
      )}

      <header
        className="shp-reveal relative mt-3 flex flex-col items-center"
        style={{ ['--rv' as string]: '0ms' }}
      >
        <h1 className="font-display text-center text-[32px] font-semibold leading-none tracking-tight text-zinc-50 md:text-[40px]">
          Shop
        </h1>
        <p className="mt-3 text-center text-[13px] text-zinc-500">
          Plates for the board. Rank stays earned.
        </p>
      </header>

      <main className="mt-8 space-y-14 md:space-y-16">
        {notice && (
          <NoticeBanner
            notice={notice}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onDismiss={() => setNotice(null)}
          />
        )}

        <section className="shp-reveal" style={{ ['--rv' as string]: '60ms' }}>
          <MarqueeFan />
        </section>

        <section className="shp-reveal" style={{ ['--rv' as string]: '120ms' }}>
          <ProCards loading={loading} isPro={isPro} />
        </section>

        {RESERVE_PLATES.length > 0 && (
          <section className="shp-mythic shp-reveal" style={{ ['--rv' as string]: '200ms' }}>
            <SectionHead title="Mythic" count={RESERVE_PLATES.length} />
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {RESERVE_PLATES.map((plate) => (
                <ReserveCard
                  key={plate.id}
                  plate={plate}
                  loading={loading}
                  isPro={isPro}
                  owned={owned.has(plate.id)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="shp-reveal" style={{ ['--rv' as string]: '240ms' }}>
          <SectionHead title="Plates" count={SHOP_PLATES.length} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          </div>
        </section>

        <section className="shp-reveal" style={{ ['--rv' as string]: '300ms' }}>
          <GoldRow loading={loading} isPro={isPro} owned={owned} />
        </section>
      </main>

      <footer className="mt-16 flex flex-col gap-3 text-[11px] tracking-[0.08em] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
        <p>Cosmetic · USD · Polar</p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={isTeam ? '/team' : '/teams'}
            className="transition-colors hover:text-zinc-300"
          >
            {isTeam ? 'Team console' : 'Team'}
          </Link>
          <Link href="/billboard#pitch" className="transition-colors hover:text-zinc-300">
            Billboard
          </Link>
          <a href="/api/portal" className="transition-colors hover:text-zinc-300">
            Manage
          </a>
        </nav>
      </footer>

      <style jsx global>{`
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

        .shp-notice {
          animation: shp-notice-in 420ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes shp-notice-in {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
        }

        /* Cards flip data-offstage via the shared IntersectionObserver in
           components/shop/stage.ts; every scene animation under one pauses
           wholesale. !important is required: the scenes' animation
           shorthands implicitly reset play-state to running. */
        [data-offstage] [data-plate-fx] * {
          animation-play-state: paused !important;
        }

        /* data-perf="low" is set on the shop root by the one-shot device
           heuristic in ShopDepot (≤4GB memory or ≤4 cores). */
        [data-perf='low'] [data-plate-fx] * {
          animation-play-state: paused !important;
        }
        [data-perf='low'] .shpc-hoverable:hover [data-plate-fx] *,
        [data-perf='low'] .shpc-hoverable:focus-within [data-plate-fx] *,
        [data-perf='low'] .shpm-card:hover [data-plate-fx] *,
        [data-perf='low'] .shpm-card:focus-visible [data-plate-fx] * {
          animation-play-state: running !important;
        }
        [data-perf='low'] .shpp-go-clip::after {
          display: none;
        }
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
// shop itself paints instantly (static catalog), so a null fallback is
// never visible in practice.
export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopDepot />
    </Suspense>
  )
}
