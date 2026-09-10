'use client'

// Spec drawer — the inspect step before spending. Desktop: a 440px right
// panel sliding in from the edge; mobile: a bottom sheet with a grabber
// that can be flicked or dragged away (GSAP Draggable + Inertia, release
// routed through shouldDismissSheet). Follows bag/SpecDrawer for the
// behaviour that matters — fixed root, veil button, Escape, Tab trap, body
// scroll lock, focus to CLOSE on open and back to the opener on close —
// but slides on the shop drawer curve instead of a hard cut.
//
// Open/closed is owned by the page (`plateId`, null = closed; the page
// also writes the `?plate=` deep link and sets `data-stage-hold` on the
// shop root while this is open). Closing plays the exit first and calls
// `onClose` when it lands, so the component stays mounted for the whole
// slide; an internal `closing` flag makes the exit idempotent.
//
// Portaled to document.body: the page sits inside .app-nav-inset, a
// `relative z-10` stacking context that would cap any z-index inside it
// under the fixed top bar's z-40. The portal wrapper re-applies .shop-floor
// so the --shop-* tokens resolve out here; that also keeps the drawer's
// one live PlateLayer scene outside the page's `data-stage-hold` freeze.
//
// Styled-jsx under `shpd-`.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { IconClose } from '@/components/leaderboard/icons'
import { getPlate } from '@/lib/cosmetics/plates'
import { JP, plateIndex } from './catalog'
import { PlateSpec } from './PlateSpec'
import { DISPLAY, FOCUS, INK, JP as JP_FACE, LABEL, LINE, MUTE, PAPER_BG, TAP } from './shopChrome'
import {
  CSS_EASE,
  DUR,
  Draggable,
  EASE,
  InertiaPlugin,
  gsap,
  motionReduced,
  shouldDismissSheet,
  useGSAP
} from './shopMotion'

export interface SpecDrawerProps {
  /** Plate on the sheet; null = closed. */
  plateId: string | null
  loading: boolean
  isPro: boolean
  owned: ReadonlySet<string>
  /** Fired after the exit animation lands (or at once under reduced motion). */
  onClose: () => void
}

/** Side panel from md up; bottom sheet below. Read at animation time, not
 * held in state — the resting transform is identity on both axes, so a
 * breakpoint crossing while open needs no repair. */
const DESKTOP_QUERY = '(min-width: 768px)'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Wrap Tab / Shift+Tab inside `root`; anything hidden is skipped. */
function trapTab(event: KeyboardEvent, root: HTMLElement) {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null
  )
  if (nodes.length === 0) {
    event.preventDefault()
    return
  }
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement
  const inside = active instanceof HTMLElement && root.contains(active)
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault()
      last.focus()
    }
  } else if (!inside || active === last) {
    event.preventDefault()
    first.focus()
  }
}

export function SpecDrawer({ plateId, loading, isPro, owned, onClose }: SpecDrawerProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const veilRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const grabberRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // The exit is idempotent: veil, CLOSE, Escape and a sheet flick may all
  // land while it plays. The ref gates re-entry synchronously; the state
  // drops pointer events on the departing panel.
  const closingRef = useRef(false)
  const exitRef = useRef<gsap.core.Animation | null>(null)
  const [closing, setClosing] = useState(false)

  const open = plateId !== null
  const plate = plateId === null ? null : getPlate(plateId)

  // A deep link to an id the catalog no longer has: hand control straight
  // back so the page can drop `?plate=` and the stage hold.
  useEffect(() => {
    if (plateId !== null && plate === null) onCloseRef.current()
  }, [plateId, plate])

  // Re-arm for the next open once the page has acknowledged the close.
  useEffect(() => {
    closingRef.current = false
    setClosing(false)
  }, [plateId])

  useEffect(
    () => () => {
      exitRef.current?.kill()
    },
    []
  )

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    const panel = panelRef.current
    const veil = veilRef.current
    const finish = () => onCloseRef.current()
    if (!panel || !veil) {
      finish()
      return
    }
    // Drops any inertia throw the sheet's Draggable still has running.
    gsap.killTweensOf([panel, veil])
    if (motionReduced()) {
      exitRef.current = gsap.to([veil, panel], {
        autoAlpha: 0,
        duration: DUR.cut,
        ease: EASE.out,
        onComplete: finish
      })
      return
    }
    const desktop = window.matchMedia(DESKTOP_QUERY).matches
    // yPercent/xPercent, not y/x: a dragged sheet keeps its `y` and the
    // percent rides on top, so the exit runs from wherever it was released.
    const tl = gsap.timeline({ onComplete: finish })
    tl.to(
      panel,
      {
        ...(desktop ? { xPercent: 100 } : { yPercent: 100 }),
        duration: DUR.drawer,
        ease: EASE.drawer
      },
      0
    )
    tl.to(veil, { autoAlpha: 0, duration: DUR.veil, ease: EASE.out }, DUR.drawer - DUR.veil)
    exitRef.current = tl
  }, [])

  /* ---- focus, keys, scroll lock ---- */
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // preventScroll: the panel is still mid-slide (transformed off the
    // edge) when this runs; nothing may nudge the viewport to reveal it.
    closeRef.current?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key === 'Tab' && panelRef.current) trapTab(event, panelRef.current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [open, requestClose])

  /* ---- entrance ---- */
  // Keyed on open, not plateId: a plate change while open just re-renders
  // the body. Layout-phase, so the from-state lands before first paint.
  useGSAP(
    () => {
      if (!open) return
      const panel = panelRef.current
      const veil = veilRef.current
      if (!panel || !veil) return
      if (motionReduced()) {
        // opacity, not autoAlpha: visibility:hidden at t=0 would make the
        // CLOSE focus above land on nothing.
        gsap.fromTo([veil, panel], { opacity: 0 }, { opacity: 1, duration: DUR.cut, ease: EASE.out })
        return
      }
      const desktop = window.matchMedia(DESKTOP_QUERY).matches
      gsap.fromTo(veil, { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR.veil, ease: EASE.out })
      gsap.fromTo(
        panel,
        desktop ? { xPercent: 100, yPercent: 0 } : { xPercent: 0, yPercent: 100 },
        { xPercent: 0, yPercent: 0, duration: DUR.drawer, ease: EASE.drawer }
      )
    },
    { dependencies: [open], scope: rootRef }
  )

  /* ---- sheet gesture (mobile) ---- */
  // Grabber + header drag the sheet down; the scrolling body is not a
  // trigger, so reading long SCENE notes never fights the gesture. The
  // inertia throw Draggable starts on release is killed in onDragEnd and
  // the release is routed by hand: flick or 40% travel dismisses, anything
  // else snaps back on the drawer curve.
  useGSAP(
    () => {
      if (!open || window.matchMedia(DESKTOP_QUERY).matches) return
      const sheet = panelRef.current
      const grabber = grabberRef.current
      const header = headerRef.current
      if (!sheet || !grabber || !header) return
      const [drag] = Draggable.create(sheet, {
        type: 'y',
        trigger: [grabber, header],
        bounds: { minX: 0, maxX: 0, minY: 0, maxY: sheet.offsetHeight },
        inertia: true,
        zIndexBoost: false,
        onDragEnd: () => {
          drag.tween?.kill()
          const velocity = InertiaPlugin.getVelocity(sheet, 'y') / 1000
          if (shouldDismissSheet(drag.y, sheet.offsetHeight, velocity)) {
            requestClose()
            return
          }
          gsap.to(sheet, {
            y: 0,
            duration: motionReduced() ? 0 : DUR.drawer,
            ease: EASE.drawer,
            overwrite: 'auto'
          })
        }
      })
      return () => {
        drag.kill()
        gsap.killTweensOf(sheet, 'y')
      }
    },
    { dependencies: [open], scope: rootRef }
  )

  if (plate === null || typeof document === 'undefined') return null

  return createPortal(
    // .shop-floor re-scopes the tokens; a zero-height in-flow wrapper at
    // the end of <body> — the fixed root inside does the work.
    <div ref={rootRef} className="shop-floor font-sans">
      <div
        className={`shpd-root fixed inset-0 z-[80] flex items-end justify-center md:items-stretch md:justify-end ${
          closing ? 'pointer-events-none' : ''
        }`}
        data-closing={closing ? '' : undefined}
      >
        <button
          ref={veilRef}
          type="button"
          tabIndex={-1}
          onClick={requestClose}
          aria-label="Close spec"
          className="absolute inset-0 cursor-default bg-[color:var(--shop-veil)]"
        />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`shpd-panel relative flex max-h-[88svh] w-full flex-col border-t ${LINE} ${PAPER_BG} md:h-full md:max-h-none md:w-[440px] md:border-l md:border-t-0`}
        >
          {/* grabber — the sheet's handle, hidden on the side panel */}
          <div
            ref={grabberRef}
            aria-hidden
            className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center md:hidden"
          >
            <span className="h-[4px] w-[36px] bg-[color:var(--shop-mute)]" />
          </div>

          <div
            ref={headerRef}
            className={`flex shrink-0 items-center justify-between gap-3 border-b ${LINE} pl-[var(--shop-pad)]`}
          >
            <h2 id={titleId} className={`m-0 min-w-0 truncate ${LABEL} ${MUTE}`}>
              SPEC <span className={JP_FACE}>{JP.spec}</span> · /{plateIndex(plate.id)}
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={requestClose}
              className={`shpd-close inline-flex ${TAP} shrink-0 items-center gap-2 px-[var(--shop-pad)] ${LABEL} ${INK} ${FOCUS}`}
            >
              CLOSE
              <IconClose size={12} />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
            {/* art well — the one live scene while the drawer is open.
                `group` is load-bearing: mythic hover flourishes key off it. */}
            <div className="shpd-well group relative aspect-[2/1] overflow-hidden">
              <PlateLayer plateId={plate.id} fade="none" />
              <span aria-hidden className="shpd-scrim pointer-events-none absolute inset-0" />
              <p
                className={`shpd-onart pointer-events-none absolute inset-x-0 bottom-0 m-0 p-[var(--shop-pad)] ${DISPLAY} font-semibold leading-tight tracking-[-0.01em]`}
              >
                {plate.name}
              </p>
            </div>

            <div className="p-[var(--shop-pad)]">
              <PlateSpec
                plate={plate}
                variant="drawer"
                loading={loading}
                isPro={isPro}
                owned={owned.has(plate.id)}
              />
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .shpd-panel {
          will-change: transform;
        }
        /* fixed-dark art well in both themes: plate art is authored on black */
        .shpd-well {
          background: rgb(9 10 13);
        }
        .shpd-scrim {
          background: linear-gradient(180deg, transparent 50%, rgb(5 6 9 / 0.86));
        }
        /* on-art type is literal near-white, never zinc (theme-flipped) */
        .shpd-onart {
          color: rgb(244 244 245);
          font-size: 17px;
        }
        @media (min-width: 768px) {
          .shpd-onart {
            font-size: calc(17px / 0.9);
          }
        }
        .shpd-close {
          transition: color 160ms ${CSS_EASE.out};
        }
        @media (hover: hover) and (pointer: fine) {
          .shpd-close:hover {
            color: var(--shop-mute);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .shpd-close {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpd-close {
          transition: none;
        }
      `}</style>
    </div>,
    document.body
  )
}
