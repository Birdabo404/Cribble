'use client'

import { useCallback, useMemo, useRef } from 'react'
import WorldwideText from '@/components/WorldwideText'
import { accentA } from '@/lib/theme'
import type { GlobePinInput } from '@/components/ditherEarthRenderer'
import type { GlobeHandle } from '@/components/Globe'
import { Descent } from '@/components/landing/Descent'
import { DescentProgress } from '@/components/landing/DescentProgress'
import { DescentSpine } from '@/components/landing/DescentSpine'
import { FilmGrain } from '@/components/landing/hero/FilmGrain'
import { Footer } from '@/components/landing/hero/Footer'
import { GlobeInstrument } from '@/components/landing/hero/GlobeInstrument'
import { HeroCta } from '@/components/landing/hero/HeroCta'
import { useHeroEntrance } from '@/components/landing/hero/heroEntrance'
import { Numeral } from '@/components/landing/hero/Numeral'
import { Rail } from '@/components/landing/hero/Rail'
import { Tower } from '@/components/landing/hero/Tower'
import { PILOTS } from '@/components/landing/pilots'
import { LandingScrollRuntime } from '@/components/landing/scrollFx'
// Type-only on purpose: landingLive.ts is server code (service-role
// client) and must never enter this client bundle.
import type { GlobePin, LandingLive } from '@/lib/landingLive'

/** Real players → the renderer's vocabulary. The chip prints the city
 *  slot in caps, so the country name lands as "@handle · UNITED STATES". */
const toGlobePin = (pin: GlobePin): GlobePinInput => ({
  callsign: pin.handle,
  city: pin.countryName,
  lat: pin.lat,
  lng: pin.lng
})

export default function HomeV2({
  live
}: {
  /** Fetched by page.tsx (ISR, 5 min) and handed down as plain JSON. */
  live: LandingLive
}) {
  // The globe's pin count is a shader compile-time constant, so the list
  // is memoised: a new array would tear the renderer down and rebuild it.
  // Nothing live (read failed, or a build without secrets) → the static
  // roster, so the planet is never bare.
  const pins = useMemo<GlobePinInput[]>(
    () => (live.pins.length > 0 ? live.pins.map(toGlobePin) : PILOTS),
    [live.pins]
  )

  // Shared wiring for the motion layer (see LandingScrollRuntime). All
  // inert until the GSAP chunk idle-loads — and it never loads on the
  // 'still' tier, leaving this page byte-identical to its CSS-only self.
  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const descentRef = useRef<HTMLDivElement>(null)
  const globeHandleRef = useRef<GlobeHandle | null>(null)
  const handleGlobeReady = useCallback((handle: GlobeHandle) => {
    globeHandleRef.current = handle
  }, [])

  // Hero entrance: pre-paint arming + one GSAP timeline over the
  // [data-hero-enter] blocks (hero/heroEntrance.ts). CSS never animates
  // opacity/transform on nodes the pin's GSAP exits also own.
  useHeroEntrance(heroRef)

  return (
    <>
    {/* ATMOSPHERE — the page-long color journey (dark mode, full tier
        only). Fixed gradient layers cross-faded by opacity from --alt,
        painted UNDER #smooth-wrapper (earlier sibling; the smoother makes
        the wrapper position:fixed, so tree order keeps content on top).
        display:none until html.lx-motion-full arms it — see globals.css. */}
    <div aria-hidden className="lx-atmo">
      <div className="lx-atmo-base" />
      <div className="lx-atmo-stars" />
      <div className="lx-atmo-strato" />
      <div className="lx-atmo-meso" />
      <div className="lx-atmo-dusk" />
    </div>

    {/* SMOOTH WRAPPER — ScrollSmoother's wrapper/content pair. Plain divs
        until (unless) the full tier arms; the fixed overlays (rope, phone
        progress hairline, grain, atmosphere) live OUTSIDE, since
        transformed content can't host position:fixed children. */}
    <div id="smooth-wrapper" ref={wrapperRef}>
      <div id="smooth-content" ref={contentRef}>
    <div
      ref={heroRef}
      className="min-h-screen-safe lx-hero text-zinc-100 font-mono selection:bg-accent/20 flex flex-col relative overflow-hidden"
    >
      {/* star tiles on their own layer so the hero pin can streak them via
          transform (scaleY) instead of repainting background-size. Hidden
          (and the tiles stay on .lx-hero itself) until the full tier arms. */}
      <div
        aria-hidden
        className="lx-hero-stars pointer-events-none absolute inset-0"
      />
      {/* thin horizon line — single retro accent. The hero pin flares it
          into the tear at the end of the atmospheric entry (.lx-horizon). */}
      <div
        aria-hidden
        className="lx-horizon pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-30"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentA(0.33)}, transparent)`
        }}
      />

      {/* THE MANIFEST — a compartmented 12-col grid drawn in 1px hairlines
          over the star field (cells stay transparent, so lines are borders,
          each owned by exactly one edge so none doubles). Rows: rail /
          board / footer strip. Below lg everything stacks and the hairlines
          go horizontal only. Lines that would outlive their compartment
          mid-pin are standalone spans instead of borders — [data-hero-line]
          (horizontal) / [data-hero-vline] (vertical) — so the entrance can
          grow them and the pin can collapse them with a compositor-only
          scale; borders stay only where the owning cell fades as a whole.
          The zoom container stays: the pin's spacer math depends on
          .page-zoom-out being INSIDE .lx-hero. */}
      <div className="page-zoom-out relative z-10 max-w-6xl w-full mx-auto px-6 flex-1 flex flex-col">
        <Rail playerCount={live.playerCount} season={live.season} />

        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12">
          {/* LEFT — the score to beat, the serif line, the CTA. An inline-
              size container so the numeral can size itself to this column
              (see .lx-numeral). During the pinned entry the static text
              exits as SplitText masked lines (.lx-hero-title /
              .lx-hero-tagline) while blocks with dynamic children
              (WorldwideText) lift out whole (.lx-hero-exit) — SplitText
              must never own DOM that React re-renders. */}
          <div className="flex min-w-0 flex-col justify-center py-[var(--rhythm-3)] [container-type:inline-size] lg:col-span-7 lg:py-10 lg:pr-8">
            <Numeral />

            <div
              data-hero-enter
              className="mt-[var(--rhythm-3)] text-[length:var(--fs-tagline)] leading-[1.1]"
            >
              <div
                className="lx-hero-tagline font-serif"
                style={{ color: 'var(--lx-ink-dim)' }}
              >
                ranking AI users,
              </div>
              <div className="lx-hero-exit worldwide-anchor mt-[var(--rhythm-1)]">
                <WorldwideText />
              </div>
            </div>

            <div data-hero-enter className="lx-hero-exit mt-[var(--rhythm-3)]">
              <HeroCta />
            </div>
          </div>

          {/* RIGHT — two compartments split by a hairline: the tower on
              top, the globe instrument below. The column divider and the
              split are spans (the column owns the planet, so it can never
              fade; the split rides the tower wrapper's bottom edge so the
              frame draws before the compartment fills). The tower wrapper
              is an .lx-hero-exit block: the pin staggers the rows out, then
              this fades the table shell — header, cell borders and all —
              right behind them. The instrument's compartment is the
              instrument's direct parent on purpose: the pin measures that
              rect as the resting spot it drifts from. */}
          <div className="relative flex flex-col lg:col-span-5">
            <span
              aria-hidden
              data-hero-vline
              className="absolute inset-y-0 left-0 hidden w-px lg:block"
              style={{ background: 'var(--lx-line)', transformOrigin: 'center top' }}
            />
            <div className="lx-hero-exit relative pb-4">
              <span
                aria-hidden
                data-hero-line
                className="absolute inset-x-0 top-0 h-px lg:hidden"
                style={{ background: 'var(--lx-line)', transformOrigin: 'left center' }}
              />
              <Tower />
              <span
                aria-hidden
                data-hero-line
                className="absolute inset-x-0 bottom-0 h-px"
                style={{ background: 'var(--lx-line)', transformOrigin: 'left center' }}
              />
            </div>
            <div
              data-hero-enter
              className="flex min-h-[260px] flex-1 items-center justify-center py-5"
            >
              <GlobeInstrument
                onGlobeReady={handleGlobeReady}
                pins={pins}
                playerCount={live.playerCount}
              />
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>

    {/* THE DESCENT — the remaining sheets of the manifest: a contents rail,
        then arena → cockpit → identity → honors → flight plan on the same
        substrate as the hero, and the touchdown bookend. */}
    <Descent rootRef={descentRef} live={live} />
      </div>
    </div>

    {/* THE ROPE — fixed left gutter, lg+ and full tier only: the one depth
        instrument, spanning the hero pin through touchdown. Lives out here
        as a sibling of the wrapper because ScrollSmoother transforms
        #smooth-content and position:fixed dies inside a transform. */}
    <DescentSpine heroRef={heroRef} descentRef={descentRef} />

    {/* PHONE PROGRESS — the rope's stand-in below lg: a 1px hairline at
        the top edge filling with the same fall progress. */}
    <DescentProgress heroRef={heroRef} descentRef={descentRef} />

    {/* FILM GRAIN — deliberately a sibling of the smooth wrapper: outside
        the hero's overflow-hidden shell, outside every .page-zoom-out
        wrapper, and outside the transformed smooth content, so the fixed
        sheet covers the viewport 1:1 without being rescaled or clipped. */}
    <FilmGrain />

    {/* Headless orchestrator: tier pick, idle chunk load, smoother/pin/
        velocity/atmosphere arming, runtime publish. */}
    <LandingScrollRuntime
      wrapperRef={wrapperRef}
      contentRef={contentRef}
      heroRef={heroRef}
      globeHandleRef={globeHandleRef}
    />
    </>
  )
}
