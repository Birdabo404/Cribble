'use client'

// The SOLO | TEAM chooser — the page's "choose, then pay" moment. A
// two-position lane dial (same radio-group keyboard contract as the
// shop's term dials: one tab stop, arrows flip) reveals the matching
// payment card. TEAM leads — it is this page's audience.
//
// Checkout is a plain browser navigation to /api/checkout, which bounces
// signed-out visitors to /login itself — so the consoles render for
// everyone. Tier state hydrates from /api/user/cosmetics exactly like the
// shop: already-Pro visitors get a PRO ACTIVE panel on the solo side,
// TEAM accounts get TEAM ACTIVE with their console/portal links.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { PRO_TERMS, TEAM_TERMS, type BillingTerm, type PlanTermMeta } from '@/lib/planTerms'

/** Tailwind amber-300 — Pro's merchandising hue, written as a raw triplet
 *  so it can drive the same --plan-rgb custom property gold uses. */
const AMBER = '252 211 77'
const GOLD = 'var(--lb-gold)'

type Lane = 'solo' | 'team'

/* ================= visitor tier ================= */

interface TierState {
  tier: string
  isPro: boolean
}

/** Signed-out / failed-fetch mode: browsable, both consoles armed. */
const NEUTRAL_TIER: TierState = { tier: 'FREE', isPro: false }

/** The shop's cosmetics read, reduced to what the chooser needs. A 401
 *  (signed out) or any failure degrades to the neutral storefront. */
function useVisitorTier(): TierState | null {
  const [state, setState] = useState<TierState | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/user/cosmetics', {
          cache: 'no-store',
          credentials: 'include'
        })
        if (!alive) return
        if (!res.ok) {
          setState(NEUTRAL_TIER)
          return
        }
        const data = await res.json()
        if (!alive) return
        setState(
          data?.success
            ? {
                tier: typeof data.tier === 'string' ? data.tier : 'FREE',
                isPro: Boolean(data.isPro)
              }
            : NEUTRAL_TIER
        )
      } catch {
        if (alive) setState(NEUTRAL_TIER)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return state
}

/* ================= console pieces ================= */

/** Term dial + scoreboard + launch button — the checkout console both
 *  cards share, toned by the surrounding card's --plan-rgb. */
function CheckoutConsole({
  terms,
  valueTag,
  dialLabel,
  checkoutPrefix,
  cta,
  footnote
}: {
  terms: Record<BillingTerm, PlanTermMeta>
  valueTag: string
  dialLabel: string
  checkoutPrefix: 'pro' | 'team'
  cta: string
  footnote: string
}) {
  const [term, setTerm] = useState<BillingTerm>('yearly')
  const monthlyRef = useRef<HTMLButtonElement>(null)
  const yearlyRef = useRef<HTMLButtonElement>(null)
  const meta = terms[term]

  // Radio-group keyboard contract: one tab stop, arrows flip the dial.
  const handleSegKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const next: BillingTerm = term === 'monthly' ? 'yearly' : 'monthly'
    setTerm(next)
    ;(next === 'monthly' ? monthlyRef : yearlyRef).current?.focus()
  }

  return (
    <div className="tm-console rounded-xl p-5">
      {/* arcade prompt line */}
      <div className="flex items-center gap-2">
        <span className="text-[8px] tracking-[0.35em] text-zinc-600">SELECT TERM</span>
        <span aria-hidden className="tm-cursor h-2 w-1.5" />
      </div>

      {/* term dial — yearly preloaded, the honest default is the best deal */}
      <div
        role="radiogroup"
        aria-label={dialLabel}
        onKeyDown={handleSegKeys}
        className="tm-seg-track mt-2.5 grid grid-cols-2 gap-1 rounded-lg p-1"
      >
        <button
          ref={monthlyRef}
          type="button"
          role="radio"
          aria-checked={term === 'monthly'}
          tabIndex={term === 'monthly' ? 0 : -1}
          onClick={() => setTerm('monthly')}
          className="tm-seg flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-[9px] tracking-[0.3em] text-zinc-500"
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
          className="tm-seg flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-[9px] tracking-[0.3em] text-zinc-500"
        >
          12 MONTHS
          <span className="tm-seg-tag rounded px-1.5 py-px text-[7px] tracking-[0.2em]">
            {valueTag}
          </span>
        </button>
      </div>

      {/* scoreboard — keyed by term so switching re-rolls the digits */}
      <div key={term} aria-hidden className="mt-5 text-center">
        <div className="flex items-baseline justify-center gap-2">
          <span className="tm-price text-[30px] leading-none [font-family:var(--font-pixel)] md:text-[34px]">
            {meta.price.split('').map((ch, i) => (
              <span key={i} className="tm-price-ch" style={{ ['--d' as string]: `${i * 30}ms` }}>
                {ch}
              </span>
            ))}
          </span>
          <span
            className="tm-price-ch text-[10px] tracking-[0.2em] text-zinc-500"
            style={{ ['--d' as string]: `${meta.price.length * 30}ms` }}
          >
            {meta.unit}
          </span>
        </div>
        <p className="tm-price-ctx mt-2.5 text-[9px] tracking-[0.2em] text-zinc-500">
          {meta.context}
        </p>
      </div>
      {/* stable live region — remounting scoreboards don't announce */}
      <p className="sr-only" aria-live="polite">
        {meta.announce}
      </p>

      {/* the only button in the panel */}
      <a
        href={`/api/checkout?type=${checkoutPrefix}_${term}`}
        className="tm-go mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-[13px] leading-none tracking-[0.18em] [font-family:var(--font-pixel)]"
      >
        {cta}
        <span aria-hidden className="tm-go-arrow">→</span>
      </a>

      <p className="mt-3.5 text-center text-[8px] tracking-[0.25em] text-zinc-600">{footnote}</p>
    </div>
  )
}

function ConsoleSkeleton() {
  return (
    <div className="grid gap-3 rounded-xl border border-[rgb(var(--lb-panel-edge)/0.1)] p-5">
      <span className="h-11 animate-pulse rounded-lg bg-white/[0.05]" />
      <span className="mx-auto h-12 w-2/3 animate-pulse rounded-lg bg-white/[0.05]" />
      <span className="h-12 animate-pulse rounded-lg bg-white/[0.05]" />
      <span className="mx-auto h-2 w-1/2 animate-pulse rounded bg-white/[0.05]" />
    </div>
  )
}

/** Already-subscribed state — chip, one line of copy, onward links. */
function ActivePanel({
  tone,
  chipLabel,
  body,
  links
}: {
  tone: string
  chipLabel: string
  body: string
  links: ReactNode
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        border: `1px solid rgb(${tone} / 0.3)`,
        background: `linear-gradient(180deg, rgb(${tone} / 0.05), transparent 60%), rgb(var(--lb-panel-bg) / 0.85)`
      }}
    >
      <span
        className="inline-block rounded border px-2 py-1 text-[9px] tracking-[0.3em]"
        style={{
          color: `rgb(${tone})`,
          borderColor: `rgb(${tone} / 0.4)`,
          background: `rgb(${tone} / 0.05)`
        }}
      >
        {chipLabel}
      </span>
      <p className="mt-3 text-xs leading-relaxed text-zinc-400">{body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">{links}</div>
    </div>
  )
}

/* ================= plan cards ================= */

interface Perk {
  text: string
  badge?: ReactNode
}

/** Card shell — pitch + perks on the left, console (or active state) on
 *  the right, everything toned by --plan-rgb. */
function PlanPanel({
  tone,
  chip,
  title,
  pitch,
  perks,
  right
}: {
  tone: string
  chip: string
  title: string
  pitch: string
  perks: Perk[]
  right: ReactNode
}) {
  return (
    <div
      className="tm-plan relative overflow-hidden rounded-2xl"
      style={{ ['--plan-rgb' as string]: tone }}
    >
      <span aria-hidden className="tm-plan-keyline absolute inset-x-0 top-0 z-10 h-[2px]" />

      <div className="grid gap-8 p-6 md:grid-cols-[1.15fr_1fr] md:p-8">
        {/* pitch + perks */}
        <div>
          <span
            className="inline-block rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]"
            style={{
              color: `rgb(${tone})`,
              border: `1px solid rgb(${tone} / 0.45)`,
              background: `rgb(${tone} / 0.07)`,
              textShadow: `0 0 10px rgb(${tone} / 0.5)`
            }}
          >
            {chip}
          </span>
          <h3
            className="mt-3 text-xl leading-none md:text-2xl [font-family:var(--font-pixel)]"
            style={{
              color: `rgb(${tone})`,
              textShadow: `0 0 18px rgb(${tone} / 0.45), 0 0 46px rgb(${tone} / 0.2)`
            }}
          >
            {title}
          </h3>
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">{pitch}</p>

          <ul className="mt-5 space-y-2.5">
            {perks.map((perk) => (
              <li key={perk.text} className="flex items-start gap-2.5 text-xs text-zinc-300">
                <span
                  className="mt-px shrink-0 text-[10px] leading-4 [font-family:var(--font-pixel)]"
                  style={{ color: `rgb(${tone} / 0.9)` }}
                >
                  +
                </span>
                <span className="leading-relaxed">
                  {perk.text}
                  {perk.badge}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* pricing / active state */}
        <div className="flex flex-col justify-center gap-3">{right}</div>
      </div>
    </div>
  )
}

function SoloCard({ loading, isPro }: { loading: boolean; isPro: boolean }) {
  return (
    <PlanPanel
      tone={AMBER}
      chip="THE SUBSCRIPTION"
      title="CRIBBLE PRO"
      pitch="The full pilot kit — flex on the whole board. Cancel anytime."
      perks={[
        { text: 'Animated GIF banner on your profile' },
        {
          text: 'Pixel blue check next to your name',
          badge: <VerifiedBadge size={12} className="ml-1.5 inline-block align-[-2px]" />
        },
        { text: 'Three exclusive plates in the depot' },
        { text: '25% off every plate, applied at checkout' }
      ]}
      right={
        loading ? (
          <ConsoleSkeleton />
        ) : isPro ? (
          <ActivePanel
            tone={AMBER}
            chipLabel="PREMIUM ACTIVE"
            body="You already fly the full kit. Every plate in the depot is 25% off for you."
            links={
              <>
                <Link
                  href="/shop"
                  className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] transition-opacity hover:opacity-80"
                  style={{ color: `rgb(${AMBER})` }}
                >
                  OPEN THE DEPOT <span aria-hidden>→</span>
                </Link>
                <a
                  href="/api/portal"
                  className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  MANAGE SUBSCRIPTION <span aria-hidden>→</span>
                </a>
              </>
            }
          />
        ) : (
          <CheckoutConsole
            terms={PRO_TERMS}
            valueTag="-40% BEST VALUE"
            dialLabel="Pro billing term"
            checkoutPrefix="pro"
            cta="GO PRO"
            footnote="SECURE CHECKOUT BY POLAR · CANCEL ANYTIME"
          />
        )
      }
    />
  )
}

function TeamCard({ loading, isTeam }: { loading: boolean; isTeam: boolean }) {
  return (
    <PlanPanel
      tone={GOLD}
      chip="FOR COMPANIES"
      title="CRIBBLE TEAM"
      pitch="Your account becomes the team — your people wear its mark across the board."
      perks={[
        {
          text: 'Gold team badge on your callsign',
          badge: <TeamBadge size={12} className="ml-1.5 inline-block align-[-2px]" />
        },
        { text: 'Square avatar — the corporate mark' },
        { text: 'Up to 10 affiliates wear your clickable logo' },
        { text: 'Manual identity review — pay first, badge within 24 hours' }
      ]}
      right={
        loading ? (
          <ConsoleSkeleton />
        ) : isTeam ? (
          <ActivePanel
            tone={GOLD}
            chipLabel="TEAM ACTIVE"
            body="This account flies company colors. Manage the roster and invites from the console."
            links={
              <>
                <Link
                  href="/team"
                  className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] transition-opacity hover:opacity-80"
                  style={{ color: `rgb(${GOLD})` }}
                >
                  OPEN TEAM CONSOLE <span aria-hidden>→</span>
                </Link>
                <a
                  href="/api/portal"
                  className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  MANAGE SUBSCRIPTION <span aria-hidden>→</span>
                </a>
              </>
            }
          />
        ) : (
          <CheckoutConsole
            terms={TEAM_TERMS}
            valueTag="2 MONTHS FREE"
            dialLabel="Team billing term"
            checkoutPrefix="team"
            cta="FIELD A TEAM"
            footnote="SECURE CHECKOUT BY POLAR · REVIEWED WITHIN 24 HOURS"
          />
        )
      }
    />
  )
}

/* ================= the chooser ================= */

export function PlanChooser() {
  const tier = useVisitorTier()
  const loading = tier === null
  const isPro = tier?.isPro ?? false
  const isTeam = (tier?.tier ?? 'FREE').toUpperCase() === 'TEAM'

  // TEAM leads — this page's audience. Same one-tab-stop arrow contract
  // as the term dials inside the cards.
  const [lane, setLane] = useState<Lane>('team')
  const soloRef = useRef<HTMLButtonElement>(null)
  const teamRef = useRef<HTMLButtonElement>(null)

  const handleLaneKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const next: Lane = lane === 'solo' ? 'team' : 'solo'
    setLane(next)
    ;(next === 'solo' ? soloRef : teamRef).current?.focus()
  }

  return (
    <section id="choose" className="tm-reveal" style={{ ['--rv' as string]: '200ms' }}>
      {/* section lockup */}
      <div className="flex flex-col items-center">
        <span className="text-[9px] tracking-[0.5em] text-zinc-600">THE DECISION</span>
        <h2 className="mt-3 select-none text-center text-lg leading-none text-zinc-50 md:text-xl [font-family:var(--font-pixel)]">
          PICK YOUR LANE
        </h2>
        <p className="mt-3 text-center text-[10px] tracking-[0.3em] text-zinc-600">
          ONE PILOT OR THE WHOLE COMPANY · CHECKOUT BY POLAR EITHER WAY
        </p>
      </div>

      {/* lane dial — each side lights in its own plan hue */}
      <div
        role="radiogroup"
        aria-label="Plan"
        onKeyDown={handleLaneKeys}
        className="tm-lane-track mx-auto mt-6 grid w-full max-w-md grid-cols-2 gap-1 rounded-xl p-1"
      >
        <button
          ref={soloRef}
          type="button"
          role="radio"
          aria-checked={lane === 'solo'}
          tabIndex={lane === 'solo' ? 0 : -1}
          onClick={() => setLane('solo')}
          style={{ ['--lane-rgb' as string]: AMBER }}
          className="tm-lane flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] tracking-[0.3em] text-zinc-500"
        >
          SOLO
          <span className="text-[7px] tracking-[0.25em] text-zinc-600">CRIBBLE PRO</span>
        </button>
        <button
          ref={teamRef}
          type="button"
          role="radio"
          aria-checked={lane === 'team'}
          tabIndex={lane === 'team' ? 0 : -1}
          onClick={() => setLane('team')}
          style={{ ['--lane-rgb' as string]: GOLD }}
          className="tm-lane flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] tracking-[0.3em] text-zinc-500"
        >
          TEAM
          <span className="text-[7px] tracking-[0.25em] text-zinc-600">COMPANY COLORS</span>
        </button>
      </div>

      {/* the selected side's payment card — one visible at a time */}
      <div key={lane} className="tm-reveal mt-6" style={{ ['--rv' as string]: '0ms' }}>
        {lane === 'solo' ? (
          <SoloCard loading={loading} isPro={isPro} />
        ) : (
          <TeamCard loading={loading} isTeam={isTeam} />
        )}
      </div>
    </section>
  )
}
