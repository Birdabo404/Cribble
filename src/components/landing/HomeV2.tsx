'use client'

import { useCallback, useRef } from 'react'
import WorldwideText from '@/components/WorldwideText'
import { ACCENT, accentA } from '@/lib/theme'
import { LiquidMark } from '@/components/brand/LiquidMark'
import type { GlobeHandle } from '@/components/Globe'
import { Descent, DescentHud } from '@/components/landing/Descent'
import { DescentSpine } from '@/components/landing/DescentSpine'
import { FilmGrain } from '@/components/landing/hero/FilmGrain'
import { Footer } from '@/components/landing/hero/Footer'
import { GlobeStage } from '@/components/landing/hero/GlobeStage'
import { Header } from '@/components/landing/hero/Header'
import { HeroCta } from '@/components/landing/hero/HeroCta'
import { useHeroEntrance } from '@/components/landing/hero/heroEntrance'
import { RotatingTool } from '@/components/landing/hero/RotatingTool'
import { ToolChip } from '@/components/landing/hero/ToolChip'
import { LandingScrollRuntime } from '@/components/landing/scrollFx'

export default function HomeV2() {
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

  // Hero entrance: pre-paint arming + one GSAP timeline over the four
  // [data-hero-enter] blocks (hero/heroEntrance.ts). The old .hero-item CSS
  // keyframes are gone — CSS never animates opacity/transform on nodes the
  // pin's GSAP exits also own.
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
        until (unless) the full tier arms; the fixed overlays (HUD, spine,
        grain, atmosphere) live OUTSIDE, since transformed content can't
        host position:fixed children. */}
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
      {/* faint atmospheric wash behind the globe — cool blue, so the Earth
          owns the right half and the accent stays reserved for signals */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-[340px] w-[340px] right-[-35%] sm:h-[640px] sm:w-[640px] sm:right-[-12%] rounded-full opacity-[0.1] blur-3xl"
        style={{
          background: 'radial-gradient(circle, rgb(96 148 255), transparent 70%)'
        }}
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

      <div className="page-zoom-out relative z-10 max-w-6xl w-full mx-auto px-6 flex-1 flex flex-col">
        <Header />

        {/* 7/5 asymmetric grid: the copy column (cols 1–7) overlaps the
            globe column (cols 7–13) on an explicit z-order, and the globe
            bleeds past the container's right edge (negative margin; the
            hero's overflow-hidden clips it) — the Earth reads as the object
            the page is falling toward, not a screenshot beside a paragraph.
            Below lg it stacks: copy first, globe after. */}
        <main className="flex-1 flex items-center py-4 sm:py-8">
          <div className="grid w-full grid-cols-1 items-center gap-y-10 lg:grid-cols-12">
            {/* LEFT — hero copy in four deliberate blocks (masthead /
                display unit / body / CTA), spaced on the shared --rhythm
                scale. During the pinned entry the static text exits as
                SplitText masked lines (.lx-hero-title / .lx-hero-tagline)
                while blocks with dynamic children (WorldwideText,
                RotatingTool, LiquidMark) lift out whole (.lx-hero-exit) —
                SplitText must never own DOM that React re-renders. */}
            <div className="relative z-10 order-1 lg:col-start-1 lg:col-end-8 lg:row-start-1">
              {/* masthead — telemetry line, not a pill: status reading on
                  the left, hairline, altitude callout on the right. */}
              <div
                data-hero-enter
                className="lx-hero-exit flex items-center gap-3 text-[length:var(--fs-label)] tracking-[0.25em] sm:tracking-[0.3em] text-zinc-400"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background: ACCENT,
                    boxShadow: `0 0 8px ${accentA(0.69)}`
                  }}
                />
                <span className="whitespace-nowrap">OPEN BETA</span>
                <span className="text-zinc-700">{'//'}</span>
                <span className="whitespace-nowrap">FREE WHILE IN BETA</span>
                <span aria-hidden className="h-px flex-1 bg-zinc-800/70" />
                <span className="hidden whitespace-nowrap text-zinc-600 md:inline">
                  ALT 408KM · SIG LOCKED
                </span>
              </div>

              {/* display unit — wordmark + tagline locked together, the
                  rotating word on its own optical line under an accent
                  underline that stretches with each language
                  (.worldwide-anchor). */}
              <div data-hero-enter className="mt-[var(--rhythm-3)]">
                <h1 className="flex items-center gap-3.5 font-semibold tracking-tight leading-none text-zinc-50 text-[length:var(--fs-hero)]">
                  {/* liquid-metal hive mark, sized to the cap height */}
                  <span className="lx-hero-exit">
                    <LiquidMark size="0.92em" />
                  </span>
                  <span className="lx-hero-title">
                    cribble
                    <span style={{ color: ACCENT }}>.</span>
                  </span>
                </h1>

                {/* Editorial serif tagline — deliberate contrast against
                    the mono wordmark. */}
                <div className="mt-[var(--rhythm-1)] font-serif text-[length:var(--fs-tagline)] leading-[1.12] md:leading-[1.1]">
                  <div className="lx-hero-tagline text-zinc-400">
                    ranking AI users,
                  </div>
                  <div className="lx-hero-exit worldwide-anchor mt-[var(--rhythm-1)]">
                    <WorldwideText />
                  </div>
                </div>
              </div>

              {/* body — ~46ch measure set off by a hairline rule */}
              <div data-hero-enter className="lx-hero-exit mt-[var(--rhythm-3)]">
                <span
                  aria-hidden
                  className="block h-px w-16"
                  style={{
                    background:
                      'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.9), rgb(var(--accent-rgb) / 0.05))'
                  }}
                />
                <p className="mt-[var(--rhythm-2)] max-w-[46ch] font-sans text-[length:var(--fs-body)] leading-[1.8] text-zinc-400">
                  You&apos;re in <ToolChip>ChatGPT</ToolChip>,{' '}
                  <ToolChip>Claude</ToolChip>, <ToolChip>Cursor</ToolChip> and{' '}
                  <RotatingTool />
                  {' all day anyway. Cribble just keeps score: one quiet '}
                  extension, 47 AI sites, one worldwide board. Install it,
                  forget it, and check your rank when the group chat gets
                  cocky.
                </p>
              </div>

              {/* single CTA + proof line */}
              <div data-hero-enter className="lx-hero-exit mt-[var(--rhythm-3)]">
                <HeroCta />
              </div>
            </div>

            {/* RIGHT — globe, bleeding past the container edge on lg+. On
                the full tier the pinned entry pushes it IN via
                setScrollPose (hero/heroPin.ts); on lite/still the stacked
                or static hero never receded anyway. */}
            <div className="relative z-0 order-2 lg:col-start-7 lg:col-end-13 lg:row-start-1 lg:-mr-24 xl:-mr-36">
              <GlobeStage onGlobeReady={handleGlobeReady} />
            </div>
          </div>
        </main>

        <Footer />
      </div>

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
           it tracks the width the rotator writes on the wrap above it. */
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
      `}</style>
    </div>

    {/* THE DESCENT — hero stays exactly as it was; the story continues
        below the fold: arena → cockpit → identity → honors → flight plan. */}
    <Descent rootRef={descentRef} />
      </div>
    </div>

    {/* ALTITUDE HUD — hoisted out of Descent: ScrollSmoother transforms
        #smooth-content, and position:fixed dies inside a transform, so
        every fixed overlay lives out here as a sibling of the wrapper. */}
    <DescentHud rootRef={descentRef} />

    {/* TRAJECTORY SPINE — fixed left gutter, lg+ and full tier only:
        left gutter is trajectory, right rail is telemetry. */}
    <DescentSpine descentRef={descentRef} />

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
