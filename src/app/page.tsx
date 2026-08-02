'use client'

import {
  FormEvent,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import WorldwideText from '@/components/WorldwideText'

const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  // Square placeholder reserves the canvas box, so the hero copy doesn't
  // jump when the globe chunk lands (mobile stacks it below the copy).
  loading: () => <div className="w-full aspect-square" />
})

type Status = 'idle' | 'submitting' | 'success' | 'error'

import { ACCENT, accentA } from '@/lib/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { Descent } from '@/components/landing/Descent'

export default function HomeV2() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [showForm, setShowForm] = useState(false)

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
    <>
    <div className="min-h-screen-safe lx-hero text-zinc-100 font-mono selection:bg-accent/20 flex flex-col relative overflow-hidden">
      {/* faint atmospheric wash behind the globe — cool blue, so the Earth
          owns the right half and the accent stays reserved for signals */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-[340px] w-[340px] right-[-35%] sm:h-[640px] sm:w-[640px] sm:right-[-12%] rounded-full opacity-[0.1] blur-3xl"
        style={{
          background: 'radial-gradient(circle, rgb(96 148 255), transparent 70%)'
        }}
      />
      {/* thin horizon line — single retro accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-30"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentA(0.33)}, transparent)`
        }}
      />
      {/* minimalist white asteroids — occasional fly-by */}
      <AsteroidField />

      <div className="page-zoom-out relative z-10 max-w-6xl w-full mx-auto px-6 flex-1 flex flex-col">
        <Header />

        <main className="flex-1 flex items-center py-4 sm:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-4 sm:gap-10 lg:gap-16 items-center w-full">
            {/* LEFT — hero copy */}
            <div className="order-1">
              <span
                className="hero-item inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-950 text-[10px] tracking-[0.25em] sm:tracking-[0.3em] text-zinc-400"
                style={{ ['--hr' as string]: '0ms' }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: ACCENT,
                    boxShadow: `0 0 8px ${accentA(0.69)}`
                  }}
                />
                PRIVATE BETA · INVITE-ONLY
              </span>

              <h1
                className="hero-item mt-6 flex items-center gap-3.5 font-semibold tracking-tight leading-none text-zinc-50 text-[clamp(2.5rem,11vw,3.25rem)] md:text-6xl lg:text-[4.75rem]"
                style={{ ['--hr' as string]: '90ms' }}
              >
                {/* liquid-metal hive mark, sized to the cap height */}
                <LiquidMark size="0.92em" />
                <span>
                  cribble
                  <span style={{ color: ACCENT }}>.</span>
                </span>
              </h1>

              {/* Editorial serif tagline — deliberate contrast against the
                  mono wordmark. The rotating word rides an accent underline
                  that stretches with each language (see .worldwide-anchor). */}
              <div
                className="hero-item mt-5 font-serif text-[clamp(1.875rem,8.2vw,2.5rem)] md:text-[2.85rem] lg:text-[3.55rem] leading-[1.12] md:leading-[1.1]"
                style={{ ['--hr' as string]: '180ms' }}
              >
                <div className="text-zinc-400">ranking AI users,</div>
                <div className="worldwide-anchor mt-2 md:mt-3">
                  <WorldwideText />
                </div>
              </div>

              <p
                className="hero-item mt-6 max-w-md font-sans text-[15px] leading-[1.75] text-zinc-400 sm:text-[15px] sm:leading-[1.8]"
                style={{ ['--hr' as string]: '280ms' }}
              >
                You&apos;re in <ToolChip>ChatGPT</ToolChip>,{' '}
                <ToolChip>Claude</ToolChip>, <ToolChip>Cursor</ToolChip> and{' '}
                <RotatingTool />
                {' all day anyway. Cribble just keeps score: one quiet '}
                extension, 47 AI sites, one worldwide board. Install it,
                forget it, and check your rank when the group chat gets
                cocky.
              </p>

              <div
                className="hero-item mt-7 flex flex-wrap items-center gap-3"
                style={{ ['--hr' as string]: '380ms' }}
              >
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-2.5 bg-white text-black text-sm font-medium px-5 py-3 sm:py-2.5 rounded-md hover:bg-zinc-200 transition-colors"
                >
                  <span>Claim your callsign</span>
                  <span className="text-zinc-500 group-hover:translate-x-0.5 transition-transform">
                    →
                  </span>
                </Link>

                {!showForm && status !== 'success' && (
                  <button
                    onClick={() => setShowForm(true)}
                    className="py-2 text-[13px] sm:py-0 sm:text-xs tracking-[0.2em] text-zinc-400 hover:text-[color:var(--hg)] transition-colors"
                    style={{ ['--hg' as string]: ACCENT }}
                  >
                    join the waitlist →
                  </button>
                )}
              </div>

              {/* Waitlist form (inline reveal) */}
              {showForm && status !== 'success' && (
                <form onSubmit={submit} className="mt-5 max-w-md" noValidate>
                  <div
                    className="flex items-stretch border rounded-md bg-zinc-950/80 overflow-hidden transition-colors"
                    style={{ borderColor: 'rgb(var(--z800))' }}
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
                      className="flex-1 bg-transparent px-2 py-3 text-base sm:py-2.5 sm:text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={status === 'submitting' || !email}
                      className="text-[11px] tracking-[0.2em] px-4 border-l border-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      style={{
                        color: ACCENT,
                        background: 'rgb(var(--accent-rgb)/0.10)'
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
                    borderColor: `${accentA(0.33)}`,
                    background: `${accentA(0.05)}`,
                    color: ACCENT
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
            <div className="order-2">
              <GlobeStage />
            </div>
          </div>
        </main>

        <Footer />
      </div>

    </div>

    {/* THE DESCENT — hero stays exactly as it was; the story continues
        below the fold: arena → cockpit → identity → honors → flight plan. */}
    <Descent />
    </>
  )
}

function Header() {
  return (
    <header className="pt-6 sm:pt-8 flex items-center justify-between">
      <div className="flex items-center gap-2.5 text-sm tracking-[0.3em] sm:tracking-[0.4em] text-zinc-100 font-semibold">
        <LiquidMark size={22} />
        <span>
          CRIBBLE
          <span style={{ color: ACCENT }}>.</span>
        </span>
      </div>
      <nav className="flex items-center gap-1">
        <ThemeToggle className="mr-2" />
        <a
          href="https://x.com/cribble_ai"
          target="_blank"
          rel="noreferrer"
          aria-label="X"
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
    <footer className="pb-6 pt-10 flex flex-col items-start gap-3 text-[10px] tracking-[0.22em] text-zinc-600 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-2 sm:tracking-[0.3em]">
      <span className="inline-flex items-center gap-4">
        <span>CRIBBLE · 2026</span>
        <Link
          href="/privacy"
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          PRIVACY
        </Link>
      </span>

      <span className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:contents">
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

        <span style={{ color: `${accentA(0.6)}` }}>
          {'// backed by no one'}
        </span>
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
  // always traces exactly the visible dashed circle. Both derive from
  // --orbit (set on .globe-stage below), which steps down on phones so
  // the stacked hero leaves room for the headline above the fold.
  const ORBIT_SIZE = 'var(--orbit)'

  return (
    <div className="globe-stage relative w-full flex items-center justify-center">
      {/* outer thin orbit ring */}
      <div
        aria-hidden
        className="absolute inset-0 m-auto rounded-full pointer-events-none"
        style={{
          width: ORBIT_SIZE,
          height: ORBIT_SIZE,
          border: '1px dashed rgb(var(--star-rgb) / 0.06)'
        }}
      />

      {/* soft blue atmospheric spill behind the Earth — sized to catch the
          shader's exospheric haze where the canvas edge cuts it off */}
      <div
        aria-hidden
        className="absolute inset-0 m-auto rounded-full blur-3xl opacity-30 pointer-events-none transition-[background] duration-700"
        style={{
          width: 'calc(var(--orbit) * 0.915)',
          height: 'calc(var(--orbit) * 0.915)',
          background: 'radial-gradient(circle, rgb(var(--globe-glow-rgb) / 0.19), transparent 70%)'
        }}
      />

      {/* SATELLITE — sits on the top of the orbit ring; the wrapper spins
          to carry it around the dashed circle while the craft itself slowly
          tumbles about its own axis. */}
      <div
        aria-hidden
        className="cribble-satellite absolute inset-0 m-auto pointer-events-none"
        style={{
          width: ORBIT_SIZE,
          height: ORBIT_SIZE
        }}
      >
        {/* motion trail — orbit runs clockwise, so it streams off to the
            left of the craft at the top of the ring */}
        <div
          className="absolute top-0 left-1/2 h-px w-16"
          style={{
            transform: 'translate(calc(-100% - 22px), -50%)',
            background:
              'linear-gradient(to right, transparent, rgb(var(--star-rgb) / 0.5))'
          }}
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="cribble-sat-spin cribble-sat-spin-slow">
            <SatelliteMark />
          </div>
        </div>
      </div>

      <div className="relative z-[1] w-full" style={{ maxWidth: 'var(--globe)' }}>
        <Globe size={400} />
      </div>

      {/* POLAR SATELLITE — a real orbit, not a fade: the keyframes sample a
          tilted circle (position + depth-scale + heading), and on the far
          half its z-index drops below the globe canvas, so the opaque
          planet pixels clip it at the limb. It slides out from behind the
          top of the Earth, sweeps down the face growing as it nears the
          viewer, swings around below, recedes, and slips behind the planet
          again. Track radius stays inside the dashed ring so it never meets
          the first satellite. */}
      <div
        aria-hidden
        className="cribble-polar-sat absolute left-1/2 top-1/2 pointer-events-none"
      >
        {/* velocity-matched motion trail: always streams opposite the
            flight direction and stretches with projected speed, so it
            collapses to nothing at the turnarounds and hides the flip */}
        <div className="cribble-polar-trail" />
        <div className="cribble-sat-spin">
          <SatelliteMark />
        </div>
      </div>

      {/* tiny corner annotation */}
      <div className="absolute bottom-2 right-2 text-[9px] tracking-[0.3em] text-zinc-700 pointer-events-none">
        {'// 15 ai hubs · drag to spin'}
      </div>

      <style jsx global>{`
        /* One knob sizes the whole stage: ring + satellites trace --orbit,
           the Earth fills --globe (same 400/470 ratio at every step, so
           the polar sat still clips at the planet's limb). Phones get a
           smaller stage so the stacked hero copy stays near the fold. */
        .globe-stage {
          --orbit: min(470px, 92vw);
          --globe: min(400px, calc(var(--orbit) * 0.851));
        }
        @media (max-width: 639px) {
          .globe-stage {
            --orbit: min(340px, 86vw);
          }
        }
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
        .cribble-satellite-body {
          filter: drop-shadow(0 0 5px rgb(var(--star-rgb) / 0.45));
        }
        .cribble-satellite-beacon {
          animation: cribble-beacon 1.6s ease-in-out infinite;
        }
        @keyframes cribble-beacon {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.2;
          }
        }
        .cribble-polar-sat {
          /* one orbit unit, scaled off the stage size (470px orbit = 1px
             unit); the track spans ±196 units against the planet radius,
             so limb crossings keep happening inside the frame at every
             viewport, including the smaller phone stage */
          --pu: calc(var(--orbit, 470px) / 470);
          z-index: 2;
          will-change: transform;
          animation: cribble-polar 26s linear infinite;
        }
        /* Keyframes sample a tilted orbit circle every 15°:
           x = 24·cosθ + 14·sinθ (tilt + lean), y = -196·cosθ,
           scale = 0.825 + 0.325·sinθ (depth). Craft attitude is handled by
           the separate self-spin, which keeps the angular rate constant.
           Front half (0–50%) rides above the globe; at the bottom
           turnaround the z-index drops under the canvas, so on the way up
           the opaque planet itself clips the craft at the limb. */
        @keyframes cribble-polar {
          0% {
            transform: translate(
                calc(-50% + 24 * var(--pu)),
                calc(-50% - 196 * var(--pu))
              )
              scale(0.825);
            z-index: 2;
          }
          4.17% {
            transform: translate(
                calc(-50% + 26.8 * var(--pu)),
                calc(-50% - 189.3 * var(--pu))
              )
              scale(0.909);
          }
          8.33% {
            transform: translate(
                calc(-50% + 27.8 * var(--pu)),
                calc(-50% - 169.7 * var(--pu))
              )
              scale(0.988);
          }
          12.5% {
            transform: translate(
                calc(-50% + 26.9 * var(--pu)),
                calc(-50% - 138.6 * var(--pu))
              )
              scale(1.055);
          }
          16.67% {
            transform: translate(
                calc(-50% + 24.1 * var(--pu)),
                calc(-50% - 98 * var(--pu))
              )
              scale(1.106);
          }
          20.83% {
            transform: translate(
                calc(-50% + 19.7 * var(--pu)),
                calc(-50% - 50.7 * var(--pu))
              )
              scale(1.139);
          }
          25% {
            transform: translate(calc(-50% + 14 * var(--pu)), -50%) scale(1.15);
          }
          29.17% {
            transform: translate(
                calc(-50% + 7.3 * var(--pu)),
                calc(-50% + 50.7 * var(--pu))
              )
              scale(1.139);
          }
          33.33% {
            transform: translate(
                calc(-50% + 0.1 * var(--pu)),
                calc(-50% + 98 * var(--pu))
              )
              scale(1.106);
          }
          37.5% {
            transform: translate(
                calc(-50% - 7.1 * var(--pu)),
                calc(-50% + 138.6 * var(--pu))
              )
              scale(1.055);
          }
          41.67% {
            transform: translate(
                calc(-50% - 13.8 * var(--pu)),
                calc(-50% + 169.7 * var(--pu))
              )
              scale(0.988);
          }
          45.83% {
            transform: translate(
                calc(-50% - 19.6 * var(--pu)),
                calc(-50% + 189.3 * var(--pu))
              )
              scale(0.909);
          }
          50% {
            transform: translate(
                calc(-50% - 24 * var(--pu)),
                calc(-50% + 196 * var(--pu))
              )
              scale(0.825);
            z-index: 2;
          }
          /* bottom turnaround happens clear of the planet, so the z-order
             swap under the canvas is invisible */
          50.2% {
            z-index: 0;
          }
          54.17% {
            transform: translate(
                calc(-50% - 26.8 * var(--pu)),
                calc(-50% + 189.3 * var(--pu))
              )
              scale(0.741);
          }
          58.33% {
            transform: translate(
                calc(-50% - 27.8 * var(--pu)),
                calc(-50% + 169.7 * var(--pu))
              )
              scale(0.663);
          }
          62.5% {
            transform: translate(
                calc(-50% - 26.9 * var(--pu)),
                calc(-50% + 138.6 * var(--pu))
              )
              scale(0.595);
          }
          66.67% {
            transform: translate(
                calc(-50% - 24.1 * var(--pu)),
                calc(-50% + 98 * var(--pu))
              )
              scale(0.544);
          }
          70.83% {
            transform: translate(
                calc(-50% - 19.7 * var(--pu)),
                calc(-50% + 50.7 * var(--pu))
              )
              scale(0.511);
          }
          75% {
            transform: translate(calc(-50% - 14 * var(--pu)), -50%) scale(0.5);
          }
          79.17% {
            transform: translate(
                calc(-50% - 7.3 * var(--pu)),
                calc(-50% - 50.7 * var(--pu))
              )
              scale(0.511);
          }
          83.33% {
            transform: translate(
                calc(-50% - 0.1 * var(--pu)),
                calc(-50% - 98 * var(--pu))
              )
              scale(0.544);
          }
          87.5% {
            transform: translate(
                calc(-50% + 7.1 * var(--pu)),
                calc(-50% - 138.6 * var(--pu))
              )
              scale(0.595);
          }
          91.67% {
            transform: translate(
                calc(-50% + 13.8 * var(--pu)),
                calc(-50% - 169.7 * var(--pu))
              )
              scale(0.663);
          }
          95.83% {
            transform: translate(
                calc(-50% + 19.6 * var(--pu)),
                calc(-50% - 189.3 * var(--pu))
              )
              scale(0.741);
          }
          100% {
            transform: translate(
                calc(-50% + 24 * var(--pu)),
                calc(-50% - 196 * var(--pu))
              )
              scale(0.825);
            z-index: 0;
          }
        }
        /* Trail anchored to the polar craft's center. transform-origin sits
           on the craft, so rotate() aims the streak opposite the flight
           direction and scaleX() stretches it with projected speed. The
           fast heading flips at the turnarounds happen while the trail is
           collapsed, so they are invisible. Sampled every 15° of the same
           orbit the position keyframes trace. */
        .cribble-polar-trail {
          position: absolute;
          top: 50%;
          right: 50%;
          width: 64px;
          height: 1px;
          margin-top: -0.5px;
          transform-origin: 100% 50%;
          background: linear-gradient(
            to right,
            transparent,
            rgb(var(--star-rgb) / 0.5)
          );
          animation: cribble-polar-trail 26s linear infinite;
        }
        @keyframes cribble-polar-trail {
          0% {
            transform: rotate(0deg) scaleX(0.07);
          }
          4.17% {
            transform: rotate(81.8deg) scaleX(0.26);
          }
          8.33% {
            transform: rotate(89.9deg) scaleX(0.5);
          }
          12.5% {
            transform: rotate(92.9deg) scaleX(0.7);
          }
          16.67% {
            transform: rotate(94.6deg) scaleX(0.86);
          }
          20.83% {
            transform: rotate(95.9deg) scaleX(0.96);
          }
          25% {
            transform: rotate(97deg) scaleX(1);
          }
          29.17% {
            transform: rotate(98.1deg) scaleX(0.97);
          }
          33.33% {
            transform: rotate(99.3deg) scaleX(0.87);
          }
          37.5% {
            transform: rotate(101deg) scaleX(0.71);
          }
          41.67% {
            transform: rotate(103.8deg) scaleX(0.51);
          }
          45.83% {
            transform: rotate(111.3deg) scaleX(0.28);
          }
          50% {
            transform: rotate(180deg) scaleX(0.07);
          }
          54.17% {
            transform: rotate(261.8deg) scaleX(0.26);
          }
          58.33% {
            transform: rotate(269.9deg) scaleX(0.5);
          }
          62.5% {
            transform: rotate(272.9deg) scaleX(0.7);
          }
          66.67% {
            transform: rotate(274.6deg) scaleX(0.86);
          }
          70.83% {
            transform: rotate(275.9deg) scaleX(0.96);
          }
          75% {
            transform: rotate(277deg) scaleX(1);
          }
          79.17% {
            transform: rotate(278.1deg) scaleX(0.97);
          }
          83.33% {
            transform: rotate(279.3deg) scaleX(0.87);
          }
          87.5% {
            transform: rotate(281deg) scaleX(0.71);
          }
          91.67% {
            transform: rotate(283.8deg) scaleX(0.51);
          }
          95.83% {
            transform: rotate(291.3deg) scaleX(0.28);
          }
          100% {
            transform: rotate(360deg) scaleX(0.07);
          }
        }
        /* slow tumble about each craft's own axis; constant angular rate
           so nothing snaps at the orbit turnarounds */
        .cribble-sat-spin {
          animation: cribble-sat-spin 14s linear infinite;
        }
        .cribble-sat-spin > svg {
          display: block;
        }
        .cribble-sat-spin-slow {
          animation-duration: 22s;
          animation-direction: reverse;
        }
        @keyframes cribble-sat-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cribble-satellite,
          .cribble-satellite-beacon,
          .cribble-sat-spin {
            animation: none !important;
          }
          /* without its animation the polar craft has no valid resting
             spot, so it sits out entirely */
          .cribble-polar-sat {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}

function SatelliteMark() {
  // Side-view comms satellite: long twin solar wings on booms, silver bus
  // with a sensor strip, uplink dish, and a blinking accent beacon.
  return (
    <svg
      width="56"
      height="22"
      viewBox="0 0 56 22"
      className="cribble-satellite-body"
      aria-hidden
    >
      {/* left solar wing */}
      <rect
        x="1"
        y="7"
        width="18"
        height="8.5"
        rx="1"
        fill="rgb(30 64 175 / 0.92)"
        stroke="rgb(148 163 184 / 0.95)"
        strokeWidth="0.8"
      />
      <path
        d="M5.5 7v8.5M10 7v8.5M14.5 7v8.5M1 11.25h18"
        stroke="rgb(191 219 254 / 0.55)"
        strokeWidth="0.6"
      />
      {/* right solar wing */}
      <rect
        x="37"
        y="7"
        width="18"
        height="8.5"
        rx="1"
        fill="rgb(30 64 175 / 0.92)"
        stroke="rgb(148 163 184 / 0.95)"
        strokeWidth="0.8"
      />
      <path
        d="M41.5 7v8.5M46 7v8.5M50.5 7v8.5M37 11.25h18"
        stroke="rgb(191 219 254 / 0.55)"
        strokeWidth="0.6"
      />
      {/* wing booms */}
      <path
        d="M19 11.25h4M33 11.25h4"
        stroke="rgb(161 161 170)"
        strokeWidth="1"
      />
      {/* bus */}
      <rect
        x="23"
        y="5.5"
        width="10"
        height="11.5"
        rx="1.8"
        fill="#e4e4e7"
        stroke="#3f3f46"
        strokeWidth="0.9"
      />
      {/* sensor strip */}
      <rect x="24.8" y="7.4" width="6.4" height="2.6" rx="0.6" fill="#27272a" />
      <rect
        x="25.5"
        y="8.1"
        width="2.1"
        height="1.2"
        rx="0.3"
        fill="rgb(56 189 248 / 0.85)"
      />
      {/* uplink dish */}
      <path d="M28 5.5V2.9" stroke="#a1a1aa" strokeWidth="0.9" />
      <circle
        cx="28"
        cy="2.2"
        r="1.5"
        fill="#f4f4f5"
        stroke="#52525b"
        strokeWidth="0.7"
      />
      <circle cx="28" cy="2.2" r="0.45" fill="#52525b" />
      {/* status beacon */}
      <circle
        className="cribble-satellite-beacon"
        cx="28"
        cy="14.4"
        r="1.2"
        fill="rgb(var(--accent-rgb))"
      />
    </svg>
  )
}

// Number of streaks that can be in flight at once. Each one re-launches on
// its own randomized schedule, so the sky never feels metronomic. Kept low
// (with long idle gaps) so a fly-by reads as a rare event, not a swarm.
const ASTEROID_COUNT = 3

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
        // Long, randomized idle gap before this streak flies again — this is
        // what keeps passes rare and de-synced, while each pass itself stays
        // fast. Big spread so they don't cluster into a swarm.
        const gap = rand(6000, 16000)
        const t = window.setTimeout(() => launch(el), gap)
        timers.add(t)
      }
    }

    // Widely stagger the first launch of each streak so they don't all fire
    // at once (and don't immediately re-cluster after the first cycle).
    streaks.forEach((el, i) => {
      if (i >= 2 && window.innerWidth < 640) return
      const t = window.setTimeout(
        () => launch(el),
        rand(400, 2000) + i * rand(2500, 5000)
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
          position: relative;
          display: inline-block;
          padding-bottom: 12px;
          line-height: 1.12;
        }

        /* Accent underline that stretches and shrinks with each language —
           it tracks the animated width of the wrap above it. */
        .worldwide-anchor::after {
          content: '';
          position: absolute;
          left: 1px;
          right: 1px;
          bottom: 2px;
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            rgb(var(--accent-rgb) / 0.85),
            rgb(var(--accent-rgb) / 0.1)
          );
          box-shadow: 0 0 14px rgb(var(--accent-rgb) / 0.35);
          pointer-events: none;
        }

        /* Hero entrance — badge, wordmark, tagline, copy, CTAs rise in
           sequence. Uses "backwards" fill so hover states stay free after
           the cascade finishes. Delay comes from --hr, set inline. */
        .hero-item {
          animation: hero-rise-in 720ms cubic-bezier(0.22, 1, 0.36, 1)
            backwards;
          animation-delay: var(--hr, 0ms);
        }
        @keyframes hero-rise-in {
          from {
            opacity: 0;
            transform: translateY(var(--hero-rise, 16px));
            filter: blur(var(--hero-blur, 8px));
          }
        }
        /* Phones: animating a large blur radius across the whole cascade
           drops frames on mobile GPUs (the WebGL globe is booting at the
           same moment) — keep the motion, shrink the expensive part. */
        @media (max-width: 639px) {
          .hero-item {
            --hero-blur: 4px;
            --hero-rise: 12px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-item {
            animation: none;
          }
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
            rgb(var(--star-rgb) / 0.05) 30%,
            rgb(var(--star-rgb) / 0.55) 80%,
            rgb(var(--star-rgb) / 0.92) 100%
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
          background: rgb(var(--star-rgb));
          border-radius: 9999px;
          box-shadow: 0 0 6px rgb(var(--star-rgb) / 0.85);
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

function ToolChip({ children }: { children: ReactNode }) {
  return (
    <span className="font-medium text-zinc-200 border-b border-zinc-700/70">
      {children}
    </span>
  )
}

// The fourth slot in the tool list cycles through the rest of the roster so
// the paragraph reads as live inventory instead of static marketing copy.
const ROTATING_TOOLS = [
  'Gemini',
  'Perplexity',
  'Copilot',
  'v0',
  'Windsurf',
  'DeepSeek',
  'Grok',
  'Lovable'
]

const ROTATE_HOLD_MS = 2400
const ROTATE_SWAP_MS = 240

function RotatingTool() {
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [width, setWidth] = useState<number | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)

  // Measure each word so the sentence reflows smoothly instead of jumping.
  // offsetWidth (layout px), not getBoundingClientRect (visual px): the
  // hero sits under `zoom: 0.9`, and a rect-based measure gets shrunk a
  // second time when written back as style.width — clipping every word.
  useLayoutEffect(() => {
    if (measureRef.current) {
      setWidth(measureRef.current.offsetWidth + 1)
    }
  }, [index])

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return

    let cancelled = false
    const timers: Array<ReturnType<typeof setTimeout>> = []

    const tick = () => {
      timers.push(
        setTimeout(() => {
          if (cancelled) return
          setLeaving(true)
          timers.push(
            setTimeout(() => {
              if (cancelled) return
              setIndex((v) => (v + 1) % ROTATING_TOOLS.length)
              setLeaving(false)
              tick()
            }, ROTATE_SWAP_MS)
          )
        }, ROTATE_HOLD_MS)
      )
    }
    tick()

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <span
      className="rt-wrap"
      style={{ width: width != null ? `${width}px` : 'auto' }}
    >
      <span ref={measureRef} aria-hidden className="rt-measure">
        {ROTATING_TOOLS[index]}
      </span>
      <span className={`rt-word ${leaving ? 'is-out' : ''}`}>
        {ROTATING_TOOLS[index]}
      </span>

      <style jsx>{`
        .rt-wrap {
          position: relative;
          display: inline-block;
          vertical-align: baseline;
          white-space: nowrap;
          transition: width ${ROTATE_SWAP_MS + 80}ms
            cubic-bezier(0.22, 1, 0.36, 1);
        }
        .rt-measure {
          position: absolute;
          left: 0;
          top: 0;
          visibility: hidden;
          pointer-events: none;
          font-weight: 500;
        }
        .rt-word {
          display: inline-block;
          font-weight: 500;
          color: var(--accent);
          border-bottom: 1px dashed rgb(var(--accent-rgb) / 0.45);
          transition:
            opacity ${ROTATE_SWAP_MS}ms ease,
            transform ${ROTATE_SWAP_MS}ms ease,
            filter ${ROTATE_SWAP_MS}ms ease;
        }
        .rt-word.is-out {
          opacity: 0;
          transform: translateY(-5px);
          filter: blur(3px);
        }
        @media (prefers-reduced-motion: reduce) {
          .rt-wrap,
          .rt-word {
            transition: none;
          }
        }
      `}</style>
    </span>
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
