'use client'

// The Cribble hive mark, rendered as living liquid metal via
// @paper-design/shaders-react (https://shaders.paper.design/liquid-metal).
//
// Material: molten-orange chrome — hard stripes (softness 0), negative red
// dispersion, #ff4400 color-burn tint over the metal. Tuned in the paper
// playground; the hero carries it verbatim.
//
// Render ladder:
//   1. SSR / pre-mount / preprocessing → empty box (never the flat PNG — a
//      visible orange→metal swap reads as a glitch, an easing-in metal mark
//      does not; the box is sized so nothing shifts)
//   2. shader ready                    → canvas fades in
//   3. no WebGL2                       → static mark (probed up front: the
//      shader throws from an async init that error boundaries can't catch)
//
// `suspendWhenProcessingImage` routes every instance through one global
// cache keyed by image URL, so N marks on screen cost a single Poisson
// preprocessing pass.

import { Suspense, useEffect, useState, type CSSProperties } from 'react'
import { LiquidMetal } from '@paper-design/shaders-react'

export const CRIBBLE_MARK_SRC = '/brand/cribble-mark.png'

type LiquidMarkProps = {
  /** Square box edge — number of px or any CSS length (e.g. '0.85em'). */
  size?: number | string
  /** Shader animation speed; 0 freezes the metal. */
  speed?: number
  className?: string
  style?: CSSProperties
  /** Accessible name. Omit when the mark sits next to visible wordmark text. */
  title?: string
}

export function LiquidMark({
  size = 24,
  speed = 0.52,
  className = '',
  style,
  title
}: LiquidMarkProps) {
  const webgl2 = useWebGl2Support()

  return (
    <span
      className={`relative inline-block shrink-0 select-none ${className}`}
      style={{ width: size, height: size, ...style }}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      {webgl2 === false ? (
        <StaticMark />
      ) : webgl2 === true ? (
        <Suspense fallback={null}>
          <ShaderMark speed={speed} small={typeof size === 'number' && size <= 32} />
        </Suspense>
      ) : null}
    </span>
  )
}

function ShaderMark({ speed, small }: { speed: number; small: boolean }) {
  const reducedMotion = usePrefersReducedMotion()
  const shown = useFadeIn()

  // Small marks keep the same molten material but drop the chromatic
  // dispersion (at 20px it only reads as color fringing), soften the stripes
  // so the burn tint doesn't crush them into a dark blob, and render 4x
  // internally so the downscale stays crisp.
  const material = small
    ? { repetition: 1.92, softness: 0.45, shiftRed: 0, shiftBlue: 0 }
    : { repetition: 1.92, softness: 0, shiftRed: -0.38, shiftBlue: -0.1 }

  return (
    <LiquidMetal
      image={CRIBBLE_MARK_SRC}
      suspendWhenProcessingImage
      colorBack="#00000000"
      colorTint="#ff4400"
      {...material}
      distortion={0}
      contour={0.12}
      angle={90}
      fit="contain"
      scale={1}
      speed={reducedMotion ? 0 : speed}
      minPixelRatio={small ? 4 : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: shown ? 1 : 0,
        transition: 'opacity 480ms ease'
      }}
    />
  )
}

function StaticMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- decorative mark, sized by the wrapper
    <img
      src={CRIBBLE_MARK_SRC}
      alt=""
      draggable={false}
      className="absolute inset-0 h-full w-full"
    />
  )
}

// Probed once per session; `null` until the client mounts, which also keeps
// the server and first client render identical (both empty).
let webgl2Supported: boolean | null = null

function useWebGl2Support() {
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    if (webgl2Supported === null) {
      try {
        webgl2Supported = Boolean(
          document.createElement('canvas').getContext('webgl2')
        )
      } catch {
        webgl2Supported = false
      }
    }
    setSupported(webgl2Supported)
  }, [])
  return supported
}

// Mount → next frame → opacity 1, so the canvas eases in instead of popping.
function useFadeIn() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return shown
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}
