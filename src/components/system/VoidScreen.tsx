'use client'

// Full-viewport "adrift in space" system screen, shared by the global 404
// (variant "not-found"), the maintenance / coming-soon route (variant
// "maintenance", served in place of locked sectors) and the sign-in wall
// (variant "restricted", served when a locked sector would open for a
// signed-in pilot — e.g. /shop under the site lock).
//
// Composition mirrors the landing hero so the screen reads as the same
// station: deep-space starfield (dossier paper in light mode), mono chrome,
// serif editorial line, terminal readout. The centerpiece swaps the middle
// digit of the status code for a live orbit — dashed ring, satellite fly-by,
// liquid-metal hive mark floating at the barycenter.

import Link from 'next/link'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ACCENT, accentA } from '@/lib/theme'

type VoidScreenVariant = 'not-found' | 'maintenance' | 'restricted'

type VoidCopy = {
  /** Digits flanking the orbit-ring zero: 4⊙4, 5⊙3, 4⊙1. */
  digits: [string, string]
  badge: string
  /** Serif headline; the second line renders italic in the accent color. */
  headline: [string, string]
  body: string
  /** Typed into the terminal readout, character by character. */
  terminal: string
  footerNote: string
  /** `forward` flips the primary arrow: ← go back vs → go on (sign in). */
  actions: Array<{ href: string; label: string; primary?: boolean; forward?: boolean }>
}

const COPY: Record<VoidScreenVariant, VoidCopy> = {
  'not-found': {
    digits: ['4', '4'],
    badge: 'SIGNAL LOST · UNCHARTED SECTOR',
    headline: ["you've drifted", 'off the charted map.'],
    body:
      'No deck, dossier, or pilot answers at this address. Re-check the ' +
      'coordinates or fly back to a charted route.',
    terminal: 'ERR_404 · no waypoint at these coordinates',
    footerNote: '// lost in space, not in spirit',
    actions: [
      { href: '/', label: 'RETURN TO BASE', primary: true },
      { href: '/leaderboard', label: 'SCAN THE LEADERBOARD' }
    ]
  },
  maintenance: {
    digits: ['5', '3'],
    badge: 'SCHEDULED WORKS · SECTOR SEALED',
    headline: ['this sector is still', 'under construction.'],
    body:
      'Crews are bolting down the last panels in this wing. It opens with ' +
      'the next launch window — nothing to see yet except sparks.',
    terminal: 'ERR_503 · sealed for outfitting · check back soon',
    footerNote: '// pardon our space dust',
    actions: [
      { href: '/', label: 'RETURN TO BASE', primary: true },
      { href: '/leaderboard', label: 'SCAN THE LEADERBOARD' }
    ]
  },
  restricted: {
    digits: ['4', '1'],
    badge: 'RESTRICTED SECTOR · PILOTS ONLY',
    headline: ['this deck is reserved', 'for registered pilots.'],
    body:
      'Nothing is broken and nothing is hidden — this hatch just answers ' +
      'to a callsign. Sign in and the sector opens on its own.',
    terminal: 'ERR_401 · no clearance on file · identify yourself',
    footerNote: '// no callsign, no boarding',
    actions: [
      { href: '/login', label: 'SIGN IN', primary: true, forward: true },
      { href: '/', label: 'RETURN TO BASE' }
    ]
  }
}

export function VoidScreen({ variant }: { variant: VoidScreenVariant }) {
  const copy = COPY[variant]

  return (
    <div className="void-scene min-h-screen-safe relative flex flex-col overflow-hidden font-mono text-zinc-100 selection:bg-accent/20">
      {/* faint accent wash behind the status code */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.1] blur-3xl"
        style={{ background: `radial-gradient(circle, ${ACCENT}, transparent 70%)` }}
      />
      {/* thin horizon line — single retro accent, same as the landing hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-30"
        style={{ background: `linear-gradient(90deg, transparent, ${accentA(0.33)}, transparent)` }}
      />
      {/* occasional asteroid fly-bys */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span
          className="vs-asteroid"
          style={{
            ['--ay' as string]: '16%',
            ['--tilt' as string]: '16deg',
            ['--slope' as string]: '0.287',
            ['--dur' as string]: '17s',
            ['--delay' as string]: '2.4s'
          }}
        />
        <span
          className="vs-asteroid"
          style={{
            ['--ay' as string]: '62%',
            ['--tilt' as string]: '-11deg',
            ['--slope' as string]: '-0.194',
            ['--dur' as string]: '23s',
            ['--delay' as string]: '10s'
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6">
        <header className="flex items-center justify-between pt-6 sm:pt-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-[0.4em] text-zinc-100"
          >
            <LiquidMark size={22} />
            <span>
              CRIBBLE
              <span style={{ color: ACCENT }}>.</span>
            </span>
          </Link>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 flex-col items-center justify-center py-14 text-center">
          <span
            className="vs-item inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] tracking-[0.3em] text-zinc-400"
            style={{ ['--vr' as string]: '0ms' }}
          >
            <span
              className="vs-beacon-dot h-1.5 w-1.5 rounded-full"
              style={{ background: ACCENT, boxShadow: `0 0 8px ${accentA(0.69)}` }}
            />
            {copy.badge}
          </span>

          {/* status code — the zero is a live orbit */}
          <div
            className="vs-item mt-10 flex items-center justify-center gap-[0.07em] leading-none"
            style={{
              ['--vr' as string]: '90ms',
              fontSize: 'clamp(6rem, 20vw, 12rem)'
            }}
          >
            <span className="vs-digit vs-bob-a">{copy.digits[0]}</span>
            <OrbitZero />
            <span className="vs-digit vs-bob-b">{copy.digits[1]}</span>
          </div>

          <h1
            className="vs-item mt-9 font-serif text-4xl leading-[1.08] md:text-5xl lg:text-[3.4rem]"
            style={{ ['--vr' as string]: '180ms' }}
          >
            <span className="block text-zinc-400">{copy.headline[0]}</span>
            <span className="mt-1 block italic" style={{ color: ACCENT }}>
              {copy.headline[1]}
            </span>
          </h1>

          <p
            className="vs-item mx-auto mt-6 max-w-md font-sans text-sm leading-[1.8] text-zinc-400"
            style={{ ['--vr' as string]: '280ms' }}
          >
            {copy.body}
          </p>

          {/* terminal readout — types itself out */}
          <div className="vs-item mt-8" style={{ ['--vr' as string]: '380ms' }}>
            <div className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-950/70 px-3.5 py-2 text-[11px] tracking-[0.08em] text-zinc-500">
              <span className="mr-2 select-none" style={{ color: ACCENT }}>
                ▸
              </span>
              <span
                className="vs-type"
                style={{
                  ['--ch' as string]: copy.terminal.length,
                  animationTimingFunction: `steps(${copy.terminal.length}, end)`
                }}
              >
                {copy.terminal}
              </span>
              <span className="vs-caret" aria-hidden />
            </div>
          </div>

          <div
            className="vs-item mt-9 flex flex-wrap items-center justify-center gap-3"
            style={{ ['--vr' as string]: '480ms' }}
          >
            {copy.actions.map((action) =>
              action.primary ? (
                // Same solid primary as the landing "Register" CTA — white
                // slab in dark mode, ink slab on paper in light mode (the
                // white/black tokens flip with the theme).
                <Link
                  key={action.href}
                  href={action.href}
                  className="group inline-flex items-center gap-2.5 rounded-md bg-white px-5 py-2.5 text-[11px] font-semibold tracking-[0.25em] text-black transition-[background-color,transform] hover:bg-zinc-200 active:scale-[0.98]"
                >
                  {!action.forward && (
                    <span
                      aria-hidden
                      className="text-zinc-500 transition-transform group-hover:-translate-x-0.5"
                    >
                      ←
                    </span>
                  )}
                  {action.label}
                  {action.forward && (
                    <span
                      aria-hidden
                      className="text-zinc-500 transition-transform group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  )}
                </Link>
              ) : (
                <Link
                  key={action.href}
                  href={action.href}
                  className="inline-flex items-center rounded-md border border-zinc-800 px-4 py-2 text-[11px] tracking-[0.25em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
                >
                  {action.label}
                </Link>
              )
            )}
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-6 pt-8 text-[10px] tracking-[0.3em] text-zinc-600">
          <span>CRIBBLE · 2026</span>
          <span style={{ color: accentA(0.6) }}>{copy.footerNote}</span>
        </footer>
      </div>

      <style jsx global>{`
        /* Deep-space field, same recipe as the landing hero (.lx-hero):
           three coprime speck tiles over the zenith→deep gradient. */
        .void-scene {
          background-color: var(--space-deep);
          background-image:
            radial-gradient(1.2px 1.2px at 22px 84px, rgb(190 210 255 / 0.32) 50%, transparent 55%),
            radial-gradient(1px 1px at 118px 31px, rgb(255 255 255 / 0.22) 50%, transparent 55%),
            radial-gradient(1.6px 1.6px at 73px 156px, rgb(165 195 255 / 0.17) 50%, transparent 55%),
            linear-gradient(180deg, var(--space-zenith) 0%, var(--space-mid) 52%, var(--space-deep) 100%);
          background-size: 210px 210px, 260px 260px, 320px 320px, 100% 100%;
        }
        /* Light mode: the site-wide flat professional-white canvas. */
        html.light .void-scene {
          background: #ffffff;
        }

        /* Entrance cascade — rise + deblur, staggered via --vr (same
           choreography as the landing hero items). */
        .vs-item {
          animation: vs-rise 720ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--vr, 0ms);
        }
        @keyframes vs-rise {
          from {
            opacity: 0;
            transform: translateY(16px);
            filter: blur(8px);
          }
        }

        /* Hollow blueprint numerals — stroke keys off the zinc scale so
           light mode automatically re-inks them on paper. */
        .vs-digit {
          font-family: var(--font-display), 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 1em;
          line-height: 1;
          color: transparent;
          -webkit-text-stroke: 0.014em rgb(var(--z200) / 0.92);
          filter: drop-shadow(0 0 0.15em rgb(var(--accent-rgb) / 0.12));
        }

        /* Weightless drift — each glyph bobs on its own phase. */
        @keyframes vs-bob {
          from {
            transform: translateY(-0.028em);
          }
          to {
            transform: translateY(0.028em);
          }
        }
        .vs-bob-a {
          animation: vs-bob 5.2s ease-in-out infinite alternate;
        }
        .vs-bob-b {
          animation: vs-bob 6.1s ease-in-out 0.8s infinite alternate-reverse;
        }

        /* The zero: dashed orbit ring + satellite + hive mark. Sized in em
           so it tracks the digit font-size at every viewport; 0.74em matches
           the Space Grotesk cap height, so it reads as a digit. */
        .vs-zero {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 0.74em;
          height: 0.74em;
          margin: 0 0.05em;
          animation: vs-bob 6.8s ease-in-out 1.6s infinite alternate;
        }
        .vs-zero-glow {
          position: absolute;
          width: 132%;
          height: 132%;
          border-radius: 9999px;
          background: radial-gradient(circle, rgb(var(--accent-rgb) / 0.16), transparent 65%);
          filter: blur(0.06em);
          animation: vs-glow 7s ease-in-out infinite;
        }
        @keyframes vs-glow {
          0%,
          100% {
            opacity: 0.65;
          }
          50% {
            opacity: 1;
          }
        }
        .vs-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 0.014em dashed rgb(var(--z300) / 0.8);
          animation: vs-spin 60s linear infinite;
        }
        @keyframes vs-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .vs-sat-orbit {
          position: absolute;
          inset: 0;
          animation: vs-spin 16s linear infinite;
        }
        .vs-sat {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translate(-50%, -50%);
        }
        .vs-sat svg {
          display: block;
          width: 0.24em;
          height: auto;
          filter: drop-shadow(0 0 4px rgb(var(--star-rgb) / 0.45));
        }
        .vs-beacon {
          animation: vs-blink 1.6s ease-in-out infinite;
        }
        .vs-beacon-dot {
          animation: vs-blink 2.4s ease-in-out infinite;
        }
        @keyframes vs-blink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.25;
          }
        }

        /* Terminal type-out: width steps from 0 to the full line, one
           character per step (timing function set inline per variant).
           Each glyph occupies 1ch plus the 0.08em tracking the readout
           carries, so the resting width must include both or the tail of
           the line stays clipped. */
        .vs-type {
          display: inline-block;
          overflow: hidden;
          white-space: nowrap;
          width: calc(var(--ch) * (1ch + 0.08em));
          animation: vs-type 1.9s 700ms backwards;
        }
        @keyframes vs-type {
          from {
            width: 0;
          }
        }
        .vs-caret {
          display: inline-block;
          width: 0.55ch;
          height: 1.05em;
          margin-left: 0.35ch;
          background: rgb(var(--accent-rgb) / 0.85);
          animation: vs-caret-blink 1.1s steps(2, jump-none) infinite;
        }
        @keyframes vs-caret-blink {
          50% {
            opacity: 0;
          }
        }

        /* Rare shooting-star streaks; head (bright end) leads. */
        .vs-asteroid {
          position: absolute;
          top: var(--ay);
          left: -140px;
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
          animation: vs-fly var(--dur) linear var(--delay) infinite;
        }
        .vs-asteroid::after {
          content: '';
          position: absolute;
          right: 0;
          top: -1.5px;
          width: 4px;
          height: 4px;
          border-radius: 9999px;
          background: rgb(var(--star-rgb));
          box-shadow: 0 0 6px rgb(var(--star-rgb) / 0.85);
        }
        @keyframes vs-fly {
          0% {
            transform: translate(0, 0) rotate(var(--tilt));
            opacity: 0;
          }
          1.5% {
            opacity: 0.9;
          }
          11% {
            opacity: 0.9;
          }
          13% {
            transform: translate(130vw, calc(130vw * var(--slope))) rotate(var(--tilt));
            opacity: 0;
          }
          100% {
            transform: translate(130vw, calc(130vw * var(--slope))) rotate(var(--tilt));
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vs-item,
          .vs-digit,
          .vs-zero,
          .vs-zero-glow,
          .vs-ring,
          .vs-sat-orbit,
          .vs-bob-a,
          .vs-bob-b,
          .vs-beacon,
          .vs-beacon-dot,
          .vs-caret {
            animation: none !important;
          }
          .vs-type {
            animation: none !important;
            width: auto;
          }
          .vs-asteroid {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}

function OrbitZero() {
  return (
    <span className="vs-zero" aria-hidden>
      <span className="vs-zero-glow" />
      <span className="vs-ring" />
      <span className="relative z-[1] inline-flex">
        <LiquidMark size="0.34em" />
      </span>
      <span className="vs-sat-orbit">
        <span className="vs-sat">
          <SatelliteGlyph />
        </span>
      </span>
    </span>
  )
}

function SatelliteGlyph() {
  // Compact side-view comms satellite: twin solar wings, silver bus,
  // uplink dish, blinking accent beacon (same craft family as the landing).
  return (
    <svg viewBox="0 0 56 22" xmlns="http://www.w3.org/2000/svg" aria-hidden>
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
      <path d="M19 11.25h4M33 11.25h4" stroke="rgb(161 161 170)" strokeWidth="1" />
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
      <rect x="24.8" y="7.4" width="6.4" height="2.6" rx="0.6" fill="#27272a" />
      <rect x="25.5" y="8.1" width="2.1" height="1.2" rx="0.3" fill="rgb(56 189 248 / 0.85)" />
      <path d="M28 5.5V2.9" stroke="#a1a1aa" strokeWidth="0.9" />
      <circle cx="28" cy="2.2" r="1.5" fill="#f4f4f5" stroke="#52525b" strokeWidth="0.7" />
      <circle cx="28" cy="2.2" r="0.45" fill="#52525b" />
      <circle className="vs-beacon" cx="28" cy="14.4" r="1.2" fill="rgb(var(--accent-rgb))" />
    </svg>
  )
}
