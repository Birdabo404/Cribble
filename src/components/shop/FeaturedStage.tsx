'use client'

// Featured Stage — the body of `01 FEATURED`. Left: the art well, a fixed
// dark 16:7 (16:9 on phones) compartment where the selected plate is
// live and full-bleed under static corner brackets. Right: the plate's
// spec (PlateSpec, stage variant) with the filled BUY and the SPEC door
// to the drawer. Below: the thumb rail — five frozen PlatePreview thumbs
// as a radio group with roving focus and a 1px ink indicator riding the
// active one.
//
// Selection is a two-step swap so the well never reads empty: the spec
// lines drop out (120ms), the state commits, then the incoming art
// crossfades over the outgoing one (shopMotion.crossfadeSwap) while the
// new lines stagger in and the price glyphs roll. The art uses two
// persistent slot layers that alternate front/back — the outgoing scene
// keeps its own DOM node through the fade, so it never restarts on the way
// out. Every GSAP path branches on motionReduced(); the helpers do too.
//
// The page renders the section wrapper + heading and owns the drawer
// (`onInspect` hands it a plate id). Styled-jsx under `shpf-`.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PlateLayer, PlatePreview } from '@/components/cosmetics/PlateLayer'
import { PLATE_RARITY_META, type PlateDef } from '@/lib/cosmetics/plates'
import { FEATURED_PLATES, plateIndex, rarityJp } from './catalog'
import { PlateSpec } from './PlateSpec'
import { DISPLAY, FOCUS, JP_KICKER, LINE, MICRO, MUTE, PAPER_BG, rarityColor } from './shopChrome'
import {
  CSS_EASE,
  DUR,
  EASE,
  STAGGER,
  crossfadeSwap,
  gsap,
  motionReduced,
  rollGlyphs,
  useGSAP
} from './shopMotion'
import { useOnStage } from './stage'

export interface FeaturedStageProps {
  loading: boolean
  isPro: boolean
  owned: ReadonlySet<string>
  /** Opens the spec drawer for a plate (the SPEC door on the stage). */
  onInspect: (plateId: string) => void
}

/** The indicator is a fixed 100px ink line scaled to the active thumb —
 * transform only, so moving it never touches layout. */
const INDICATOR_BASE = 100
/** Spec lines out / in around the art crossfade (seconds). */
const LINES_OUT = 0.12
const LINES_IN = 0.28

type Slot = 0 | 1
type Slots = [string | null, string | null]

const other = (slot: Slot): Slot => (slot === 0 ? 1 : 0)

export function FeaturedStage({ loading, isPro, owned, onInspect }: FeaturedStageProps) {
  const first: PlateDef | undefined = FEATURED_PLATES[0]
  const firstId = first?.id ?? ''

  // `selectedId` is the rail's truth (aria-checked, roving focus, the
  // indicator) and moves at once; the well + spec follow it through the
  // swap via `slots[front]`.
  const [selectedId, setSelectedId] = useState(firstId)
  const [slots, setSlots] = useState<Slots>([firstId || null, null])
  const [front, setFront] = useState<Slot>(0)
  const stageId = slots[front] ?? firstId
  const stagePlate = FEATURED_PLATES.find((plate) => plate.id === stageId) ?? first

  const rootRef = useRef<HTMLDivElement>(null)
  const wellRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<[HTMLDivElement | null, HTMLDivElement | null]>([null, null])
  const captionRef = useRef<HTMLDivElement>(null)
  const specRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Live mirrors for the tween callbacks, which outlive the render that
  // created them.
  const stageIdRef = useRef(stageId)
  stageIdRef.current = stageId
  const frontRef = useRef(front)
  frontRef.current = front
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const outRef = useRef<gsap.core.Tween | null>(null)
  const inRef = useRef<gsap.core.Timeline | null>(null)
  const booted = useRef(false)
  const indicatorBooted = useRef(false)

  // The well joins the page's stage budget: scrolled past, its scene
  // pauses like any card's (the page's [data-offstage] rule).
  useOnStage(wellRef)

  /** The animatable lines: the on-art caption plus every PlateSpec line. */
  const lineTargets = useCallback(() => {
    const lines = specRef.current
      ? gsap.utils.toArray<HTMLElement>('.shop-spec-line', specRef.current)
      : []
    return captionRef.current ? [captionRef.current, ...lines] : lines
  }, [])

  /* ---- swap, step 1: selection → lines out → commit ---- */
  useGSAP(
    () => {
      if (!booted.current) return
      outRef.current?.kill()
      inRef.current?.kill()
      const lines = lineTargets()
      const reduced = motionReduced()

      if (selectedId === stageIdRef.current) {
        // Bounced back to the plate on stage mid-swap: restore whatever
        // the interrupted out tween had taken.
        if (lines.length > 0) {
          gsap.to(lines, {
            autoAlpha: 1,
            y: 0,
            duration: DUR.cut,
            ease: EASE.out,
            clearProps: 'transform',
            overwrite: 'auto'
          })
        }
        return
      }

      const commit = () => {
        const back = other(frontRef.current)
        setSlots((prev) => {
          const next: Slots = [prev[0], prev[1]]
          next[back] = selectedId
          return next
        })
        setFront(back)
      }

      if (lines.length === 0) {
        commit()
        return
      }
      outRef.current = gsap.to(lines, {
        autoAlpha: 0,
        ...(reduced ? {} : { y: -4 }),
        duration: reduced ? DUR.cut : LINES_OUT,
        ease: EASE.out,
        overwrite: 'auto',
        onComplete: commit
      })
    },
    { dependencies: [selectedId], scope: rootRef }
  )

  /* ---- swap, step 2: committed → art crossfade, lines in, glyph roll ---- */
  useGSAP(
    () => {
      if (!booted.current) {
        booted.current = true
        return
      }
      const back = other(front)
      const inEl = slotRefs.current[front]
      const outEl = slotRefs.current[back]
      if (!inEl) return
      inRef.current?.kill()
      const reduced = motionReduced()

      const tl = gsap.timeline()
      tl.add(
        crossfadeSwap(outEl, inEl, {
          // The outgoing slot is emptied only once it is gone, so its
          // scene keeps playing under the fade instead of vanishing.
          onOutComplete: () =>
            setSlots((prev) => {
              if (prev[back] === null) return prev
              const next: Slots = [prev[0], prev[1]]
              next[back] = null
              return next
            })
        }),
        0
      )

      // PlateSpec + caption are re-keyed on the stage plate, so these are
      // fresh nodes: the from-state lands in this layout pass, pre-paint.
      const lines = lineTargets()
      if (lines.length > 0) {
        if (reduced) {
          tl.fromTo(
            lines,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: DUR.cut, ease: EASE.out },
            0
          )
        } else {
          tl.fromTo(
            lines,
            { autoAlpha: 0, y: 4 },
            {
              autoAlpha: 1,
              y: 0,
              duration: LINES_IN,
              ease: EASE.out,
              stagger: STAGGER.lines,
              clearProps: 'transform'
            },
            0.06
          )
        }
      }
      const glyphs = specRef.current
        ? gsap.utils.toArray<HTMLElement>('.shop-glyph', specRef.current)
        : []
      if (glyphs.length > 0) tl.add(rollGlyphs(glyphs), reduced ? 0 : 0.14)
      inRef.current = tl
    },
    { dependencies: [front], scope: rootRef }
  )

  /* ---- indicator ---- */
  const fitIndicator = useCallback((duration: number) => {
    const indicator = indicatorRef.current
    const rail = railRef.current
    const at = FEATURED_PLATES.findIndex((plate) => plate.id === selectedIdRef.current)
    const thumb = thumbRefs.current[at]
    if (!indicator || !rail || !thumb || thumb.offsetWidth === 0) return
    // offsetLeft is in the rail's own frame (the rail is its offsetParent
    // and, on phones, the scroller the indicator scrolls with).
    gsap.to(indicator, {
      x: thumb.offsetLeft,
      scaleX: thumb.offsetWidth / INDICATOR_BASE,
      transformOrigin: 'left center',
      duration: motionReduced() ? 0 : duration,
      ease: EASE.out,
      overwrite: 'auto'
    })
  }, [])

  useGSAP(
    () => {
      fitIndicator(indicatorBooted.current ? DUR.indicator : 0)
      indicatorBooted.current = true
    },
    { dependencies: [selectedId, fitIndicator], scope: rootRef }
  )

  useEffect(() => {
    const rail = railRef.current
    const indicator = indicatorRef.current
    if (!rail || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => fitIndicator(0))
    observer.observe(rail)
    return () => {
      observer.disconnect()
      if (indicator) gsap.killTweensOf(indicator)
    }
  }, [fitIndicator])

  /* ---- rail ---- */
  const registerThumb = useCallback((index: number, el: HTMLButtonElement | null) => {
    thumbRefs.current[index] = el
  }, [])

  const select = useCallback((plateId: string) => setSelectedId(plateId), [])

  /** Phones: centre a keyboard-selected thumb in the snap scroller. */
  const revealThumb = (thumb: HTMLButtonElement | null) => {
    const rail = railRef.current
    if (!rail || !thumb || rail.scrollWidth <= rail.clientWidth) return
    rail.scrollTo({
      left: thumb.offsetLeft - (rail.clientWidth - thumb.offsetWidth) / 2,
      behavior: motionReduced() ? 'auto' : 'smooth'
    })
  }

  const onRailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = FEATURED_PLATES.length
    if (count === 0) return
    const current = Math.max(
      0,
      FEATURED_PLATES.findIndex((plate) => plate.id === selectedId)
    )
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % count
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + count) % count
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      default:
        return
    }
    event.preventDefault()
    setSelectedId(FEATURED_PLATES[next].id)
    const thumb = thumbRefs.current[next] ?? null
    thumb?.focus({ preventScroll: true })
    revealThumb(thumb)
  }

  if (!first || !stagePlate) return null

  return (
    <div
      ref={rootRef}
      className={`shpf-stage flex flex-col gap-px border ${LINE} bg-[color:var(--shop-line)]`}
    >
      <div className="grid gap-px md:grid-cols-[1.4fr_1fr]">
        {/* art well — fixed dark in both themes; brackets static-on */}
        <div className={PAPER_BG}>
          <div
            ref={wellRef}
            data-offstage=""
            data-active=""
            className="shpf-well shop-brackets group relative aspect-[16/9] overflow-hidden md:aspect-[16/7]"
          >
            <div
              ref={(el) => {
                slotRefs.current[0] = el
              }}
              className="absolute inset-0"
            >
              {slots[0] && <PlateLayer plateId={slots[0]} fade="none" />}
            </div>
            <div
              ref={(el) => {
                slotRefs.current[1] = el
              }}
              className="absolute inset-0"
            >
              {slots[1] && <PlateLayer plateId={slots[1]} fade="none" />}
            </div>
            <span aria-hidden className="shpf-scrim pointer-events-none absolute inset-0" />
            <div
              key={stageId}
              ref={captionRef}
              className="shpf-onart pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-[var(--shop-pad)]"
            >
              <p
                className={`shpf-onart-name m-0 ${DISPLAY} font-semibold leading-tight tracking-[-0.01em]`}
              >
                {stagePlate.name}
              </p>
              <p className={`shpf-onart-rarity m-0 ${MICRO}`}>
                {PLATE_RARITY_META[stagePlate.rarity].label}{' '}
                <span className={JP_KICKER}>{rarityJp(stagePlate.rarity)}</span>
              </p>
            </div>
          </div>
        </div>

        {/* spec column */}
        <div
          ref={specRef}
          className={`shpf-spec ${PAPER_BG} flex flex-col justify-center p-[var(--shop-pad)]`}
        >
          <PlateSpec
            key={stageId}
            plate={stagePlate}
            variant="stage"
            loading={loading}
            isPro={isPro}
            owned={owned.has(stageId)}
            onInspect={onInspect}
          />
        </div>
      </div>

      {/* thumb rail — radio group, roving focus, snap scroller on phones */}
      <div
        ref={railRef}
        role="radiogroup"
        aria-label="Featured plates"
        onKeyDown={onRailKeyDown}
        className="shpf-rail relative flex snap-x snap-mandatory gap-px overflow-x-auto md:grid md:grid-cols-5 md:snap-none"
      >
        {FEATURED_PLATES.map((plate, index) => (
          <RailThumb
            key={plate.id}
            plate={plate}
            index={index}
            active={plate.id === selectedId}
            onSelect={select}
            register={registerThumb}
          />
        ))}
        <span
          ref={indicatorRef}
          aria-hidden
          className="shpf-indicator pointer-events-none absolute bottom-0 left-0 h-px w-[100px] origin-left bg-[color:var(--shop-ink)]"
        />
      </div>

      <style jsx global>{`
        /* art well: fixed dark surface; ink re-pinned to on-art near-white
           so the static brackets (drawn in --shop-ink) read on the art in
           both themes. Nothing else inside inherits ink. */
        .shpf-well {
          --shop-ink: rgb(244 244 245);
          background: rgb(9 10 13);
        }
        .shpf-scrim {
          background: linear-gradient(180deg, transparent 55%, rgb(5 6 9 / 0.84));
        }
        /* on-art type: literal near-white, never zinc (theme-flipped) */
        .shpf-onart-name {
          color: rgb(244 244 245);
          font-size: 17px;
        }
        @media (min-width: 768px) {
          .shpf-onart-name {
            font-size: calc(17px / 0.9);
          }
        }
        .shpf-onart-rarity {
          color: rgb(255 255 255 / 0.62);
        }

        /* rail: no scrollbar on the phone snap scroller */
        .shpf-rail {
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .shpf-rail::-webkit-scrollbar {
          display: none;
        }
        .shpf-indicator {
          will-change: transform;
        }

        /* thumbs: the micro row sharpens to ink when active or hovered
           (fine pointer only) — colour only, no lift, no shadow */
        .shpf-thumb-row {
          transition: color 160ms ${CSS_EASE.out};
        }
        .shpf-thumb[data-active] .shpf-thumb-row {
          color: var(--shop-ink);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpf-thumb:hover .shpf-thumb-row {
            color: var(--shop-ink);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shpf-thumb-row {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpf-thumb-row {
          transition: none;
        }
      `}</style>
    </div>
  )
}

/* ================= rail thumb ================= */

function RailThumb({
  plate,
  index,
  active,
  onSelect,
  register
}: {
  plate: PlateDef
  index: number
  active: boolean
  onSelect: (plateId: string) => void
  register: (index: number, el: HTMLButtonElement | null) => void
}) {
  // `shop-thumb` already freezes the scene; data-offstage keeps the thumb
  // in the page's shared stage budget like every card.
  const ref = useRef<HTMLButtonElement | null>(null)
  useOnStage(ref)
  const setRef = (el: HTMLButtonElement | null) => {
    ref.current = el
    register(index, el)
  }

  return (
    <button
      ref={setRef}
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      data-offstage=""
      data-active={active ? '' : undefined}
      onClick={() => onSelect(plate.id)}
      className={`shpf-thumb shop-thumb shop-brackets relative flex w-[64vw] shrink-0 snap-start flex-col gap-2 p-3 text-left md:w-auto ${PAPER_BG} ${FOCUS}`}
    >
      <span className={`shpf-thumb-row flex items-baseline justify-between gap-2 ${MICRO} ${MUTE}`}>
        <span className="min-w-0 truncate">
          /{plateIndex(plate.id)} <span className="ml-1">{plate.name}</span>
        </span>
        <span className="shrink-0" style={{ color: rarityColor(plate.rarity) }}>
          {PLATE_RARITY_META[plate.rarity].label}
        </span>
      </span>
      <PlatePreview plateId={plate.id} />
    </button>
  )
}
