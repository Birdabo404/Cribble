'use client'

import { useEffect, useRef, useState } from 'react'

interface GlobeProps {
  className?: string
  size?: number
}

export default function Globe({ className = '', size = 400 }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<any>(null)
  const [createGlobe, setCreateGlobe] = useState<any>(null)

  useEffect(() => {
    // Dynamically import COBE only on client side
    import('cobe').then((module) => {
      setCreateGlobe(() => module.default)
    }).catch((error) => {
      console.error('Failed to load COBE:', error)
    })
  }, [])

  useEffect(() => {
    if (!createGlobe || !canvasRef.current) return

    let phi = 0
    let width = 0
    const onResize = () => canvasRef.current && (width = canvasRef.current.offsetWidth)

    window.addEventListener('resize', onResize)
    onResize()

    try {
      globeRef.current = createGlobe(canvasRef.current, {
        devicePixelRatio: 2,
        width: size * 2,
        height: size * 2,
        phi: 0,
        theta: 0.3,
        dark: 1,
        diffuse: 0.4,
        mapSamples: 16000,
        mapBrightness: 1.2,
        baseColor: [1, 1, 1],
        markerColor: [0.008, 0.996, 0.004], // Hacker green #02fe01 for pulsing dots only
        glowColor: [1.2, 1.2, 1.2],
        markers: [
          // Major AI hubs around the world
          { location: [37.7749, -122.4194], size: 0.1 }, // San Francisco (OpenAI)
          { location: [47.6062, -122.3321], size: 0.08 }, // Seattle (Microsoft)
          { location: [40.7128, -74.0060], size: 0.07 }, // New York
          { location: [51.5074, -0.1278], size: 0.06 }, // London (DeepMind)
          { location: [48.8566, 2.3522], size: 0.05 }, // Paris (Mistral)
          { location: [35.6762, 139.6503], size: 0.05 }, // Tokyo
          { location: [22.3193, 114.1694], size: 0.04 }, // Hong Kong
          { location: [1.3521, 103.8198], size: 0.04 }, // Singapore
          { location: [-33.8688, 151.2093], size: 0.03 }, // Sydney
          { location: [52.5200, 13.4050], size: 0.03 }, // Berlin
        ],
        onRender: (state: any) => {
          state.phi = phi
          phi += 0.002 // Much slower rotation
          state.width = width * 2
          state.height = width * 2
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
  }, [createGlobe, size])

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          maxWidth: '100%',
          aspectRatio: '1',
        }}
        width={size * 2}
        height={size * 2}
        className="opacity-80 hover:opacity-100 transition-opacity duration-300"
      />
    </div>
  )
}
