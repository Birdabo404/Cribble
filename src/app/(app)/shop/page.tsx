'use client'

// The Supply Depot — Cribble's storefront. Three shelves, per the
// monetization plan: the Cribble Pro subscription hero (animated banner,
// PRO badge, the Pro plate collection, 25% off), the Leaderboard Plate
// grid (one-time purchases, owned forever) and the Founder vault — a
// single-run gold plate sold once and never restocked.
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
// The catalog is static (src/lib/cosmetics/plates.ts) so the storefront
// paints immediately; only ownership state (/api/user/cosmetics) hydrates
// async. A signed-out or failed fetch degrades to a browsable neutral
// storefront — the checkout route enforces auth itself.

import { type KeyboardEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { tierAccent } from '@/components/dashboard-v2/format'
import { IconClose, IconRefresh, IconSwords } from '@/components/leaderboard/icons'
import { PlateLayer, PlatePreview } from '@/components/cosmetics/PlateLayer'
import { PremiumWelcomeModal } from '@/components/premium/PremiumWelcomeModal'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
import {
  PLATES,
  PLATE_RARITY_META,
  type PlateDef,
  type PlateRarity
} from '@/lib/cosmetics/plates'

/* ================= catalog shelves ================= */

type ShopPlate = PlateDef & { priceUsd: number }

/** Storefront order: the seasonal drop leads, then rarity descending —
 * most premium at the top of the rack, catalog order within ties. */
const RARITY_ORDER: Record<PlateRarity, number> = {
  mythic: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
  common: 4
}

/** The one-run vault drop. Sold from its own gold band, never the grid —
 * and only while the catalog prices it (retiring the run = priceUsd back
 * to null, which also makes the checkout route refuse it). */
const FOUNDER_PLATE_ID = 'founder'

const SHOP_PLATES: ShopPlate[] = PLATES.filter(
  (plate): plate is ShopPlate =>
    plate.priceUsd !== null && plate.id !== FOUNDER_PLATE_ID && plate.rarity !== 'mythic'
).sort(
  (a, b) =>
    Number(Boolean(b.seasonal)) - Number(Boolean(a.seasonal)) ||
    RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]
)

/** The Reserve — the mythic class, sold from its own shelf above the grid,
 * cheapest first so the shelf reads as a ladder up to the flagship. */
const RESERVE_PLATES: ShopPlate[] = PLATES.filter(
  (plate): plate is ShopPlate => plate.rarity === 'mythic' && plate.priceUsd !== null
).sort((a, b) => a.priceUsd - b.priceUsd)

/** Reserve shelf copy: a lane kicker + "what's alive in it" for each plate.
 * Keyed by catalog id — a mythic plate without notes still renders, just
 * without the bullet list. */
const RESERVE_NOTES: Record<string, { kicker: string; alive: string[] }> = {
  'koi-pond': {
    kicker: 'WATER, CHOREOGRAPHED',
    alive: [
      'Three koi swim their own laps — the Kohaku rises to kiss the surface, rings and all',
      'An unseen fourth tugs the lily pad from below; petals cast off the lotus, a dragonfly visits',
      'Hover blooms the sunlight — caustic webs, breathing shafts and the swell sheen lift as one'
    ]
  },
  'event-horizon': {
    kicker: 'A LIVING SCENE',
    alive: [
      'The disk shears at three speeds and light orbits the photon ring every 3.5s',
      'Every 45 seconds a star wanders too close, stretches into a filament and sets the disk flaring',
      'The approaching limb flashes white-hot each pass; hover feeds the disk and pulls the well closer'
    ]
  },
  'prime-anomaly': {
    kicker: 'THE FLAGSHIP',
    alive: [
      'Every 45 seconds the crack gives and blinding light floods through the sky',
      'The fracture glows from inside at rest; RGB-split ticks warn right before it goes',
      'Hover tears it open and holds it — the light churns, dust escapes, it knows you are looking'
    ]
  }
}

const PRO_PLATES = PLATES.filter((plate) => plate.proExclusive)
const FOUNDER_PLATE: ShopPlate | null =
  PLATES.find(
    (plate): plate is ShopPlate => plate.id === FOUNDER_PLATE_ID && plate.priceUsd !== null
  ) ?? null
const CHAMPION_PLATE = PLATES.find((plate) => plate.championExclusive) ?? null
const HERO_BACKDROP_ID = PRO_PLATES[0]?.id ?? null

/** Pro shop discount: 25% off in cents-math so $X.99 stays a tidy .49/.99. */
const proPrice = (priceUsd: number) => Math.round(priceUsd * 100 * 0.75) / 100
const usd = (n: number) => `$${n.toFixed(2)}`

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

/* ================= chips ================= */

function RarityChip({ rarity }: { rarity: PlateRarity }) {
  const meta = PLATE_RARITY_META[rarity]
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
      style={{
        color: meta.color,
        border: `1px solid rgb(var(--r-${rarity}) / 0.35)`,
        background: `rgb(var(--r-${rarity}) / 0.07)`
      }}
    >
      {meta.label}
    </span>
  )
}

function SeasonalChip({ label }: { label: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
      style={{
        color: 'rgb(var(--lb-gold))',
        border: '1px solid rgb(var(--lb-gold) / 0.4)',
        background: 'rgb(var(--lb-gold) / 0.07)'
      }}
    >
      {label}
    </span>
  )
}

/** Reserve-band upgrade of the MYTHIC chip: the label itself is iridescent
 * (a slowly panning spectrum clipped to the glyphs). Everywhere else the
 * flat --r-mythic token chip from RarityChip is the correct, quieter form. */
function MythicChip() {
  return (
    <span className="shp-mythic-chip rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]">
      MYTHIC
    </span>
  )
}

/* ================= Pro hero ================= */

const AMBER = '252 211 77' // tailwind amber-300 — the PRO tier hue

/** The checkout console's two positions. Yearly leads: it's preselected
 * and carries the value tag, so the honest default is also the best deal. */
type ProTerm = 'monthly' | 'yearly'

const PRO_TERMS: Record<
  ProTerm,
  { price: string; unit: string; context: string; announce: string }
> = {
  monthly: {
    price: '$6.99',
    unit: '/ MO',
    context: 'BILLED MONTHLY · CANCEL ANYTIME',
    announce: '$6.99 per month, billed monthly'
  },
  yearly: {
    price: '$49.99',
    unit: '/ YR',
    context: '≈ $4.17 / MO · SAVE $33.89 A YEAR',
    announce: '$49.99 per year, about $4.17 per month'
  }
}

function ProHero({
  loading,
  isPro
}: {
  loading: boolean
  isPro: boolean
}) {
  const proPlateNames = PRO_PLATES.map((plate) => plate.name).join(' · ')

  // Checkout console state — one dial, one price, one button.
  const [term, setTerm] = useState<ProTerm>('yearly')
  const monthlyRef = useRef<HTMLButtonElement>(null)
  const yearlyRef = useRef<HTMLButtonElement>(null)
  const meta = PRO_TERMS[term]

  // Radio-group keyboard contract: one tab stop, arrows flip the dial.
  // With exactly two positions every arrow lands on the other segment.
  const handleSegKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const next: ProTerm = term === 'monthly' ? 'yearly' : 'monthly'
    setTerm(next)
    ;(next === 'monthly' ? monthlyRef : yearlyRef).current?.focus()
  }

  return (
    <div
      className="shp-hero relative overflow-hidden rounded-2xl"
      style={{
        border: `1px solid rgb(${AMBER} / 0.28)`,
        background: 'rgb(var(--lb-panel-bg))',
        boxShadow: `0 24px 70px -30px rgb(${AMBER} / 0.3), 0 18px 50px -24px rgb(0 0 0 / 0.85)`
      }}
    >
      {/* amber keyline across the top — the PRO signature */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 4%, rgb(${AMBER} / 0.9) 50%, transparent 96%)`,
          boxShadow: `0 0 12px rgb(${AMBER} / 0.5)`
        }}
      />

      {/* ---- main block: perks + pricing over the Pro Circuit plate ---- */}
      <div className="relative overflow-hidden">
        {HERO_BACKDROP_ID && (
          <>
            <PlateLayer plateId={HERO_BACKDROP_ID} fade="left" className="opacity-[0.55]" />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, rgb(var(--lb-panel-bg) / 0.92), rgb(var(--lb-panel-bg) / 0.55) 45%, rgb(var(--lb-panel-bg) / 0.15) 80%)'
              }}
            />
          </>
        )}

        <div className="relative grid gap-8 p-6 md:grid-cols-[1.15fr_1fr] md:p-8">
          {/* pitch + perks */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] tracking-[0.4em] text-amber-200/70">
                THE SUBSCRIPTION
              </span>
              {isPro && (
                <span
                  className={`rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em] ${tierAccent('PRO')}`}
                >
                  PREMIUM ACTIVE
                </span>
              )}
            </div>
            <h2
              className="mt-3 text-xl leading-none md:text-2xl [font-family:var(--font-pixel)]"
              style={{
                color: `rgb(${AMBER})`,
                textShadow: `0 0 18px rgb(${AMBER} / 0.45), 0 0 46px rgb(${AMBER} / 0.2)`
              }}
            >
              CRIBBLE PRO
            </h2>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              The full pilot kit — flex on the whole board. Cancel anytime.
            </p>

            <ul className="mt-5 space-y-2.5">
              {[
                'Animated GIF banner on your profile',
                'Pixel blue check next to your name',
                `Three exclusive plates — ${proPlateNames}`,
                '25% off every plate in the depot'
              ].map((perk) => (
                <li key={perk} className="flex items-start gap-2.5 text-xs text-zinc-300">
                  <span
                    className="mt-px shrink-0 text-[10px] leading-4 [font-family:var(--font-pixel)]"
                    style={{ color: `rgb(${AMBER} / 0.9)` }}
                  >
                    +
                  </span>
                  <span className="leading-relaxed">
                    {perk}
                    {perk === 'Pixel blue check next to your name' && (
                      <VerifiedBadge size={12} className="ml-1.5 inline-block align-[-2px]" />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* pricing / active state */}
          <div className="flex flex-col justify-center gap-3">
            {loading ? (
              <div className="grid gap-3 rounded-xl border border-[rgb(var(--lb-panel-edge)/0.1)] p-5">
                <span className="h-11 animate-pulse rounded-lg bg-white/[0.05]" />
                <span className="mx-auto h-12 w-2/3 animate-pulse rounded-lg bg-white/[0.05]" />
                <span className="h-12 animate-pulse rounded-lg bg-white/[0.05]" />
                <span className="mx-auto h-2 w-1/2 animate-pulse rounded bg-white/[0.05]" />
              </div>
            ) : isPro ? (
              <div
                className="rounded-xl p-5"
                style={{
                  border: `1px solid rgb(${AMBER} / 0.3)`,
                  background: `linear-gradient(180deg, rgb(${AMBER} / 0.05), transparent 60%), rgb(var(--lb-panel-bg) / 0.85)`
                }}
              >
                <span
                  className={`inline-block rounded border px-2 py-1 text-[9px] tracking-[0.3em] ${tierAccent('PRO')}`}
                >
                  PREMIUM ACTIVE
                </span>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                  You already have Cribble Premium — full kit unlocked. Every plate on
                  the rack below is 25% off for you, applied automatically at checkout.
                </p>
                <a
                  href="/api/portal"
                  className="mt-4 inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-amber-200"
                >
                  MANAGE SUBSCRIPTION <span aria-hidden>→</span>
                </a>
              </div>
            ) : (
              <div className="shp-console rounded-xl p-5">
                {/* arcade prompt line */}
                <div className="flex items-center gap-2">
                  <span className="text-[8px] tracking-[0.35em] text-zinc-600">SELECT TERM</span>
                  <span aria-hidden className="shp-cursor h-2 w-1.5 bg-amber-300/80" />
                </div>

                {/* term dial — arcade difficulty select, yearly preloaded */}
                <div
                  role="radiogroup"
                  aria-label="Billing term"
                  onKeyDown={handleSegKeys}
                  className="shp-seg-track mt-2.5 grid grid-cols-2 gap-1 rounded-lg p-1"
                >
                  <button
                    ref={monthlyRef}
                    type="button"
                    role="radio"
                    aria-checked={term === 'monthly'}
                    tabIndex={term === 'monthly' ? 0 : -1}
                    onClick={() => setTerm('monthly')}
                    className="shp-seg flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-[9px] tracking-[0.3em] text-zinc-500"
                  >
                    1 MONTH
                  </button>
                  <button
                    ref={yearlyRef}
                    type="button"
                    role="radio"
                    aria-checked={term === 'yearly'}
                    tabIndex={term === 'yearly' ? 0 : -1}
                    onClick={() => setTerm('yearly')}
                    className="shp-seg flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-[9px] tracking-[0.3em] text-zinc-500"
                  >
                    12 MONTHS
                    <span className="shp-seg-tag rounded px-1.5 py-px text-[7px] tracking-[0.2em]">
                      -40% BEST VALUE
                    </span>
                  </button>
                </div>

                {/* scoreboard — keyed by term so switching re-rolls the digits */}
                <div key={term} aria-hidden className="mt-5 text-center">
                  <div className="flex items-baseline justify-center gap-2">
                    <span className="shp-price text-[30px] leading-none [font-family:var(--font-pixel)] md:text-[34px]">
                      {meta.price.split('').map((ch, i) => (
                        <span
                          key={i}
                          className="shp-price-ch"
                          style={{ ['--d' as string]: `${i * 30}ms` }}
                        >
                          {ch}
                        </span>
                      ))}
                    </span>
                    <span
                      className="shp-price-ch text-[10px] tracking-[0.2em] text-zinc-500"
                      style={{ ['--d' as string]: `${meta.price.length * 30}ms` }}
                    >
                      {meta.unit}
                    </span>
                  </div>
                  <p className="shp-price-ctx mt-2.5 text-[9px] tracking-[0.2em] text-zinc-500">
                    {meta.context}
                  </p>
                </div>
                {/* stable live region — remounting scoreboards don't announce */}
                <p className="sr-only" aria-live="polite">
                  {meta.announce}
                </p>

                {/* the only button in the panel */}
                <a
                  href={`/api/checkout?type=pro_${term}`}
                  className="shp-go mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-[13px] leading-none tracking-[0.18em] [font-family:var(--font-pixel)]"
                >
                  GO PRO
                  <span aria-hidden className="shp-go-arrow">→</span>
                </a>

                <p className="mt-3.5 text-center text-[8px] tracking-[0.25em] text-zinc-600">
                  SECURE CHECKOUT BY POLAR · CANCEL ANYTIME
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- the Pro collection — usable while the sub is active ---- */}
      {PRO_PLATES.length > 0 && (
        <div className="relative border-t border-[rgb(var(--lb-panel-edge)/0.08)] px-6 pb-5 pt-4 md:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[9px] tracking-[0.35em] text-zinc-500">THE PRO COLLECTION</span>
            <span className="text-[9px] tracking-[0.2em] text-zinc-600">
              equipped while your sub is active
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {PRO_PLATES.map((plate) => (
              <div key={plate.id} className="relative">
                <PlatePreview plateId={plate.id} />
                <span
                  className="absolute right-2 top-2 z-10 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
                  style={{
                    color: `rgb(${AMBER})`,
                    borderColor: `rgb(${AMBER} / 0.45)`,
                    background: 'rgb(0 0 0 / 0.55)'
                  }}
                >
                  PRO
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

/* ================= plate tile ================= */

function PlateTile({
  plate,
  index,
  loading,
  isPro,
  owned
}: {
  plate: ShopPlate
  index: number
  loading: boolean
  isPro: boolean
  owned: boolean
}) {
  const accent = plate.render.kind === 'css' ? plate.render.accent : 'var(--lb-panel-edge)'
  const discounted = proPrice(plate.priceUsd)
  const checkoutPrice = usd(isPro ? discounted : plate.priceUsd)
  const canBuy = !loading && !owned

  return (
    <article
      className={`shp-tile shp-reveal relative flex flex-col rounded-2xl p-3 ${
        canBuy ? 'shp-tile-buyable' : ''
      }`}
      style={{
        ['--rv' as string]: `${240 + Math.min(index, 7) * 60}ms`,
        ['--tile-accent' as string]: accent
      }}
    >
      <div className="relative">
        <PlatePreview plateId={plate.id} />
        {owned && (
          <span
            className="absolute right-2 top-2 z-10 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
            style={{
              color: 'rgb(var(--lb-up))',
              borderColor: 'rgb(var(--lb-up) / 0.45)',
              background: 'rgb(0 0 0 / 0.55)'
            }}
          >
            OWNED
          </span>
        )}
      </div>

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-zinc-400">{plate.tagline}</p>

      <div className="mt-auto flex items-center justify-between gap-2 px-1 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <RarityChip rarity={plate.rarity} />
          {plate.seasonal && <SeasonalChip label={plate.seasonal.label} />}
        </div>

        {loading ? (
          <span className="h-[30px] w-24 animate-pulse rounded-lg bg-white/[0.05]" />
        ) : owned ? (
          <span
            className="rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em]"
            style={{
              color: 'rgb(var(--lb-up))',
              border: '1px solid rgb(var(--lb-up) / 0.35)',
              background: 'rgb(var(--lb-up) / 0.06)'
            }}
          >
            OWNED
          </span>
        ) : (
          <span
            aria-hidden
            className="shp-buy flex items-center gap-2 rounded-lg px-3 py-1.5"
          >
            {isPro ? (
              <>
                <span className="text-[9px] tabular-nums text-zinc-600 line-through">
                  {usd(plate.priceUsd)}
                </span>
                <span className="text-[12px] leading-none tabular-nums text-amber-300 [font-family:var(--font-pixel)]">
                  {usd(discounted)}
                </span>
                <span className="text-[7px] tracking-[0.2em] text-amber-300/80">-25% PRO</span>
              </>
            ) : (
              <span className="text-[12px] leading-none tabular-nums text-zinc-100 [font-family:var(--font-pixel)]">
                {usd(plate.priceUsd)}
              </span>
            )}
          </span>
        )}
      </div>

      {!loading && owned && (
        <p className="mt-2 px-1 text-[9px] tracking-[0.15em] text-zinc-600">
          in your hangar —{' '}
          <Link
            href="/profile"
            className="text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
          >
            equip it from your profile editor
          </Link>
        </p>
      )}

      {canBuy && (
        <a
          href={`/api/checkout?type=plate&plateId=${plate.id}`}
          aria-label={`Buy ${plate.name} — ${checkoutPrice}`}
          className="shp-tile-link absolute inset-0 z-20 rounded-2xl"
        />
      )}
    </article>
  )
}

/* ================= The Reserve — mythic class ================= */

function ReserveRow({
  plate,
  loading,
  isPro,
  owned
}: {
  plate: ShopPlate
  loading: boolean
  isPro: boolean
  owned: boolean
}) {
  const accent = plate.render.kind === 'css' ? plate.render.accent : 'var(--lb-panel-edge)'
  const notes = RESERVE_NOTES[plate.id]
  const discounted = proPrice(plate.priceUsd)
  const checkoutPrice = usd(isPro ? discounted : plate.priceUsd)
  const canBuy = !loading && !owned

  return (
    // `group` is load-bearing: the mythic hover flourishes in PlateLayer
    // (koi light bloom, anomaly tear-hold) key off `.group:hover`.
    <article
      className={`shp-reserve-row group relative rounded-xl p-3 ${
        canBuy ? 'shp-tile-buyable' : ''
      }`}
      style={{ ['--tile-accent' as string]: accent }}
    >
      <div className="relative">
        <PlatePreview plateId={plate.id} />
        {owned && (
          <span
            className="absolute right-2 top-2 z-10 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
            style={{
              color: 'rgb(var(--lb-up))',
              borderColor: 'rgb(var(--lb-up) / 0.45)',
              background: 'rgb(0 0 0 / 0.55)'
            }}
          >
            OWNED
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-1">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <MythicChip />
            {notes && (
              <span className="text-[9px] tracking-[0.3em] text-zinc-500">{notes.kicker}</span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{plate.tagline}</p>
          {notes && (
            <ul className="mt-2.5 space-y-1.5">
              {notes.alive.map((line) => (
                <li key={line} className="flex items-start gap-2 text-[10px] leading-relaxed text-zinc-500">
                  <span
                    aria-hidden
                    className="mt-px shrink-0 text-[9px] leading-4 [font-family:var(--font-pixel)]"
                    style={{ color: `rgb(${accent} / 0.85)` }}
                  >
                    +
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {loading ? (
            <span className="h-[34px] w-28 animate-pulse rounded-lg bg-white/[0.05]" />
          ) : owned ? (
            <span
              className="rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em]"
              style={{
                color: 'rgb(var(--lb-up))',
                border: '1px solid rgb(var(--lb-up) / 0.35)',
                background: 'rgb(var(--lb-up) / 0.06)'
              }}
            >
              OWNED
            </span>
          ) : (
            <span aria-hidden className="shp-buy flex items-center gap-2 rounded-lg px-3.5 py-2">
              {isPro ? (
                <>
                  <span className="text-[9px] tabular-nums text-zinc-600 line-through">
                    {usd(plate.priceUsd)}
                  </span>
                  <span className="text-[14px] leading-none tabular-nums text-amber-300 [font-family:var(--font-pixel)]">
                    {usd(discounted)}
                  </span>
                  <span className="text-[7px] tracking-[0.2em] text-amber-300/80">-25% PRO</span>
                </>
              ) : (
                <span className="text-[14px] leading-none tabular-nums text-zinc-100 [font-family:var(--font-pixel)]">
                  {usd(plate.priceUsd)}
                </span>
              )}
            </span>
          )}
          {!loading && owned && (
            <Link
              href="/profile"
              className="relative z-30 text-[9px] tracking-[0.15em] text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
            >
              equip it from your profile editor
            </Link>
          )}
        </div>
      </div>

      {canBuy && (
        <a
          href={`/api/checkout?type=plate&plateId=${plate.id}`}
          aria-label={`Buy ${plate.name} — ${checkoutPrice}`}
          className="shp-tile-link absolute inset-0 z-20 rounded-xl"
        />
      )}
    </article>
  )
}

function ReserveShelf({
  loading,
  isPro,
  owned
}: {
  loading: boolean
  isPro: boolean
  owned: ReadonlySet<string>
}) {
  if (RESERVE_PLATES.length === 0) return null

  return (
    <div className="shp-reserve relative overflow-hidden rounded-2xl">
      {/* iridescent keyline — the Reserve signature, one class above gold */}
      <span aria-hidden className="shp-reserve-keyline absolute inset-x-0 top-0 z-10 h-[2px]" />

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
          Three plates engineered past the legendary line. Not motifs on a
          background — <span className="text-zinc-200">living scenes</span>: a pond
          where koi actually swim, a black hole that keeps eating, a sky that tears
          open when it thinks nobody&apos;s watching.
        </p>

        <div className="mt-4 space-y-4">
          {RESERVE_PLATES.map((plate) => (
            <ReserveRow
              key={plate.id}
              plate={plate}
              loading={loading}
              isPro={isPro}
              owned={owned.has(plate.id)}
            />
          ))}
        </div>
      </div>
    </div>
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
  const owned = cosmetics?.owned ?? NEUTRAL_COSMETICS.owned

  return (
    <div className="page-zoom-out relative mx-auto max-w-5xl px-6 pb-16 pt-6">
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

      <main className="mt-8 space-y-6">
        {notice && (
          <NoticeBanner
            notice={notice}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onDismiss={() => setNotice(null)}
          />
        )}

        {/* ---------- Cribble Pro hero ---------- */}
        <section className="shp-reveal" style={{ ['--rv' as string]: '90ms' }}>
          <ProHero loading={loading} isPro={isPro} />
        </section>

        {/* ---------- The Reserve — mythic class ---------- */}
        <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '150ms' }}>
          <ReserveShelf loading={loading} isPro={isPro} owned={owned} />
        </section>

        {/* ---------- plate rack ---------- */}
        <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '210ms' }}>
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

          <div className="grid gap-4 md:grid-cols-2">
            {SHOP_PLATES.map((plate, i) => (
              <PlateTile
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

        {/* ---------- the vault — founder plate, one run then retired ---------- */}
        {FOUNDER_PLATE && (
          <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '260ms' }}>
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{
                border: '1px solid rgb(var(--lb-gold) / 0.28)',
                background:
                  'linear-gradient(90deg, rgb(var(--lb-gold) / 0.07), rgb(var(--lb-gold) / 0.02) 55%, transparent), rgb(var(--lb-panel-bg))',
                boxShadow:
                  '0 24px 70px -30px rgb(var(--lb-gold) / 0.25), 0 18px 50px -24px rgb(0 0 0 / 0.6)'
              }}
            >
              {/* gold keyline — same signature treatment as the trophy case */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 z-10 h-[2px]"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 4%, rgb(var(--lb-gold) / 0.85) 50%, transparent 96%)',
                  boxShadow: '0 0 12px rgb(var(--lb-gold) / 0.45)'
                }}
              />
              <div className="flex flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:px-8">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]"
                      style={{
                        color: 'rgb(var(--lb-gold))',
                        border: '1px solid rgb(var(--lb-gold) / 0.45)',
                        background: 'rgb(var(--lb-gold) / 0.07)',
                        textShadow: '0 0 10px rgb(var(--lb-gold) / 0.5)'
                      }}
                    >
                      THE VAULT
                    </span>
                    <span className="text-[9px] tracking-[0.3em] text-zinc-500">
                      ULTRA RARE · ONE RUN · NEVER SOLD AGAIN
                    </span>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
                    The <span className="text-[rgb(var(--lb-gold))]">{FOUNDER_PLATE.name}</span>{' '}
                    plate gets exactly one production run — this one. Take it and fly{' '}
                    <span className="text-zinc-200">day-one colors</span> forever; when the run
                    retires, it is never minted or sold again.
                  </p>
                  {!loading &&
                    (owned.has(FOUNDER_PLATE.id) ? (
                      <p
                        className="mt-3 text-[9px] tracking-[0.3em]"
                        style={{ color: 'rgb(var(--lb-gold))' }}
                      >
                        YOURS, FROM THE ONLY RUN —{' '}
                        <Link
                          href="/profile"
                          className="underline-offset-2 transition-colors hover:underline"
                        >
                          EQUIP IT
                        </Link>
                      </p>
                    ) : (
                      <a
                        href={`/api/checkout?type=plate&plateId=${FOUNDER_PLATE.id}`}
                        aria-label={`Buy ${FOUNDER_PLATE.name} — ${usd(
                          isPro ? proPrice(FOUNDER_PLATE.priceUsd) : FOUNDER_PLATE.priceUsd
                        )}`}
                        className="shp-founder mt-3.5 inline-flex items-center gap-2.5 rounded-lg px-3.5 py-2"
                      >
                        <span className="text-[9px] tracking-[0.3em]">
                          TAKE THE FOUNDER PLATE
                        </span>
                        {isPro ? (
                          <>
                            <span className="text-[9px] tabular-nums text-zinc-600 line-through">
                              {usd(FOUNDER_PLATE.priceUsd)}
                            </span>
                            <span className="text-[12px] leading-none tabular-nums text-amber-300 [font-family:var(--font-pixel)]">
                              {usd(proPrice(FOUNDER_PLATE.priceUsd))}
                            </span>
                            <span className="text-[7px] tracking-[0.2em] text-amber-300/80">
                              -25% PRO
                            </span>
                          </>
                        ) : (
                          <span className="text-[12px] leading-none tabular-nums [font-family:var(--font-pixel)]">
                            {usd(FOUNDER_PLATE.priceUsd)}
                          </span>
                        )}
                      </a>
                    ))}
                </div>
                {/* no OWNED chip over the art — the band states it, and the
                    guilloché should stay uncovered */}
                <div className="w-full shrink-0 md:max-w-[280px]">
                  <PlatePreview plateId={FOUNDER_PLATE.id} />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---------- the trophy case — champion plate, never sold ---------- */}
        {CHAMPION_PLATE && (
          <section className="shp-reveal !mt-10" style={{ ['--rv' as string]: '310ms' }}>
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{
                border: '1px solid rgb(var(--lb-gold) / 0.28)',
                background:
                  'linear-gradient(90deg, rgb(var(--lb-gold) / 0.07), rgb(var(--lb-gold) / 0.02) 55%, transparent), rgb(var(--lb-panel-bg))',
                boxShadow:
                  '0 24px 70px -30px rgb(var(--lb-gold) / 0.25), 0 18px 50px -24px rgb(0 0 0 / 0.6)'
              }}
            >
              {/* gold keyline — same signature treatment as the Pro hero */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 z-10 h-[2px]"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 4%, rgb(var(--lb-gold) / 0.85) 50%, transparent 96%)',
                  boxShadow: '0 0 12px rgb(var(--lb-gold) / 0.45)'
                }}
              />
              <div className="flex flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:px-8">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]"
                      style={{
                        color: 'rgb(var(--lb-gold))',
                        border: '1px solid rgb(var(--lb-gold) / 0.45)',
                        background: 'rgb(var(--lb-gold) / 0.07)',
                        textShadow: '0 0 10px rgb(var(--lb-gold) / 0.5)'
                      }}
                    >
                      THE TROPHY CASE
                    </span>
                    <span className="text-[9px] tracking-[0.3em] text-zinc-500">
                      NEVER SOLD · AWARDED AT #1
                    </span>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
                    <span className="text-[rgb(var(--lb-gold))]">{CHAMPION_PLATE.name}</span>{' '}
                    can&apos;t be bought at any price. Take the{' '}
                    <span className="text-zinc-200">number one spot</span> on the leaderboard and
                    it&apos;s minted to your hangar forever — lose the throne, keep the trophy.
                  </p>
                  {owned.has(CHAMPION_PLATE.id) ? (
                    <p
                      className="mt-3 text-[9px] tracking-[0.3em]"
                      style={{ color: 'rgb(var(--lb-gold))' }}
                    >
                      IN YOUR HANGAR, CHAMPION —{' '}
                      <Link
                        href="/profile"
                        className="underline-offset-2 transition-colors hover:underline"
                      >
                        EQUIP IT
                      </Link>
                    </p>
                  ) : (
                    <Link
                      href="/leaderboard"
                      className="mt-3 inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-500 transition-colors hover:text-[rgb(var(--lb-gold))]"
                    >
                      SEE WHO HOLDS THE THRONE <span aria-hidden>→</span>
                    </Link>
                  )}
                </div>
                {/* no OWNED/PRO-style chip here — the band's header already
                    says it all, and nothing should cover the trophy */}
                <div className="w-full shrink-0 md:max-w-[280px]">
                  <PlatePreview plateId={CHAMPION_PLATE.id} />
                </div>
              </div>
            </div>
          </section>
        )}

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

        /* The Pro hero is a product showcase: plate art is authored against
           black, and the theme-flipped panel washed it out with a white fade
           in light mode. Re-pin the surface + type tokens to their dark
           values inside the hero, so the readability fade stays black and
           the copy stays light-on-dark in both themes. */
        html.light .shp-hero {
          --lb-panel-bg: 9 10 13;
          --lb-panel-edge: 255 255 255;
          --lb-gold: 255 214 68;
          --lb-gold-hi: 255 240 160;
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

        /* plate tile — hover lifts and glows in the plate's own accent
           (each tile sets --tile-accent from the catalog) */
        .shp-tile {
          background: linear-gradient(180deg, rgb(255 255 255 / 0.03), transparent 40%),
            rgb(var(--lb-panel-bg));
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms ease,
            box-shadow 320ms ease;
        }
        .shp-tile-buyable {
          cursor: pointer;
        }
        .shp-tile-link {
          outline: none;
        }
        .shp-tile-link:focus-visible {
          outline: 2px solid rgb(var(--tile-accent) / 0.85);
          outline-offset: 3px;
        }
        @media (hover: hover) and (pointer: fine) {
          .shp-tile:hover {
            transform: translateY(-3px);
            border-color: rgb(var(--tile-accent) / 0.45);
            box-shadow:
              0 22px 60px -28px rgb(var(--tile-accent) / 0.4),
              0 16px 40px -22px rgb(0 0 0 / 0.8);
          }
        }
        .shp-tile:focus-within {
          transform: translateY(-3px);
          border-color: rgb(var(--tile-accent) / 0.6);
          box-shadow:
            0 22px 60px -28px rgb(var(--tile-accent) / 0.48),
            0 16px 40px -22px rgb(0 0 0 / 0.8);
        }

        /* buy chip — tints toward the plate accent on hover */
        .shp-buy {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.14);
          background: rgb(var(--lb-panel-edge) / 0.05);
          transition:
            border-color 220ms ease,
            background-color 220ms ease,
            box-shadow 220ms ease;
        }
        .shp-tile-buyable:hover .shp-buy,
        .shp-tile-buyable:focus-within .shp-buy {
          border-color: rgb(var(--tile-accent) / 0.6);
          background: rgb(var(--tile-accent) / 0.09);
          box-shadow: 0 0 24px -8px rgb(var(--tile-accent) / 0.5);
        }

        /* ---- The Reserve — obsidian band, iridescent chrome ----------- */

        /* Obsidian in BOTH themes: like the Pro hero, the Reserve is a
           product showcase — plate art is authored against black, so the
           band re-pins the dark surface + type tokens in light mode. */
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
        /* the animated iridescent MYTHIC chip — Reserve band only. The
           spectrum pans across the glyphs; border stays a quiet violet. */
        .shp-mythic-chip {
          border: 1px solid rgb(196 181 253 / 0.4);
          background: rgb(196 181 253 / 0.07);
          color: transparent;
          background-image: linear-gradient(
            100deg,
            rgb(125 232 255),
            rgb(178 166 255) 25%,
            rgb(255 154 222) 50%,
            rgb(255 233 166) 75%,
            rgb(125 232 255) 100%
          );
          background-size: 220% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          animation: shp-iri-pan 6s linear infinite;
        }
        @keyframes shp-iri-pan {
          to {
            background-position: -220% 0;
          }
        }

        /* reserve rows — same lift/glow contract as grid tiles, tuned to
           each plate's own accent */
        .shp-reserve-row {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          background: linear-gradient(180deg, rgb(255 255 255 / 0.02), transparent 45%),
            rgb(0 0 0 / 0.35);
          transition:
            transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 320ms ease,
            box-shadow 320ms ease;
        }
        @media (hover: hover) and (pointer: fine) {
          .shp-reserve-row:hover {
            transform: translateY(-3px);
            border-color: rgb(var(--tile-accent) / 0.5);
            box-shadow:
              0 22px 60px -28px rgb(var(--tile-accent) / 0.42),
              0 16px 40px -22px rgb(0 0 0 / 0.8);
          }
        }
        .shp-reserve-row:focus-within {
          transform: translateY(-3px);
          border-color: rgb(var(--tile-accent) / 0.6);
          box-shadow:
            0 22px 60px -28px rgb(var(--tile-accent) / 0.5),
            0 16px 40px -22px rgb(0 0 0 / 0.8);
        }
        .shp-reserve-row:hover .shp-buy,
        .shp-reserve-row:focus-within .shp-buy {
          border-color: rgb(var(--tile-accent) / 0.6);
          background: rgb(var(--tile-accent) / 0.09);
          box-shadow: 0 0 24px -8px rgb(var(--tile-accent) / 0.5);
        }

        /* vault band CTA — gold twin of the buy chip */
        .shp-founder {
          color: rgb(var(--lb-gold));
          border: 1px solid rgb(var(--lb-gold) / 0.4);
          background: rgb(var(--lb-gold) / 0.06);
          transition:
            border-color 220ms ease,
            background-color 220ms ease,
            box-shadow 220ms ease;
        }
        .shp-founder:hover,
        .shp-founder:focus-visible {
          border-color: rgb(var(--lb-gold) / 0.7);
          background: rgb(var(--lb-gold) / 0.11);
          box-shadow: 0 0 24px -8px rgb(var(--lb-gold) / 0.5);
        }

        /* Pro checkout console — one dial, one scoreboard, one launch
           button. Amber is written out (252 211 77) to match the AMBER
           const, same as the hero chrome above. */
        .shp-console {
          border: 1px solid rgb(252 211 77 / 0.24);
          background:
            repeating-linear-gradient(180deg, rgb(255 255 255 / 0.012) 0 1px, transparent 1px 3px),
            linear-gradient(180deg, rgb(252 211 77 / 0.05), transparent 55%),
            rgb(var(--lb-panel-bg) / 0.88);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.05),
            0 18px 44px -24px rgb(0 0 0 / 0.7);
        }

        /* prompt cursor — slow arcade blink */
        .shp-cursor {
          animation: shp-blink 1.1s steps(2, start) infinite;
        }
        @keyframes shp-blink {
          to {
            visibility: hidden;
          }
        }

        /* term dial: an inset slot; the selected segment is the lit key */
        .shp-seg-track {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.12);
          background: rgb(0 0 0 / 0.4);
          box-shadow: inset 0 2px 8px rgb(0 0 0 / 0.45);
        }
        .shp-seg {
          border: 1px solid transparent;
          transition:
            color 220ms ease,
            border-color 220ms ease,
            background-color 220ms ease,
            box-shadow 220ms ease,
            text-shadow 220ms ease;
        }
        .shp-seg-track .shp-seg[aria-checked='false']:hover {
          color: rgb(var(--z300));
          background: rgb(255 255 255 / 0.03);
        }
        .shp-seg-track .shp-seg[aria-checked='true'] {
          color: rgb(252 211 77);
          border-color: rgb(252 211 77 / 0.5);
          background: linear-gradient(180deg, rgb(252 211 77 / 0.14), rgb(252 211 77 / 0.04));
          box-shadow:
            0 0 20px -6px rgb(252 211 77 / 0.4),
            inset 0 1px 0 rgb(255 255 255 / 0.08);
          text-shadow: 0 0 12px rgb(252 211 77 / 0.45);
        }
        .shp-seg:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }
        .shp-seg-tag {
          color: rgb(252 211 77 / 0.9);
          border: 1px solid rgb(252 211 77 / 0.35);
          background: rgb(252 211 77 / 0.07);
          text-shadow: none;
        }
        .shp-seg-track .shp-seg[aria-checked='true'] .shp-seg-tag {
          border-color: rgb(252 211 77 / 0.55);
          background: rgb(252 211 77 / 0.12);
        }

        /* scoreboard price — amber LED digits */
        .shp-price {
          color: #fcff00;
          text-shadow:
            0 0 22px rgb(252 255 0 / 0.42),
            0 0 48px rgb(252 255 0 / 0.16);
        }
        /* a term switch re-mounts the readout; each glyph rolls up in turn */
        .shp-price-ch {
          display: inline-block;
          animation: shp-digit-roll 340ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes shp-digit-roll {
          from {
            opacity: 0;
            transform: translateY(0.5em);
          }
        }
        .shp-price-ctx {
          animation: shp-ctx-in 260ms ease-out 140ms backwards;
        }
        @keyframes shp-ctx-in {
          from {
            opacity: 0;
          }
        }

        /* launch button — the only control that leaves the console */
        .shp-go {
          position: relative;
          overflow: hidden;
          color: rgb(252 211 77);
          border: 2px solid rgb(252 211 77 / 0.55);
          background: linear-gradient(180deg, rgb(252 211 77 / 0.16), rgb(252 211 77 / 0.05)),
            rgb(var(--lb-panel-bg) / 0.6);
          text-shadow: 0 0 14px rgb(252 211 77 / 0.5);
          box-shadow:
            0 0 34px -8px rgb(252 211 77 / 0.45),
            inset 0 1px 0 rgb(255 255 255 / 0.12);
          transition:
            border-color 220ms ease,
            box-shadow 220ms ease,
            transform 120ms ease;
        }
        .shp-go::after {
          content: '';
          position: absolute;
          top: -40%;
          bottom: -40%;
          left: 0;
          width: 38%;
          background: linear-gradient(100deg, transparent, rgb(255 245 200 / 0.25), transparent);
          transform: translateX(-160%) skewX(-16deg);
          pointer-events: none;
        }
        .shp-go-arrow {
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .shp-go:hover {
            border-color: rgb(252 211 77 / 0.85);
            box-shadow:
              0 0 44px -6px rgb(252 211 77 / 0.55),
              inset 0 1px 0 rgb(255 255 255 / 0.16);
          }
          .shp-go:hover::after {
            animation: shp-go-sheen 650ms ease forwards;
          }
          .shp-go:hover .shp-go-arrow {
            transform: translateX(3px);
          }
        }
        @keyframes shp-go-sheen {
          to {
            transform: translateX(320%) skewX(-16deg);
          }
        }
        .shp-go:active {
          transform: translateY(1px);
          box-shadow:
            0 0 18px -10px rgb(252 211 77 / 0.4),
            inset 0 3px 10px rgb(0 0 0 / 0.45);
        }
        .shp-go:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .shp-reveal,
          .shp-notice,
          .shp-cursor,
          .shp-price-ch,
          .shp-price-ctx,
          .shp-mythic-chip,
          .shp-go:hover::after {
            animation: none;
          }
          .shp-tile,
          .shp-seg,
          .shp-go,
          .shp-go-arrow,
          .shp-buy,
          .shp-reserve-row,
          .shp-founder {
            transition: none;
          }
          .shp-go:hover .shp-go-arrow {
            transform: none;
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
