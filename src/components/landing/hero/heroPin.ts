// The pinned atmospheric entry — Layer 2 of the "Controlled Fall" plan and
// the hero-to-descent WOW moment. Full tier only (LandingScrollRuntime only
// calls this after creating the ScrollSmoother).
//
// One ScrollTrigger pins the OUTER .lx-hero for +260% of a viewport and
// scrubs a single timeline through the entry. The globe instrument (a
// 220–260px compartment, bottom-right of the manifest) drifts to the viewport
// center on both axes (a transform written by the pose follower below, so
// position and zoom stay phase-locked) while the renderer's ortho zoom
// grows the planet to well over half the viewport (via the GlobeHandle
// scroll pose — sharp, no raster scaling) and its own dither dropout
// erodes the raster from p = 0.6. Meanwhile the star tiles stretch into
// streaks (transform-based scaleY on the dedicated .lx-hero-stars layer —
// no background-size repaints), the manifest exits — numeral and serif as
// SplitText masked lines, tower rows staggered top→bottom, rail/footer/
// header cells and the dynamic blocks fading, every standalone hairline
// collapsing along its own axis — so by p ≈ 0.4 only the planet, the stars
// and the horizon remain, and the horizon hairline flares into the tear
// that hands off to the Contents rail below.
//
// Pinning rule (from the plan): pin .lx-hero itself, NEVER anything inside
// .page-zoom-out — that utility is `zoom: 0.9`, and GSAP computes
// pin-spacer height from visual pixels, so a pin inside the zoom container
// would be off by 1/0.9 and the page would jump. .page-zoom-out is a child
// of .lx-hero, so the outer pin is safe.

import type { GlobeHandle } from '@/components/Globe'
import type { LandingMotion } from '@/lib/landingMotion'
import { settleHeroEntrance, whenHeroEntranceSettled } from './heroEntrance'

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
  // Hoisted so cleanup can pull the pose follower off gsap.ticker; only
  // build() assigns it, so a skipped pin never runs a ticker callback.
  let tickPose: ((time: number, deltaTime: number) => void) | null = null
  // Hoisted so cleanup can strip the drift transform the follower wrote.
  let stageEl: HTMLElement | null = null
  let splits: SplitTextInstance[] = []
  let willChangeTargets: HTMLElement[] = []

  // Instrument Serif loads with preload: false, so the tagline's line
  // breaks aren't final until fonts resolve. The exit splits live inside a
  // scrubbed timeline (autoSplit can't rebuild tweens that belong to a
  // timeline), so instead of autoSplit we simply build once, after fonts —
  // and after the GSAP entrance cascade settles, so the pin never splits or
  // tweens nodes another timeline is mid-animating.
  void document.fonts.ready.then(() => {
    if (killed) return
    // If the visitor already scrolled past the hero while the chunk was
    // loading, installing the pin now would grow the page by +260vh under
    // them — a guaranteed layout jump for zero payoff (the entry moment is
    // behind them). Skip it; everything else still arms.
    if (window.scrollY > hero.offsetHeight * 0.5) return
    whenHeroEntranceSettled(() => {
      if (killed) return
      if (window.scrollY > hero.offsetHeight * 0.5) return
      build()
    })
  })

  function build() {
    // Safety valve: if an entrance is somehow still in flight, jump it to
    // its end and kill it, so every exit below is built over settled
    // values — including the numeral's count-up text, which SplitText
    // slices below.
    settleHeroEntrance()

    const { gsap, ScrollTrigger, SplitText } = motion

    const stars = hero.querySelector<HTMLElement>('.lx-hero-stars')
    const horizon = hero.querySelector<HTMLElement>('.lx-horizon')
    const copyBlocks = Array.from(
      hero.querySelectorAll<HTMLElement>('.lx-hero-exit')
    )
    // Tower rows and rail/header/footer cells, in document order — the
    // stagger reads top→bottom for the rows, left→right along the rail.
    const rows = Array.from(
      hero.querySelectorAll<HTMLElement>('[data-hero-row]')
    )
    const cells = Array.from(
      hero.querySelectorAll<HTMLElement>('[data-hero-cell]')
    )
    // Standalone hairlines (rail bottom, tower header, tower/globe split,
    // the column divider) — the frame the entrance grew in.
    const lines = Array.from(
      hero.querySelectorAll<HTMLElement>('[data-hero-line]')
    )
    const vlines = Array.from(
      hero.querySelectorAll<HTMLElement>('[data-hero-vline]')
    )

    // Globe drift: as the pin progresses the whole instrument (canvas, chip
    // overlay, annotation — one container carries them all) translates
    // from its compartment to the viewport center, while the renderer's
    // ortho zoom does the actual growing (sharp — no raster scaling) and a
    // whisper of container scale tops off the composition.
    const stage = hero.querySelector<HTMLElement>('.globe-instrument')
    stageEl = stage
    // The square footprint is the instrument's first child (see
    // GlobeInstrument.tsx); the planet is centered in it.
    const footprint = stage?.firstElementChild
    const DRIFT_START = 0.1 // the copy owns the frame until ~0.4 — leave gently
    const DRIFT_END = 0.62 // centered as the dropout begins, before the flare
    const DRIFT_SCALE_MAX = 1.1 // container scale on top of the WebGL zoom

    // Layout px at full drift — measured live, never a vw guess.
    let driftX = 0
    let driftY = 0
    // Footprint center's layout offset from the compartment center: the
    // annotation under the square shifts it, and the compartment may be
    // taller than the instrument. Only re-sampled while the stage carries
    // no drift transform (its rect is untrustworthy mid-pin).
    let footprintDX = 0
    let footprintDY = 0
    const measureDrift = () => {
      // The stage's parent (the manifest's instrument compartment) never
      // carries a transform, so its rect is the stage's true resting spot
      // even when a refresh lands mid-pin with the drift applied. Rects
      // come back in VISUAL px while translations inside .page-zoom-out
      // (zoom 0.9) apply in LAYOUT px — the offsetWidth ratio recovers the
      // cumulative zoom to divide back out.
      const column = stage?.parentElement
      if (!stage || !column) return
      const rect = column.getBoundingClientRect()
      if (!rect.width || !column.offsetWidth) return
      const zoom = rect.width / column.offsetWidth
      const columnX = rect.left + rect.width / 2
      const columnY = rect.top + rect.height / 2
      if (footprint && !stage.style.transform) {
        const fp = footprint.getBoundingClientRect()
        footprintDX = (fp.left + fp.width / 2 - columnX) / zoom
        footprintDY = (fp.top + fp.height / 2 - columnY) / zoom
      }
      driftX = (window.innerWidth / 2 - columnX) / zoom - footprintDX
      driftY = (window.innerHeight / 2 - columnY) / zoom - footprintDY
    }
    measureDrift()

    // Masked line exits for the static text only: the numeral wrapper
    // (.lx-hero-title — its text is written once by the entrance count-up,
    // settled above) and the static serif line (.lx-hero-tagline).
    // WorldwideText re-renders its own DOM, so it exits as a whole block
    // (.lx-hero-exit) instead of being split.
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
      ...copyBlocks,
      ...rows,
      ...cells,
      ...lines,
      ...vlines
    ]

    timeline = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        // +260% (up from +130%) halves the scroll gain: one wheel notch now
        // moves the cascade half as far, and the relative timings below
        // stretch proportionally with it.
        end: '+=260%',
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
        },
        // Layout moved under the pin (resize, font swap, pin-spacer math):
        // re-measure the drift geometry against the fresh rects.
        onRefresh: () => measureDrift()
      }
    })

    // Duration anchor: the relative positions below stay "fraction of the
    // pin" even if every DOM target were missing and the timeline would
    // otherwise have no duration-1 member.
    timeline.to({}, { duration: 1 }, 0)

    // Globe push-in: ortho zoom + pitch/yaw toward the horizon, composed
    // with drag-to-spin inside the renderer. The pose gets its own
    // smoothing instead of riding the scrub: scrub's expo.out closes ~63%
    // of the gap in the first fifth of its duration, so every wheel notch
    // lurched the planet forward then crawled. A critically damped spring
    // closes the same gap with velocity continuity — a scroll reversal
    // bends the pose instead of kinking it — and MAX_RATE caps how fast
    // the cascade can advance however hard the wheel is flicked. Writing
    // the pose target still costs nothing: the globe's own rAF applies it,
    // and the burst seek is one paused-timeline render.
    const POSE_OMEGA = 5.5 // rad/s, ~0.7s to settle: the "weight" dial
    const POSE_MAX_RATE = 0.5 // pose units/s: cascade cannot run under ~2s
    const POSE_REST = 0.0002

    const st = timeline.scrollTrigger
    let poseValue = 0
    let poseVelocity = 0
    let poseSettled = true

    tickPose = (_time, deltaMs) => {
      const target = st?.progress ?? 0

      // Settled short-circuit — the same idle guard startVelocityFeedback
      // uses, so a page at rest does no pose work per tick.
      if (poseSettled && Math.abs(target - poseValue) < POSE_REST) return

      // dt clamp: a backgrounded tab hands back one huge delta, and an
      // unbounded step would teleport the cascade on return.
      const dt = Math.min(deltaMs, 34) / 1000

      // exact step of x'' + 2*w*x' + w^2*(x - target) = 0 (critical
      // damping): unconditionally stable, no overshoot, frame-rate
      // independent.
      const d = poseValue - target
      const c = poseVelocity + POSE_OMEGA * d
      const e = Math.exp(-POSE_OMEGA * dt)
      let next = target + (d + c * dt) * e
      poseVelocity = (poseVelocity - POSE_OMEGA * c * dt) * e

      const maxStep = POSE_MAX_RATE * dt
      const step = next - poseValue
      if (step > maxStep) {
        next = poseValue + maxStep
        poseVelocity = POSE_MAX_RATE
      } else if (step < -maxStep) {
        next = poseValue - maxStep
        poseVelocity = -POSE_MAX_RATE
      }

      poseValue = next
      poseSettled = Math.abs(target - poseValue) < POSE_REST
      if (poseSettled) {
        poseValue = target
        poseVelocity = 0
      }

      globeHandle()?.setScrollPose(poseValue)

      // Instrument drift rides the same follower (never the scrub
      // timeline), eased by a smoothstep so departure and arrival are both
      // soft. At rest the inline transform is stripped entirely, so the
      // untouched-instrument guarantee for tiers that never build the pin
      // also holds for a pin scrubbed back to 0.
      if (stage) {
        const t = Math.min(
          1,
          Math.max(0, (poseValue - DRIFT_START) / (DRIFT_END - DRIFT_START))
        )
        if (t <= 0) {
          if (stage.style.transform) stage.style.transform = ''
        } else {
          const eased = t * t * (3 - 2 * t)
          const scale = 1 + (DRIFT_SCALE_MAX - 1) * eased
          stage.style.transform = `translate(${(driftX * eased).toFixed(
            2
          )}px, ${(driftY * eased).toFixed(2)}px) scale(${scale.toFixed(4)})`
        }
      }
    }
    gsap.ticker.add(tickPose)

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

    // Manifest exit: masked lines rise up out of their clip edges, tower
    // rows lift out top→bottom, cells and dynamic blocks fade. All
    // transform/opacity — and every exit is an explicit fromTo with hard
    // start values, so GSAP never derives a start by sampling a transient
    // computed style (a `.to(autoAlpha)` here once latched opacity 0 off
    // the old CSS entrance mid-delay and pinned the badge and body
    // invisible forever). immediateRender stays off: the entrance settled
    // these nodes at their resting pose, and the scrub re-asserts the same
    // hard values the moment it renders. Positions, durations and staggers
    // are sized for the +=260% pin, so the copy spends ~40% of the scrub
    // clearing the frame — the planet owns the rest.
    if (titleLines.length) {
      timeline.fromTo(
        titleLines,
        { yPercent: 0 },
        {
          yPercent: -120,
          duration: 0.19,
          stagger: 0.025,
          ease: 'power2.in',
          immediateRender: false
        },
        0.025
      )
    }
    if (taglineLines.length) {
      timeline.fromTo(
        taglineLines,
        { yPercent: 0 },
        {
          yPercent: -120,
          duration: 0.19,
          stagger: 0.025,
          ease: 'power2.in',
          immediateRender: false
        },
        0.06
      )
    }
    if (rows.length) {
      timeline.fromTo(
        rows,
        { autoAlpha: 1, y: 0 },
        {
          autoAlpha: 0,
          y: -24,
          duration: 0.19,
          stagger: 0.025,
          ease: 'power2.in',
          immediateRender: false
        },
        0.05
      )
    }
    if (copyBlocks.length) {
      timeline.fromTo(
        copyBlocks,
        { autoAlpha: 1, y: 0 },
        {
          autoAlpha: 0,
          y: -36,
          duration: 0.19,
          stagger: 0.025,
          ease: 'power2.in',
          immediateRender: false
        },
        0.04
      )
    }
    if (cells.length) {
      timeline.fromTo(
        cells,
        { autoAlpha: 1 },
        {
          autoAlpha: 0,
          duration: 0.15,
          stagger: 0.012,
          ease: 'power2.in',
          immediateRender: false
        },
        0.03
      )
    }
    // The frame's hairlines collapse the way they grew — from the left
    // edge, and from the top for the verticals — so the empty grid never
    // outlives the copy it framed.
    if (lines.length) {
      timeline.fromTo(
        lines,
        { scaleX: 1, transformOrigin: 'left center' },
        {
          scaleX: 0,
          duration: 0.15,
          ease: 'power2.in',
          immediateRender: false
        },
        0.04
      )
    }
    if (vlines.length) {
      timeline.fromTo(
        vlines,
        { scaleY: 1, transformOrigin: 'center top' },
        {
          scaleY: 0,
          duration: 0.15,
          ease: 'power2.in',
          immediateRender: false
        },
        0.04
      )
    }

    // The horizon hairline flares and widens into the tear, late — the
    // last thing seen before the Contents rail's hairline draws in below.
    if (horizon) {
      timeline.to(
        horizon,
        {
          scaleY: 9,
          opacity: 0.85,
          transformOrigin: '50% 100%',
          duration: 0.18,
          ease: 'power2.in'
        },
        0.78
      )
    }

    // The pin spacer just added +260vh ahead of every trigger below the
    // hero (Stage --p scrubs, HUD, spine, atmosphere). Re-sort so refresh
    // order follows document position, then recompute.
    ScrollTrigger.sort()
    ScrollTrigger.refresh()
  }

  return () => {
    killed = true
    if (tickPose) motion.gsap.ticker.remove(tickPose)
    tickPose = null
    timeline?.scrollTrigger?.kill()
    timeline?.kill()
    timeline = null
    // After the follower and timeline are dead (no more renders), strip
    // every inline style this module wrote, restoring the untouched
    // manifest for whatever mounts next.
    if (stageEl) {
      stageEl.style.transform = ''
      stageEl = null
    }
    splits.forEach((split) => split.revert())
    splits = []
    willChangeTargets.forEach((el) => {
      el.style.willChange = ''
    })
    willChangeTargets = []
  }
}
