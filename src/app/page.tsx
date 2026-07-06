'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import WorldwideText from '@/components/WorldwideText'
import { AuthStatusModal, AuthStatusPill } from '@/components/AuthStatus'

const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  loading: () => <div className="w-full h-full" />
})

type Status = 'idle' | 'submitting' | 'success' | 'error'

const HACKER_GREEN = '#02fe01'
const IS_PUBLIC_SITE_LOCKED = process.env.NEXT_PUBLIC_SITE_LOCKED === 'true'

export default function HomeV2() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showAuthStatus, setShowAuthStatus] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') return
    setStatus('submitting')
    setErrorMsg('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setErrorMsg(data?.error || 'Something went wrong')
        return
      }
      setStatus('success')
    } catch {
      setStatus('error')
      setErrorMsg('Network error. Try again.')
    }
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-mono selection:bg-[#02fe01]/20 flex flex-col relative overflow-hidden">
      {/* faint hacker-green wash on the right side — sits behind the globe */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 right-[-12%] h-[640px] w-[640px] rounded-full opacity-[0.12] blur-3xl"
        style={{
          background: `radial-gradient(circle, ${HACKER_GREEN}, transparent 70%)`
        }}
      />
      {/* thin horizon line — single retro accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-30"
        style={{
          background: `linear-gradient(90deg, transparent, ${HACKER_GREEN}55, transparent)`
        }}
      />
      {/* minimalist white asteroids — occasional fly-by */}
      <AsteroidField />

      <div className="relative z-10 max-w-6xl w-full mx-auto px-6 flex-1 flex flex-col">
        <Header />

        <main className="flex-1 flex items-center py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-16 items-center w-full">
            {/* LEFT — hero copy */}
            <div className="order-2 lg:order-1">
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-950 text-[10px] tracking-[0.3em] text-zinc-400">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: HACKER_GREEN,
                    boxShadow: `0 0 8px ${HACKER_GREEN}b0`
                  }}
                />
                PRIVATE BETA · INVITE-ONLY
              </span>

              <h1 className="mt-6 font-semibold tracking-tight leading-[1.02] text-zinc-50 text-5xl md:text-6xl lg:text-[5.25rem]">
                cribble.
              </h1>
              <div className="mt-4 text-3xl md:text-4xl lg:text-5xl font-normal leading-tight">
                <div className="text-zinc-400">ranking AI users,</div>
                <div className="worldwide-anchor mt-3 md:mt-4">
                  <WorldwideText />
                </div>
              </div>

              <p className="mt-7 max-w-md text-sm leading-relaxed text-zinc-400">
                The worldwide leaderboard for AI users. Tracks{' '}
                <span className="text-zinc-200">ChatGPT</span>,{' '}
                <span className="text-zinc-200">Claude</span>,{' '}
                <span className="text-zinc-200">Cursor</span>, and 30+ more.
                Build a streak. Climb the board. Or just lurk — the extension
                is silent.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                {!IS_PUBLIC_SITE_LOCKED ? (
                  <button
                    onClick={() => setShowAuthStatus(true)}
                    className="group inline-flex items-center gap-2.5 bg-white text-black text-sm font-medium px-5 py-2.5 rounded-md hover:bg-zinc-200 transition-colors"
                  >
                    <span>Register</span>
                    <span className="text-zinc-500 group-hover:translate-x-0.5 transition-transform">
                      →
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAuthStatus(true)}
                    className="inline-flex items-center gap-2 rounded-md border border-[#02fe01]/70 bg-[#02fe01]/10 px-4 py-2 text-xs tracking-[0.18em] text-[#02fe01] shadow-[0_0_18px_rgba(2,254,1,0.18)] transition-colors hover:bg-[#02fe01]/15"
                  >
                    SIGN IN
                  </button>
                )}

                {!showForm && status !== 'success' && (
                  <button
                    onClick={() => setShowForm(true)}
                    className="text-xs tracking-[0.2em] text-zinc-400 hover:text-[color:var(--hg)] transition-colors"
                    style={{ ['--hg' as string]: HACKER_GREEN }}
                  >
                    join the waitlist →
                  </button>
                )}
              </div>

              <div className="mt-4">
                <AuthStatusPill onClick={() => setShowAuthStatus(true)} />
              </div>

              {/* Waitlist form (inline reveal) */}
              {showForm && status !== 'success' && (
                <form onSubmit={submit} className="mt-5 max-w-md" noValidate>
                  <div
                    className="flex items-stretch border rounded-md bg-zinc-950/80 overflow-hidden transition-colors"
                    style={{ borderColor: '#27272a' }}
                  >
                    <span className="pl-3 pr-1 flex items-center text-zinc-600 text-xs select-none">
                      ▸
                    </span>
                    <input
                      type="email"
                      required
                      autoFocus
                      placeholder="you@somewhere.dev"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        if (status === 'error') setStatus('idle')
                      }}
                      className="flex-1 bg-transparent px-2 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={status === 'submitting' || !email}
                      className="text-[11px] tracking-[0.2em] px-4 border-l border-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      style={{
                        color: HACKER_GREEN,
                        background: 'rgba(2,254,1,0.10)'
                      }}
                    >
                      {status === 'submitting' ? 'SENDING…' : 'JOIN'}
                    </button>
                  </div>
                  {status === 'error' && (
                    <p className="mt-2 text-[11px] text-rose-300">{errorMsg}</p>
                  )}
                  {status === 'idle' && (
                    <p className="mt-2 text-[10px] tracking-wider text-zinc-600">
                      No spam. One email when the gates open.
                    </p>
                  )}
                </form>
              )}

              {status === 'success' && (
                <div
                  className="mt-6 max-w-md rounded-md border px-4 py-3 text-xs"
                  style={{
                    borderColor: `${HACKER_GREEN}55`,
                    background: `${HACKER_GREEN}0d`,
                    color: HACKER_GREEN
                  }}
                >
                  <span className="tracking-[0.2em]">▸ ON THE LIST.</span>{' '}
                  <span className="text-zinc-300">
                    We&apos;ll ping {email} when your slot opens.
                  </span>
                </div>
              )}
            </div>

            {/* RIGHT — globe */}
            <div className="order-1 lg:order-2">
              <GlobeStage />
            </div>
          </div>
        </main>

        <Footer />
      </div>

      {showAuthStatus && (
        <AuthStatusModal
          onClose={() => setShowAuthStatus(false)}
          onJoinWaitlist={() => {
            setShowAuthStatus(false)
            setShowForm(true)
          }}
        />
      )}
    </div>
  )
}

function Header() {
  return (
    <header className="pt-8 flex items-center justify-between">
      <div className="text-sm tracking-[0.4em] text-zinc-100 font-semibold">
        CRIBBLE
        <span style={{ color: HACKER_GREEN }}>.</span>
      </div>
      <nav className="flex items-center gap-1">
        <a
          href="https://twitter.com/cribbledotdev"
          target="_blank"
          rel="noreferrer"
          aria-label="Twitter"
          className="p-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <TwitterMark />
        </a>
        <a
          href="https://github.com/Birdabo404/Cribble"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="p-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <GithubMark />
        </a>
      </nav>
    </header>
  )
}

function Footer() {
  return (
    <footer className="pb-6 pt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[10px] tracking-[0.3em] text-zinc-600">
      <span>CRIBBLE · 2025</span>

      <a
        href="https://cursor.com"
        target="_blank"
        rel="noreferrer"
        aria-label="Powered by Cursor"
        className="inline-flex items-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors"
      >
        <span>POWERED BY</span>
        <CursorMark />
        <span className="tracking-[0.25em]">CURSOR</span>
      </a>

      <span style={{ color: `${HACKER_GREEN}99` }}>
        {'// backed by no one'}
      </span>
    </footer>
  )
}

function CursorMark({ size = 11 }: { size?: number }) {
  // Cursor's tri-facet geometric mark, monochrome via currentColor.
  return (
    <svg
      width={size}
      height={Math.round(size * (25 / 22))}
      viewBox="0 0 22 25"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M22 6.245 11 0 0 6.245v12.5L11 25l11-6.255V6.245Z"
        fill="currentColor"
        fillOpacity="0.22"
      />
      <path
        d="M11 0 0 6.245 11 12.491l11-6.246L11 0Z"
        fill="currentColor"
        fillOpacity="0.55"
      />
      <path
        d="M11 12.491V25l11-6.255V6.245L11 12.491Z"
        fill="currentColor"
      />
    </svg>
  )
}

function GlobeStage() {
  // The orbit ring + satellite share these dimensions so the satellite
  // always traces exactly the visible dashed circle.
  const ORBIT_SIZE = 'min(470px, 92vw)'

  return (
    <div className="relative w-full flex items-center justify-center">
      {/* outer thin orbit ring */}
      <div
        aria-hidden
        className="absolute inset-0 m-auto rounded-full pointer-events-none"
        style={{
          width: ORBIT_SIZE,
          height: ORBIT_SIZE,
          border: '1px dashed rgba(255,255,255,0.06)'
        }}
      />

      {/* inner glow */}
      <div
        aria-hidden
        className="absolute inset-0 m-auto rounded-full blur-3xl opacity-30 pointer-events-none"
        style={{
          width: 'min(360px, 80vw)',
          height: 'min(360px, 80vw)',
          background: `radial-gradient(circle, ${HACKER_GREEN}26, transparent 70%)`
        }}
      />

      {/* SATELLITE — sits on the top of the orbit ring; wrapper rotates */}
      <div
        aria-hidden
        className="cribble-satellite absolute inset-0 m-auto pointer-events-none"
        style={{
          width: ORBIT_SIZE,
          height: ORBIT_SIZE
        }}
      >
        {/* faint leading "spark" arc just ahead of the satellite */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-px w-10"
          style={{
            background:
              'linear-gradient(to right, transparent, rgba(255,255,255,0.45))',
            transform: 'translate(-50%, -50%) rotate(0deg) translateX(-12px)'
          }}
        />
        {/* satellite body */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-white"
          style={{
            boxShadow:
              '0 0 6px rgba(255,255,255,0.9), 0 0 14px rgba(255,255,255,0.35)'
          }}
        />
      </div>

      <div className="relative">
        <Globe size={400} />
      </div>

      {/* tiny corner annotation */}
      <div className="absolute bottom-2 right-2 text-[9px] tracking-[0.3em] text-zinc-700 pointer-events-none">
        {'// 10 ai hubs'}
      </div>

      <style jsx global>{`
        .cribble-satellite {
          transform-origin: 50% 50%;
          will-change: transform;
          animation: cribble-orbit 32s linear infinite;
        }
        @keyframes cribble-orbit {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cribble-satellite {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}

// Number of streaks that can be in flight at once. Each one re-launches on
// its own randomized schedule, so the sky never feels metronomic.
const ASTEROID_COUNT = 6

function AsteroidField() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia === 'undefined'
    )
      return

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    )
    if (reduceMotion.matches) return

    const streaks = Array.from(
      container.querySelectorAll<HTMLSpanElement>('.home-asteroid')
    )
    const timers = new Set<number>()
    const anims = new Set<Animation>()
    let disposed = false

    const rand = (min: number, max: number) => min + Math.random() * (max - min)

    const launch = (el: HTMLSpanElement) => {
      if (disposed) return
      const w = window.innerWidth
      const h = window.innerHeight
      const margin = 180

      // Travel direction: a shallow-to-medium diagonal, either way across the
      // screen. Head (bright end) leads, so rotation == travel angle.
      const goRight = Math.random() < 0.5
      const goDown = Math.random() < 0.62
      const tilt = rand(10, 42) * (Math.PI / 180)
      const ux = (goRight ? 1 : -1) * Math.cos(tilt)
      const uy = (goDown ? 1 : -1) * Math.sin(tilt)
      const rotDeg = (Math.atan2(uy, ux) * 180) / Math.PI

      // A single straight pass fully across the viewport (plus offscreen run-up
      // and run-out so it enters and exits cleanly).
      const dist = Math.hypot(w, h) + margin * 2
      const startX = goRight ? -margin : w + margin
      const bandY = goDown ? rand(-0.15 * h, 0.7 * h) : rand(0.3 * h, 1.05 * h)
      const startY = bandY
      const endX = startX + ux * dist
      const endY = startY + uy * dist

      // Physics: speed is randomized but always fast — a fly-by, never a drift.
      // Duration is derived from distance / speed so long paths still zip.
      const speed = rand(1250, 2850) // px per second
      const duration = (dist / speed) * 1000

      const from = `translate(${startX}px, ${startY}px) rotate(${rotDeg}deg)`
      const to = `translate(${endX}px, ${endY}px) rotate(${rotDeg}deg)`

      const anim = el.animate(
        [
          { transform: from, opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.06 },
          { opacity: 1, offset: 0.9 },
          { transform: to, opacity: 0, offset: 1 }
        ],
        { duration, easing: 'linear', fill: 'forwards' }
      )
      anims.add(anim)

      anim.onfinish = () => {
        anims.delete(anim)
        if (disposed) return
        // Idle gap before this streak flies again — this is what makes passes
        // occasional and de-synced, while each pass itself stays fast.
        const gap = rand(700, 4200)
        const t = window.setTimeout(() => launch(el), gap)
        timers.add(t)
      }
    }

    // Stagger the first launch of each streak so they don't all fire at once.
    streaks.forEach((el, i) => {
      const t = window.setTimeout(
        () => launch(el),
        rand(200, 1200) + i * rand(500, 1400)
      )
      timers.add(t)
    })

    return () => {
      disposed = true
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
      anims.forEach((a) => a.cancel())
      anims.clear()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden z-0"
    >
      {Array.from({ length: ASTEROID_COUNT }).map((_, i) => (
        <span key={i} className="home-asteroid" />
      ))}

      <style jsx global>{`
        /* Anchor the rotating WorldwideText to the left edge so the layout
           reads as a clean width change rather than a jiggling reflow. */
        .worldwide-anchor {
          display: inline-block;
          padding-bottom: 4px;
          line-height: 1.15;
        }

        .home-asteroid {
          position: absolute;
          top: 0;
          left: 0;
          width: 120px;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(255, 255, 255, 0.55) 80%,
            rgba(255, 255, 255, 0.92) 100%
          );
          opacity: 0;
          will-change: transform, opacity;
          transform-origin: right center;
        }
        .home-asteroid::after {
          content: '';
          position: absolute;
          right: 0;
          top: -1.5px;
          width: 4px;
          height: 4px;
          background: #ffffff;
          border-radius: 9999px;
          box-shadow: 0 0 6px rgba(255, 255, 255, 0.85);
        }

        @media (prefers-reduced-motion: reduce) {
          .home-asteroid {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}

function GithubMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5C5.73.5.92 5.31.92 11.58c0 4.88 3.16 9.01 7.55 10.47.55.1.75-.24.75-.53 0-.26-.01-.95-.02-1.86-3.07.67-3.72-1.48-3.72-1.48-.5-1.27-1.23-1.6-1.23-1.6-1-.69.08-.67.08-.67 1.11.08 1.7 1.14 1.7 1.14.99 1.69 2.6 1.2 3.23.92.1-.72.39-1.2.7-1.48-2.45-.28-5.03-1.23-5.03-5.48 0-1.21.43-2.2 1.14-2.97-.11-.28-.5-1.42.11-2.96 0 0 .93-.3 3.05 1.13a10.6 10.6 0 0 1 2.78-.37c.94 0 1.89.13 2.78.37 2.12-1.43 3.05-1.13 3.05-1.13.61 1.54.22 2.68.11 2.96.71.77 1.14 1.76 1.14 2.97 0 4.26-2.58 5.19-5.04 5.46.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.06 0 .29.2.64.76.53 4.38-1.46 7.54-5.59 7.54-10.47C23.08 5.31 18.27.5 12 .5Z" />
    </svg>
  )
}

function TwitterMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M18.244 2H21l-6.52 7.45L22 22h-6.835l-4.79-6.272L4.8 22H2l6.99-7.99L2 2h7.012l4.33 5.741L18.244 2Zm-2.397 18.3h1.66L7.27 3.6H5.49l10.357 16.7Z" />
    </svg>
  )
}
