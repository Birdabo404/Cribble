'use client'

// Cribble Pro — kit on the left (perks + exclusive plates), compact
// yearly/monthly tickets on the right. Yearly is the featured default:
// 1px amber border + glare-shine CTA. `isPro` keeps the kit and swaps
// the tickets for an active readout.
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

const PERKS: readonly { title: string; body: string; badge?: boolean }[] = [
  { title: 'GIF banner', body: 'Animated on your profile' },
  { title: 'Blue check', body: 'Next to your name', badge: true },
  { title: 'Three plates', body: 'Exclusive while Pro is live' },
  { title: '25% off', body: 'Every plate at checkout' }
]

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

function TermTicket({ term }: { term: BillingTerm }) {
  const meta = PRO_TERMS[term]
  const featured = term === 'yearly'

  return (
    <div className={`shpp-card ${featured ? 'shpp-card-featured' : ''} rounded-2xl p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] tracking-[0.08em] text-zinc-500">
          {term === 'yearly' ? 'Yearly' : 'Monthly'}
        </span>
        {featured && <span className="text-[11px] text-amber-200/80">−40%</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="shpp-price text-[22px] leading-none [font-family:var(--font-pixel)]">
          {meta.price}
        </span>
        <span className="text-[11px] text-zinc-500">{meta.unit.toLowerCase()}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-zinc-600">
        {term === 'yearly' ? 'About $4.17 / mo' : 'Cancel anytime'}
      </p>
      <a
        href={`/api/checkout?type=pro_${term}`}
        aria-label={`Get Pro — ${meta.announce}`}
        className={`${
          featured ? 'shpp-go' : 'shpp-go shpp-go-ghost'
        } mt-3 flex w-full items-center justify-center rounded-[10px] px-4 py-2.5 text-[13px] font-medium leading-none`}
      >
        {featured && <span aria-hidden className="shpp-go-clip" />}
        Get Pro
      </a>
    </div>
  )
}

function ProKit() {
  return (
    <>
      <h2
        className="font-display text-[13px] font-semibold tracking-[0.12em]"
        style={{ color: `rgb(${AMBER})` }}
      >
        Pro
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
        The full kit. Flex on the board. Cancel anytime.
      </p>
      <ul className="mt-5 grid grid-cols-2 gap-2">
        {PERKS.map((perk) => (
          <li key={perk.title} className="shpp-perk rounded-xl px-3 py-2.5">
            <p className="text-[12px] font-medium text-zinc-200">
              {perk.title}
              {perk.badge && (
                <VerifiedBadge size={11} className="ml-1.5 inline-block align-[-2px]" />
              )}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{perk.body}</p>
          </li>
        ))}
      </ul>
      {PRO_PLATES.length > 0 && (
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {PRO_PLATES.map((plate) => (
            <ProStripPlate key={plate.id} plate={plate} />
          ))}
        </div>
      )}
    </>
  )
}

export function ProCards({ loading, isPro }: { loading: boolean; isPro: boolean }) {
  return (
    <div className="shpp-root relative overflow-hidden rounded-2xl">
      <div className="grid md:grid-cols-[minmax(0,1fr)_17.5rem]">
        <div className="border-b border-[rgb(var(--lb-panel-edge)/0.08)] p-6 md:border-b-0 md:border-r md:p-8">
          {loading ? (
            <div className="space-y-4">
              <span className="block h-3 w-16 animate-pulse rounded bg-zinc-500/10" />
              <span className="block h-4 w-2/3 animate-pulse rounded bg-zinc-500/10" />
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <span key={i} className="h-14 animate-pulse rounded-xl bg-zinc-500/10" />
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <span key={i} className="aspect-[4/1] animate-pulse rounded-xl bg-zinc-500/10" />
                ))}
              </div>
            </div>
          ) : (
            <ProKit />
          )}
        </div>

        <div className="flex flex-col justify-center gap-3 p-6 md:p-6">
          {loading ? (
            <>
              <span className="h-32 animate-pulse rounded-2xl bg-zinc-500/10" />
              <span className="h-32 animate-pulse rounded-2xl bg-zinc-500/10" />
            </>
          ) : isPro ? (
            <div className="shpp-card rounded-2xl p-4">
              <p className="text-[13px] leading-relaxed text-zinc-300">Pro is active.</p>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                25% off plates at checkout. The three plates stay equipped while the sub is live.
              </p>
              <a
                href="/api/portal"
                className="mt-4 inline-flex text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
              >
                Manage
              </a>
            </div>
          ) : (
            <>
              <TermTicket term="yearly" />
              <TermTicket term="monthly" />
            </>
          )}
        </div>
      </div>

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

        .shpp-perk {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.08);
          background: rgb(var(--lb-panel-edge) / 0.03);
        }

        .shpp-price {
          color: rgb(var(--z50));
        }

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
