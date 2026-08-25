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
  createStylizedEarthRenderer,
  type EarthRenderer,
  type PinScreenPosition,
  type RGB,
} from '@/components/stylizedEarthRenderer'
import { PILOTS } from '@/components/landing/pilots'
import { ACCENT, accentA } from '@/lib/theme'

/**
 * Imperative scroll-pose handle for the pinned hero entry. Calls are safe
 * at any lifecycle point: before the WebGL renderer has initialized the
 * value is remembered and applied on init, and after disposal calls are
 * no-ops.
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
const DARK_MARKER: RGB = [0.008, 0.996, 0.004]
const LIGHT_MARKER: RGB = [1, 0.37, 0]
// How long each pilot chip stays up before cycling to the next front pin.
const CHIP_CYCLE_MS = 4000

const mixRGB = (from: RGB, to: RGB, amount: number): RGB => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
]

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { className = '', size = 400, onReady }: GlobeProps,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
      if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
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
    let animationFrame = 0
    let disposed = false
    let onVisibilityChange: (() => void) | null = null
    let phi = 2.6
    let previousTime = performance.now()
    let liveLightMode = targetLightMode.current
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    setRenderStatus('loading')

    void createStylizedEarthRenderer(canvas)
      .then((createdRenderer) => {
        if (disposed) {
          createdRenderer.destroy()
          return
        }

        renderer = createdRenderer
        rendererRef.current = createdRenderer
        // replay whatever pose the scroll timeline set while we loaded
        createdRenderer.setScrollPose(scrollPoseRef.current)
        resizeObserver = new ResizeObserver(() => renderer?.resize())
        resizeObserver.observe(canvas)
        setRenderStatus('ready')

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

          renderer.render({
            phi: phi + rot.current,
            theta: 0.25,
            time: reduceMotion ? 0 : time / 1000,
            lightMode: liveLightMode,
            accent: mixRGB(DARK_MARKER, LIGHT_MARKER, liveLightMode),
          })

          // Project the pins and steer the pilot chip: it rides its pin
          // while the globe spins and hides when the pin swings behind.
          const positions = renderer.getPinScreenPositions()
          pinPositionsRef.current = positions
          const chip = chipRef.current
          if (chip) {
            const pin = positions[activePinRef.current]
            if (pin?.front) {
              chip.style.transform = `translate(${pin.x.toFixed(1)}px, ${pin.y.toFixed(1)}px)`
              chip.style.visibility = 'visible'
            } else {
              chip.style.visibility = 'hidden'
            }
          }

          animationFrame = window.requestAnimationFrame(draw)
        }

        animationFrame = window.requestAnimationFrame(draw)

        // Pause the render loop while the tab is hidden; resume (with a
        // fresh frame clock) when it becomes visible again.
        onVisibilityChange = () => {
          if (document.hidden) {
            window.cancelAnimationFrame(animationFrame)
          } else if (!disposed) {
            previousTime = performance.now()
            animationFrame = window.requestAnimationFrame(draw)
          }
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
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
    // from the pointer. Inert without ScrollSmoother.
    <div
      data-lag="0"
      className={`relative flex w-full items-center justify-center ${className}`}
      style={{ maxWidth: size }}
    >
      {renderStatus === 'fallback' && (
        <div
          aria-hidden
          className="absolute inset-[14%] rounded-full"
          style={{
            background:
              'radial-gradient(circle at 34% 28%, #4f9cc8 0%, #135b83 25%, #07345e 55%, #03162d 76%, #010812 100%)',
            boxShadow:
              '0 0 3px #9ed8ff, 0 0 18px rgb(70 150 255 / 0.75), 0 0 44px rgb(35 110 255 / 0.32)',
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        aria-label="A stylized rotating Earth showing Cribble users worldwide"
        role="img"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          grabX.current = e.clientX
          rotAtGrab.current = rot.current
          targetRot.current = rot.current
          vel.current = 0
          if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
        }}
        style={{
          width: '100%',
          height: 'auto',
          aspectRatio: '1',
          cursor: 'grab',
          touchAction: 'pan-y',
        }}
        width={size * 2}
        height={size * 2}
        className={`relative transition-opacity duration-700 ${
          renderStatus === 'ready' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Cycling pilot chip — anchored to the projected pin position. The
          outer node is steered per-frame by the render loop; the keyed
          remount replays the enter animation on every pilot change. */}
      {renderStatus === 'ready' && activePilot && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
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
