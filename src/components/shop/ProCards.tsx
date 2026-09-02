'use client'

// Cribble Pro — the arcade panel. Kit on the left (pixel wordmark, gold
// `+` perks, the three exclusive plates), scoreboard tickets on the
// right. Yearly is the featured default: gold chrome, BEST VALUE tag,
// GO PRO button. `isPro` keeps the kit and swaps the tickets for an
// active readout.
//
// The gold treatment is the storefront's one loud moment: a keyline with
// a slow idle sheen, LED price digits that roll in per glyph, and a
// hatched panel surface so the fill reads as material instead of flat.
// Every animation is transform/opacity only and gates off under
// data-perf="low", prefers-reduced-motion and data-motion="reduced".
//
// Self-contained styled-jsx under `shpp-`.

import { useRef } from 'react'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
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

/** Per-glyph LED readout — each character rolls up in turn. */
function ScorePrice({ price, unit }: { price: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span aria-hidden className="shpp-price text-[24px] leading-none [font-family:var(--font-pixel)]">
        {price.split('').map((ch, i) => (
          <span key={i} className="shpp-price-ch" style={{ ['--d' as string]: `${i * 30}ms` }}>
            {ch}
          </span>
        ))}
      </span>
      <span
        aria-hidden
        className="shpp-price-ch text-[10px] tracking-[0.18em] text-zinc-500"
        style={{ ['--d' as string]: `${price.length * 30}ms` }}
      >
        {unit}
      </span>
    </div>
  )
}

function ProStripPlate({ plate }: { plate: PlateDef }) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOnStage(rootRef)

  return (
    <div ref={rootRef} data-offstage="" className="relative">
      <PlatePreview plateId={plate.id} />
      <span className="shpp-plate-tag absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-[8px] leading-none [font-family:var(--font-pixel)]">
        PRO
      </span>
    </div>
  )
}

function TermTicket({ term }: { term: BillingTerm }) {
  const meta = PRO_TERMS[term]
  const featured = term === 'yearly'

  return (
    <div className={`shpp-card ${featured ? 'shpp-card-featured' : ''} relative rounded-2xl p-4`}>
      {featured && <span aria-hidden className="shpp-card-keyline" />}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] tracking-[0.18em] text-zinc-500">
          {featured ? 'YEARLY' : 'MONTHLY'}
        </span>
        {featured && (
          <span className="shpp-tag rounded px-1.5 py-1 text-[7px] leading-none [font-family:var(--font-pixel)]">
            BEST VALUE
          </span>
        )}
      </div>

      <div className="mt-3">
        <ScorePrice price={meta.price} unit={meta.unit} />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-zinc-600">
        {featured ? 'About $4.17 / mo · save $33.89' : 'Cancel anytime'}
      </p>

      <a
        href={`/api/checkout?type=pro_${term}`}
        aria-label={`Go Pro — ${meta.announce}`}
        className={`${
          featured ? 'shpp-go' : 'shpp-go shpp-go-ghost'
        } mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[11px] leading-none tracking-[0.14em] [font-family:var(--font-pixel)]`}
      >
        <span aria-hidden className="shpp-go-clip" />
        GO PRO
        <span aria-hidden className="shpp-go-arrow">
          →
        </span>
      </a>
    </div>
  )
}

function ProKit() {
  return (
    <>
      <h2 className="shpp-wordmark text-[15px] leading-none [font-family:var(--font-pixel)]">
        CRIBBLE PRO
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
        The full kit. Flex on the whole board. Cancel anytime.
      </p>

      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {PERKS.map((perk) => (
          <li key={perk.title} className="shpp-perk flex items-start gap-2.5 rounded-xl px-3 py-2.5">
            <span aria-hidden className="shpp-plus text-[10px] leading-4 [font-family:var(--font-pixel)]">
              +
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-zinc-200">
                {perk.title}
                {perk.badge && (
                  <VerifiedBadge size={11} className="ml-1.5 inline-block align-[-2px]" />
                )}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                {perk.body}
              </span>
            </span>
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

export function ProCards({
  loading,
  isPro,
  complimentary = false
}: {
  loading: boolean
  isPro: boolean
  complimentary?: boolean
}) {
  return (
    <div className="shpp-root relative overflow-hidden rounded-2xl">
      {/* gold keyline — the PRO signature, with a slow idle sheen */}
      <span aria-hidden className="shpp-keyline absolute inset-x-0 top-0 z-10 h-[2px]" />

      <div className="relative grid md:grid-cols-[minmax(0,1fr)_17.5rem]">
        <div className="border-b border-[rgb(var(--lb-panel-edge)/0.08)] p-6 md:border-b-0 md:border-r md:p-8">
          {loading ? (
            <div className="space-y-4">
              <span className="block h-4 w-32 animate-pulse rounded bg-zinc-500/10" />
              <span className="block h-4 w-2/3 animate-pulse rounded bg-zinc-500/10" />
              <div className="grid gap-2 sm:grid-cols-2">
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

        <div className="flex flex-col justify-center gap-3 p-6">
          {loading ? (
            <>
              <span className="h-40 animate-pulse rounded-2xl bg-zinc-500/10" />
              <span className="h-32 animate-pulse rounded-2xl bg-zinc-500/10" />
            </>
          ) : isPro ? (
            <div className="shpp-card shpp-card-featured relative rounded-2xl p-4">
              <span aria-hidden className="shpp-card-keyline" />
              <span className="shpp-tag inline-block rounded px-1.5 py-1 text-[7px] leading-none [font-family:var(--font-pixel)]">
                PRO ACTIVE
              </span>
              <p className="mt-3 text-[12px] leading-relaxed text-zinc-400">
                {complimentary
                  ? 'House complimentary — never billed. The three plates stay equipped.'
                  : '25% off plates at checkout. The three plates stay equipped while the sub is live.'}
              </p>
              {complimentary ? null : (
                <a
                  href="/api/portal"
                  className="mt-4 inline-flex text-[12px] text-zinc-400 transition-colors hover:text-amber-200"
                >
                  Manage
                </a>
              )}
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
        /* Panel surface: hatched so the gold chrome sits on material, not
           a flat fill. Same idiom as --rail-vacant-hatch in globals. */
        .shpp-root {
          border: 1px solid rgb(var(--lb-gold) / 0.22);
          background:
            repeating-linear-gradient(
              45deg,
              rgb(var(--lb-gold) / 0.016) 0 1px,
              transparent 1px 7px
            ),
            linear-gradient(180deg, rgb(var(--lb-gold) / 0.045), transparent 30%),
            rgb(var(--lb-panel-bg));
        }

        .shpp-keyline {
          background: linear-gradient(
            90deg,
            transparent 4%,
            rgb(var(--lb-gold) / 0.9) 50%,
            transparent 96%
          );
          box-shadow: 0 0 12px rgb(var(--lb-gold) / 0.45);
          overflow: hidden;
        }
        /* slow idle traveller — transform-only, one small element */
        .shpp-keyline::after {
          content: '';
          position: absolute;
          inset-block: 0;
          left: 0;
          width: 22%;
          background: linear-gradient(90deg, transparent, rgb(var(--lb-gold-hi)), transparent);
          animation: shpp-keyline-travel 9s cubic-bezier(0.5, 0, 0.5, 1) infinite;
        }
        @keyframes shpp-keyline-travel {
          0% {
            transform: translateX(-120%);
          }
          55%,
          100% {
            transform: translateX(560%);
          }
        }

        .shpp-wordmark {
          color: rgb(var(--lb-gold));
          text-shadow:
            0 0 18px rgb(var(--lb-gold) / 0.4),
            0 0 44px rgb(var(--lb-gold) / 0.16);
        }

        .shpp-perk {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.08);
          background: rgb(var(--lb-panel-edge) / 0.03);
        }
        .shpp-plus {
          color: rgb(var(--lb-gold) / 0.9);
        }

        .shpp-plate-tag {
          color: rgb(var(--lb-gold));
          background: rgb(0 0 0 / 0.6);
        }

        .shpp-card {
          position: relative;
          overflow: hidden;
          border: 1px solid rgb(var(--lb-panel-edge) / 0.12);
          background: rgb(var(--lb-panel-edge) / 0.03);
        }
        .shpp-card-featured {
          border-color: rgb(var(--lb-gold) / 0.42);
          background: linear-gradient(180deg, rgb(var(--lb-gold) / 0.08), transparent 55%),
            rgb(var(--lb-panel-edge) / 0.03);
        }
        .shpp-card-keyline {
          position: absolute;
          inset-inline: 0;
          top: 0;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent 6%,
            rgb(var(--lb-gold) / 0.8) 50%,
            transparent 94%
          );
        }

        .shpp-tag {
          color: rgb(var(--lb-gold) / 0.95);
          border: 1px solid rgb(var(--lb-gold) / 0.35);
          background: rgb(var(--lb-gold) / 0.08);
          letter-spacing: 0.1em;
        }

        /* LED scoreboard digits — gold, not the old acid yellow */
        .shpp-price {
          color: rgb(var(--lb-gold-hi));
          text-shadow:
            0 0 18px rgb(var(--lb-gold) / 0.45),
            0 0 42px rgb(var(--lb-gold) / 0.18);
        }
        .shpp-price-ch {
          display: inline-block;
          animation: shpp-digit-roll 340ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
        @keyframes shpp-digit-roll {
          from {
            opacity: 0;
            transform: translateY(0.5em);
          }
        }

        /* GO PRO — rest chrome is a static box-shadow (paints once); only
           the hover delta animates, as opacity on the ::before glow. */
        .shpp-go {
          position: relative;
          isolation: isolate;
          color: rgb(var(--lb-gold));
          border: 2px solid rgb(var(--lb-gold) / 0.55);
          background: linear-gradient(
              180deg,
              rgb(var(--lb-gold) / 0.16),
              rgb(var(--lb-gold) / 0.05)
            ),
            rgb(var(--lb-panel-bg) / 0.6);
          text-shadow: 0 0 14px rgb(var(--lb-gold) / 0.5);
          box-shadow:
            0 0 30px -10px rgb(var(--lb-gold) / 0.45),
            inset 0 1px 0 rgb(255 255 255 / 0.12);
          transition:
            border-color 220ms ease,
            transform 120ms ease;
        }
        .shpp-go::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: 0 0 44px -6px rgb(var(--lb-gold) / 0.35);
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
          z-index: -1;
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
        .shpp-go-arrow {
          transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpp-go:hover {
            border-color: rgb(var(--lb-gold) / 0.85);
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
        }
        .shpp-go:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }

        /* monthly's quieter twin — same geometry, no fill, so yearly reads
           as the default choice. Declared after the base rules so its
           overrides win at equal specificity. */
        .shpp-go-ghost {
          color: rgb(var(--lb-gold) / 0.85);
          border-width: 1px;
          border-color: rgb(var(--lb-gold) / 0.35);
          background: transparent;
          text-shadow: none;
          box-shadow: none;
        }
        .shpp-go-ghost::before {
          box-shadow: 0 0 30px -12px rgb(var(--lb-gold) / 0.35);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpp-go-ghost:hover {
            border-color: rgb(var(--lb-gold) / 0.6);
            background: rgb(var(--lb-gold) / 0.06);
          }
        }

        /* light mode: neon glows collapse on white — keep the gold as ink */
        html.light .shpp-wordmark,
        html.light .shpp-price {
          text-shadow: none;
        }
        html.light .shpp-go {
          text-shadow: none;
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.3);
        }

        @media (prefers-reduced-motion: reduce) {
          .shpp-keyline::after,
          .shpp-price-ch,
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
        html[data-motion='reduced'] .shpp-keyline::after,
        html[data-motion='reduced'] .shpp-price-ch,
        html[data-motion='reduced'] .shpp-go:hover .shpp-go-clip::after {
          animation: none;
        }
        html[data-motion='reduced'] .shpp-go,
        html[data-motion='reduced'] .shpp-go::before,
        html[data-motion='reduced'] .shpp-go-arrow {
          transition: none;
        }
      `}</style>
    </div>
  )
}
