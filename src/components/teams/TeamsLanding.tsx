'use client'

// The /teams landing — Cribble Team's public pitch. Same design vocabulary
// as the /team console and the shop's gold surfaces: gold keylines over
// lb-panel ink, pixel display headlines with a gold glow, tracking-heavy
// microcopy. The page is intentionally quiet — the proof strip and the
// chooser do the selling.
//
// The tm-* styles below are this page's own copy of the shop's checkout
// console recipes (shp-* lives in a styled-jsx block scoped to the shop
// page, so it is not reachable from here). They are parameterised by
// --plan-rgb / --lane-rgb so one set of rules serves both the amber SOLO
// and gold TEAM sides.

import { TeamBadge } from '@/components/premium/TeamBadge'
import { GoldChip, GoldPanel, SectionHead } from './chrome'
import { PlanChooser } from './PlanChooser'
import { TeamsProofStrip } from './TeamsProofStrip'

const GOLD = 'var(--lb-gold)'

/* ================= copy ================= */

const WHAT_YOU_GET: { label: string; body: string; badge?: boolean }[] = [
  {
    label: 'THE GOLD SEAL',
    body: 'The pixel gold check on the company callsign — profile, player card, every board row.',
    badge: true
  },
  {
    label: 'THE SQUARE MARK',
    body: 'Companies are square, pilots are round. Your avatar renders square across the arena.'
  },
  {
    label: 'TEN SEATS',
    body: 'Up to ten affiliated pilots wear your clickable logo next to their names. Pending invites hold a seat.'
  },
  {
    label: 'THE CONSOLE',
    body: 'Invite by callsign, watch the seat meter, revoke in two clicks — the roster on one screen.'
  }
]

const STEPS: { n: string; label: string; body: string }[] = [
  {
    n: '01',
    label: 'CLAIM & PURCHASE',
    body: 'Sign in as the company account and pick a term. The account itself becomes the team.'
  },
  {
    n: '02',
    label: 'IDENTITY REVIEW',
    body: 'A human verifies the account before anything lights. Pay first — reviewed within 24 hours.'
  },
  {
    n: '03',
    label: 'FIELD YOUR PILOTS',
    body: 'Invite up to ten by callsign from the console. They accept from their notifications bell.'
  }
]

const TRUST: { label: string; body: string }[] = [
  {
    label: 'PAY FIRST, BADGE ON APPROVAL',
    body: 'Money lights nothing on its own. Every team passes a manual identity review before the gold seal renders.'
  },
  {
    label: 'THE IDENTITY TRIPWIRE',
    body: 'Change the approved account\u2019s handle, name, or avatar and the badge drops back to review on the spot.'
  },
  {
    label: 'INSTANT REVOCATION',
    body: 'Let the subscription lapse and every badge and affiliate mark goes dark at once. Renew and they light back up.'
  }
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What if review rejects us?',
    a: 'The subscription is cancelled and refunded. Rejection is about identity, not merit.'
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

/* ================= page ================= */

export function TeamsLanding() {
  return (
    <div className="page-zoom-out relative mx-auto max-w-4xl px-6 pb-16 pt-6">
      {/* gold atmosphere — the arena wash, tuned to this page's tier */}
      <div
        aria-hidden
        className="tm-arena pointer-events-none absolute inset-x-0 top-0 h-[560px]"
      />

      {/* ---------- hero ---------- */}
      <header
        className="tm-reveal relative mt-6 flex flex-col items-center"
        style={{ ['--rv' as string]: '0ms' }}
      >
        <GoldChip>CRIBBLE TEAM</GoldChip>
        <h1 className="tm-title mt-5 select-none text-center leading-none [font-family:var(--font-pixel)]">
          FLY COMPANY COLORS
        </h1>
        <p className="mt-5 max-w-md text-center text-xs leading-relaxed text-zinc-400">
          One account becomes the team. Your pilots wear its mark across the board — and
          every team is verified by hand before anything lights.
        </p>
        <p className="mt-4 text-center text-[10px] tracking-[0.3em] text-zinc-600">
          GOLD BADGE
          <span className="mx-2 text-zinc-800">·</span>
          SQUARE MARK
          <span className="mx-2 text-zinc-800">·</span>
          TEN SEATS
        </p>
        <span aria-hidden className="tm-keyline mt-8 h-[2px] w-full max-w-sm" />
      </header>

      <main className="mt-10 space-y-12">
        {/* ---------- proof strip — the real components ---------- */}
        <TeamsProofStrip />

        {/* ---------- what you get ---------- */}
        <section className="tm-reveal" style={{ ['--rv' as string]: '200ms' }}>
          <SectionHead label="WHAT YOU GET" note="EVERYTHING GATES ON APPROVAL" />
          <div className="grid gap-4 sm:grid-cols-2">
            {WHAT_YOU_GET.map((item) => (
              <div key={item.label} className="lb-panel rounded-2xl p-5">
                <div className="flex items-center gap-2.5">
                  <span
                    className="text-[10px] leading-4 [font-family:var(--font-pixel)]"
                    style={{ color: `rgb(${GOLD} / 0.9)` }}
                  >
                    +
                  </span>
                  <span className="text-[10px] tracking-[0.3em] text-zinc-300">
                    {item.label}
                  </span>
                  {item.badge && <TeamBadge size={13} />}
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="tm-reveal" style={{ ['--rv' as string]: '240ms' }}>
          <SectionHead label="HOW IT WORKS" note="REVIEWED WITHIN 24 HOURS" />
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="lb-panel rounded-2xl p-5">
                <span
                  className="text-sm leading-none [font-family:var(--font-pixel)]"
                  style={{
                    color: `rgb(${GOLD})`,
                    textShadow: `0 0 14px rgb(${GOLD} / 0.4)`
                  }}
                >
                  {step.n}
                </span>
                <div className="mt-3 text-[10px] tracking-[0.3em] text-zinc-300">
                  {step.label}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- trust — verification is the product ---------- */}
        <section className="tm-reveal" style={{ ['--rv' as string]: '280ms' }}>
          <SectionHead label="BUILT TO BE TRUSTED" note="THE BADGE IS A CLAIM WE CHECK" />
          <GoldPanel>
            <ul className="divide-y divide-white/[0.05]">
              {TRUST.map((row) => (
                <li
                  key={row.label}
                  className="flex flex-col gap-1.5 px-5 py-4 md:flex-row md:items-baseline md:gap-6 md:px-6"
                >
                  <span
                    className="shrink-0 text-[10px] tracking-[0.3em] md:w-64"
                    style={{ color: `rgb(${GOLD})` }}
                  >
                    {row.label}
                  </span>
                  <span className="min-w-0 text-[11px] leading-relaxed text-zinc-400">
                    {row.body}
                  </span>
                </li>
              ))}
            </ul>
          </GoldPanel>
        </section>

        {/* ---------- short FAQ ---------- */}
        <section className="tm-reveal" style={{ ['--rv' as string]: '320ms' }}>
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

        {/* ---------- choose, then pay ---------- */}
        <PlanChooser />
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

        /* ---- plan cards — one recipe, toned by --plan-rgb ------------- */

        /* The payment cards are checkout showcases — the same consoles the
           shop's Pro hero sells with, authored against ink (amber/gold chrome,
           signal-lime digits, black dial slots). Mirror the shop hero's move
           in light mode: re-pin the dark surface + type tokens inside the
           cards and the lane dial's slot, so the consoles read identically
           in both themes instead of half-flipping onto the cream. */
        html.light .tm-plan,
        html.light .tm-lane-track {
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
        /* The dial slot sits on the page itself, not on a card — its
           translucent black fill needs an opaque ink base on the cream. */
        html.light .tm-lane-track {
          background: rgb(var(--lb-panel-bg));
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

        /* lane dial — the SOLO | TEAM chooser; each side lights its own hue */
        .tm-lane-track {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.12);
          background: rgb(0 0 0 / 0.4);
          box-shadow: inset 0 2px 8px rgb(0 0 0 / 0.45);
        }
        .tm-lane {
          border: 1px solid transparent;
          transition:
            color 220ms ease,
            border-color 220ms ease,
            background-color 220ms ease,
            box-shadow 220ms ease,
            text-shadow 220ms ease;
        }
        .tm-lane-track .tm-lane[aria-checked='false']:hover {
          color: rgb(var(--z300));
          background: rgb(255 255 255 / 0.03);
        }
        .tm-lane-track .tm-lane[aria-checked='true'] {
          color: rgb(var(--lane-rgb));
          border-color: rgb(var(--lane-rgb) / 0.5);
          background: linear-gradient(180deg, rgb(var(--lane-rgb) / 0.14), rgb(var(--lane-rgb) / 0.04));
          box-shadow:
            0 0 20px -6px rgb(var(--lane-rgb) / 0.4),
            inset 0 1px 0 rgb(255 255 255 / 0.08);
          text-shadow: 0 0 12px rgb(var(--lane-rgb) / 0.45);
        }
        .tm-lane-track .tm-lane[aria-checked='true'] > span {
          color: rgb(var(--lane-rgb) / 0.75);
        }
        .tm-lane:focus-visible {
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
          .tm-lane,
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
