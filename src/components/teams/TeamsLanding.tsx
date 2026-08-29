'use client'

// The /teams landing — Cribble Team's buy page. Checkout-first: a short
// hero, then the TEAM checkout console, then the proof strip, then one
// compact FAQ. Same design vocabulary as the /team console and the shop's
// gold surfaces: gold keylines over lb-panel ink, pixel display headlines
// with a gold glow, tracking-heavy microcopy.
//
// The tm-* styles below are this page's own copy of the shop's checkout
// console recipes (shp-* lives in a styled-jsx block scoped to the shop
// page, so it is not reachable from here), parameterised by --plan-rgb.
// /teams sells Team only — Pro lives on /shop — so the console is wired
// straight to the team checkout with no plan chooser in front of it.
//
// Checkout is a plain browser navigation to /api/checkout, which bounces
// signed-out visitors to /login itself — so the console renders for
// everyone. Tier state hydrates from /api/user/cosmetics exactly like the
// shop: TEAM accounts get TEAM ACTIVE with their console/portal links.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { TEAM_TERMS, type BillingTerm } from '@/lib/planTerms'
import { GoldChip, SectionHead } from './chrome'
import { TeamsProofStrip } from './TeamsProofStrip'

const GOLD = 'var(--lb-gold)'

/* ================= copy ================= */

/** What the money buys — one-liners under the price, not a second essay.
 *  `tail` is the closing word rendered in a nowrap span together with
 *  the TeamBadge, so the mark can never orphan-wrap onto its own line. */
const PERKS: { text: string; tail?: string }[] = [
  { text: 'Gold team badge on your', tail: 'callsign' },
  { text: 'Square avatar — the corporate mark' },
  { text: 'Up to 10 affiliates wear your clickable logo' },
  { text: 'Manual identity review — pay first, badge within 24 hours' }
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What if review rejects us?',
    a: 'A human reviews every team\u2019s identity within 24 hours of payment. If we reject, the subscription is cancelled and refunded — rejection is about identity, not merit.'
  },
  {
    q: 'Do our pilots lose their own blue check?',
    a: 'No. The Pro check is personal — your logo renders alongside it, not instead of it.'
  },
  {
    q: 'What happens if the subscription lapses?',
    a: 'Badges and affiliate marks go dark immediately. The roster keeps its seats, and renewing lights everything back up.'
  },
  {
    q: 'Can we put anyone on the roster?',
    a: 'Only pilots who accept. Invites land in their notifications and can be declined.'
  }
]

/* ================= visitor tier ================= */

/** 'neutral' covers signed-out, non-team, and failed-fetch visitors — all
 *  of them get the browsable, armed checkout. */
type VisitorTier = 'team' | 'neutral'

/** The shop's cosmetics read, reduced to the one question this page asks:
 *  does this account already fly company colors? A 401 (signed out) or any
 *  failure degrades to the neutral storefront. Null while loading. */
function useVisitorTier(): VisitorTier | null {
  const [tier, setTier] = useState<VisitorTier | null>(null)

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
          setTier('neutral')
          return
        }
        const data = await res.json()
        if (!alive) return
        setTier(
          data?.success && typeof data.tier === 'string' && data.tier.toUpperCase() === 'TEAM'
            ? 'team'
            : 'neutral'
        )
      } catch {
        if (alive) setTier('neutral')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return tier
}

/* ================= checkout console ================= */

/** Term dial + scoreboard + launch button — the buy control, wired to the
 *  team checkout. Toned by the surrounding card's --plan-rgb. */
function CheckoutConsole() {
  const [term, setTerm] = useState<BillingTerm>('yearly')
  const monthlyRef = useRef<HTMLButtonElement>(null)
  const yearlyRef = useRef<HTMLButtonElement>(null)
  const meta = TEAM_TERMS[term]

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
        aria-label="Team billing term"
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
            2 MONTHS FREE
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

      {/* the only button in the panel. Press Start 2P advances a full em
          per glyph, so the label needs ~207px of the ~214px a 390px
          viewport leaves it — one step down below sm keeps it one line. */}
      <a
        href={`/api/checkout?type=team_${term}`}
        className="tm-go mt-5 flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-3.5 text-[11px] leading-none tracking-[0.18em] sm:text-[13px] [font-family:var(--font-pixel)]"
      >
        FIELD A TEAM
        <span aria-hidden className="tm-go-arrow">→</span>
      </a>

      <p className="mt-3.5 text-center text-[8px] tracking-[0.25em] text-zinc-600">
        SECURE CHECKOUT BY POLAR · REVIEWED WITHIN 24 HOURS
      </p>
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
function TeamActivePanel() {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        border: `1px solid rgb(${GOLD} / 0.3)`,
        background: `linear-gradient(180deg, rgb(${GOLD} / 0.05), transparent 60%), rgb(var(--lb-panel-bg) / 0.85)`
      }}
    >
      <span
        className="inline-block rounded border px-2 py-1 text-[9px] tracking-[0.3em]"
        style={{
          color: `rgb(${GOLD})`,
          borderColor: `rgb(${GOLD} / 0.4)`,
          background: `rgb(${GOLD} / 0.05)`
        }}
      >
        TEAM ACTIVE
      </span>
      <p className="mt-3 text-xs leading-relaxed text-zinc-400">
        This account flies company colors. Manage the roster and invites from the console.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
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
      </div>
    </div>
  )
}

function ConsoleSlot({ tier }: { tier: VisitorTier | null }) {
  if (tier === null) return <ConsoleSkeleton />
  switch (tier) {
    case 'team':
      return <TeamActivePanel />
    case 'neutral':
      return <CheckoutConsole />
    default: {
      const exhaustive: never = tier
      return exhaustive
    }
  }
}

/** The buy card — console on top, perks as one-liners underneath. */
function TeamCheckout() {
  const tier = useVisitorTier()

  return (
    <section className="tm-reveal" style={{ ['--rv' as string]: '70ms' }}>
      <div
        className="tm-plan relative mx-auto w-full max-w-xl overflow-hidden rounded-2xl"
        style={{ ['--plan-rgb' as string]: GOLD }}
      >
        <span aria-hidden className="tm-plan-keyline absolute inset-x-0 top-0 z-10 h-[2px]" />
        <div className="p-6 md:p-8">
          <ConsoleSlot tier={tier} />

          <ul className="mt-6 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {PERKS.map((perk) => (
              <li
                key={perk.text}
                className="flex items-start gap-2.5 text-[11px] leading-relaxed text-zinc-400"
              >
                <span
                  className="mt-px shrink-0 text-[10px] leading-4 [font-family:var(--font-pixel)]"
                  style={{ color: `rgb(${GOLD} / 0.9)` }}
                >
                  +
                </span>
                <span>
                  {perk.text}
                  {perk.tail && (
                    <>
                      {' '}
                      <span className="whitespace-nowrap">
                        {perk.tail}
                        <TeamBadge size={12} className="ml-1.5 inline-block align-[-2px]" />
                      </span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ================= page ================= */

export function TeamsLanding() {
  return (
    <div className="page-zoom-out relative mx-auto max-w-4xl px-6 pb-16 pt-6">
      {/* gold atmosphere — the arena wash, tuned to this page's tier */}
      <div
        aria-hidden
        className="tm-arena pointer-events-none absolute inset-x-0 top-0 h-[560px]"
      />

      {/* ---------- hero — chip, title, one line ---------- */}
      <header
        className="tm-reveal relative mt-6 flex flex-col items-center"
        style={{ ['--rv' as string]: '0ms' }}
      >
        <GoldChip>CRIBBLE TEAM</GoldChip>
        <h1 className="tm-title mt-5 select-none text-center leading-none [font-family:var(--font-pixel)]">
          FLY COMPANY COLORS
        </h1>
        <p className="mt-5 max-w-md text-center text-xs leading-relaxed text-zinc-400">
          One account becomes the team — your pilots wear its mark across the board.
        </p>
        <span aria-hidden className="tm-keyline mt-8 h-[2px] w-full max-w-sm" />
      </header>

      <main className="mt-10 space-y-12">
        {/* ---------- the buy control, first ---------- */}
        <TeamCheckout />

        {/* ---------- proof strip — the real components ---------- */}
        <TeamsProofStrip />

        {/* ---------- short FAQ ---------- */}
        <section className="tm-reveal" style={{ ['--rv' as string]: '210ms' }}>
          <SectionHead label="QUESTIONS" note="SHORT ANSWERS" />
          <div className="lb-panel divide-y divide-white/[0.05] rounded-2xl">
            {FAQ.map((item) => (
              <div key={item.q} className="px-5 py-4 md:px-6">
                <h3 className="text-xs font-medium text-zinc-200">{item.q}</h3>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mt-10 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
        <span>CRIBBLE · {new Date().getFullYear()}</span>
        <span className="text-zinc-700">{'// fly company colors'}</span>
      </footer>

      <style jsx global>{`
        /* page atmosphere — the shop's arena wash, gold-led for this tier */
        .tm-arena {
          background:
            radial-gradient(46% 340px at 50% -40px, rgb(var(--lb-gold) / 0.08), transparent 70%),
            radial-gradient(30% 300px at 12% 60px, rgb(var(--lb-gold) / 0.04), transparent 70%),
            radial-gradient(30% 300px at 88% 60px, rgb(var(--banner-a) / 0.04), transparent 70%);
          mask-image: linear-gradient(180deg, black 55%, transparent);
          -webkit-mask-image: linear-gradient(180deg, black 55%, transparent);
        }
        html.light .tm-arena {
          background: radial-gradient(46% 320px at 50% -40px, rgb(var(--lb-gold) / 0.07), transparent 70%);
        }

        /* pixel headline — gold face, the console's glow at display scale */
        .tm-title {
          font-size: clamp(20px, 4.5vw, 38px);
          color: rgb(var(--lb-gold));
          letter-spacing: 0.03em;
          text-shadow:
            0 0 24px rgb(var(--lb-gold) / 0.4),
            0 0 56px rgb(var(--lb-gold) / 0.16);
        }

        /* hero rule — the gold keyline, freestanding */
        .tm-keyline {
          background: linear-gradient(90deg, transparent 4%, rgb(var(--lb-gold) / 0.7) 50%, transparent 96%);
          box-shadow: 0 0 12px rgb(var(--lb-gold) / 0.35);
        }

        /* first-paint cascade */
        .tm-reveal {
          animation: tm-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes tm-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }

        /* ---- plan card — the shop's console recipe, toned by --plan-rgb ---- */

        /* The payment card is a checkout showcase — the same console the
           shop's Pro hero sells with, authored against ink (gold chrome,
           signal-lime digits, black dial slots). Mirror the shop hero's move
           in light mode: re-pin the dark surface + type tokens inside the
           card so the console reads identically in both themes instead of
           half-flipping onto the cream. */
        html.light .tm-plan {
          --lb-panel-bg: 9 10 13;
          --lb-panel-edge: 255 255 255;
          --lb-gold: 255 214 68;
          --lb-gold-hi: 255 240 160;
          --lb-score: 252 255 0;
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

        .tm-plan {
          border: 1px solid rgb(var(--plan-rgb) / 0.28);
          background:
            linear-gradient(90deg, rgb(var(--plan-rgb) / 0.07), rgb(var(--plan-rgb) / 0.02) 55%, transparent),
            rgb(var(--lb-panel-bg));
          box-shadow:
            0 24px 70px -30px rgb(var(--plan-rgb) / 0.25),
            0 18px 50px -24px rgb(0 0 0 / 0.6);
        }
        .tm-plan-keyline {
          background: linear-gradient(90deg, transparent 4%, rgb(var(--plan-rgb) / 0.85) 50%, transparent 96%);
          box-shadow: 0 0 12px rgb(var(--plan-rgb) / 0.45);
        }

        /* checkout console — dial, scoreboard, launch button */
        .tm-console {
          border: 1px solid rgb(var(--plan-rgb) / 0.24);
          background:
            repeating-linear-gradient(180deg, rgb(255 255 255 / 0.012) 0 1px, transparent 1px 3px),
            linear-gradient(180deg, rgb(var(--plan-rgb) / 0.05), transparent 55%),
            rgb(var(--lb-panel-bg) / 0.88);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.05),
            0 18px 44px -24px rgb(0 0 0 / 0.7);
        }

        /* prompt cursor — slow arcade blink, in the plan's hue */
        .tm-cursor {
          background: rgb(var(--plan-rgb) / 0.8);
          animation: tm-blink 1.1s steps(2, start) infinite;
        }
        @keyframes tm-blink {
          to {
            visibility: hidden;
          }
        }

        /* term dial: an inset slot; the selected segment is the lit key */
        .tm-seg-track {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.12);
          background: rgb(0 0 0 / 0.4);
          box-shadow: inset 0 2px 8px rgb(0 0 0 / 0.45);
        }
        .tm-seg {
          border: 1px solid transparent;
          transition:
            color 220ms ease,
            border-color 220ms ease,
            background-color 220ms ease,
            box-shadow 220ms ease,
            text-shadow 220ms ease;
        }
        .tm-seg-track .tm-seg[aria-checked='false']:hover {
          color: rgb(var(--z300));
          background: rgb(255 255 255 / 0.03);
        }
        .tm-seg-track .tm-seg[aria-checked='true'] {
          color: rgb(var(--plan-rgb));
          border-color: rgb(var(--plan-rgb) / 0.5);
          background: linear-gradient(180deg, rgb(var(--plan-rgb) / 0.14), rgb(var(--plan-rgb) / 0.04));
          box-shadow:
            0 0 20px -6px rgb(var(--plan-rgb) / 0.4),
            inset 0 1px 0 rgb(255 255 255 / 0.08);
          text-shadow: 0 0 12px rgb(var(--plan-rgb) / 0.45);
        }
        .tm-seg:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }
        .tm-seg-tag {
          color: rgb(var(--plan-rgb) / 0.9);
          border: 1px solid rgb(var(--plan-rgb) / 0.35);
          background: rgb(var(--plan-rgb) / 0.07);
          text-shadow: none;
        }
        .tm-seg-track .tm-seg[aria-checked='true'] .tm-seg-tag {
          border-color: rgb(var(--plan-rgb) / 0.55);
          background: rgb(var(--plan-rgb) / 0.12);
        }

        /* scoreboard price — the board's signal-lime numerals */
        .tm-price {
          color: rgb(var(--lb-score));
          text-shadow:
            0 0 22px rgb(var(--lb-score) / 0.42),
            0 0 48px rgb(var(--lb-score) / 0.16);
        }
        .tm-price-ch {
          display: inline-block;
          animation: tm-digit-roll 340ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes tm-digit-roll {
          from {
            opacity: 0;
            transform: translateY(0.5em);
          }
        }
        .tm-price-ctx {
          animation: tm-ctx-in 260ms ease-out 140ms backwards;
        }
        @keyframes tm-ctx-in {
          from {
            opacity: 0;
          }
        }

        /* launch button — the only control that leaves the console */
        .tm-go {
          position: relative;
          overflow: hidden;
          color: rgb(var(--plan-rgb));
          border: 2px solid rgb(var(--plan-rgb) / 0.55);
          background:
            linear-gradient(180deg, rgb(var(--plan-rgb) / 0.16), rgb(var(--plan-rgb) / 0.05)),
            rgb(var(--lb-panel-bg) / 0.6);
          text-shadow: 0 0 14px rgb(var(--plan-rgb) / 0.5);
          box-shadow:
            0 0 34px -8px rgb(var(--plan-rgb) / 0.45),
            inset 0 1px 0 rgb(255 255 255 / 0.12);
          transition:
            border-color 220ms ease,
            box-shadow 220ms ease,
            transform 120ms ease;
        }
        .tm-go::after {
          content: '';
          position: absolute;
          top: -40%;
          bottom: -40%;
          left: 0;
          width: 38%;
          background: linear-gradient(100deg, transparent, rgb(255 250 220 / 0.25), transparent);
          transform: translateX(-160%) skewX(-16deg);
          pointer-events: none;
        }
        .tm-go-arrow {
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .tm-go:hover {
            border-color: rgb(var(--plan-rgb) / 0.85);
            box-shadow:
              0 0 44px -6px rgb(var(--plan-rgb) / 0.55),
              inset 0 1px 0 rgb(255 255 255 / 0.16);
          }
          .tm-go:hover::after {
            animation: tm-go-sheen 650ms ease forwards;
          }
          .tm-go:hover .tm-go-arrow {
            transform: translateX(3px);
          }
        }
        @keyframes tm-go-sheen {
          to {
            transform: translateX(320%) skewX(-16deg);
          }
        }
        .tm-go:active {
          transform: translateY(1px);
          box-shadow:
            0 0 18px -10px rgb(var(--plan-rgb) / 0.4),
            inset 0 3px 10px rgb(0 0 0 / 0.45);
        }
        .tm-go:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .tm-reveal,
          .tm-cursor,
          .tm-price-ch,
          .tm-price-ctx,
          .tm-go:hover::after {
            animation: none;
          }
          .tm-seg,
          .tm-go,
          .tm-go-arrow {
            transition: none;
          }
          .tm-go:hover .tm-go-arrow {
            transform: none;
          }
        }
      `}</style>
    </div>
  )
}
