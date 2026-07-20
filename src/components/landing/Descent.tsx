'use client'

// THE DESCENT — everything below the landing hero. Five stages falling from
// orbit to touchdown (arena → cockpit → identity → honors → flight plan),
// stitched together by a fixed altitude HUD that tracks scroll like a
// re-entry telemetry readout. The hero above is untouched; this component
// simply extends the page downward.

import { CSSProperties, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { prefersReducedMotion } from '@/lib/motion'
import { ArenaSection } from './ArenaSection'
import { CockpitSection } from './CockpitSection'
import { HonorsSection } from './HonorsSection'
import { IdentitySection } from './IdentitySection'
import { RoadmapSection } from './RoadmapSection'
import { DecodeText, Stage } from './scrollFx'

const SECTIONS = [
  { id: 'arena', label: 'ARENA' },
  { id: 'cockpit', label: 'COCKPIT' },
  { id: 'identity', label: 'IDENTITY' },
  { id: 'honors', label: 'HONORS' },
  { id: 'roadmap', label: 'FLIGHT PLAN' }
] as const

/* ------------------------------------------------------------------ */
/* Altitude HUD — fixed right rail, wakes up once the hero is cleared  */
/* ------------------------------------------------------------------ */

function DescentHud({ rootRef }: { rootRef: React.RefObject<HTMLDivElement> }) {
  const [visible, setVisible] = useState(false)
  const [barVisible, setBarVisible] = useState(false)
  const [alt, setAlt] = useState(100)
  const [active, setActive] = useState<string>('arena')
  const raf = useRef(0)

  useEffect(() => {
    if (prefersReducedMotion()) return

    const measure = () => {
      raf.current = 0
      const root = rootRef.current
      if (!root) return
      const vh = window.innerHeight
      setVisible(window.scrollY > vh * 0.55)
      // The phone chip overlays page content (no free margin on small
      // screens), so it waits until the hero is fully cleared.
      setBarVisible(window.scrollY > vh * 1.05)

      const r = root.getBoundingClientRect()
      const total = r.height - vh
      const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1
      setAlt(Math.max(0, 100 - p * 100))
    }
    const onScroll = () => {
      if (!raf.current) raf.current = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const sec = e.target.getAttribute('data-sec')
            if (sec) setActive(sec)
          }
        })
      },
      { rootMargin: '-42% 0px -42% 0px' }
    )
    document.querySelectorAll('[data-sec]').forEach((el) => io.observe(el))

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf.current)
      io.disconnect()
    }
  }, [rootRef])

  return (
    <>
    {/* Phone HUD — the right rail has no room on small screens, so the
        same telemetry compresses into a hairline descent-progress bar
        pinned to the top edge (plus the live altitude readout). */}
    <div
      aria-hidden
      className="hud-bar pointer-events-none fixed inset-x-0 z-40 lg:hidden"
      style={{
        top: 'env(safe-area-inset-top, 0px)',
        opacity: barVisible ? 1 : 0
      }}
    >
      <div className="h-[2px] w-full bg-zinc-900/60">
        <div
          className="h-full"
          style={{
            width: `${100 - alt}%`,
            background:
              'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.4), var(--accent))',
            boxShadow: '0 0 12px rgb(var(--accent-rgb) / 0.7)'
          }}
        />
      </div>
    </div>

    {/* altitude chip — bottom corner, clear of the reading line */}
    <div
      aria-hidden
      className="hud-bar pointer-events-none fixed right-3 z-40 lg:hidden"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        opacity: barVisible ? 1 : 0
      }}
    >
      <span
        className="block rounded-md border px-2 py-1.5 text-[9px] leading-none tabular-nums tracking-[0.2em] [font-family:var(--font-pixel)]"
        style={{
          color: 'var(--accent)',
          borderColor: 'rgb(var(--accent-rgb) / 0.25)',
          background: 'rgb(0 0 0 / 0.72)',
          textShadow: '0 0 10px rgb(var(--accent-rgb) / 0.5)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)'
        }}
      >
        ALT {alt.toFixed(1).padStart(5, '0')} KM
      </span>
    </div>

    <div
      aria-hidden
      className="hud-rail pointer-events-none fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-5 lg:flex"
      style={{ opacity: visible ? 1 : 0, transform: `translateY(-50%) translateX(${visible ? 0 : 12}px)` }}
    >
      {/* altitude readout */}
      <div className="flex flex-col items-end gap-1">
        <span className="text-[8px] tracking-[0.4em] text-zinc-600">ALT</span>
        <span
          className="leading-none tabular-nums [font-family:var(--font-pixel)] text-[13px]"
          style={{ color: 'var(--accent)', textShadow: '0 0 12px rgb(var(--accent-rgb) / 0.5)' }}
        >
          {alt.toFixed(1).padStart(5, '0')}
        </span>
        <span className="text-[8px] tracking-[0.4em] text-zinc-600">KM</span>
      </div>

      {/* section ladder */}
      <div className="flex flex-col items-end gap-3">
        {SECTIONS.map((s, i) => {
          const on = active === s.id
          return (
            <span key={s.id} className="pointer-events-auto flex items-center gap-2.5">
              <span
                className="text-[8px] tracking-[0.3em] transition-all duration-300"
                style={{
                  color: on ? 'var(--accent)' : 'rgb(var(--z600))',
                  opacity: on ? 1 : 0.4,
                  transform: on ? 'translateX(0)' : 'translateX(4px)'
                }}
              >
                {s.label}
              </span>
              <a
                href={`#descent-${s.id}`}
                aria-label={s.label}
                className="block h-[3px] rounded-full transition-all duration-300"
                style={{
                  width: on ? 26 : 14,
                  background: on ? 'var(--accent)' : 'rgb(var(--z700))',
                  boxShadow: on ? '0 0 10px rgb(var(--accent-rgb) / 0.7)' : 'none'
                }}
              />
              <span
                className="text-[8px] tabular-nums text-zinc-700"
                style={{ opacity: on ? 1 : 0.5 }}
              >
                0{i + 1}
              </span>
            </span>
          )
        })}
      </div>

    </div>

    <style jsx>{`
      .hud-rail {
        transition: opacity 500ms ease, transform 500ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .hud-bar {
        transition: opacity 500ms ease;
      }
    `}</style>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Descent gate — the seam between hero and the first stage            */
/* ------------------------------------------------------------------ */

function DescentGate() {
  return (
    <Stage className="page-zoom-out mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-12 pb-2 sm:pt-16 sm:pb-4 text-center">
      <span
        className="st text-[9px] tracking-[0.45em] text-zinc-600"
        style={{ '--d': '0ms' } as CSSProperties}
      >
        <DecodeText text="INITIATING DESCENT" delay={150} />
      </span>
      <span
        className="st mt-4 font-serif italic text-xl text-zinc-500 md:text-2xl"
        style={{ '--d': '120ms' } as CSSProperties}
      >
        from orbit, five stages down.
      </span>
      <span
        className="st-grow mt-8 block h-14 w-px"
        style={
          {
            '--d': '260ms',
            transformOrigin: 'top center',
            background:
              'linear-gradient(180deg, rgb(var(--accent-rgb) / 0.85), transparent)'
          } as CSSProperties
        }
      />
    </Stage>
  )
}

/* ------------------------------------------------------------------ */
/* Finale — touchdown CTA                                              */
/* ------------------------------------------------------------------ */

function Finale() {
  return (
    <section className="relative overflow-hidden">
      {/* landing-pad glow rising from the floor */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-72 opacity-[0.1]"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 100%, var(--accent), transparent 70%)'
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-40"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgb(var(--accent-rgb) / 0.5), transparent)'
        }}
      />

      <Stage className="page-zoom-out relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-20 pt-20 text-center sm:pb-24 sm:pt-28 md:pt-36">
        <span
          className="st text-[9px] tracking-[0.45em] text-zinc-600"
          style={{ '--d': '0ms' } as CSSProperties}
        >
          <DecodeText text="TOUCHDOWN CONFIRMED" delay={150} />
        </span>

        <h2
          className="st mt-7 font-semibold leading-none tracking-tight text-zinc-50 text-6xl md:text-8xl"
          style={{ '--d': '110ms' } as CSSProperties}
        >
          cribble
          <span style={{ color: 'var(--accent)' }}>.</span>
        </h2>

        <p
          className="st mt-6 font-serif italic text-2xl text-zinc-400 md:text-3xl"
          style={{ '--d': '210ms' } as CSSProperties}
        >
          the board is live. your rank isn&apos;t.
        </p>

        <div
          className="st mt-11 flex flex-wrap items-center justify-center gap-4"
          style={{ '--d': '320ms' } as CSSProperties}
        >
          <Link
            href="/login"
            className="group inline-flex items-center gap-2.5 rounded-md bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
          >
            <span>Claim your callsign</span>
            <span className="text-zinc-500 transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="px-2 py-2 text-[13px] sm:px-0 sm:py-0 sm:text-xs tracking-[0.2em] text-zinc-400 transition-colors hover:text-[color:var(--accent)]"
          >
            back to orbit ↑
          </button>
        </div>

        <span
          className="st mt-20 text-[9px] tracking-[0.4em] text-zinc-700"
          style={{ '--d': '420ms' } as CSSProperties}
        >
          {'// TRANSMISSION ENDS'}
        </span>
      </Stage>
    </section>
  )
}

/* ------------------------------------------------------------------ */

export function Descent() {
  const rootRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={rootRef} className="lx-descent relative text-zinc-100 font-mono">
      <DescentHud rootRef={rootRef} />
      <DescentGate />
      <ArenaSection />
      <CockpitSection />
      <IdentitySection />
      <HonorsSection />
      <RoadmapSection />
      <Finale />

      {/* ——— LIGHT MODE: the mission dossier ———————————————————————————
          Dark mode is the native habitat; light mode is NOT an inversion.
          Concept: a technical-paper dossier (warm paper, ink type, orange
          annotation accent) with the product artifacts — standings board,
          console, pilot card, medal case, terminal — kept as DARK EMISSIVE
          HARDWARE, exactly as authored, seated on the page with real
          object shadows. `.lx-hw` re-pins every theme token inside an
          artifact back to its dark value, so plate art, neon numerals and
          medal glows never wash out on white. Green light belongs to the
          screens; orange ink belongs to the paper. */}
      <style jsx global>{`
        /* ——— DARK MODE: deep space ——————————————————————————————————
           The hero's zenith gradient settles to --space-deep at the
           fold; the descent continues that exact tone under a sparser,
           dimmer star field — five stages falling through one night.
           (Panels and hardware keep their own near-black surfaces, so
           they still read as objects sitting on the page.) */
        .lx-descent {
          background:
            radial-gradient(1.2px 1.2px at 37px 63px, rgb(190 210 255 / 0.22) 50%, transparent 55%),
            radial-gradient(1px 1px at 141px 158px, rgb(255 255 255 / 0.14) 50%, transparent 55%),
            var(--space-deep);
          background-size: 240px 240px, 300px 300px, auto;
          /* decorative glows/beams may poke past the viewport on phones;
             clip (not hidden) keeps this from becoming a scroll container,
             so page scroll + the roadmap's sticky column stay intact */
          overflow-x: clip;
        }

        html.light .lx-descent {
          /* annotation grays: theme-flipped zinc-600/700 are too pale on
             paper — remap to warm archival inks (descent scope only) */
          --z600: 110 105 90;
          --z700: 140 134 116;
          /* top edge: the hero (white in light mode) hands off into warm
             dossier paper; a faint drafting grid keeps it technical */
          background:
            linear-gradient(180deg, #ffffff 0px, rgb(255 255 255 / 0) 260px),
            repeating-linear-gradient(0deg, rgb(52 45 24 / 0.04) 0 1px, transparent 1px 56px),
            repeating-linear-gradient(90deg, rgb(52 45 24 / 0.04) 0 1px, transparent 1px 56px),
            linear-gradient(180deg, #f6f4ee 0%, #f1eee5 100%);
        }

        /* hardware scope — dark-theme tokens, verbatim from :root */
        html.light .lx-hw {
          --panel: #080808;
          --accent: #02fe01;
          --accent-rgb: 2 254 1;
          --r-common: 161 161 170;
          --r-rare: 56 189 248;
          --r-epic: 255 45 149;
          --r-legendary: 255 214 68;
          --c-black: 0 0 0;
          --c-white: 255 255 255;
          --z50: 250 250 250;
          --z100: 244 244 245;
          --z200: 228 228 231;
          --z300: 212 212 216;
          --z400: 161 161 170;
          --z500: 113 113 122;
          --z600: 82 82 91;
          --z700: 63 63 70;
          --z800: 39 39 42;
          --z900: 24 24 27;
          --z950: 9 9 11;
          --lb-gold: 255 214 68;
          --lb-gold-hi: 255 240 160;
          --lb-silver: 216 228 242;
          --lb-bronze: 255 145 77;
          --lb-up: 74 222 128;
          --lb-down: 251 113 133;
          --lb-panel-bg: 9 10 13;
          --lb-panel-edge: 255 255 255;
        }

        /* seams: hairlines cut in ink, not ghost-gray */
        html.light .lx-descent .lx-seamline {
          background: rgb(52 45 24 / 0.2);
        }

        /* console modules + rack rows: seat the dark slabs on the paper */
        html.light .lx-hw .lx-mod,
        html.light .lx-hw.lx-mod {
          box-shadow: 0 18px 38px -20px rgb(52 45 24 / 0.38);
        }

        /* the honors wall: on paper the tiles mount inside one dark medal
           case (in dark mode the page itself is the case — no chrome) */
        html.light .lx-hw.lx-case {
          background:
            linear-gradient(180deg, rgb(255 255 255 / 0.04), transparent 30%),
            rgb(5 6 8);
          border-radius: 22px;
          padding: 16px;
          box-shadow:
            0 34px 74px -36px rgb(52 45 24 / 0.55),
            0 12px 28px -18px rgb(52 45 24 / 0.3);
        }
        @media (min-width: 640px) {
          html.light .lx-hw.lx-case {
            padding: 22px;
          }
        }

        /* roadmap phase cards: index cards pinned to the dossier */
        html.light .lx-descent .rm-item {
          background: #fcfbf7;
          border-color: rgb(52 45 24 / 0.16);
          box-shadow: 0 10px 22px -16px rgb(52 45 24 / 0.3);
        }
        html.light .lx-descent .rm-item:hover {
          border-color: rgb(var(--accent-rgb) / 0.55);
        }

        /* generic paper card (readouts that live on the page, not on glass) */
        html.light .lx-descent .lx-paper {
          background: #fcfbf7;
          border-color: rgb(52 45 24 / 0.18);
          box-shadow: 0 8px 18px -14px rgb(52 45 24 / 0.28);
        }

        /* arena stat bar: printed data cells, ink numerals */
        html.light .lx-descent .lx-statgrid {
          border-color: rgb(52 45 24 / 0.18);
          background: rgb(52 45 24 / 0.14);
        }
        html.light .lx-descent .lx-statcell {
          background: #fcfbf7;
        }

        /* agent chips read as stamped tags on paper */
        html.light .lx-descent .rm-chip {
          background: #fcfbf7;
          border-color: rgb(52 45 24 / 0.18);
        }
      `}</style>
    </div>
  )
}
