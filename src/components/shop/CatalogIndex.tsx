'use client'

// Catalog index — the storefront's table of contents, pinned under the top
// bar. Left: the five indexed sections as `NN NAME 漢字` buttons with one
// 1px ink underline that slides between them (GSAP x/width, DUR.indicator).
// Right: the two doors out of the store — the Team door (`TEAM チーム ·
// $50/MO →`, the /teams buy page; `COMMAND DECK →` once the account flies
// colors) and MANAGE (the Polar customer portal, a native navigation,
// hidden for house-complimentary accounts). Both are the same outlined ink
// chip that inverts on hover: no gold here, so the only lit thing in the
// bar is the active section's underline — the Team door reads as a price
// chip you can click, not as a selected state. The row is one horizontal
// snap scroller with the doors at its end wherever it overflows — always
// below md, and through the md band where the five sections alone fill
// the row; from xl everything sits on one line and nothing scrolls. The
// active item is scrolled into view when the spy moves the underline.
//
// Scroll-spy: one ScrollTrigger per section, active while the 45% viewport
// line is inside it. A click locks the spy onto its target until that
// section actually arrives (or LOCK_MS passes), so the underline does not
// flicker through every section the smooth scroll crosses.
//
// Sticky offset mirrors the Bag's LoadoutStrip / spec sheet: the fixed top
// bar is --nav-topbar-h plus its 1px rule; from md the page sits under the
// 0.9 zoom (which scales sticky `top`, hence the division) and in rail mode
// (html[data-nav-pos=left]) there is no top bar at all. The page must give
// every section `id={section.anchor}` and SECTION_SCROLL_MT so a click
// lands the section head right under this bar.

import { useRef, useState } from 'react'
import Link from 'next/link'
import { TEAM_TERMS } from '@/lib/planTerms'
import { SHOP_SECTIONS, type ShopSection, type ShopSectionId } from './catalog'
import {
  FOCUS,
  INK,
  JP_KICKER,
  LABEL,
  LINE,
  MICRO,
  MUTE,
  PAPER_BG,
  PIXEL,
  TAP
} from './shopChrome'
import { DUR, EASE, ScrollTrigger, gsap, motionReduced, registerShopGsap, useGSAP } from './shopMotion'

export interface CatalogIndexProps {
  doors: { isTeam: boolean; complimentary: boolean }
}

/** The bar's height in the floor's own CSS pixels: the tap floor (the
 * item buttons) plus the 1px bottom rule. Pre-divided at md with the
 * token, so it renders 45px tall at every breakpoint. */
export const CATALOG_INDEX_HEIGHT = 'calc(var(--shop-tap) + 1px)'

/** Scroll margin for every indexed section: the fixed top bar (+1px rule,
 * divided by the md page zoom) plus this bar. Rail mode has no top bar. */
export const SECTION_SCROLL_MT =
  'scroll-mt-[calc(var(--nav-topbar-h)_+_1px_+_var(--shop-tap)_+_1px)] md:scroll-mt-[calc((var(--nav-topbar-h)_+_1px)/0.9_+_var(--shop-tap)_+_1px)] md:[html[data-nav-pos=left]_&]:scroll-mt-[calc(var(--shop-tap)_+_1px)]'

const STICKY =
  'sticky z-20 top-[calc(var(--nav-topbar-h)_+_1px)] md:top-[calc((var(--nav-topbar-h)_+_1px)/0.9)] md:[html[data-nav-pos=left]_&]:top-0'

/** How long a click owns the underline while the page scrolls to its
 * target; cleared early the moment the target section goes active. */
const LOCK_MS = 1500

const ITEM = `shpi-item relative inline-flex ${TAP} shrink-0 items-baseline gap-x-1.5 ${FOCUS}`
/** The door's hit area is the full tap floor; the visible chip inside is
 * a short outlined lozenge so it never crowds the bar's bottom rule. Both
 * doors share it: ink at rest, inverting on hover. `whitespace-nowrap`
 * keeps the priced Team label on one line at every width — below md the
 * row scrolls instead of wrapping. */
const DOOR = `shpi-door inline-flex ${TAP} shrink-0 items-center ${FOCUS}`
const CHIP = `shpi-chip inline-flex h-7 items-center gap-x-2 whitespace-nowrap border ${LINE} px-3 ${LABEL} ${INK}`
/** Secondary parts inside a chip (JP kicker, the `·` separator): mute at
 * rest, inheriting the paper type once the chip inverts. */
const CHIP_SUB = `shpi-door-sub ${MUTE}`
/** The Team door's price figure — the pixel face at the label stop, the
 * same lockup the card price chips print, so the chip reads as a door to
 * checkout. Ink, not gold: gold is the Pro tier's hue and, sitting next to
 * the section index, a gold chip read as the selected item. */
const CHIP_PRICE = `${PIXEL} text-[length:var(--shop-fs-label)] leading-none`

/** Team in Japanese — the door's kicker, paired with its English word like
 * every other kicker on the floor (the shop glossary in catalog.ts does
 * not carry it because Team is sold on /teams, not here). Decorative, so
 * it steps out in the md–xl band where the bar is tightest (at 1024 the
 * doors otherwise overrun the row by ~17px). */
const JP_TEAM = 'チーム'
const JP_TEAM_VISIBILITY = 'md:hidden xl:inline'

/** Monthly Team price as the chip prints it: `$50/MO`. The figure is the
 * shared plan copy; the unit is compacted from `/ MO` for the chip. Not
 * "from": yearly works out cheaper per month, so $50 is the monthly
 * price, not a floor. */
const TEAM_PRICE = TEAM_TERMS.monthly.price
const TEAM_UNIT = TEAM_TERMS.monthly.unit.replace(/\s+/g, '')
const TEAM_DOOR_LABEL = `Team plan — subscribe, ${TEAM_PRICE} per month`
const DECK_DOOR_LABEL = 'Command deck — your team console'

export function CatalogIndex({ doors }: CatalogIndexProps) {
  const rootRef = useRef<HTMLElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)

  const [active, setActive] = useState<ShopSectionId>(SHOP_SECTIONS[0].id)
  const activeRef = useRef<ShopSectionId>(active)
  const firstFit = useRef(true)

  // Click lock: the section a click is scrolling to, and its safety timer.
  const lockRef = useRef<ShopSectionId | null>(null)
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearLock = () => {
    lockRef.current = null
    if (lockTimer.current !== null) {
      clearTimeout(lockTimer.current)
      lockTimer.current = null
    }
  }

  // Scroll-spy + the underline's resize re-fit. Mount only; the context
  // kills every trigger on unmount.
  useGSAP(
    (_, contextSafe = (fn) => fn) => {
      registerShopGsap()
      for (const section of SHOP_SECTIONS) {
        const el = document.getElementById(section.anchor)
        if (!el) continue
        ScrollTrigger.create({
          trigger: el,
          start: 'top 45%',
          end: 'bottom 45%',
          onToggle: (self) => {
            if (!self.isActive) return
            const lock = lockRef.current
            if (lock !== null && lock !== section.id) return
            if (lock === section.id) clearLock()
            setActive(section.id)
          }
        })
      }

      // Web fonts landing re-flow every section; measure again once they
      // are in (and once more on window load, which ScrollTrigger already
      // does on its own).
      let live = true
      void document.fonts.ready.then(() => {
        if (live) ScrollTrigger.refresh()
      })

      // The list's own box changes (font swap, resize, orientation) move
      // the item under the underline; re-fit instantly, no tween.
      const list = listRef.current
      const refit = contextSafe(() => {
        if (list) placeIndicator(list, barRef.current, activeRef.current, true)
      })
      const observer = new ResizeObserver(refit)
      if (list) observer.observe(list)

      return () => {
        live = false
        observer.disconnect()
        clearLock()
      }
    },
    { scope: rootRef }
  )

  // The underline follows the active item: instant on first paint and
  // under reduced motion, otherwise a DUR.indicator slide on the shop
  // curve. The mobile strip also scrolls the item into view.
  useGSAP(
    () => {
      activeRef.current = active
      const list = listRef.current
      if (!list) return
      placeIndicator(list, barRef.current, active, firstFit.current || motionReduced())
      firstFit.current = false
      const row = rowRef.current
      const item = list.querySelector<HTMLElement>(`[data-section="${active}"]`)
      if (row && item) revealItem(row, list, item)
    },
    { dependencies: [active], scope: rootRef }
  )

  const onPick = (section: ShopSection) => {
    setActive(section.id)
    lockRef.current = section.id
    if (lockTimer.current !== null) clearTimeout(lockTimer.current)
    lockTimer.current = setTimeout(clearLock, LOCK_MS)
    document.getElementById(section.anchor)?.scrollIntoView({
      behavior: motionReduced() ? 'auto' : 'smooth',
      block: 'start'
    })
  }

  return (
    <nav
      ref={rootRef}
      aria-label="Catalog"
      className={`shpi-index ${STICKY} border-b ${LINE} ${PAPER_BG}`}
    >
      <div ref={rowRef} className="shpi-row relative">
        <div ref={listRef} className="shpi-list relative flex shrink-0 items-stretch gap-x-5 md:gap-x-6">
          {SHOP_SECTIONS.map((section) => {
            const isActive = section.id === active
            return (
              <button
                key={section.id}
                type="button"
                data-section={section.id}
                data-active={isActive ? '' : undefined}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onPick(section)}
                className={ITEM}
              >
                <span className={`shpi-num ${MICRO} ${MUTE}`}>{section.index}</span>
                <span className={`shpi-label ${LABEL} ${INK}`}>{section.label}</span>
                <span aria-hidden lang="ja" className={`shpi-jp ${JP_KICKER} ${MUTE}`}>
                  {section.jp}
                </span>
              </button>
            )
          })}
          <span
            ref={barRef}
            aria-hidden
            className="shpi-indicator pointer-events-none absolute bottom-0 left-0 h-px w-0 bg-[color:var(--shop-ink)]"
          />
        </div>

        <div className="shpi-doors ml-auto flex shrink-0 items-stretch gap-x-2 pl-5 md:pl-6">
          <Link
            href="/teams"
            aria-label={doors.isTeam ? DECK_DOOR_LABEL : TEAM_DOOR_LABEL}
            className={DOOR}
          >
            <span className={CHIP}>
              {doors.isTeam ? 'COMMAND DECK' : 'TEAM'}
              <span aria-hidden lang="ja" className={`${CHIP_SUB} ${JP_KICKER} ${JP_TEAM_VISIBILITY}`}>
                {JP_TEAM}
              </span>
              {!doors.isTeam && (
                <>
                  <span aria-hidden className={CHIP_SUB}>
                    ·
                  </span>
                  <span className="inline-flex items-baseline gap-x-0.5">
                    <span className={CHIP_PRICE}>{TEAM_PRICE}</span>
                    <span>{TEAM_UNIT}</span>
                  </span>
                </>
              )}
              <span aria-hidden>→</span>
            </span>
          </Link>
          {!doors.complimentary && (
            <a href="/api/portal" className={DOOR}>
              <span className={CHIP}>MANAGE</span>
            </a>
          )}
        </div>
      </div>

      <style jsx global>{`
        /* The row is one horizontal snap scroller — sections, then the
           doors at its end — at every width: a no-op once the line fits
           (xl+), and the way the doors stay reachable through the md band
           where the five sections alone fill the row. Scrollbar hidden;
           the underline lives inside the list, so it scrolls with the
           items. */
        .shpi-row {
          display: flex;
          align-items: stretch;
          padding-inline: var(--shop-pad);
          overflow-x: auto;
          scroll-snap-type: x proximity;
          scroll-padding-inline: var(--shop-pad);
          scrollbar-width: none;
        }
        .shpi-row::-webkit-scrollbar {
          display: none;
        }
        .shpi-item {
          scroll-snap-align: start;
        }

        /* the active item is all ink: numeral, name and kicker */
        .shpi-item[data-active] .shpi-num,
        .shpi-item[data-active] .shpi-jp {
          color: var(--shop-ink);
        }

        /* hover / press stay CSS; 160ms on the shop curve (CSS_EASE.out) */
        .shpi-num,
        .shpi-jp,
        .shpi-chip,
        .shpi-door-sub {
          transition:
            color 160ms cubic-bezier(0.23, 1, 0.32, 1),
            background-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
            border-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        /* both doors invert the same way — ink slab, paper type; the mute
           sub-parts (kicker, separator) ride the paper too */
        @media (hover: hover) and (pointer: fine) {
          .shpi-item:hover .shpi-num {
            color: var(--shop-ink);
          }
          .shpi-door:hover .shpi-chip {
            background: var(--shop-ink);
            border-color: var(--shop-ink);
            color: var(--shop-paper);
          }
          .shpi-door:hover .shpi-chip .shpi-door-sub {
            color: inherit;
          }
        }
        .shpi-door:focus-visible .shpi-chip {
          background: var(--shop-ink);
          border-color: var(--shop-ink);
          color: var(--shop-paper);
        }
        .shpi-door:focus-visible .shpi-chip .shpi-door-sub {
          color: inherit;
        }

        @media (prefers-reduced-motion: reduce) {
          .shpi-num,
          .shpi-jp,
          .shpi-chip,
          .shpi-door-sub {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpi-num,
        html[data-motion='reduced'] .shpi-jp,
        html[data-motion='reduced'] .shpi-chip,
        html[data-motion='reduced'] .shpi-door-sub {
          transition: none;
        }
      `}</style>
    </nav>
  )
}

/** Slide (or snap) the 1px underline under `id`: x is the item's offset
 * inside the list, width its box. Both are list-relative, so the mobile
 * scroller's scrollLeft never enters into it. */
function placeIndicator(
  list: HTMLElement,
  bar: HTMLElement | null,
  id: ShopSectionId,
  instant: boolean
) {
  if (!bar) return
  const item = list.querySelector<HTMLElement>(`[data-section="${id}"]`)
  if (!item) return
  const vars = { x: item.offsetLeft, width: item.offsetWidth }
  if (instant) {
    gsap.set(bar, vars)
    return
  }
  gsap.to(bar, { ...vars, duration: DUR.indicator, ease: EASE.out, overwrite: 'auto' })
}

/** Scrolling strip: when the spy (or a resize) leaves the active item
 * outside the scroller's view, scroll the row so it sits a gutter in from
 * the nearer edge. No-op when the row does not overflow (xl+). Offsets are
 * measured, not rect-derived, so they hold under the md page zoom too. */
function revealItem(scroller: HTMLElement, list: HTMLElement, item: HTMLElement) {
  if (scroller.scrollWidth <= scroller.clientWidth) return
  const pad = parseFloat(getComputedStyle(scroller).paddingLeft) || 0
  const start = list.offsetLeft + item.offsetLeft
  const end = start + item.offsetWidth
  const viewStart = scroller.scrollLeft
  const viewEnd = viewStart + scroller.clientWidth
  let left: number | null = null
  if (start - pad < viewStart) left = start - pad
  else if (end + pad > viewEnd) left = end + pad - scroller.clientWidth
  if (left === null) return
  scroller.scrollTo({ left, behavior: motionReduced() ? 'auto' : 'smooth' })
}
