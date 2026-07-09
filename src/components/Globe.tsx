'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'

interface GlobeProps {
  className?: string
  size?: number
}

// Major AI hubs around the world
export const AI_HUBS: { location: [number, number]; size: number }[] = [
  { location: [37.7749, -122.4194], size: 0.1 }, // San Francisco (OpenAI, Anthropic)
  { location: [47.6062, -122.3321], size: 0.08 }, // Seattle (Microsoft)
  { location: [40.7128, -74.006], size: 0.07 }, // New York
  { location: [51.5074, -0.1278], size: 0.06 }, // London (DeepMind)
  { location: [48.8566, 2.3522], size: 0.05 }, // Paris (Mistral)
  { location: [35.6762, 139.6503], size: 0.05 }, // Tokyo
  { location: [39.9042, 116.4074], size: 0.05 }, // Beijing (DeepSeek)
  { location: [12.9716, 77.5946], size: 0.05 }, // Bangalore
  { location: [22.3193, 114.1694], size: 0.04 }, // Hong Kong
  { location: [1.3521, 103.8198], size: 0.04 }, // Singapore
  { location: [37.5665, 126.978], size: 0.04 }, // Seoul
  { location: [43.6532, -79.3832], size: 0.04 }, // Toronto (Cohere)
  { location: [-33.8688, 151.2093], size: 0.03 }, // Sydney
  { location: [52.52, 13.405], size: 0.03 }, // Berlin
  { location: [32.0853, 34.7818], size: 0.03 }, // Tel Aviv
]

const AUTO_SPIN_SPEED = 0.002
const DRAG_SENSITIVITY = 1 / 140 // px of pointer travel per radian
const DRAG_FOLLOW = 0.3 // per-frame easing toward the pointer while dragging
const INERTIA_DAMPING = 0.94
const MAX_FLING = 0.22 // rad/frame cap so violent flicks don't spin wildly
const THEME_LERP = 0.055 // per-frame easing factor for theme transitions (~0.7s)

type RGB = [number, number, number]

interface GlobeTheme {
  dark: number
  diffuse: number
  mapBrightness: number
  baseColor: RGB
  markerColor: RGB
  glowColor: RGB
}

const themeFor = (light: boolean): GlobeTheme =>
  light
    ? {
        // Greyish sphere with darker dotted land, neon orange halo + markers
        dark: 0,
        diffuse: 0.55,
        mapBrightness: 7,
        baseColor: [0.62, 0.61, 0.63],
        markerColor: [1, 0.37, 0],
        glowColor: [1.15, 0.55, 0.2],
      }
    : {
        // Black sphere with white dotted land, whitish-blue halo, green markers
        dark: 1,
        diffuse: 0.6,
        mapBrightness: 1.6,
        baseColor: [1, 1, 1],
        markerColor: [0.008, 0.996, 0.004],
        glowColor: [0.55, 0.75, 1.15],
      }

const mix = (a: number, b: number) => a + (b - a) * THEME_LERP
const mixRGB = (a: RGB, b: RGB): RGB => [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]

export default function Globe({ className = '', size = 400 }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<any>(null)
  const [createGlobe, setCreateGlobe] = useState<any>(null)
  const [ready, setReady] = useState(false)
  const { resolvedTheme } = useTheme()
  const isLight = resolvedTheme === 'light'

  // Drag-to-spin state lives in refs so onRender reads live values
  // without recreating the globe on every pointer move.
  const grabX = useRef<number | null>(null)
  const rotAtGrab = useRef(0)
  const targetRot = useRef(0) // where the pointer wants the globe to be
  const rot = useRef(0) // eased actual rotation
  const vel = useRef(0)

  // Track the pointer on window, not the canvas: pointer capture can drop
  // events once the cursor leaves the canvas, which used to freeze the drag
  // and leave the globe "held" until the next hover. Window listeners always
  // see the move/up, wherever the release happens.
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

  // Theme colors are eased toward `target` every frame inside onRender,
  // so toggling modes cross-fades the globe instead of recreating it.
  const targetTheme = useRef<GlobeTheme>(themeFor(isLight))
  const liveTheme = useRef<GlobeTheme>(themeFor(isLight))

  useEffect(() => {
    targetTheme.current = themeFor(isLight)
  }, [isLight])

  useEffect(() => {
    // Dynamically import COBE only on client side
    import('cobe')
      .then((module) => {
        setCreateGlobe(() => module.default)
      })
      .catch((error) => {
        console.error('Failed to load COBE:', error)
      })
  }, [])

  useEffect(() => {
    if (!createGlobe || !canvasRef.current) return

    // Start facing the Americas/Atlantic so land and markers are visible
    // immediately instead of open ocean.
    let phi = 2.6
    let width = 0
    let announcedReady = false
    const onResize = () => canvasRef.current && (width = canvasRef.current.offsetWidth)

    window.addEventListener('resize', onResize)
    onResize()

    // Snap to the current theme at creation; afterwards onRender eases
    // toward targetTheme whenever the user toggles modes.
    liveTheme.current = { ...targetTheme.current }
    const initial = liveTheme.current

    try {
      globeRef.current = createGlobe(canvasRef.current, {
        devicePixelRatio: 2,
        width: size * 2,
        height: size * 2,
        phi: 0,
        theta: 0.28,
        dark: initial.dark,
        diffuse: initial.diffuse,
        mapSamples: 20000,
        mapBrightness: initial.mapBrightness,
        baseColor: initial.baseColor,
        markerColor: initial.markerColor,
        glowColor: initial.glowColor,
        markers: AI_HUBS,
        onRender: (state: any) => {
          if (!announcedReady) {
            announcedReady = true
            setReady(true)
          }
          if (grabX.current !== null) {
            // Ease toward the pointer so the drag feels fluid, and record
            // the per-frame delta as velocity for the release fling.
            const delta = (targetRot.current - rot.current) * DRAG_FOLLOW
            rot.current += delta
            vel.current = Math.max(-MAX_FLING, Math.min(MAX_FLING, delta))
          } else {
            phi += AUTO_SPIN_SPEED
            rot.current += vel.current
            vel.current *= INERTIA_DAMPING
          }
          state.phi = phi + rot.current
          state.width = width * 2
          state.height = width * 2

          const live = liveTheme.current
          const tgt = targetTheme.current
          live.dark = mix(live.dark, tgt.dark)
          live.diffuse = mix(live.diffuse, tgt.diffuse)
          live.mapBrightness = mix(live.mapBrightness, tgt.mapBrightness)
          live.baseColor = mixRGB(live.baseColor, tgt.baseColor)
          live.markerColor = mixRGB(live.markerColor, tgt.markerColor)
          live.glowColor = mixRGB(live.glowColor, tgt.glowColor)
          state.dark = live.dark
          state.diffuse = live.diffuse
          state.mapBrightness = live.mapBrightness
          state.baseColor = live.baseColor
          state.markerColor = live.markerColor
          state.glowColor = live.glowColor
        },
      })
    } catch (error) {
      console.error('Error creating globe:', error)
    }

    return () => {
      try {
        if (globeRef.current) {
          globeRef.current.destroy()
        }
      } catch (error) {
        console.error('Error destroying globe:', error)
      }
      window.removeEventListener('resize', onResize)
    }
    // Theme changes are handled per-frame via targetTheme; recreating the
    // globe here would cause a visible pop instead of a smooth cross-fade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createGlobe, size])

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          grabX.current = e.clientX
          rotAtGrab.current = rot.current
          targetRot.current = rot.current
          vel.current = 0
          if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
        }}
        style={{
          width: size,
          height: size,
          maxWidth: '100%',
          aspectRatio: '1',
          cursor: 'grab',
          touchAction: 'pan-y', // horizontal drag spins, vertical still scrolls
        }}
        width={size * 2}
        height={size * 2}
        className={`transition-opacity duration-1000 ${
          ready ? 'opacity-90 hover:opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}
