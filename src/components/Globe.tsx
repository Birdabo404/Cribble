'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useTheme } from 'next-themes'
import {
  CANVAS_BLEED,
  createDitherEarthRenderer,
  type EarthRenderer,
  type PinScreenPosition,
  type RGB,
} from '@/components/ditherEarthRenderer'
import { PILOTS } from '@/components/landing/pilots'
import { ACCENT, accentA } from '@/lib/theme'

/**
 * Imperative handle for the pinned hero entry's scroll-pose scrub. Calls
 * are safe at any lifecycle point: before the WebGL renderer has
 * initialized the value is remembered and replayed on init, and after
 * disposal calls are no-ops.
 */
export interface GlobeHandle {
  /** 0 = resting orbit (exactly today's look), 1 = full hero push-in. */
  setScrollPose: (p: number) => void
}

interface GlobeProps {
  className?: string
  size?: number
  /**
   * Delivers the GlobeHandle on mount. next/dynamic does not forward
   * refs, so parents that load Globe through dynamic() (page.tsx does)
   * must use this callback instead of `ref`; both hand out the same
   * stable handle object.
   */
  onReady?: (handle: GlobeHandle) => void
}

type RenderStatus = 'loading' | 'ready' | 'fallback'

const AUTO_SPIN_SPEED = 0.00012
const DRAG_SENSITIVITY = 1 / 140
const DRAG_FOLLOW = 0.3
const INERTIA_DAMPING = 0.94
const MAX_FLING = 0.22
const THEME_LERP = 0.055
const DARK_MARKER: RGB = [0.8, 1, 0] // lime #ccff00 — the hero accent
const LIGHT_MARKER: RGB = [1, 0.37, 0]
// How long each pilot chip stays up before cycling to the next front pin.
const CHIP_CYCLE_MS = 4000
// The canvas bleeds CANVAS_BLEED× past the square globe footprint (the
// component's layout box) as room for the scroll push-in zoom and the
// halftone corona — the renderer scales its frustum by the same factor,
// so the resting globe renders pixel-identical to a footprint-sized canvas.
// Negative offsets keep the bleed out of layout. The canvas MUST carry an
// explicit CSS size: a replaced element with `inset` alone falls back to
// its intrinsic (attribute) size, and since resize() writes the attributes
// from clientWidth × DPR, the ResizeObserver would feed that back into the
// element size — a ×DPR runaway that flings the globe off-screen.
const BLEED_INSET = `${((1 - CANVAS_BLEED) / 2) * 100}%`
const BLEED_SIZE = `${CANVAS_BLEED * 100}%`

// In-place mix: the draw loop needs an accent tuple every frame, and
// returning a fresh array each time was steady GC litter (the renderer
// also latches on component equality, so a stable tuple lets an
// unchanged theme skip uniform uploads entirely).
const mixRGBInto = (out: RGB, from: RGB, to: RGB, amount: number): RGB => {
  out[0] = from[0] + (to[0] - from[0]) * amount
  out[1] = from[1] + (to[1] - from[1]) * amount
  out[2] = from[2] + (to[2] - from[2]) * amount
  return out
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { className = '', size = 400, onReady }: GlobeProps,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Drag-to-spin STARTS on a dedicated circular hit element over the
  // planet disk: the bled canvas overlaps the hero copy column, so the
  // canvas itself is pointer-events: none and must never own pointerdown.
  const hitRef = useRef<HTMLDivElement>(null)
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('loading')
  const { resolvedTheme } = useTheme()
  const isLight = resolvedTheme === 'light'

  const grabX = useRef<number | null>(null)
  const rotAtGrab = useRef(0)
  const targetRot = useRef(0)
  const rot = useRef(0)
  const vel = useRef(0)
  const targetLightMode = useRef(isLight ? 1 : 0)

  // Scroll pose: deliberately NOT gated by prefers-reduced-motion. Like
  // drag-to-spin (which also stays enabled below), it only moves when the
  // user scrolls — scrubbed input, not autonomous animation. Reduced
  // motion keeps disabling exactly what it does today: the idle auto-spin
  // and the time-driven drift (time frozen at 0 in the draw loop).
  const rendererRef = useRef<EarthRenderer | null>(null)
  const scrollPoseRef = useRef(0)
  // One stable handle for the whole component lifetime, shared by the
  // forwarded ref and the onReady callback. It only stores/forwards a
  // number — the existing draw loop's render() call applies the pose, so
  // scrubbing it every scroll tick costs nothing extra.
  const handleRef = useRef<GlobeHandle>({
    setScrollPose: (p: number) => {
      scrollPoseRef.current = p
      rendererRef.current?.setScrollPose(p)
    },
  })

  useImperativeHandle(ref, () => handleRef.current, [])

  useEffect(() => {
    onReady?.(handleRef.current)
  }, [onReady])

  // Pilot chip state: the render loop projects pins each frame and steers
  // the chip node directly (no per-frame React state); React only re-renders
  // when the featured pilot changes (every CHIP_CYCLE_MS).
  const [activePin, setActivePin] = useState(-1)
  const activePinRef = useRef(-1)
  const pinPositionsRef = useRef<PinScreenPosition[]>([])
  const chipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (grabX.current === null) return
      targetRot.current =
        rotAtGrab.current + (e.clientX - grabX.current) * DRAG_SENSITIVITY
    }
    const endDrag = () => {
      if (grabX.current === null) return
      grabX.current = null
      if (hitRef.current) hitRef.current.style.cursor = 'grab'
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('blur', endDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('blur', endDrag)
    }
  }, [])

  useEffect(() => {
    targetLightMode.current = isLight ? 1 : 0
  }, [isLight])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: EarthRenderer | null = null
    let resizeObserver: ResizeObserver | null = null
    let intersectionObserver: IntersectionObserver | null = null
    let animationFrame = 0
    let disposed = false
    let onVisibilityChange: (() => void) | null = null
    let phi = 2.6
    let previousTime = performance.now()
    let liveLightMode = targetLightMode.current
    const liveAccent: RGB = [0, 0, 0]
    // Loop gates: the draw loop runs only while the tab is visible AND
    // the canvas is near the viewport (see setLoopRunning below).
    let pageVisible = !document.hidden
    let nearViewport = true
    let loopRunning = false
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    setRenderStatus('loading')

    void createDitherEarthRenderer(canvas)
      .then((createdRenderer) => {
        if (disposed) {
          createdRenderer.destroy()
          return
        }

        renderer = createdRenderer
        rendererRef.current = createdRenderer
        // replay whatever pose the timeline set while we loaded
        createdRenderer.setScrollPose(scrollPoseRef.current)
        resizeObserver = new ResizeObserver(() => renderer?.resize())
        resizeObserver.observe(canvas)
        setRenderStatus('ready')

        // Chip style latches: on most idle-spin frames the projected pin
        // moves less than the 0.1px quantum the transform is written at —
        // skip the style write (and its string mint) on those frames.
        let chipQX = Number.NaN
        let chipQY = Number.NaN
        let chipShown: boolean | null = null

        const draw = (time: number) => {
          if (!renderer || disposed) return

          const elapsed = Math.min(time - previousTime, 34)
          const frameScale = elapsed / (1000 / 60)
          previousTime = time

          if (grabX.current !== null) {
            const follow = 1 - Math.pow(1 - DRAG_FOLLOW, frameScale)
            const delta = (targetRot.current - rot.current) * follow
            rot.current += delta
            vel.current = Math.max(-MAX_FLING, Math.min(MAX_FLING, delta))
          } else {
            if (!reduceMotion) phi += AUTO_SPIN_SPEED * elapsed
            rot.current += vel.current * frameScale
            vel.current *= Math.pow(INERTIA_DAMPING, frameScale)
          }

          const themeFollow = 1 - Math.pow(1 - THEME_LERP, frameScale)
          liveLightMode +=
            (targetLightMode.current - liveLightMode) * themeFollow
          // Snap the asymptotic tail onto the target: without this, `day`
          // drifts in float dust for hundreds of frames after a theme
          // switch, and the renderer's theme latch (which skips all theme
          // uniform work while `day` holds still) never engages.
          if (Math.abs(targetLightMode.current - liveLightMode) < 0.001) {
            liveLightMode = targetLightMode.current
          }

          renderer.render({
            phi: phi + rot.current,
            theta: 0.25,
            time: reduceMotion ? 0 : time / 1000,
            lightMode: liveLightMode,
            accent: mixRGBInto(
              liveAccent,
              DARK_MARKER,
              LIGHT_MARKER,
              liveLightMode,
            ),
          })

          // Project the pins and steer the pilot chip: it rides its pin
          // while the globe spins and hides when the pin swings behind.
          const positions = renderer.getPinScreenPositions()
          pinPositionsRef.current = positions
          const chip = chipRef.current
          if (chip) {
            const pin = positions[activePinRef.current]
            if (pin?.front) {
              const qx = Math.round(pin.x * 10)
              const qy = Math.round(pin.y * 10)
              if (qx !== chipQX || qy !== chipQY) {
                chipQX = qx
                chipQY = qy
                chip.style.transform = `translate(${qx / 10}px, ${qy / 10}px)`
              }
              if (chipShown !== true) {
                chipShown = true
                chip.style.visibility = 'visible'
              }
            } else if (chipShown !== false) {
              chipShown = false
              chip.style.visibility = 'hidden'
            }
          }

          if (loopRunning) animationFrame = window.requestAnimationFrame(draw)
        }

        // The loop runs only while the tab is visible AND the canvas is
        // near the viewport: once the hero pin releases and the descent
        // begins, no globe pixel is on screen, and a full WebGL render per
        // scrolled frame down there competes directly with the descent's
        // own scroll work. The observer margin resumes it a beat before
        // re-entry, and setScrollPose keeps absorbing writes while
        // parked, so the first resumed frame is already correct.
        const setLoopRunning = () => {
          const shouldRun = pageVisible && nearViewport && !disposed
          if (shouldRun && !loopRunning) {
            loopRunning = true
            previousTime = performance.now()
            animationFrame = window.requestAnimationFrame(draw)
          } else if (!shouldRun && loopRunning) {
            loopRunning = false
            window.cancelAnimationFrame(animationFrame)
          }
        }
        setLoopRunning()

        onVisibilityChange = () => {
          pageVisible = !document.hidden
          setLoopRunning()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        intersectionObserver = new IntersectionObserver(
          ([entry]) => {
            nearViewport = entry.isIntersecting
            setLoopRunning()
          },
          { rootMargin: '25% 0px 25% 0px' },
        )
        intersectionObserver.observe(canvas)
      })
      .catch(() => {
        if (disposed) return
        setRenderStatus('fallback')
      })

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      if (onVisibilityChange) {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      intersectionObserver?.disconnect()
      resizeObserver?.disconnect()
      renderer?.destroy()
      rendererRef.current = null // handle calls after disposal become no-ops
    }
  }, [size])

  // Cycle the featured pilot through whichever pins currently face the
  // camera. Reduced motion picks one pilot and keeps it (no cycling).
  useEffect(() => {
    if (renderStatus !== 'ready') return
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const advance = () => {
      const front = pinPositionsRef.current.filter((pin) => pin.front)
      if (!front.length) return
      const next =
        front.find((pin) => pin.index > activePinRef.current) ?? front[0]
      activePinRef.current = next.index
      setActivePin(next.index)
    }

    // Small delay so the first projected positions exist before picking.
    const firstPick = window.setTimeout(advance, 350)
    const cycle = reduceMotion
      ? 0
      : window.setInterval(advance, CHIP_CYCLE_MS)
    return () => {
      window.clearTimeout(firstPick)
      if (cycle) window.clearInterval(cycle)
    }
  }, [renderStatus])

  const activePilot = activePin >= 0 ? PILOTS[activePin] : null
  const chipInitial = pinPositionsRef.current[activePin]

  return (
    // data-lag="0" pins the globe (canvas + chip overlay) out of GSAP
    // ScrollSmoother's effects lag, so smoothing never desyncs the canvas
    // from the pointer. Inert without ScrollSmoother. aspect-square: the
    // canvas left the flow for its burst bleed, so the root must reserve
    // the square footprint itself.
    <div
      data-lag="0"
      className={`relative flex aspect-square w-full items-center justify-center ${className}`}
      style={{ maxWidth: size }}
    >
      {/* CSS fallback disc — flat token-colored plate + ring, in the same
          no-gradient language as the dithered renderer it stands in for. */}
      {renderStatus === 'fallback' && (
        <div
          aria-hidden
          className="absolute inset-[14%] rounded-full"
          style={{
            background: 'rgb(var(--star-rgb) / 0.07)',
            border: '1px solid rgb(var(--star-rgb) / 0.35)',
            outline: '1px dotted rgb(var(--star-rgb) / 0.18)',
            outlineOffset: '6px',
          }}
        />
      )}
      {/* Bled canvas (see BLEED_INSET): its overhang covers the hero copy
          column, so it must be pointer-events: none — clicks, selection
          and the CTA under it stay live, and the hit circle below owns
          the drag start instead. */}
      <canvas
        ref={canvasRef}
        aria-label="A dithered rotating Earth showing Cribble users worldwide"
        role="img"
        style={{
          position: 'absolute',
          left: BLEED_INSET,
          top: BLEED_INSET,
          width: BLEED_SIZE,
          height: BLEED_SIZE,
          pointerEvents: 'none',
        }}
        width={size * 2}
        height={size * 2}
        className={`transition-opacity duration-700 ${
          renderStatus === 'ready' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Drag hit surface — a circle over the planet disk (disk + hills
          reach ~76% of the footprint). pointermove/up live on window, so
          a drag that leaves the circle keeps spinning until release. */}
      <div
        ref={hitRef}
        aria-hidden
        className="absolute inset-[12%] rounded-full"
        style={{ cursor: 'grab', touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          grabX.current = e.clientX
          rotAtGrab.current = rot.current
          targetRot.current = rot.current
          vel.current = 0
          if (hitRef.current) hitRef.current.style.cursor = 'grabbing'
        }}
      />

      {/* Cycling pilot chip — anchored to the projected pin position. The
          outer node is steered per-frame by the render loop; the keyed
          remount replays the enter animation on every pilot change. The
          overlay shares the canvas's bleed insets so the canvas-relative
          pin coordinates map 1:1 with no offset math. */}
      {renderStatus === 'ready' && activePilot && (
        <div
          aria-hidden
          className="pointer-events-none absolute overflow-hidden"
          style={{ inset: BLEED_INSET }}
        >
          <div
            key={activePin}
            ref={chipRef}
            className="absolute left-0 top-0 will-change-transform"
            style={{
              transform: chipInitial
                ? `translate(${chipInitial.x.toFixed(1)}px, ${chipInitial.y.toFixed(1)}px)`
                : undefined,
              visibility: chipInitial?.front ? 'visible' : 'hidden',
            }}
          >
            <span className="globe-chip inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950/85 px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] text-zinc-300">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: ACCENT,
                  boxShadow: `0 0 8px ${accentA(0.69)}`,
                }}
              />
              @{activePilot.callsign} · {activePilot.city.toUpperCase()}
            </span>
          </div>

          <style jsx>{`
            .globe-chip {
              transform: translate(-50%, calc(-100% - 12px));
              animation: globe-chip-in 340ms cubic-bezier(0.22, 1, 0.36, 1)
                backwards;
            }
            @keyframes globe-chip-in {
              from {
                opacity: 0;
                transform: translate(-50%, calc(-100% - 4px));
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .globe-chip {
                animation: none;
              }
            }
          `}</style>
        </div>
      )}
    </div>
  )
})

export default Globe
