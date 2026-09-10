'use client'

// Shop — Cribble's storefront. The page is the composition layer only:
// masthead, season ticker, the sticky catalog index, the five indexed
// sections (01 FEATURED stage · 02 PRO · 03 MYTHIC · 04 PLATES · 05
// VAULT), the footer stamp, the Spec drawer and the query-flag notice.
// State lives in useShopCosmetics (cosmetics, Polar sync, notices, the
// Premium welcome); the section components own their own chrome; this
// file owns section order, the `?plate=` deep link, the stage-hold and
// perf tiers, and the GSAP entrance + scroll reveals.
//
// Checkout and the customer portal are plain browser navigations to
// /api/checkout and /api/portal — those routes resolve Polar products
// server-side and redirect to the hosted pages. Both bounce back here
// with query flags which useShopCosmetics captures into a dismissable
// notice strip and scrubs from the URL (keeping `?plate=`).
//
// URL contract for the inspect step: opening the Spec drawer writes
// `/shop?plate=<id>` (replace, no scroll) and closing writes `/shop`;
// landing on `?plate=<id>` opens the drawer for a known catalog id. While
// the drawer is open the root carries `data-stage-hold`, which pauses
// every page scene (globals.css) — one live scene at a time.
//
// The catalog is static (src/lib/cosmetics/plates.ts, sliced into
// storefront views by components/shop/catalog.ts) so the storefront
// paints immediately; only ownership state (/api/user/cosmetics) hydrates
// async. A signed-out or failed fetch degrades to a browsable neutral
// storefront — the checkout route enforces auth itself.

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { PremiumWelcomeModal } from '@/components/premium/PremiumWelcomeModal'
import { CatalogIndex, SECTION_SCROLL_MT } from '@/components/shop/CatalogIndex'
import { FeaturedStage } from '@/components/shop/FeaturedStage'
import { GoldRow } from '@/components/shop/GoldRow'
import { Masthead, type MastheadTier } from '@/components/shop/Masthead'
import { PlateCard } from '@/components/shop/PlateCard'
import { ProCards } from '@/components/shop/ProCards'
import { ReserveCard } from '@/components/shop/ReserveCard'
import { ShopNoticeBanner } from '@/components/shop/ShopNotice'
import { SpecDrawer } from '@/components/shop/SpecDrawer'
import { Ticker } from '@/components/shop/Ticker'
import {
  CHAMPION_PLATE,
  FEATURED_PLATES,
  FOUNDER_PLATE,
  JP as GLOSSARY,
  PRO_PLATES,
  RESERVE_PLATES,
  SHOP_PLATES,
  SHOP_SECTIONS,
  type ShopSection,
  type ShopSectionId
} from '@/components/shop/catalog'
import { INK, JP, JP_KICKER, LABEL, LINE, MICRO, MUTE, PAPER_BG } from '@/components/shop/shopChrome'
import {
  STAGGER,
  ScrollTrigger,
  drawRule,
  gsap,
  motionReduced,
  revealIn,
  scrollReveal,
  useGSAP
} from '@/components/shop/shopMotion'
import { useShopCosmetics, type CosmeticsData } from '@/components/shop/useShopCosmetics'
import { getPlate } from '@/lib/cosmetics/plates'

// "SHOP" in ANSI Shadow, same family as Bag / Dashboard / Achievements —
// survives only as the mute footer stamp.
const ASCII_SHOP = String.raw`███████╗██╗  ██╗ ██████╗ ██████╗ 
██╔════╝██║  ██║██╔═══██╗██╔══██╗
███████╗███████║██║   ██║██████╔╝
╚════██║██╔══██║██║   ██║██╔═══╝ 
███████║██║  ██║╚██████╔╝██║     
╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     `

/** Every plate the storefront sells, for the masthead's catalog count. */
const PLATE_COUNT = SHOP_PLATES.length + RESERVE_PLATES.length + (FOUNDER_PLATE ? 1 : 0)

/** 04 PLATES is a gap-px grid over the line colour, so a trailing empty
 * cell would paint as a solid line-coloured block. Fillers complete the
 * last row per breakpoint (paper, aria-hidden); both are 0 today. */
const PLATES_FILL_LG = (3 - (SHOP_PLATES.length % 3)) % 3
const PLATES_FILL_SM = (2 - (SHOP_PLATES.length % 2)) % 2

/* ================= entrance guard ================= */

// The storefront is server-rendered, so its content paints before React
// hydrates — and a GSAP entrance that starts at hydration would blink that
// content off and fade it back in. The `.shop-floor` block in globals.css
// (styled-jsx is client-only here, so it has to be the stylesheet) holds
// every entrance target at opacity 0 from first paint until the root
// carries `data-motion-ready` (set by the entrance effect), via a CSS
// animation that doubles as a fail-safe fade at FAILSAFE_DELAY_MS in case
// hydration is slow or never comes. If that fail-safe has already begun
// when the effect runs, the content has been seen: the effect skips the
// entrance for whatever is on screen and only arms the scroll reveals
// below the fold. Name and delay mirror the stylesheet.
const FAILSAFE_NAME = 'shop-entrance-failsafe'
const FAILSAFE_DELAY_MS = 800

/** True when the fail-safe fade on `el` has passed its delay — the SSR
 * paint has been (or is being) revealed. A fresh client mount (soft
 * navigation) has a just-started animation, so this reads false there. */
function failsafeStarted(el: Element | null): boolean {
  if (!el || typeof el.getAnimations !== 'function') return false
  return el.getAnimations().some((animation) => {
    // Duck-typed: CSSAnimation is not a global in every engine.
    if (!('animationName' in animation)) return false
    const css = animation as CSSAnimation
    return (
      css.animationName === FAILSAFE_NAME &&
      typeof css.currentTime === 'number' &&
      css.currentTime >= FAILSAFE_DELAY_MS
    )
  })
}

/** Any part of `el` inside the viewport right now. */
function inViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.bottom > 0 && rect.top < window.innerHeight
}

/* ================= sections ================= */

function tierOf(cosmetics: CosmeticsData): MastheadTier {
  if (cosmetics.tier.toUpperCase() === 'TEAM') return 'TEAM'
  if (cosmetics.isPro) return 'PRO'
  return 'FREE'
}

/** `REV YYYY.MM` for the footer line. */
function revStamp(date: Date): string {
  return `REV ${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

function sectionVisible(id: ShopSectionId): boolean {
  switch (id) {
    case 'featured':
      return FEATURED_PLATES.length > 0
    case 'pro':
      return true
    case 'mythic':
      return RESERVE_PLATES.length > 0
    case 'plates':
      return SHOP_PLATES.length > 0
    case 'vault':
      return FOUNDER_PLATE !== null || CHAMPION_PLATE !== null
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}

/** The count printed at the end of every section head. */
function sectionCount(id: ShopSectionId): string {
  switch (id) {
    case 'featured':
      return `${FEATURED_PLATES.length} PLATES`
    case 'pro':
      return `${PRO_PLATES.length} PLATES · 2 TERMS`
    case 'mythic':
      return `${RESERVE_PLATES.length} PLATES`
    case 'plates':
      return `${SHOP_PLATES.length} PLATES`
    case 'vault':
      return `${(FOUNDER_PLATE ? 1 : 0) + (CHAMPION_PLATE ? 1 : 0)} PLATES`
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}

/** `NN NAME 漢字 ………… count` over a full-width hairline. The head is one
 * reveal target; the rule (`shp-section-rule`) draws on its own trigger. */
function SectionHead({ section }: { section: ShopSection }) {
  return (
    <>
      <div className="shop-reveal flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3">
        <span className={`${MICRO} ${MUTE}`}>{section.index}</span>
        <h2 className={`m-0 ${LABEL} ${INK}`}>{section.label}</h2>
        <span lang="ja" className={`${JP_KICKER} ${MUTE}`}>
          {section.jp}
        </span>
        <span className={`ml-auto ${MICRO} ${MUTE}`}>{sectionCount(section.id)}</span>
      </div>
      <div aria-hidden className={`shp-section-rule border-t ${LINE}`} />
    </>
  )
}

interface SectionBodyProps {
  loading: boolean
  isPro: boolean
  complimentary: boolean
  owned: ReadonlySet<string>
  onInspect: (plateId: string) => void
}

/** Every body cell that should reveal on scroll carries `shop-reveal`.
 * The 04 grid keeps its paper on a static cell wrapper so the hairlines
 * (the gap) stay put while the card inside fades in. */
function SectionBody({
  id,
  loading,
  isPro,
  complimentary,
  owned,
  onInspect
}: SectionBodyProps & { id: ShopSectionId }): ReactNode {
  switch (id) {
    case 'featured':
      return (
        <div className="shop-reveal">
          <FeaturedStage loading={loading} isPro={isPro} owned={owned} onInspect={onInspect} />
        </div>
      )
    case 'pro':
      return (
        <div className="shop-reveal">
          <ProCards loading={loading} isPro={isPro} complimentary={complimentary} />
        </div>
      )
    case 'mythic':
      return (
        <div className="shp-mythic-grid">
          {RESERVE_PLATES.map((plate) => (
            <div key={plate.id} className="shop-reveal">
              <ReserveCard
                plate={plate}
                featured={plate.id === 'prime-anomaly'}
                loading={loading}
                isPro={isPro}
                owned={owned.has(plate.id)}
                onInspect={onInspect}
              />
            </div>
          ))}
        </div>
      )
    case 'plates':
      return (
        <div
          className={`grid gap-px border ${LINE} bg-[color:var(--shop-line)] sm:grid-cols-2 lg:grid-cols-3`}
        >
          {SHOP_PLATES.map((plate) => (
            <div key={plate.id} className={PAPER_BG}>
              <div className="shop-reveal h-full">
                <PlateCard
                  plate={plate}
                  loading={loading}
                  isPro={isPro}
                  owned={owned.has(plate.id)}
                  onInspect={onInspect}
                />
              </div>
            </div>
          ))}
          {Array.from({ length: PLATES_FILL_LG }, (_, i) => (
            <div key={`fill-lg-${i}`} aria-hidden className={`hidden lg:block ${PAPER_BG}`} />
          ))}
          {Array.from({ length: PLATES_FILL_SM }, (_, i) => (
            <div key={`fill-sm-${i}`} aria-hidden className={`hidden sm:block lg:hidden ${PAPER_BG}`} />
          ))}
        </div>
      )
    case 'vault':
      return (
        <div className="shop-reveal">
          <GoldRow loading={loading} isPro={isPro} owned={owned} onInspect={onInspect} />
        </div>
      )
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}

/* ================= the floor ================= */

function ShopFloor() {
  const searchParams = useSearchParams()
  const shop = useShopCosmetics()

  const rootRef = useRef<HTMLDivElement>(null)

  // Low-end tier: a one-shot client heuristic (≤4GB reported device memory
  // or ≤4 cores) flips `data-perf="low"` on the shop root — the CSS tier
  // in the style block below then parks every ambient scene except the
  // stage well. Hover-wake stays. setAttribute (not state): purely
  // presentational, no re-render.
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const low = (nav.deviceMemory ?? 8) <= 4 || navigator.hardwareConcurrency <= 4
    if (low) rootRef.current?.setAttribute('data-perf', 'low')
  }, [])

  /* ---- the inspect step: ?plate=<id> ⇄ SpecDrawer ---- */
  const [plateId, setPlateId] = useState<string | null>(null)
  const plateParam = searchParams.get('plate')

  // A deep link (or a share) to a known plate opens the drawer; unknown
  // ids are ignored so a stale link degrades to the plain storefront.
  useEffect(() => {
    if (plateParam !== null && getPlate(plateParam) !== null) setPlateId(plateParam)
  }, [plateParam])

  // Native replaceState (Next integrates it with useSearchParams) instead
  // of router.replace: the URL flips synchronously with the drawer and
  // no RSC round-trip fires for a purely client-side inspect step.
  const openInspect = useCallback((id: string) => {
    setPlateId(id)
    window.history.replaceState(null, '', `/shop?plate=${encodeURIComponent(id)}`)
  }, [])

  const closeInspect = useCallback(() => {
    setPlateId(null)
    window.history.replaceState(null, '', '/shop')
  }, [])

  /* ---- motion: one entrance timeline, then a scroll reveal per section ---- */
  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return

      // Read the fail-safe before the attribute flips it off (see the
      // entrance guard above); the from-states GSAP writes next land in
      // the same task, so the CSS hold hands over without a paint between.
      const late = failsafeStarted(root.querySelector('.shpm-lockup'))
      root.setAttribute('data-motion-ready', '')

      if (!late) {
        const tl = gsap.timeline()
        tl.add(
          revealIn(
            '.shpm-masthead .shpm-lockup, .shpm-masthead .shpm-telemetry, .shpm-masthead .shpm-telemetry-line',
            { stagger: STAGGER.header }
          ),
          0
        )
        tl.add(drawRule('.shpm-rule'), 0.12)
        tl.add(drawRule('.shpt-rule'), 0.2)
        tl.add(revealIn('.shpi-item', { stagger: 0.03, y: 6 }), 0.24)
      }

      const reduced = motionReduced()
      for (const section of gsap.utils.toArray<HTMLElement>('[data-shop-section]', root)) {
        // Already on screen since first paint: leave it be.
        if (late && inViewport(section)) continue
        const targets = section.querySelectorAll('.shop-reveal')
        if (targets.length > 0) scrollReveal(section, targets, { stagger: STAGGER.cards, y: 10 })
        const rule = section.querySelector('.shp-section-rule')
        if (!rule) continue
        if (reduced) {
          drawRule(rule)
          continue
        }
        ScrollTrigger.create({
          trigger: section,
          start: 'top 85%',
          once: true,
          animation: drawRule(rule).pause(0)
        })
      }
    },
    { scope: rootRef }
  )

  const { loading, isPro, complimentary, isTeam, owned } = shop
  const tier: MastheadTier | null = shop.cosmetics ? tierOf(shop.cosmetics) : null

  return (
    // overflow-x is clipped (not hidden — clip never creates a scroll
    // container, so the sticky index and ScrollTrigger keep the viewport
    // as their frame) so nothing inside can widen the page on phones.
    <div
      ref={rootRef}
      className="shop-floor page-zoom-out relative mx-auto max-w-6xl px-4 pt-6 sm:px-6 pb-[max(4rem,env(safe-area-inset-bottom))]"
      data-stage-hold={plateId !== null ? '' : undefined}
      style={{ overflowX: 'clip' }}
    >
      {shop.welcome && (
        <PremiumWelcomeModal premiumSince={shop.welcome.premiumSince} onClose={shop.closeWelcome} />
      )}

      {/* header block: raster (dark) / grain (light) over the masthead and
          the ticker only — never over plate art */}
      <div className="shop-scanlines shop-grain relative mt-3">
        <Masthead tier={tier} plateCount={PLATE_COUNT} />
        <Ticker />
      </div>

      <CatalogIndex doors={{ isTeam, complimentary }} />

      <main className="mt-8 space-y-12 md:space-y-14">
        {shop.notice && (
          <ShopNoticeBanner
            notice={shop.notice}
            refreshing={shop.refreshing}
            onRefresh={shop.handleRefresh}
            onDismiss={shop.dismissNotice}
          />
        )}

        {SHOP_SECTIONS.filter((section) => sectionVisible(section.id)).map((section) => (
          <section
            key={section.id}
            id={section.anchor}
            data-shop-section={section.id}
            aria-label={`${section.index} ${section.label}`}
            className={SECTION_SCROLL_MT}
          >
            <SectionHead section={section} />
            <div className="mt-4">
              <SectionBody
                id={section.id}
                loading={loading}
                isPro={isPro}
                complimentary={complimentary}
                owned={owned}
                onInspect={openInspect}
              />
            </div>
          </section>
        ))}
      </main>

      <footer
        className={`mt-14 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t ${LINE} pt-3 ${MICRO} ${MUTE}`}
      >
        <pre
          aria-hidden
          className="shp-stamp m-0 max-w-full overflow-x-auto whitespace-pre font-mono text-[5px] leading-[0.9] tracking-normal opacity-50"
        >
          {ASCII_SHOP}
        </pre>
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-right">
          <span>COSMETIC · USD · POLAR · {revStamp(new Date())} ·</span>
          <span lang="ja" className={`${JP} tracking-[0.2em]`}>
            {GLOSSARY.shop}
          </span>
        </p>
      </footer>

      <SpecDrawer
        plateId={plateId}
        loading={loading}
        isPro={isPro}
        owned={owned}
        onClose={closeInspect}
      />

      <style jsx global>{`
        /* Flagship (last in catalog order) takes the tall left cell on
           md+; koi / horizon stack on the right. DOM order stays cheapest
           first so shot harnesses keep reading cards 1–3 as koi → horizon
           → anomaly. The grid children are the reveal wrappers. */
        .shp-mythic-grid {
          display: grid;
          gap: 0.75rem;
        }
        @media (min-width: 768px) {
          .shp-mythic-grid {
            grid-template-columns: 1.35fr 1fr;
            grid-template-rows: auto auto;
          }
          .shp-mythic-grid > :nth-child(1) {
            grid-column: 2;
            grid-row: 1;
          }
          .shp-mythic-grid > :nth-child(2) {
            grid-column: 2;
            grid-row: 2;
          }
          .shp-mythic-grid > :nth-child(3) {
            grid-column: 1;
            grid-row: 1 / span 2;
          }
        }

        /* Cards flip data-offstage via the shared IntersectionObserver in
           components/shop/stage.ts; every scene animation under one pauses
           wholesale. !important is required: the scenes' animation
           shorthands implicitly reset play-state to running. */
        [data-offstage] [data-plate-fx] * {
          animation-play-state: paused !important;
        }

        /* data-perf="low" is set on the shop root by the one-shot device
           heuristic in ShopFloor (≤4GB memory or ≤4 cores): every scene
           parks; a hovered / focused card wakes its own, and the stage well
           stays live (it is the one scene the page is about) unless the
           drawer holds the stage or the well has scrolled offstage. */
        [data-perf='low'] [data-plate-fx] * {
          animation-play-state: paused !important;
        }
        [data-perf='low']:not([data-stage-hold]) .shpc-hoverable:hover [data-plate-fx] *,
        [data-perf='low']:not([data-stage-hold]) .shpc-hoverable:focus-within [data-plate-fx] *,
        [data-perf='low']:not([data-stage-hold]) .shpf-well:not([data-offstage]) [data-plate-fx] * {
          animation-play-state: running !important;
        }
        [data-perf='low'] .shop-pro-keyline::after {
          display: none;
        }
      `}</style>
    </div>
  )
}

/* ================= page shell ================= */

// useSearchParams requires a Suspense boundary at prerender time; the
// shop itself paints instantly (static catalog), so a null fallback is
// never visible in practice.
export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopFloor />
    </Suspense>
  )
}
