'use client'

// The gold row — the Vault (founder plate, one run then retired) and the
// Trophy Case (champion plate, never sold) as two half-width gold cards,
// replacing the page's two full-width bands. Chrome is copied from the
// old Vault band; art sits below the copy instead of beside it, pinned to
// the card bottom so both previews baseline-align. The vault card keeps
// the founder anchor id — it is a marquee-fan scroll target.
//
// Self-contained: the one custom class lives in this file's styled-jsx
// block under a fresh `shpg-` prefix — zero reliance on the `shp-`
// classes still defined by shop/page.tsx.

import { useRef, type CSSProperties } from 'react'
import Link from 'next/link'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { CHAMPION_PLATE, FOUNDER_PLATE, plateAnchorId, proPrice, usd } from './catalog'
import { PriceTag } from './chips'
import { useOnStage } from './stage'

/** Shared gold card chrome — same recipe as the old full-width bands. */
const GOLD_CARD_STYLE: CSSProperties = {
  border: '1px solid rgb(var(--lb-gold) / 0.28)',
  background:
    'linear-gradient(90deg, rgb(var(--lb-gold) / 0.07), rgb(var(--lb-gold) / 0.02) 55%, transparent), rgb(var(--lb-panel-bg))',
  boxShadow:
    '0 24px 70px -30px rgb(var(--lb-gold) / 0.25), 0 18px 50px -24px rgb(0 0 0 / 0.6)'
}

/** The 2px gold top keyline — the gold-band signature treatment. */
function GoldKeyline() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 z-10 h-[2px]"
      style={{
        background:
          'linear-gradient(90deg, transparent 4%, rgb(var(--lb-gold) / 0.85) 50%, transparent 96%)',
        boxShadow: '0 0 12px rgb(var(--lb-gold) / 0.45)'
      }}
    />
  )
}

function GoldChip({ children }: { children: string }) {
  return (
    <span
      className="rounded px-2 py-1 text-[9px] leading-none tracking-[0.3em] [font-family:var(--font-pixel)]"
      style={{
        color: 'rgb(var(--lb-gold))',
        border: '1px solid rgb(var(--lb-gold) / 0.45)',
        background: 'rgb(var(--lb-gold) / 0.07)',
        textShadow: '0 0 10px rgb(var(--lb-gold) / 0.5)'
      }}
    >
      {children}
    </span>
  )
}

export function GoldRow({
  loading,
  isPro,
  owned
}: {
  loading: boolean
  isPro: boolean
  owned: ReadonlySet<string>
}) {
  const vaultRef = useRef<HTMLElement>(null)
  const trophyRef = useRef<HTMLElement>(null)
  useOnStage(vaultRef)
  useOnStage(trophyRef)

  if (!FOUNDER_PLATE && !CHAMPION_PLATE) return null

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {/* ---- the vault — founder plate, one run then retired ---- */}
        {FOUNDER_PLATE && (
          <article
            ref={vaultRef}
            id={plateAnchorId(FOUNDER_PLATE.id)}
            data-offstage=""
            className="relative flex scroll-mt-24 flex-col overflow-hidden rounded-2xl p-5 md:p-6"
            style={GOLD_CARD_STYLE}
          >
            <GoldKeyline />
            <div className="flex flex-wrap items-center gap-2">
              <GoldChip>THE VAULT</GoldChip>
              <span className="text-[9px] tracking-[0.3em] text-zinc-500">
                ULTRA RARE · ONE RUN · NEVER SOLD AGAIN
              </span>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
              The <span className="text-[rgb(var(--lb-gold))]">{FOUNDER_PLATE.name}</span> plate
              gets exactly one production run — this one. Take it and fly{' '}
              <span className="text-zinc-200">day-one colors</span> forever; when the run retires,
              it is never minted or sold again.
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
                  className="shpg-founder mt-3.5 inline-flex items-center gap-2.5 self-start rounded-lg px-3.5 py-2"
                >
                  <span className="text-[9px] tracking-[0.3em]">TAKE THE FOUNDER PLATE</span>
                  <PriceTag priceUsd={FOUNDER_PLATE.priceUsd} isPro={isPro} size="md" />
                </a>
              ))}
            {/* no OWNED chip over the art — the copy states it, and the
                guilloché should stay uncovered */}
            <div className="mt-auto pt-4">
              <PlatePreview plateId={FOUNDER_PLATE.id} />
            </div>
          </article>
        )}

        {/* ---- the trophy case — champion plate, never sold ---- */}
        {CHAMPION_PLATE && (
          <article
            ref={trophyRef}
            data-offstage=""
            className="relative flex flex-col overflow-hidden rounded-2xl p-5 md:p-6"
            style={GOLD_CARD_STYLE}
          >
            <GoldKeyline />
            <div className="flex flex-wrap items-center gap-2">
              <GoldChip>THE TROPHY CASE</GoldChip>
              <span className="text-[9px] tracking-[0.3em] text-zinc-500">
                NEVER SOLD · AWARDED AT #1
              </span>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
              <span className="text-[rgb(var(--lb-gold))]">{CHAMPION_PLATE.name}</span> can&apos;t
              be bought at any price. Take the{' '}
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
                className="mt-3 inline-flex items-center gap-1.5 self-start text-[9px] tracking-[0.3em] text-zinc-500 transition-colors hover:text-[rgb(var(--lb-gold))]"
              >
                SEE WHO HOLDS THE THRONE <span aria-hidden>→</span>
              </Link>
            )}
            {/* nothing covers the trophy — the header already says it all */}
            <div className="mt-auto pt-4">
              <PlatePreview plateId={CHAMPION_PLATE.id} />
            </div>
          </article>
        )}
      </div>

      <style jsx global>{`
        /* vault CTA — gold twin of the buy chip. isolation scopes the
           glow pseudo's z-index: -1 to this element. */
        .shpg-founder {
          position: relative;
          isolation: isolate;
          color: rgb(var(--lb-gold));
          border: 1px solid rgb(var(--lb-gold) / 0.4);
          background: rgb(var(--lb-gold) / 0.06);
          transition:
            border-color 220ms ease,
            background-color 220ms ease;
        }
        /* hover glow — pre-painted pseudo, opacity-only transition
           (compositor-only; was a per-frame box-shadow repaint) */
        .shpg-founder::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: 0 0 24px -8px rgb(var(--lb-gold) / 0.5);
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
          z-index: -1;
        }
        .shpg-founder:hover,
        .shpg-founder:focus-visible {
          border-color: rgb(var(--lb-gold) / 0.7);
          background: rgb(var(--lb-gold) / 0.11);
        }
        .shpg-founder:hover::after,
        .shpg-founder:focus-visible::after {
          opacity: 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .shpg-founder,
          .shpg-founder::after {
            transition: none;
          }
        }
      `}</style>
    </>
  )
}
