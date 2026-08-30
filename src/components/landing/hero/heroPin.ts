// The pinned atmospheric entry — Layer 2 of the "Controlled Fall" plan and
// the hero-to-descent WOW moment. Full tier only (LandingScrollRuntime only
// calls this after creating the ScrollSmoother).
//
// One ScrollTrigger pins the OUTER .lx-hero for +260% of a viewport and
// scrubs a single timeline through the entry: the globe pushes in toward
// the horizon (via the GlobeHandle scroll pose — the renderer's own
// dither dropout erodes the planet late in the pose) and its stage
// drifts from the right column to the horizontal viewport center (a
// transform written by the same pose follower, so position and zoom stay
// phase-locked) while the GlobeStage hardware carriers (orbit ring,
// dotted ring, both satellites) fade out on opacity-only tweens, the
// star tiles stretch into streaks (transform-based scaleY on the
// dedicated .lx-hero-stars layer — no background-size repaints), the
// hero copy exits as SplitText masked lines / staggered blocks, and the
// horizon hairline flares into the tear that hands off to DescentGate.
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
  // Hoisted so cleanup can strip the exit tweens' inline opacity and the
  // polar carrier's mid-flight z-index guard (see the fade block below).
  let carrierEls: HTMLElement[] = []
  let satPolarEl: HTMLElement | null = null
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
    // its end and kill it, so every exit below is built over settled values.
    settleHeroEntrance()

    const { gsap, ScrollTrigger, SplitText } = motion

    const stars = hero.querySelector<HTMLElement>('.lx-hero-stars')
    const horizon = hero.querySelector<HTMLElement>('.lx-horizon')
    const copyBlocks = Array.from(
      hero.querySelectorAll<HTMLElement>('.lx-hero-exit')
    )

    // Globe drift: as the pin progresses the whole stage (canvas, chip
    // overlay, DOM ring/satellite carriers — one container carries them
    // all) translates from its right-column resting spot to the
    // horizontal viewport center, while the renderer's ortho zoom does
    // the actual growing (sharp — no raster scaling) and a whisper of
    // container scale tops off the composition.
    const stage = hero.querySelector<HTMLElement>('.globe-stage')
    stageEl = stage

    // The stage hardware around the planet — orbit ring, dotted ring and
    // both satellites — exits on the data-burst carriers (GlobeStage.tsx
    // wraps each piece in one). The globe itself never fades: its exit is
    // the renderer's dither dropout, driven by the scroll pose.
    const ring = hero.querySelector<HTMLElement>('[data-burst="ring"]')
    const glow = hero.querySelector<HTMLElement>('[data-burst="glow"]')
    const satEquatorial = hero.querySelector<HTMLElement>(
      '[data-burst="sat-equatorial"]'
    )
    const satPolar = hero.querySelector<HTMLElement>('[data-burst="sat-polar"]')
    satPolarEl = satPolar
    carrierEls = [ring, glow, satEquatorial, satPolar].filter(
      (el): el is HTMLElement => el !== null
    )
    const DRIFT_START = 0.1 // the copy owns the left until ~24% — leave gently
    const DRIFT_END = 0.62 // centered well after the copy exit, before the flare
    const DRIFT_SCALE_MAX = 1.08 // container scale on top of the WebGL zoom
    // Where the hardware carrier fades start on the scrub timeline; the
    // polar z-index guard below lifts just ahead of this.
    const HW_FADE_START = 0.2
    const HW_FADE_DURATION = 0.17
    const HW_FADE_STAGGER = 0.025

    let driftX = 0 // layout px at full drift — measured live, never a vw guess
    const measureDrift = () => {
      // The stage's parent (the hero grid's globe column) never carries a
      // transform, so its rect is the stage's true resting spot even when
      // a refresh lands mid-pin with the drift applied. Rects come back
      // in VISUAL px while translations inside .page-zoom-out (zoom 0.9)
      // apply in LAYOUT px — the offsetWidth ratio recovers the
      // cumulative zoom to divide back out.
      const column = stage?.parentElement
      if (!column) return
      const rect = column.getBoundingClientRect()
      if (!rect.width || !column.offsetWidth) return
      const zoom = rect.width / column.offsetWidth
      driftX = (window.innerWidth / 2 - (rect.left + rect.width / 2)) / zoom
    }
    measureDrift()

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

    // Stage hardware exits — OPACITY ONLY, and every start value is a hard
    // 1, never sampled. THE STACKING-CONTEXT GOTCHA (see GlobeStage.tsx):
    // the polar sat's CSS keyframes animate z-index 0↔2 to interleave with
    // the globe canvas (z-[1]) for limb clipping, and that interleave only
    // works while its carrier has NO stacking context. Inline opacity: 1
    // (what this fromTo re-asserts at scrub 0) creates none; any inline
    // transform would — so the carriers must never be tweened on
    // transforms. While the fade is mid-flight (opacity < 1 IS a stacking
    // context) the pose follower below lifts the carrier to z-index 2 so
    // the departing craft rides above the planet instead of vanishing
    // behind it, and strips the lift again at rest.
    if (carrierEls.length) {
      timeline.fromTo(
        carrierEls,
        { opacity: 1 },
        {
          opacity: 0,
          duration: HW_FADE_DURATION,
          stagger: HW_FADE_STAGGER,
          ease: 'power1.in',
          immediateRender: false
        },
        HW_FADE_START
      )
    }

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
    // Mirrors whether the polar carrier's inline z-index guard is applied,
    // so the follower never reads the style object back per tick.
    let polarLifted = false

    tickPose = (_time, deltaMs) => {
      const target = st?.progress ?? 0

      // Polar carrier z-index guard: the scrubbed opacity fade above gives
      // the carrier a stacking context (opacity < 1), and inside it the
      // inner z keyframes can no longer beat the canvas — so lift the
      // whole carrier above the planet while the fade window is live.
      // Keyed on the scrub timeline's OWN playhead (the source of that
      // opacity) and checked BEFORE the settled short-circuit below: the
      // scrub keeps easing after the pose follower settles, and the strip
      // back to bare — the polar sat's limb-clip interleave depends on a
      // stacking-context-free carrier — must always land at rest. Below
      // the fade window the inline opacity is exactly 1, so small scrubs
      // keep the interleave intact with no lift at all.
      if (satPolar && timeline) {
        const fadeLive = timeline.progress() > HW_FADE_START - 0.01
        if (fadeLive !== polarLifted) {
          satPolar.style.zIndex = fadeLive ? '2' : ''
          polarLifted = fadeLive
        }
      }

      // Settled short-circuit — the same idle guard startVelocityFeedback
      // uses, so a page at rest does no pose/burst work per tick.
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

      // Stage drift rides the same follower (never the scrub timeline),
      // eased by a smoothstep so departure and arrival are both soft. At
      // rest the inline transform is stripped entirely — the retired
      // burst choreography's carrier discipline — so the untouched-stage
      // guarantee for tiers that never build the pin also holds for a
      // pin scrubbed back to 0.
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
          stage.style.transform = `translateX(${(driftX * eased).toFixed(
            2
          )}px) scale(${scale.toFixed(4)})`
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

    // Hero copy exit: masked lines rise up out of their clip edges,
    // dynamic blocks lift and fade. All transform/opacity — and every exit
    // is an explicit fromTo with hard start values, so GSAP never derives a
    // start by sampling a transient computed style (a `.to(autoAlpha)` here
    // once latched opacity 0 off the old CSS entrance mid-delay and pinned
    // the badge and body invisible forever). immediateRender stays off:
    // the entrance settled these nodes at their resting pose, and the scrub
    // re-asserts the same hard values the moment it renders. Positions,
    // durations and staggers are half their +=130% values, so the doubled
    // pin didn't double the scroll the copy spends creeping out of frame.
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

    // The horizon hairline flares and widens into the tear, late — the
    // last thing seen before DescentGate's INITIATING DESCENT decode.
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
    // the carriers back to bare — no inline opacity, no z-index guard —
    // restoring the untouched-stage guarantee (and the polar sat's
    // stacking-context-free limb clipping) for whatever mounts next.
    carrierEls.forEach((el) => {
      el.style.opacity = ''
    })
    carrierEls = []
    if (satPolarEl) {
      satPolarEl.style.zIndex = ''
      satPolarEl = null
    }
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
