'use client'

// Cribble Pro — one perk list, then monthly / yearly term cards.
// Yearly is the featured default: 1px amber border + glare-shine CTA.
// `isPro` collapses the terms into a one-line active state + portal link.
//
// Self-contained styled-jsx under `shpp-`. Plate previews are already
// dark art wells; the panel chrome follows the theme.

import { useRef } from 'react'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { AMBER } from '@/components/premium/premium'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import type { PlateDef } from '@/lib/cosmetics/plates'
import { PRO_TERMS, type BillingTerm } from '@/lib/planTerms'
import { PRO_PLATES } from './catalog'
import { useOnStage } from './stage'

const BLUE_CHECK_PERK = 'Pixel blue check next to your name'

const PERKS: readonly string[] = [
  'Animated GIF banner on your profile',
  BLUE_CHECK_PERK,
  'Three exclusive plates',
  '25% off every plate'
]

const TERM_LABEL: Record<BillingTerm, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly'
}

function ProStripPlate({ plate }: { plate: PlateDef }) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOnStage(rootRef)

  return (
    <div ref={rootRef} data-offstage="" className="relative">
      <PlatePreview plateId={plate.id} />
      <span
        className="absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-amber-200"
        style={{ background: 'rgb(0 0 0 / 0.55)' }}
      >
        PRO
      </span>
    </div>
  )
}

function TermCard({ term }: { term: BillingTerm }) {
  const meta = PRO_TERMS[term]
  const featured = term === 'yearly'

  return (
    <div
      className={`relative flex flex-col rounded-2xl p-5 ${
        featured ? 'shpp-card shpp-card-featured' : 'shpp-card'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] tracking-[0.08em] text-zinc-500">{TERM_LABEL[term]}</span>
        {featured && <span className="text-[11px] text-amber-200/80">−40%</span>}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="shpp-price text-[22px] leading-none [font-family:var(--font-pixel)] md:text-[26px]">
          {meta.price}
        </span>
        <span className="text-[11px] text-zinc-500">{meta.unit.toLowerCase()}</span>
      </div>

      <div className="mt-auto pt-5">
        <a
          href={`/api/checkout?type=pro_${term}`}
          aria-label={`Get Pro — ${meta.announce}`}
          className={`${
            featured ? 'shpp-go' : 'shpp-go shpp-go-ghost'
          } flex w-full items-center justify-center rounded-[10px] px-4 py-3 text-[13px] font-medium leading-none`}
        >
          {featured && <span aria-hidden className="shpp-go-clip" />}
          Get Pro
        </a>
      </div>
    </div>
  )
}

export function ProCards({ loading, isPro }: { loading: boolean; isPro: boolean }) {
  return (
    <div className="shpp-root relative overflow-hidden rounded-2xl">
      <div className="p-6 md:p-8">
        <h2
          className="font-display text-[13px] font-semibold tracking-[0.12em]"
          style={{ color: `rgb(${AMBER})` }}
        >
          Pro
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
          GIF banner, blue check, three plates, 25% off.
        </p>

        {loading ? (
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className="block h-4 w-3/4 animate-pulse rounded bg-zinc-500/10" />
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {(['monthly', 'yearly'] as const).map((term) => (
                <div key={term} className="grid gap-3 rounded-2xl border border-[rgb(var(--lb-panel-edge)/0.1)] p-5">
                  <span className="h-3 w-20 animate-pulse rounded bg-zinc-500/10" />
                  <span className="h-8 w-2/5 animate-pulse rounded-lg bg-zinc-500/10" />
                  <span className="h-11 animate-pulse rounded-[10px] bg-zinc-500/10" />
                </div>
              ))}
            </div>
          </div>
        ) : isPro ? (
          <div className="mt-6">
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Pro is active. 25% off plates at checkout.
            </p>
            <a
              href="/api/portal"
              className="mt-3 inline-flex text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Manage
            </a>
          </div>
        ) : (
          <>
            <ul className="mt-5 space-y-2">
              {PERKS.map((perk) => (
                <li key={perk} className="flex items-start gap-2.5 text-[13px] text-zinc-400">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600"
                  />
                  <span className="leading-relaxed">
                    {perk}
                    {perk === BLUE_CHECK_PERK && (
                      <VerifiedBadge size={12} className="ml-1.5 inline-block align-[-2px]" />
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <TermCard term="monthly" />
              <TermCard term="yearly" />
            </div>
          </>
        )}
      </div>

      {PRO_PLATES.length > 0 && (
        <div className="px-6 pb-6 md:px-8">
          <div className="grid gap-3 sm:grid-cols-3">
            {PRO_PLATES.map((plate) => (
              <ProStripPlate key={plate.id} plate={plate} />
            ))}
          </div>
        </div>
      )}

      <style jsx global>{`
        .shpp-root {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          background: rgb(var(--lb-panel-bg));
        }

        .shpp-card {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.1);
          background: rgb(var(--lb-panel-bg));
        }
        .shpp-card-featured {
          border-color: rgb(252 211 77 / 0.4);
        }

        .shpp-price {
          color: rgb(var(--z50));
        }

        /* Get Pro — yearly carries an Amicro-style glare shine on hover.
           Clip lives on an inner span so the button root can stay simple. */
        .shpp-go {
          position: relative;
          isolation: isolate;
          color: rgb(252 211 77);
          border: 1px solid rgb(252 211 77 / 0.4);
          background: rgb(252 211 77 / 0.06);
          transition:
            border-color 220ms ease,
            background-color 220ms ease,
            transform 120ms ease;
        }
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
          background: linear-gradient(100deg, transparent, rgb(255 245 200 / 0.28), transparent);
          transform: translateX(-160%) skewX(-16deg);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpp-go:hover {
            border-color: rgb(252 211 77 / 0.7);
            background: rgb(252 211 77 / 0.1);
          }
          .shpp-go:hover .shpp-go-clip::after {
            animation: shpp-go-glare 700ms ease forwards;
          }
        }
        @keyframes shpp-go-glare {
          to {
            transform: translateX(320%) skewX(-16deg);
          }
        }
        .shpp-go:active {
          transform: translateY(1px);
        }
        .shpp-go:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }

        .shpp-go-ghost {
          color: rgb(var(--z200));
          border-color: rgb(var(--lb-panel-edge) / 0.18);
          background: transparent;
        }
        @media (hover: hover) and (pointer: fine) {
          .shpp-go-ghost:hover {
            border-color: rgb(var(--lb-panel-edge) / 0.32);
            background: rgb(var(--lb-panel-edge) / 0.04);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shpp-go:hover .shpp-go-clip::after {
            animation: none;
          }
          .shpp-go {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpp-go:hover .shpp-go-clip::after {
          animation: none;
        }
        html[data-motion='reduced'] .shpp-go {
          transition: none;
        }
      `}</style>
    </div>
  )
}
