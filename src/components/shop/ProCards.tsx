'use client'

// Cribble Pro — the subscription section, as two standalone pricing cards
// (monthly / yearly) inside the same obsidian + amber showcase panel the
// old ProHero used. Replaces the hero's term dial + scoreboard: each term
// carries its own price, the four perks and its own checkout CTA, so
// there is no dial state and no live region. `isPro` collapses the cards
// into the PREMIUM ACTIVE panel + portal link.
//
// Self-contained: every class lives in this file's styled-jsx block under
// a fresh `shpp-` prefix — zero reliance on the `shp-` classes still
// defined by shop/page.tsx.

import { useRef } from 'react'
import { PlateLayer, PlatePreview } from '@/components/cosmetics/PlateLayer'
import { tierAccent } from '@/components/dashboard-v2/format'
import { AMBER } from '@/components/premium/premium'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import type { PlateDef } from '@/lib/cosmetics/plates'
import { PRO_TERMS, type BillingTerm } from '@/lib/planTerms'
import { HERO_BACKDROP_ID, PRO_PLATES } from './catalog'
import { useOnStage } from './stage'

const PRO_PLATE_NAMES = PRO_PLATES.map((plate) => plate.name).join(' · ')

/** The blue-check line gets the inline VerifiedBadge in the renderer. */
const BLUE_CHECK_PERK = 'Pixel blue check next to your name'

/** The four perk lines — the exact copy the old ProHero pitched. */
const PERKS: readonly string[] = [
  'Animated GIF banner on your profile',
  BLUE_CHECK_PERK,
  `Three exclusive plates — ${PRO_PLATE_NAMES}`,
  '25% off every plate in the depot'
]

const TERM_LABEL: Record<BillingTerm, string> = {
  monthly: '1 MONTH',
  yearly: '12 MONTHS'
}

/** One plate in the Pro collection strip, on the stage budget: its scene
 * pauses whenever the strip is offstage. */
function ProStripPlate({ plate }: { plate: PlateDef }) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOnStage(rootRef)

  return (
    <div ref={rootRef} data-offstage="" className="relative">
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
  )
}

/** One pricing card. Yearly is the featured default: amber chrome, its
 * own keyline, the value tag and the plate-art backdrop; monthly gets the
 * quiet chrome + ghost CTA so yearly reads as the choice. */
function TermCard({ term }: { term: BillingTerm }) {
  const meta = PRO_TERMS[term]
  const featured = term === 'yearly'
  // stage budget: pauses the featured card's PlateLayer backdrop while
  // the Pro section is offstage (monthly has no scene — attr is inert)
  const rootRef = useRef<HTMLDivElement>(null)
  useOnStage(rootRef)

  return (
    <div
      ref={rootRef}
      data-offstage=""
      className={`relative flex flex-col overflow-hidden rounded-xl p-5 ${
        featured ? 'shpp-card shpp-card-featured' : 'shpp-card'
      }`}
    >
      {featured && (
        <>
          {/* thin amber keyline — the featured card's own signature */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 z-10 h-px"
            style={{
              background: `linear-gradient(90deg, transparent 4%, rgb(${AMBER} / 0.9) 50%, transparent 96%)`,
              boxShadow: `0 0 10px rgb(${AMBER} / 0.5)`
            }}
          />
          {HERO_BACKDROP_ID && (
            <>
              <PlateLayer plateId={HERO_BACKDROP_ID} fade="left" className="opacity-[0.35]" />
              {/* dark veil over the art so price + perks stay legible */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgb(var(--lb-panel-bg) / 0.92), rgb(var(--lb-panel-bg) / 0.7) 45%, rgb(var(--lb-panel-bg) / 0.4))'
                }}
              />
            </>
          )}
        </>
      )}

      <div className="relative flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] tracking-[0.3em] text-zinc-500">{TERM_LABEL[term]}</span>
          {featured && (
            <span className="shpp-tag rounded px-1.5 py-px text-[7px] tracking-[0.2em]">
              BEST VALUE -40%
            </span>
          )}
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="shpp-price text-[28px] leading-none [font-family:var(--font-pixel)] md:text-[32px]">
            {meta.price}
          </span>
          <span className="text-[10px] tracking-[0.2em] text-zinc-500">{meta.unit}</span>
        </div>
        <p className="mt-2 text-[9px] tracking-[0.2em] text-zinc-500">{meta.context}</p>

        <ul className="mt-4 space-y-2">
          {PERKS.map((perk) => (
            <li key={perk} className="flex items-start gap-2.5 text-xs text-zinc-300">
              <span
                className="mt-px shrink-0 text-[10px] leading-4 [font-family:var(--font-pixel)]"
                style={{ color: `rgb(${AMBER} / 0.9)` }}
              >
                +
              </span>
              <span className="leading-relaxed">
                {perk}
                {perk === BLUE_CHECK_PERK && (
                  <VerifiedBadge size={12} className="ml-1.5 inline-block align-[-2px]" />
                )}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-5">
          <a
            href={`/api/checkout?type=pro_${term}`}
            aria-label={`Go Pro — ${meta.announce}`}
            className={`${
              featured ? 'shpp-go' : 'shpp-go shpp-go-ghost'
            } flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-[13px] leading-none tracking-[0.18em] [font-family:var(--font-pixel)]`}
          >
            {/* clips the hover sheen — the button root itself must stay
                overflow-visible so the ::before glow can paint outside */}
            <span aria-hidden className="shpp-go-clip" />
            GO PRO
            <span aria-hidden className="shpp-go-arrow">
              →
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}

export function ProCards({ loading, isPro }: { loading: boolean; isPro: boolean }) {
  return (
    <div
      className="shpp-root relative overflow-hidden rounded-2xl"
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

      <div className="p-6 md:p-8">
        <span className="block text-[9px] tracking-[0.4em] text-amber-200/70">
          THE SUBSCRIPTION
        </span>
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

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {(['monthly', 'yearly'] as const).map((term) => (
              <div
                key={term}
                className="grid gap-3 rounded-xl border border-[rgb(var(--lb-panel-edge)/0.1)] p-5"
              >
                <span className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
                <span className="h-10 w-2/5 animate-pulse rounded-lg bg-white/[0.05]" />
                <span className="h-20 animate-pulse rounded-lg bg-white/[0.05]" />
                <span className="h-12 animate-pulse rounded-lg bg-white/[0.05]" />
              </div>
            ))}
          </div>
        ) : isPro ? (
          <div
            className="mt-6 rounded-xl p-5"
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
              You already have Cribble Premium — full kit unlocked. Every plate on the rack below
              is 25% off for you, applied automatically at checkout.
            </p>
            <a
              href="/api/portal"
              className="mt-4 inline-flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-amber-200"
            >
              MANAGE SUBSCRIPTION <span aria-hidden>→</span>
            </a>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <TermCard term="monthly" />
              <TermCard term="yearly" />
            </div>
            <p className="mt-4 text-center text-[8px] tracking-[0.25em] text-zinc-600">
              SECURE CHECKOUT BY POLAR · CANCEL ANYTIME
            </p>
          </>
        )}
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
              <ProStripPlate key={plate.id} plate={plate} />
            ))}
          </div>
        </div>
      )}

      <style jsx global>{`
        /* This section is a product showcase: plate art is authored
           against black, and the theme-flipped panel washed it out in
           light mode. Re-pin the surface + type tokens to their dark
           values inside the panel, so the backdrop veils stay black and
           the copy stays light-on-dark in both themes. */
        html.light .shpp-root {
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

        /* term cards — inner card on the obsidian panel. Amber is written
           out (252 211 77) to match the AMBER const, same as the chrome. */
        .shpp-card {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.12);
          background: linear-gradient(180deg, rgb(255 255 255 / 0.02), transparent 45%),
            rgb(0 0 0 / 0.35);
        }
        .shpp-card-featured {
          border-color: rgb(252 211 77 / 0.4);
          box-shadow:
            0 24px 70px -30px rgb(252 211 77 / 0.3),
            0 18px 50px -24px rgb(0 0 0 / 0.6);
        }

        /* value tag on the yearly card */
        .shpp-tag {
          color: rgb(252 211 77 / 0.9);
          border: 1px solid rgb(252 211 77 / 0.35);
          background: rgb(252 211 77 / 0.07);
        }

        /* scoreboard price — amber LED digits */
        .shpp-price {
          color: #fcff00;
          text-shadow:
            0 0 22px rgb(252 255 0 / 0.42),
            0 0 48px rgb(252 255 0 / 0.16);
        }

        /* launch button — one per card now. The rest chrome (outer glow +
           inset top light) is a STATIC box-shadow: it paints once, only
           the hover delta animates — as opacity on the ::before glow.
           isolation scopes that pseudo's z-index: -1 to the button. */
        .shpp-go {
          position: relative;
          isolation: isolate;
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
            transform 120ms ease;
        }
        /* hover glow — pre-painted pseudo layered over the static rest
           glow, opacity-only (was a per-frame box-shadow repaint). The
           sheen already owns ::after, so the glow lives on ::before. */
        .shpp-go::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: 0 0 44px -6px rgb(252 211 77 / 0.35);
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
          z-index: -1;
        }
        /* sheen clip — the bar used to rely on the button's own
           overflow: hidden; the root must stay overflow-visible for the
           glow, so the clip moved to this inner span */
        .shpp-go-clip {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: inherit;
          pointer-events: none;
        }
        .shpp-go-clip::after {
          content: '';
          position: absolute;
          top: -40%;
          bottom: -40%;
          left: 0;
          width: 38%;
          background: linear-gradient(100deg, transparent, rgb(255 245 200 / 0.25), transparent);
          transform: translateX(-160%) skewX(-16deg);
        }
        .shpp-go-arrow {
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpp-go:hover {
            border-color: rgb(252 211 77 / 0.85);
          }
          .shpp-go:hover::before {
            opacity: 1;
          }
          .shpp-go:hover .shpp-go-clip::after {
            animation: shpp-go-sheen 650ms ease forwards;
          }
          .shpp-go:hover .shpp-go-arrow {
            transform: translateX(3px);
          }
        }
        @keyframes shpp-go-sheen {
          to {
            transform: translateX(320%) skewX(-16deg);
          }
        }
        .shpp-go:active {
          transform: translateY(1px);
          box-shadow:
            0 0 18px -10px rgb(252 211 77 / 0.4),
            inset 0 3px 10px rgb(0 0 0 / 0.45);
        }
        .shpp-go:active::before {
          opacity: 0;
        }
        .shpp-go:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }

        /* monthly's quieter outline variant — same geometry, no fill, so
           the yearly card reads as the default choice. Declared after the
           base .shpp-go rules so its overrides win at equal specificity. */
        .shpp-go-ghost {
          color: rgb(252 211 77 / 0.9);
          border-color: rgb(252 211 77 / 0.45);
          background: transparent;
          text-shadow: none;
          box-shadow: none;
        }
        /* ghost's quieter hover glow rides the same ::before opacity flip */
        .shpp-go-ghost::before {
          box-shadow: 0 0 30px -12px rgb(252 211 77 / 0.4);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpp-go-ghost:hover {
            border-color: rgb(252 211 77 / 0.75);
            background: rgb(252 211 77 / 0.07);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shpp-go:hover .shpp-go-clip::after {
            animation: none;
          }
          .shpp-go,
          .shpp-go::before,
          .shpp-go-arrow {
            transition: none;
          }
          .shpp-go:hover .shpp-go-arrow {
            transform: none;
          }
        }
      `}</style>
    </div>
  )
}
