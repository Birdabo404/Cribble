'use client'

// Generic horizontal shelf — the scroll-snap primitive under the depot's
// card rows (the Reserve, the Rack, and any future shelf). Self-contained:
// own styled-jsx under a fresh `shpc-shelf-` prefix, inline SVG chevrons,
// no icon imports, no dependency on shop/page.tsx classes.
//
// Child contract: the Shelf does NOT wrap its children. Each card must
// bring its own `snap-start shrink-0` plus an explicit width class
// (e.g. `w-[280px]`), or the flex container will squash it.
//
// The scroll container bleeds to the page edges (`-mx-6 px-6`) so cards
// peek past the content column while still snapping back into alignment
// with it (`scroll-padding-inline: 1.5rem`). Edge fades paint with
// `var(--background)` directly — it's a hex token, not an R G B triplet —
// so a section that re-pins dark surface tokens in light mode should
// re-pin `--background` on the same scope for the fades to match.

import { type ReactNode, useEffect, useRef, useState } from 'react'

/** ~8px dead zone so sub-pixel scroll positions at either end don't
 * flicker the fades/arrows. */
const EDGE_EPSILON = 8

export function Shelf({
  ariaLabel,
  children,
  className = '',
  cardGap = 'gap-4'
}: {
  ariaLabel: string
  children: ReactNode
  className?: string
  cardGap?: string
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState({ left: false, right: false })

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const measure = () => {
      const max = scroller.scrollWidth - scroller.clientWidth
      const left = scroller.scrollLeft > EDGE_EPSILON
      const right = scroller.scrollLeft < max - EDGE_EPSILON
      setCanScroll((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right }
      )
    }

    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    // Container resizes and card resizes (fonts, art loading in) both move
    // the scrollable range; observing the children catches scrollWidth
    // changes the container's own box never sees.
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    for (const child of Array.from(scroller.children)) observer.observe(child)
    return () => {
      scroller.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [])

  const scrollByPage = (direction: 1 | -1) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // In-app reduce-motion preference (settings/appearance) is mirrored
    // onto <html data-motion="reduced"> by the nav boot script; the CSS
    // kill-switch can't reach an explicit scrollBy behavior, so it is
    // honored here — alongside the OS-level media query.
    const reduced =
      document.documentElement.getAttribute('data-motion') === 'reduced' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollBy({
      left: direction * scroller.clientWidth * 0.8,
      behavior: reduced ? 'auto' : 'smooth'
    })
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={scrollerRef}
        role="group"
        aria-label={ariaLabel}
        className={`shpc-shelf-scroller -mx-6 flex ${cardGap} snap-x snap-mandatory overflow-x-auto px-6`}
      >
        {children}
      </div>

      {/* edge fades + arrows track the same scroll state: each side only
          exists while more content lies that way */}
      {canScroll.left && (
        <>
          <div
            aria-hidden
            className="shpc-shelf-fade-l pointer-events-none absolute inset-y-0 -left-6 z-10 w-12"
          />
          <button
            type="button"
            onClick={() => scrollByPage(-1)}
            aria-label="Scroll left"
            className="shpc-shelf-arrow absolute -left-3 top-1/2 z-20 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-zinc-300 md:flex"
          >
            <Chevron direction="left" />
          </button>
        </>
      )}
      {canScroll.right && (
        <>
          <div
            aria-hidden
            className="shpc-shelf-fade-r pointer-events-none absolute inset-y-0 -right-6 z-10 w-12"
          />
          <button
            type="button"
            onClick={() => scrollByPage(1)}
            aria-label="Scroll right"
            className="shpc-shelf-arrow absolute -right-3 top-1/2 z-20 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-zinc-300 md:flex"
          >
            <Chevron direction="right" />
          </button>
        </>
      )}

      <style jsx global>{`
        .shpc-shelf-scroller {
          overscroll-behavior-x: contain;
          scroll-padding-inline: 1.5rem;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .shpc-shelf-scroller::-webkit-scrollbar {
          display: none;
        }

        /* fades sit at the scroll container's true clip edges (24px past
           the wrapper, matching the -mx-6 bleed) and reach 24px into the
           content column */
        .shpc-shelf-fade-l {
          background: linear-gradient(90deg, var(--background), transparent);
        }
        .shpc-shelf-fade-r {
          background: linear-gradient(270deg, var(--background), transparent);
        }

        .shpc-shelf-arrow {
          border: 1px solid rgb(var(--lb-panel-edge) / 0.18);
          background: rgb(var(--lb-panel-bg) / 0.9);
          transition: border-color 180ms ease;
        }
        .shpc-shelf-arrow:hover {
          border-color: rgb(var(--lb-panel-edge) / 0.4);
        }
        .shpc-shelf-arrow:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .shpc-shelf-arrow {
            transition: none;
          }
        }
      `}</style>
    </div>
  )
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === 'left' ? <path d="M9.5 3.5 5 8l4.5 4.5" /> : <path d="M6.5 3.5 11 8l-4.5 4.5" />}
    </svg>
  )
}
