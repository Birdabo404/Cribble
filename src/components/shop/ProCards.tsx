'use client'

// 02 PRO — the gold compartment. Kit on the left (pixel wordmark, one line
// of copy, the four perks as a dotted-leader <dl>, the three exclusive
// plates in a hairline strip), the two term cells on the right in a 1px
// column: YEARLY is the filled gold action with the BEST VALUE tag,
// MONTHLY the outlined twin. `isPro` keeps the kit and swaps the terms for
// a PRO ACTIVE readout.
//
// Gold is the subscription hue and this is the storefront's one loud
// moment: the keyline along the top carries a slow idle sheen
// (.shop-pro-keyline) and the wordmark glows in dark. Everything else is
// hairlines, hatch and type. The price glyphs are wrapped per character
// (.shop-glyph) so the page can roll them with GSAP; the CSS roll below is
// the fallback. Every animation is transform/opacity and gates off under
// prefers-reduced-motion and data-motion="reduced" (data-perf="low" is the
// page's call). Self-contained styled-jsx under `shpp-`.

import { useRef } from 'react'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import type { PlateDef } from '@/lib/cosmetics/plates'
import { PRO_TERMS, type BillingTerm } from '@/lib/planTerms'
import { PRO_PLATES } from './catalog'
import { PriceChip } from './chips'
import {
  COPY,
  FOCUS,
  FOCUS_ON_SIGNAL,
  GOLD_FILL,
  GOLD_TEXT,
  INK,
  LABEL,
  LINE,
  MICRO,
  MUTE,
  PAPER_BG,
  PIXEL,
  TAP
} from './shopChrome'
import { useOnStage } from './stage'

const PERKS: readonly { term: string; value: string; badge?: boolean }[] = [
  { term: 'GIF banner', value: 'Animated on your profile' },
  { term: 'Blue check', value: 'Next to your name', badge: true },
  { term: 'Three plates', value: 'Exclusive while Pro is live' },
  { term: '25% off', value: 'Every plate at checkout' }
]

const SKELETON = 'animate-pulse bg-[color:var(--shop-line-soft)]'

/** Per-glyph pixel readout. Each character is its own `.shop-glyph` span
 * so GSAP can stagger them; the `shpp-glyph` CSS roll is the fallback. */
function ScorePrice({ price, unit }: { price: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={`shpp-price ${PIXEL} ${GOLD_TEXT} text-[24px] leading-none md:text-[length:calc(24px/0.9)]`}
      >
        {price.split('').map((ch, i) => (
          <span
            key={i}
            className="shop-glyph shpp-glyph"
            style={{ ['--d' as string]: `${i * 30}ms` }}
          >
            {ch}
          </span>
        ))}
      </span>
      <span
        aria-hidden
        className={`shpp-glyph ${MICRO} ${MUTE}`}
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
    <div ref={rootRef} data-offstage="" className={`group relative ${PAPER_BG}`}>
      <PlatePreview plateId={plate.id} />
      {/* on-art tag: literal dark slab over the fixed dark plate */}
      <span
        className={`shpp-plate-tag absolute right-2 top-2 z-10 px-1.5 py-1 text-[8px] leading-none ${PIXEL} ${GOLD_TEXT}`}
      >
        PRO
      </span>
    </div>
  )
}

function TermCell({ term }: { term: BillingTerm }) {
  const meta = PRO_TERMS[term]
  const featured = term === 'yearly'

  return (
    <div className={`shpp-card${featured ? ' shpp-card-featured' : ''} relative p-4 ${PAPER_BG}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${MICRO} ${MUTE}`}>{featured ? 'YEARLY' : 'MONTHLY'}</span>
        {featured && (
          <span
            className={`shpp-tag border px-1.5 py-1 text-[7px] leading-none tracking-[0.1em] ${PIXEL} ${GOLD_TEXT}`}
          >
            BEST VALUE
          </span>
        )}
      </div>

      <div className="mt-3">
        <ScorePrice price={meta.price} unit={meta.unit} />
      </div>
      <p className={`mt-2 ${MICRO} ${MUTE}`}>{meta.context}</p>

      <a
        href={`/api/checkout?type=pro_${term}`}
        aria-label={`Go Pro — ${meta.announce}`}
        className={`shpp-go ${
          featured
            ? `shpp-go-fill ${GOLD_FILL} ${FOCUS_ON_SIGNAL}`
            : `shpp-go-ghost border ${GOLD_TEXT} ${FOCUS}`
        } mt-4 flex w-full items-center justify-center gap-2 px-4 text-[11px] leading-none tracking-[0.14em] ${TAP} ${PIXEL}`}
      >
        GO PRO
        <span aria-hidden>→</span>
      </a>
    </div>
  )
}

function ProKit() {
  return (
    <>
      {/* h3: the section's own `02 PRO` heading is the h2 */}
      <h3 className={`shpp-wordmark text-[15px] leading-none ${PIXEL} ${GOLD_TEXT}`}>CRIBBLE PRO</h3>
      <p className={`mt-3 ${COPY} ${MUTE}`}>
        The full kit. Flex on the whole board. Cancel anytime.
      </p>

      {/* perks: term · dotted leader · value */}
      <dl className="mt-5 grid gap-y-2.5">
        {PERKS.map((perk) => (
          <div key={perk.term} className="shop-leaders">
            <dt className={`${MICRO} ${MUTE} inline-flex items-center gap-1.5`}>
              {perk.term}
              {perk.badge && <VerifiedBadge size={11} />}
            </dt>
            <span className="shop-leader" aria-hidden />
            <dd className={`m-0 min-w-0 text-right ${LABEL} ${INK}`}>{perk.value}</dd>
          </div>
        ))}
      </dl>

      {PRO_PLATES.length > 0 && (
        <div className={`mt-5 grid gap-px border bg-[color:var(--shop-line)] sm:grid-cols-3 ${LINE}`}>
          {PRO_PLATES.map((plate) => (
            <ProStripPlate key={plate.id} plate={plate} />
          ))}
        </div>
      )}
    </>
  )
}

function KitSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <span className={`block h-4 w-32 ${SKELETON}`} />
      <span className={`block h-3 w-2/3 ${SKELETON}`} />
      <div className="grid gap-2.5">
        {Array.from({ length: PERKS.length }, (_, i) => (
          <span key={i} className={`h-3 ${SKELETON}`} />
        ))}
      </div>
      <div className="grid gap-px sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className={`aspect-[4/1] ${SKELETON}`} />
        ))}
      </div>
    </div>
  )
}

function ProActive({ complimentary }: { complimentary: boolean }) {
  return (
    <div className={`shpp-card shpp-card-featured relative border p-4 ${LINE} ${PAPER_BG}`}>
      <span
        className={`shpp-tag inline-block border px-1.5 py-1 text-[7px] leading-none tracking-[0.1em] ${PIXEL} ${GOLD_TEXT}`}
      >
        PRO ACTIVE
      </span>
      <p className={`mt-3 ${COPY} ${MUTE}`}>
        {complimentary
          ? 'House complimentary — never billed. The three plates stay equipped.'
          : '25% off plates at checkout. The three plates stay equipped while the sub is live.'}
      </p>
      {complimentary ? null : (
        <div className="mt-4">
          <PriceChip href="/api/portal" ariaLabel="Manage your Pro subscription">
            MANAGE
          </PriceChip>
        </div>
      )}
    </div>
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
    <div className="shpp-root relative overflow-hidden">
      {/* gold keyline — the PRO signature, with a slow idle sheen */}
      <span aria-hidden className="shop-pro-keyline absolute inset-x-0 top-0 z-10 h-[2px]" />

      <div className="relative grid md:grid-cols-[minmax(0,1fr)_17.5rem]">
        <div className={`border-b p-[var(--shop-pad)] md:border-b-0 md:border-r ${LINE}`}>
          {loading ? <KitSkeleton /> : <ProKit />}
        </div>

        <div className="flex flex-col justify-center p-[var(--shop-pad)]">
          {loading ? (
            <div className="grid gap-px" aria-hidden>
              <span className={`h-40 ${SKELETON}`} />
              <span className={`h-32 ${SKELETON}`} />
            </div>
          ) : isPro ? (
            <ProActive complimentary={complimentary} />
          ) : (
            <div className={`grid gap-px border bg-[color:var(--shop-line)] ${LINE}`}>
              <TermCell term="yearly" />
              <TermCell term="monthly" />
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        /* Compartment surface: gold hairline, hatched so the chrome sits on
           material, not a flat fill. Same idiom as --rail-vacant-hatch. */
        .shpp-root {
          border: 1px solid rgb(var(--lb-gold) / 0.22);
          background:
            repeating-linear-gradient(
              45deg,
              rgb(var(--lb-gold) / 0.016) 0 1px,
              transparent 1px 7px
            ),
            linear-gradient(180deg, rgb(var(--lb-gold) / 0.045), transparent 30%),
            var(--shop-paper);
        }

        /* the one loud moment: a gold keyline with a slow travelling sheen */
        .shop-pro-keyline {
          background: linear-gradient(
            90deg,
            transparent 4%,
            rgb(var(--lb-gold) / 0.9) 50%,
            transparent 96%
          );
          box-shadow: 0 0 12px rgb(var(--lb-gold) / 0.45);
          overflow: hidden;
        }
        .shop-pro-keyline::after {
          content: '';
          position: absolute;
          inset-block: 0;
          left: 0;
          width: 22%;
          background: linear-gradient(90deg, transparent, var(--shop-gold-hi), transparent);
          animation: shop-pro-keyline-travel 9s cubic-bezier(0.5, 0, 0.5, 1) infinite;
        }
        @keyframes shop-pro-keyline-travel {
          0% {
            transform: translateX(-120%);
          }
          55%,
          100% {
            transform: translateX(560%);
          }
        }

        /* wordmark glow — dark only; on paper the gold stays ink */
        .shpp-wordmark {
          text-shadow:
            0 0 18px rgb(var(--lb-gold) / 0.4),
            0 0 44px rgb(var(--lb-gold) / 0.16);
        }
        html.light .shpp-wordmark {
          text-shadow: none;
        }

        .shpp-plate-tag {
          background: rgb(0 0 0 / 0.6);
        }

        .shpp-tag {
          border-color: rgb(var(--lb-gold) / 0.35);
          background: rgb(var(--lb-gold) / 0.08);
        }

        /* the featured term cell wears a thin gold rule along its top */
        .shpp-card-featured::before {
          content: '';
          position: absolute;
          inset-inline: 0;
          top: 0;
          height: 1px;
          pointer-events: none;
          background: linear-gradient(
            90deg,
            transparent 6%,
            rgb(var(--lb-gold) / 0.8) 50%,
            transparent 94%
          );
        }

        /* price glyph roll — CSS fallback for the GSAP stagger */
        .shpp-glyph {
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

        /* GO PRO — yearly is the gold fill, monthly the outlined twin.
           Hover brightens the fill / fills the outline; press is a scale. */
        .shpp-go {
          transition:
            background-color 160ms ease,
            border-color 160ms ease,
            color 160ms ease,
            transform 120ms ease;
        }
        .shpp-go:active {
          transform: scale(0.98);
        }
        .shpp-go-ghost {
          border-color: rgb(var(--lb-gold) / 0.45);
        }
        .shpp-go-ghost:focus-visible {
          border-color: var(--shop-gold);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpp-go-fill:hover {
            background: var(--shop-gold-hi);
          }
          .shpp-go-ghost:hover {
            background: var(--shop-gold);
            border-color: var(--shop-gold);
            color: var(--shop-on-gold);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shop-pro-keyline::after,
          .shpp-glyph {
            animation: none;
          }
          .shpp-go {
            transition: none;
          }
          .shpp-go:active {
            transform: none;
          }
        }
        html[data-motion='reduced'] .shop-pro-keyline::after,
        html[data-motion='reduced'] .shpp-glyph {
          animation: none;
        }
        html[data-motion='reduced'] .shpp-go {
          transition: none;
        }
        html[data-motion='reduced'] .shpp-go:active {
          transform: none;
        }
      `}</style>
    </div>
  )
}
