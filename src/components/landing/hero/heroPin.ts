// The pinned atmospheric entry — Layer 2 of the "Controlled Fall" plan and
// the hero-to-descent WOW moment. Full tier only (LandingScrollRuntime only
// calls this after creating the ScrollSmoother).
//
// One ScrollTrigger pins the OUTER .lx-hero for +90% of a viewport and
// scrubs a single timeline through the entry: the globe pushes in toward
// the horizon (via the GlobeHandle scroll pose), the star tiles stretch
// into streaks (transform-based scaleY on the dedicated .lx-hero-stars
// layer — no background-size repaints), the hero copy exits as SplitText
// masked lines / staggered blocks, and the horizon hairline flares into
// the tear that hands off to DescentGate.
//
// Pinning rule (from the plan): pin .lx-hero itself, NEVER anything inside
// .page-zoom-out — that utility is `zoom: 0.9`, and GSAP computes
// pin-spacer height from visual pixels, so a pin inside the zoom container
// would be off by 1/0.9 and the page would jump. .page-zoom-out is a child
// of .lx-hero, so the outer pin is safe.

import type { GlobeHandle } from '@/components/Globe'
import type { LandingMotion } from '@/lib/landingMotion'

type TimelineInstance = ReturnType<LandingMotion['gsap']['timeline']>
type SplitTextInstance = ReturnType<LandingMotion['SplitText']['create']>

export interface HeroPinOptions {
  /** The outer .lx-hero element (NOT inside .page-zoom-out). */
  hero: HTMLElement
  /** Late-bound accessor: the globe chunk may land after the pin builds,
   *  and GlobeHandle.setScrollPose replays the latest pose on init. */
  globeHandle: () => GlobeHandle | null
}

export function createHeroPin(
  motion: LandingMotion,
  { hero, globeHandle }: HeroPinOptions
): () => void {
  let killed = false
  let timeline: TimelineInstance | null = null
  let splits: SplitTextInstance[] = []
  let willChangeTargets: HTMLElement[] = []

  // Instrument Serif loads with preload: false, so the tagline's line
  // breaks aren't final until fonts resolve. The exit splits live inside a
  // scrubbed timeline (autoSplit can't rebuild tweens that belong to a
  // timeline), so instead of autoSplit we simply build once, after fonts.
  void document.fonts.ready.then(() => {
    if (killed) return
    // If the visitor already scrolled past the hero while the chunk was
    // loading, installing the pin now would grow the page by +90vh under
    // them — a guaranteed layout jump for zero payoff (the entry moment is
    // behind them). Skip it; everything else still arms.
    if (window.scrollY > hero.offsetHeight * 0.5) return
    build()
  })

  function build() {
    const { gsap, ScrollTrigger, SplitText } = motion

    const stars = hero.querySelector<HTMLElement>('.lx-hero-stars')
    const horizon = hero.querySelector<HTMLElement>('.lx-horizon')
    const copyBlocks = Array.from(
      hero.querySelectorAll<HTMLElement>('.lx-hero-exit')
    )

    // Masked line exits for the static text only. The wordmark span and the
    // "ranking AI users," line have no dynamic children; WorldwideText,
    // RotatingTool and LiquidMark re-render/re-draw their own DOM, so they
    // exit as whole blocks (.lx-hero-exit) instead of being split.
    const splitLines = (selector: string): Element[] => {
      const el = hero.querySelector<HTMLElement>(selector)
      if (!el) return []
      // same guard the data-split entrance targets get from the Stage CSS:
      // kerning differences between raw text and line-sliced spans read as
      // a wobble at split time
      el.style.fontKerning = 'none'
      const split = SplitText.create(el, {
        type: 'lines',
        mask: 'lines',
        aria: 'auto'
      })
      splits.push(split)
      return split.lines
    }
    const titleLines = splitLines('.lx-hero-title')
    const taglineLines = splitLines('.lx-hero-tagline')

    willChangeTargets = [
      ...(stars ? [stars] : []),
      ...(horizon ? [horizon] : []),
      ...copyBlocks
    ]

    const pose = { p: 0 }
    timeline = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: '+=90%',
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        // will-change only while pinned — matching the discipline the old
        // HeroGlobeRecede listener used — so the layers aren't held
        // rasterized for the life of the page.
        onToggle: (self) => {
          const value = self.isActive ? 'transform, opacity' : ''
          willChangeTargets.forEach((el) => {
            el.style.willChange = value
          })
        }
      }
    })

    // Globe push-in: ortho zoom + pitch/yaw toward the horizon, composed
    // with drag-to-spin inside the renderer. Writing the pose target costs
    // nothing — the globe's own rAF applies it.
    timeline.to(
      pose,
      {
        p: 1,
        duration: 1,
        onUpdate: () => globeHandle()?.setScrollPose(pose.p)
      },
      0
    )

    // Star streak: the dedicated star layer stretches vertically —
    // transform-only, no background repaints (the plan's --streak
    // background-size route was the fallback; this is the cheap path).
    if (stars) {
      timeline.fromTo(
        stars,
        { scaleY: 1, transformOrigin: '50% 18%' },
        { scaleY: 2.6, opacity: 0.8, duration: 1, ease: 'power1.in' },
        0
      )
    }

    // Hero copy exit: masked lines rise up out of their clip edges,
    // dynamic blocks lift and fade. All transform/opacity.
    if (titleLines.length) {
      timeline.to(
        titleLines,
        {
          yPercent: -120,
          duration: 0.38,
          stagger: 0.05,
          ease: 'power2.in'
        },
        0.05
      )
    }
    if (taglineLines.length) {
      timeline.to(
        taglineLines,
        {
          yPercent: -120,
          duration: 0.38,
          stagger: 0.05,
          ease: 'power2.in'
        },
        0.12
      )
    }
    if (copyBlocks.length) {
      timeline.to(
        copyBlocks,
        {
          autoAlpha: 0,
          y: -36,
          duration: 0.38,
          stagger: 0.05,
          ease: 'power2.in'
        },
        0.08
      )
    }

    // The horizon hairline flares and widens into the tear, late — the
    // last thing seen before DescentGate's INITIATING DESCENT decode.
    if (horizon) {
      timeline.to(
        horizon,
        {
          scaleY: 9,
          opacity: 0.85,
          transformOrigin: '50% 100%',
          duration: 0.3,
          ease: 'power2.in'
        },
        0.7
      )
    }

    // The pin spacer just added +90vh ahead of every trigger below the
    // hero (Stage --p scrubs, HUD, spine, atmosphere). Re-sort so refresh
    // order follows document position, then recompute.
    ScrollTrigger.sort()
    ScrollTrigger.refresh()
  }

  return () => {
    killed = true
    timeline?.scrollTrigger?.kill()
    timeline?.kill()
    timeline = null
    splits.forEach((split) => split.revert())
    splits = []
    willChangeTargets.forEach((el) => {
      el.style.willChange = ''
    })
    willChangeTargets = []
  }
}
