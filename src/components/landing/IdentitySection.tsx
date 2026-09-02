'use client'

// Sheet 03 — IDENTITY. The pilot trading card (the same anatomy as the
// in-app PlayerCard: plate banner, callsign, flight record, medal rack)
// with live-swappable nameplates from the real cosmetics catalog, drawn as
// one more compartment of the manifest: a 1px --lx-line-strong frame,
// hairline rows, 10px tracked Plex Mono labels, the plate art the only
// paint. Two instruments keep it alive:
//
//  · Pointer tilt — the one pointer-driven transform on the page. --rx/--ry
//    are written through gsap.quickSetter (GSAP's cheapest write path),
//    clamped to ±TILT_MAX_DEG, and released to 0 through an anime spring
//    on pointer leave; perspective lives on the card's own wrapper only.
//    No glare, no idle bob, no depth layers, no shadow.
//  · Plate swap — the incoming plate mounts over the outgoing one and
//    fades in (opacity only, SWAP_MS on the site curve); the outgoing layer
//    unmounts when the fade completes. The rack auto-cycles on an anime
//    timer (useSectionMotion) until the visitor taps a plate.
//
// Everything animated on entrance is `.st` + inline `--d`, so the Sheet's
// Stage reveal owns the choreography and SSR/no-JS/still render the final
// state. Colours are the --lx-* role tokens only; light mode is the hero's
// white sheet re-pin, nothing here overrides it.

import {
  CSSProperties,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import type { JSAnimation } from 'animejs'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { getPlate, PLATE_RARITY_META } from '@/lib/cosmetics/plates'
import { CRIBBLE_EASE } from '@/lib/landingMotion'
import { prefersReducedMotion } from '@/lib/motion'
import { SHOWCASE_PLATES } from './data'
import {
  Sheet,
  SHEET_DIM,
  SHEET_INK,
  SHEET_LABEL,
  SHEET_LINE,
  type SheetSpec
} from './Sheet'
import { useSectionMotion, type SectionMotionHandle } from './useSectionMotion'

/* The demo card is the founder's real profile — same numbers the arena sim
   above puts him at, so the two sheets corroborate each other. */
const CARD_STATS = [
  { label: 'RANK', value: '#1' },
  { label: 'SCORE', value: '929,369' },
  { label: 'STREAK', value: '92D' },
  { label: 'FOCUS', value: '369H' }
] as const

const CARD_BADGES = [
  { icon: 'rocket', rarity: 'rare', name: 'ESCAPE VELOCITY' },
  { icon: 'starfield', rarity: 'epic', name: 'DEEP SPACE' },
  { icon: 'wings', rarity: 'epic', name: 'SQUADRON LEADER' },
  { icon: 'crown', rarity: 'legendary', name: 'APEX' }
] as const

const SPECS: SheetSpec[] = [
  { label: 'CARD', value: 'BANNER · CALLSIGN · FLIGHT RECORD · MEDALS' },
  { label: 'PLATES', value: 'FROM THE SHOP, OR EARNED' },
  { label: 'SHOWN', value: '@BIRDABO · P1 · SOMEBODY DO SOMETHING' }
]

/** Tilt ceiling on both axes — enough to read as a held card, not a flip. */
const TILT_MAX_DEG = 5
/** Plate crossfade length. */
const SWAP_MS = 240
/** Auto-cycle beat between plates while nobody has taken the wheel. */
const CYCLE_MS = 3600

// Entrance stagger (ms, read by runStageEntrance via --d): the card lands
// after the Sheet's rail cells, the rack rows follow 50ms apart, the
// caption last.
const CARD_MS = 120
const RACK_START_MS = 200
const RACK_STEP_MS = 50
const CAPTION_MS = RACK_START_MS + RACK_STEP_MS * SHOWCASE_PLATES.length

const at = (ms: number): CSSProperties => ({ '--d': `${ms}ms` } as CSSProperties)

/** Widest the card + rack column gets inside the artifact compartment. */
const COLUMN = 'w-full max-w-[440px]'
/** A card row: hairline on top, label register, LABEL left / VALUE right. */
const CARD_ROW = `flex items-center justify-between gap-4 border-t ${SHEET_LINE} px-4 py-2.5 ${SHEET_LABEL}`

const [EASE_X1, EASE_Y1, EASE_X2, EASE_Y2] = CRIBBLE_EASE.split(',').map(Number)

const clampTilt = (deg: number) =>
  Math.max(-TILT_MAX_DEG, Math.min(TILT_MAX_DEG, deg))

type TiltSetters = {
  rx: (v: number) => void
  ry: (v: number) => void
}

/* ------------------------------------------------------------------ */
/* PilotCard                                                           */
/* ------------------------------------------------------------------ */

function PilotCard({
  plateId,
  motionRef
}: {
  plateId: string
  motionRef: MutableRefObject<SectionMotionHandle | null>
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const settersRef = useRef<TiltSetters | null>(null)
  const releaseAnim = useRef<JSAnimation | null>(null)
  const swapAnim = useRef<JSAnimation | null>(null)
  const overRef = useRef<HTMLDivElement | null>(null)
  const prevPlate = useRef(plateId)
  // The outgoing plate, kept painted beneath the incoming one for the
  // length of the crossfade; null once the fade lands (or without motion).
  const [under, setUnder] = useState<string | null>(null)

  const onMove = (e: ReactPointerEvent) => {
    const el = cardRef.current
    if (!el || prefersReducedMotion()) return
    // The pointer takes the wheel back from a mid-flight release spring.
    releaseAnim.current?.cancel()
    releaseAnim.current = null
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    const rx = clampTilt((0.5 - py) * 2 * TILT_MAX_DEG)
    const ry = clampTilt((px - 0.5) * 2 * TILT_MAX_DEG)
    // gsap.quickSetter on the custom properties — GSAP's cheapest write
    // path, riding its own render batching instead of a hand-rolled rAF.
    // Built lazily once the runtime handle exists; before that (chunk
    // still loading) plain writes keep the tilt working — pointer events
    // are already delivered at frame rate, so there is nothing to batch.
    const m = motionRef.current
    if (m && !settersRef.current) {
      const { gsap } = m.motion
      settersRef.current = {
        rx: gsap.quickSetter(el, '--rx', 'deg') as TiltSetters['rx'],
        ry: gsap.quickSetter(el, '--ry', 'deg') as TiltSetters['ry']
      }
    }
    const setters = settersRef.current
    if (setters) {
      setters.rx(rx)
      setters.ry(ry)
    } else {
      el.style.setProperty('--rx', `${rx}deg`)
      el.style.setProperty('--ry', `${ry}deg`)
    }
  }

  const onLeave = () => {
    const el = cardRef.current
    if (!el) return
    const m = motionRef.current
    // Spring the tilt back to rest instead of snapping. The inline-var
    // check skips pointers that never tilted (e.g. a touch tap); no handle
    // (chunk pending, reduced motion) keeps the instant reset.
    if (m && el.style.getPropertyValue('--rx') !== '') {
      releaseAnim.current = m.motion.animate(el, {
        '--rx': '0deg',
        '--ry': '0deg',
        ease: m.motion.spring({ stiffness: 170, damping: 13 })
      })
    } else {
      el.style.setProperty('--rx', '0deg')
      el.style.setProperty('--ry', '0deg')
    }
  }

  // Plate swap: the keyed incoming layer is a fresh element by the time
  // this layout effect runs, so anime renders its opacity 0 before paint
  // while the outgoing plate is still painted beneath it — then the fade.
  // No handle (chunk pending) or reduced motion: a hard cut, no under layer.
  useLayoutEffect(() => {
    if (prevPlate.current === plateId) return
    const outgoing = prevPlate.current
    prevPlate.current = plateId
    swapAnim.current?.cancel()
    swapAnim.current = null
    const m = motionRef.current
    const el = overRef.current
    if (!m || !el || prefersReducedMotion()) {
      setUnder(null)
      return
    }
    setUnder(outgoing)
    swapAnim.current = m.motion.animate(el, {
      opacity: [0, 1],
      duration: SWAP_MS,
      ease: m.motion.cubicBezier(EASE_X1, EASE_Y1, EASE_X2, EASE_Y2),
      onComplete: () => {
        swapAnim.current = null
        setUnder(null)
      }
    })
  }, [plateId, motionRef])

  useEffect(
    () => () => {
      releaseAnim.current?.cancel()
      swapAnim.current?.cancel()
    },
    []
  )

  const plate = getPlate(plateId)

  return (
    // Perspective on the card's own wrapper only — the tilt's one 3D root.
    <div className={`st ${COLUMN}`} style={{ perspective: '1200px', ...at(CARD_MS) }}>
      <div
        ref={cardRef}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="relative will-change-transform"
        style={{
          transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
          border: '1px solid var(--lx-line-strong)'
        }}
      >
        {/* banner — the equipped plate, full bleed inside its box */}
        <div className="relative h-[118px] overflow-hidden">
          {under ? (
            <div key={under} aria-hidden className="absolute inset-0">
              <PlateLayer plateId={under} fade="none" />
            </div>
          ) : null}
          <div key={plateId} ref={overRef} className="absolute inset-0">
            <PlateLayer plateId={plateId} fade="none" />
          </div>
        </div>

        <div className={CARD_ROW}>
          <span className={SHEET_DIM}>PLATE</span>
          <span className={`truncate ${SHEET_INK}`}>
            {plate?.name.toUpperCase() ?? '—'}
          </span>
        </div>

        {/* identity — avatar, callsign, handle; the pip is the online state */}
        <div className={`flex items-center gap-3 border-t ${SHEET_LINE} px-4 py-3`}>
          <span
            className="block h-10 w-10 shrink-0 overflow-hidden border"
            style={{ borderColor: 'var(--lx-line-strong)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/avatars/birdabo.jpg"
              alt=""
              width={40}
              height={40}
              className="h-full w-full object-cover"
            />
          </span>
          <span className="flex min-w-0 flex-col gap-1.5">
            <span
              className={`flex items-center gap-2 font-data text-[12px] font-semibold tracking-[0.2em] ${SHEET_INK}`}
            >
              BIRDABO
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0"
                style={{ background: 'var(--lx-signal)' }}
              />
              <span className="sr-only">online</span>
            </span>
            <span className={`${SHEET_LABEL} ${SHEET_DIM}`}>@BIRDABO</span>
          </span>
        </div>

        {/* flight record — four cells, each owning its left hairline */}
        <div className={`grid grid-cols-4 border-t ${SHEET_LINE}`}>
          {CARD_STATS.map((s, i) => (
            <div
              key={s.label}
              className={`flex flex-col gap-1.5 px-3 py-3 sm:px-4 ${
                i === 0 ? '' : `border-l ${SHEET_LINE}`
              }`}
            >
              <span className={`${SHEET_LABEL} ${SHEET_DIM}`}>{s.label}</span>
              <span className={`font-data text-[12px] leading-none tabular-nums ${SHEET_INK}`}>
                {s.value}
              </span>
            </div>
          ))}
        </div>

        {/* service record */}
        <div className={CARD_ROW}>
          <span className={SHEET_DIM}>ROLE</span>
          <span className={SHEET_INK}>FOUNDER</span>
        </div>
        <div className={CARD_ROW}>
          <span className={SHEET_DIM}>EST.</span>
          <span className={SHEET_INK}>2026 · SEASON 01</span>
        </div>

        {/* medal rack */}
        <div className={CARD_ROW}>
          <span className={SHEET_DIM}>MEDALS</span>
          <span className="flex items-center gap-1.5">
            {CARD_BADGES.map((b) => (
              <span
                key={b.name}
                title={b.name}
                className={`flex h-7 w-7 items-center justify-center border ${SHEET_LINE}`}
              >
                <PixelIcon name={b.icon} size={14} />
                <span className="sr-only">{b.name}</span>
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Artifact — card + plate rack, inside the Sheet's Stage               */
/* ------------------------------------------------------------------ */

/** Rendered as the Sheet's artifact so useSectionMotion hears the Stage
 *  go live (it reads Stage context — outside the Sheet it never would). */
function IdentityArtifact() {
  const [plateId, setPlateId] = useState<string>(SHOWCASE_PLATES[0])
  const [autoCycle, setAutoCycle] = useState(true)

  // Plate auto-cycle on the shared engine tick; the handle also powers the
  // card's tilt release spring and plate crossfade.
  const motionRef = useSectionMotion(
    'identity',
    ({ timer }) => {
      if (!autoCycle) return
      timer({
        duration: CYCLE_MS,
        loop: true,
        onLoop: () => {
          setPlateId((prev) => {
            const i = SHOWCASE_PLATES.indexOf(prev as (typeof SHOWCASE_PLATES)[number])
            return SHOWCASE_PLATES[(i + 1) % SHOWCASE_PLATES.length]
          })
        }
      })
    },
    [autoCycle]
  )

  return (
    <div className="flex flex-col gap-[var(--rhythm-3)]">
      <PilotCard plateId={plateId} motionRef={motionRef} />

      {/* plate rack — hairline rows: index · swatch · NAME · RARITY */}
      <div className={COLUMN}>
        <div role="group" aria-label="Plates">
          {SHOWCASE_PLATES.map((id, i) => {
            const plate = getPlate(id)
            if (!plate) return null
            const selected = id === plateId
            const rarity = PLATE_RARITY_META[plate.rarity]
            const last = i === SHOWCASE_PLATES.length - 1
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setAutoCycle(false)
                  setPlateId(id)
                }}
                className={`st flex w-full items-center gap-3 border-t ${SHEET_LINE} px-3 py-2.5 text-left transition-colors hover:bg-[color:rgb(var(--z900)/0.55)] sm:gap-4 ${
                  last ? 'border-b' : ''
                } ${SHEET_LABEL}`}
                style={at(RACK_START_MS + RACK_STEP_MS * i)}
              >
                {/* the selection square — a transparent slot when idle so
                    the indices never shift */}
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0"
                  style={{ background: selected ? 'var(--lx-signal)' : 'transparent' }}
                />
                <span className={`w-5 shrink-0 ${SHEET_DIM}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span aria-hidden className="relative h-4 w-7 shrink-0 overflow-hidden">
                  <PlateLayer plateId={id} fade="none" />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    selected ? 'text-[color:var(--lx-signal)]' : SHEET_INK
                  }`}
                >
                  {plate.name.toUpperCase()}
                </span>
                <span className={`shrink-0 text-right ${SHEET_DIM}`}>
                  {plate.priceUsd ? rarity.label : 'EARNED'}
                </span>
              </button>
            )
          })}
        </div>

        <p
          className={`st mt-[var(--rhythm-2)] ${SHEET_LABEL} text-[color:var(--lx-ink-faint)]`}
          style={at(CAPTION_MS)}
        >
          TAP A PLATE · THE CARD RE-SKINS LIVE
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sheet 03                                                            */
/* ------------------------------------------------------------------ */

export function IdentitySection() {
  return (
    <Sheet
      id="identity"
      index="03"
      label="IDENTITY"
      datum={
        <>
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0"
            style={{ background: 'var(--lx-signal)' }}
          />
          <span>CATALOG LIVE</span>
        </>
      }
      hook={
        <>
          your grind, pressed into a <em>trading card</em>.
        </>
      }
      specs={SPECS}
      artifact={<IdentityArtifact />}
      artifactSide="right"
    />
  )
}
