'use client'

// Shop state machine — cosmetics, Polar sync, query-flag notices, the
// Premium welcome and the post-purchase bell nudges. The page is the
// composition layer; everything that used to be React state in
// shop/page.tsx lives here so the storefront can be rebuilt around it
// without touching a single contract.
//
// Checkout and the customer portal are plain browser navigations to
// /api/checkout and /api/portal — those routes resolve Polar products
// server-side and redirect to the hosted pages. Both bounce back to /shop
// with query flags (?checkout=success|error|owned|complimentary,
// ?portal=none|error|complimentary) which this hook captures into
// `notice` and then scrubs from the URL. Fulfillment normally arrives via
// webhook, but webhooks can't reach localhost — so both the success
// bounce and the Re-check control also POST /api/user/subscription/sync,
// which reconciles the tier straight from Polar. When that call is the
// one that flips the account to PRO, `welcome` becomes non-null and the
// page mounts the Premium welcome modal.
//
// The catalog is static (src/lib/cosmetics/plates.ts, sliced into
// storefront views by components/shop/catalog.ts) so the storefront
// paints immediately; only ownership state (/api/user/cosmetics) hydrates
// async. A signed-out or failed fetch degrades to a browsable neutral
// storefront — the checkout route enforces auth itself.
//
// URL contract: the only writes this hook makes are the checkout/portal
// scrubs, and those preserve an existing `?plate=<id>` (the Spec drawer's
// deep link, owned by SpecDrawer.tsx). No flag → the URL is never touched.
//
// useSearchParams requires a Suspense boundary at prerender time, so the
// component calling this hook must sit under one (shop/page.tsx does).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'

/* ================= cosmetics ================= */

export interface CosmeticsData {
  tier: string
  isPro: boolean
  complimentary: boolean
  owned: ReadonlySet<string>
  premiumSince: string | null
}

/** Signed-out / failed-fetch mode: browsable, nothing owned, no Pro. */
export const NEUTRAL_COSMETICS: CosmeticsData = {
  tier: 'FREE',
  isPro: false,
  complimentary: false,
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

export type ShopNotice =
  | 'checkout-success'
  | 'checkout-owned'
  | 'checkout-complimentary'
  | 'checkout-error'
  | 'portal-none'
  | 'portal-complimentary'
  | 'portal-error'

export type NoticeTone = 'up' | 'down' | 'info'

export const NOTICE_TONES: Record<NoticeTone, { fg: string; border: string; wash: string }> = {
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

export function noticeMeta(notice: ShopNotice): {
  tone: NoticeTone
  title: string
  body: string
} {
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
    case 'checkout-complimentary':
      return {
        tone: 'info',
        title: 'Already complimentary',
        body: 'This account is house complimentary — nothing was charged.'
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
    case 'portal-complimentary':
      return {
        tone: 'info',
        title: 'Complimentary plan',
        body: 'House complimentary accounts are never billed, so there is no customer portal.'
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

/* ================= the hook ================= */

export function useShopCosmetics(): {
  cosmetics: CosmeticsData | null
  loading: boolean
  isPro: boolean
  complimentary: boolean
  isTeam: boolean
  owned: ReadonlySet<string>
  notice: ShopNotice | null
  dismissNotice: () => void
  refreshing: boolean
  handleRefresh: () => Promise<void>
  welcome: { premiumSince: string | null } | null
  closeWelcome: () => void
} {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [cosmetics, setCosmetics] = useState<CosmeticsData | null>(null)
  const [notice, setNotice] = useState<ShopNotice | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Non-null while the post-purchase celebration is up; holds premiumSince.
  const [welcome, setWelcome] = useState<{ premiumSince: string | null } | null>(null)

  // Monotonic guard — a slow initial load must not overwrite a re-check.
  const fetchSeq = useRef(0)

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
        complimentary: data.complimentary === true,
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
  // reload or share doesn't replay the notice. Dismissal is manual. The
  // scrub keeps an open drawer's ?plate= deep link; with no flag present
  // the URL is left alone entirely (the drawer writes it too).
  useEffect(() => {
    const checkout = searchParams.get('checkout')
    const checkoutId = searchParams.get('checkout_id')
    const portal = searchParams.get('portal')
    const next: ShopNotice | null =
      checkout === 'success'
        ? 'checkout-success'
        : checkout === 'owned'
          ? 'checkout-owned'
          : checkout === 'complimentary'
            ? 'checkout-complimentary'
            : checkout === 'error'
              ? 'checkout-error'
              : portal === 'none'
                ? 'portal-none'
                : portal === 'complimentary'
                  ? 'portal-complimentary'
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
    const plate = searchParams.get('plate')
    router.replace(plate ? `/shop?plate=${encodeURIComponent(plate)}` : '/shop', {
      scroll: false
    })
  }, [searchParams, router, syncAndLoad])

  const dismissNotice = useCallback(() => setNotice(null), [])
  const closeWelcome = useCallback(() => setWelcome(null), [])

  const loading = cosmetics === null
  const isPro = cosmetics?.isPro ?? false
  const complimentary = cosmetics?.complimentary ?? false
  const isTeam = (cosmetics?.tier ?? 'FREE').toUpperCase() === 'TEAM'
  const owned = cosmetics?.owned ?? NEUTRAL_COSMETICS.owned

  return {
    cosmetics,
    loading,
    isPro,
    complimentary,
    isTeam,
    owned,
    notice,
    dismissNotice,
    refreshing,
    handleRefresh,
    welcome,
    closeWelcome
  }
}
