'use client'

import { useEffect, useState } from 'react'

type Star = {
  top: number
  left: number
  size: number
  duration: number
  delay: number
  tint: 'white' | 'emerald'
}

type AsteroidConfig = {
  top: number
  travelX: number
  travelY: number
  angle: number
  duration: number
  delay: number
}

/**
 * Shared space backdrop — pure black, two parallax star layers that drift
 * slowly downward so the page feels like a quiet cruise through space.
 * A single asteroid streak flies across at long intervals so only one is
 * ever visible at a time. Trajectory + delay randomized per mount.
 * Stars/asteroid are generated post-mount to avoid SSR/hydration mismatch.
 * Honors `prefers-reduced-motion` for asteroid and drift.
 */
export default function SpaceBackdrop() {
  const [farStars, setFarStars] = useState<Star[]>([])
  const [nearStars, setNearStars] = useState<Star[]>([])
  const [asteroid, setAsteroid] = useState<AsteroidConfig | null>(null)

  useEffect(() => {
    const gen = (count: number, sizeBoost = 0): Star[] => {
      const list: Star[] = []
      for (let i = 0; i < count; i++) {
        const sizeRoll = Math.random()
        list.push({
          top: Math.random() * 100,
          left: Math.random() * 100,
          size: (sizeRoll < 0.75 ? 1 : sizeRoll < 0.95 ? 1.5 : 2) + sizeBoost,
          duration: 2.5 + Math.random() * 4.5,
          delay: Math.random() * 6,
          tint: Math.random() < 0.92 ? 'white' : 'emerald'
        })
      }
      return list
    }
    setFarStars(gen(24, 0))
    setNearStars(gen(12, 0.5))

    // Randomize a single asteroid pass per mount so the trajectory feels alive
    // without ever showing two streaks at once.
    setAsteroid({
      top: 12 + Math.random() * 60,
      travelX: 115 + Math.random() * 15,
      travelY: -10 + Math.random() * 40,
      angle: 12 + Math.random() * 14,
      duration: 70 + Math.random() * 25,
      delay: 8 + Math.random() * 14
    })
  }, [])

  const renderStar = (s: Star, i: number, keyPrefix: string) => {
    const isWhite = s.tint === 'white'
    const glow = isWhite
      ? s.size >= 2.5
        ? '0 0 5px rgba(255,255,255,0.75), 0 0 12px rgba(255,255,255,0.28)'
        : s.size >= 2
        ? '0 0 4px rgba(255,255,255,0.7), 0 0 10px rgba(255,255,255,0.22)'
        : s.size >= 1.5
        ? '0 0 3px rgba(255,255,255,0.55)'
        : '0 0 2px rgba(255,255,255,0.4)'
      : '0 0 3px rgba(110,231,183,0.45)'
    return (
      <span
        key={`${keyPrefix}-${i}`}
        className="absolute rounded-full"
        style={{
          top: `${s.top}%`,
          left: `${s.left}%`,
          width: `${s.size}px`,
          height: `${s.size}px`,
          background: isWhite ? 'rgb(255,255,255)' : 'rgb(167,243,208)',
          opacity: 0.35,
          boxShadow: glow,
          animation: `cribble-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`
        }}
      />
    )
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden z-0"
    >
      {/* FAR LAYER — small, slow drift */}
      <div className="cribble-drift-far absolute inset-x-0 top-0 h-[200vh]">
        <div className="absolute inset-x-0 top-0 h-screen">
          {farStars.map((s, i) => renderStar(s, i, 'far-a'))}
        </div>
        <div className="absolute inset-x-0 top-[100vh] h-screen">
          {farStars.map((s, i) => renderStar(s, i, 'far-b'))}
        </div>
      </div>

      {/* NEAR LAYER — larger, faster drift for parallax depth */}
      <div className="cribble-drift-near absolute inset-x-0 top-0 h-[200vh]">
        <div className="absolute inset-x-0 top-0 h-screen">
          {nearStars.map((s, i) => renderStar(s, i, 'near-a'))}
        </div>
        <div className="absolute inset-x-0 top-[100vh] h-screen">
          {nearStars.map((s, i) => renderStar(s, i, 'near-b'))}
        </div>
      </div>

      {asteroid && (
        <span
          className="cribble-asteroid"
          style={{
            top: `${asteroid.top}%`,
            ['--ast-x' as string]: `${asteroid.travelX}vw`,
            ['--ast-y' as string]: `${asteroid.travelY}vh`,
            ['--ast-angle' as string]: `${asteroid.angle}deg`,
            animation: `cribble-streak ${asteroid.duration}s linear ${asteroid.delay}s infinite`,
            transform: `rotate(${asteroid.angle}deg)`
          }}
        />
      )}

      <style jsx global>{`
        @keyframes cribble-twinkle {
          0%,
          100% {
            opacity: 0.15;
            transform: scale(1);
          }
          50% {
            opacity: 0.95;
            transform: scale(1.25);
          }
        }

        @keyframes cribble-drift {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(0, -100vh, 0);
          }
        }

        .cribble-drift-far {
          animation: cribble-drift 320s linear infinite;
          will-change: transform;
        }
        .cribble-drift-near {
          animation: cribble-drift 200s linear infinite;
          will-change: transform;
        }

        .cribble-asteroid {
          position: absolute;
          width: 140px;
          height: 1px;
          left: -180px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(255, 255, 255, 0.6) 80%,
            rgba(255, 255, 255, 0.95) 100%
          );
          transform: rotate(20deg);
          opacity: 0;
          will-change: transform, opacity;
        }
        .cribble-asteroid::after {
          content: '';
          position: absolute;
          right: 0;
          top: -1.5px;
          width: 4px;
          height: 4px;
          background: #ffffff;
          border-radius: 9999px;
          box-shadow:
            0 0 8px rgba(255, 255, 255, 0.9),
            0 0 16px rgba(110, 231, 183, 0.7);
        }

        /* Single asteroid: idles for most of its long cycle, then flies
           across once. Only one streak is ever visible at a time. */
        @keyframes cribble-streak {
          0% {
            transform: translate(0, 0) rotate(var(--ast-angle, 18deg));
            opacity: 0;
          }
          95% {
            transform: translate(0, 0) rotate(var(--ast-angle, 18deg));
            opacity: 0;
          }
          96.5% {
            opacity: 1;
          }
          99% {
            opacity: 1;
          }
          100% {
            transform: translate(var(--ast-x, 120vw), var(--ast-y, 25vh))
              rotate(var(--ast-angle, 18deg));
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .cribble-asteroid,
          .cribble-drift-far,
          .cribble-drift-near {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
