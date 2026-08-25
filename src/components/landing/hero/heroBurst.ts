// Hero globe scroll-burst — the disassembly choreography behind the pinned
// entry. heroPin's GSAP scrub stays the single scroll source (ScrollSmoother
// and the pin spacer live there); this module owns the pieces: one anime
// createTimeline({ autoplay: false }), driven by seek(p) from the pin's pose
// tween, tweens the BurstChannels numbers (read every rAF by
// stylizedEarthRenderer) and the four DOM carriers in GlobeStage. anime
// earns its keep here — per-piece staggers, keyframed anticipation and
// parameterized eases over a plain scrubbed number line — where hand-rolled
// GSAP tweens per piece would bloat the pin.
//
// Choreography (every position below is a fraction of the pin's scrub):
//   0.00–0.35  rumble      tremor rises to 1 by 0.15, then resolves to a
//                          0.15 residual as the cascade takes over
//   0.12–0.50  clouds      11 puffs, scattered stagger, anticipation dip
//                          below 0 then fling to 1
//   0.20–0.45  hardware    DOM carriers: equatorial sat up-left, polar sat
//                          down-right, orbit ring scales up and dissolves,
//                          glow spill fades
//   0.30–0.75  trees       master wavefront 0→1 (per-tree seeded delays
//                          live in the renderer)
//   0.35–0.80  shards      8 crust shards, scattered stagger, punchy rip
//   0.35–0.77  islands     the two orbiting islands spiral out on offset
//                          windows
//   0.45–0.80  aurora      curtain lift-and-dissolve
//   0.50–0.90  atmosphere  shell blow-off
//   0.70–1.00  (heroPin's own horizon flare + copy exits — not ours)

import type { GlobeHandle } from '@/components/Globe'
import {
  BURST_CLOUD_COUNT,
  BURST_ISLAND_COUNT,
  BURST_SHARD_COUNT,
  createBurstChannels
} from '@/lib/globeBurst'
import { CRIBBLE_EASE, type LandingMotion } from '@/lib/landingMotion'

/** Master timeline span in anime time units. seek(p) maps the pin's scrub
 *  0..1 onto it, so every `add` position reads as a fraction of the pin.
 *  The last beat ends at 0.9 · DURATION — seeking past a timeline's
 *  physical end clamps to it, which renders the same finished state. */
const DURATION = 1000

/** At or below this progress the hero counts as at rest — see the
 *  stacking-context housekeeping in seek(). */
const REST_EPSILON = 0.001

/** anime v4.5 removed the 'cubicBezier(...)' ease STRING (the parser warns
 *  and silently falls back to linear), so the site curve is built from the
 *  cubicBezier function in the lazy bundle + these parsed parameters. */
const [BEZ_X1, BEZ_Y1, BEZ_X2, BEZ_Y2] = CRIBBLE_EASE.split(',').map(Number)

/** Scatter index i across 0..count-1 without Math.random(): stepping by a
 *  number coprime to the count visits every slot exactly once, in an order
 *  that reads irregular but rebuilds identically — a rebuilt pin must
 *  replay the same choreography at the same scroll offsets. */
const scatter = (i: number, step: number, count: number): number =>
  (i * step) % count

/** Per-index proxy for the channel arrays: anime targets must be objects,
 *  so clouds[i] / shards[i] / islands[i] can't be tweened in place. seek()
 *  copies every proxy back into the arrays after the timeline renders —
 *  21 number writes, cheaper than 21 onUpdate closures and immune to
 *  callback-ordering questions. */
type ChannelProxy = { v: number }
const makeProxies = (count: number): ChannelProxy[] =>
  Array.from({ length: count }, () => ({ v: 0 }))

export interface HeroBurstOptions {
  /** The outer .lx-hero element — carrier lookups scope to it. */
  hero: HTMLElement
  /** Late-bound accessor, same contract as HeroPinOptions: the globe chunk
   *  may land after the burst builds, and GlobeHandle.setBurstChannels
   *  replays the latest channels object on renderer init. */
  globeHandle: () => GlobeHandle | null
}

export interface HeroBurst {
  /** Scrub the whole cascade to pin progress p ∈ 0..1. */
  seek: (p: number) => void
  /** Cancel the timeline, strip carrier inline styles, zero the channels
   *  so a killed pin can't strand a half-burst planet. */
  dispose: () => void
}

export function createHeroBurst(
  motion: LandingMotion,
  { hero, globeHandle }: HeroBurstOptions
): HeroBurst {
  const { createTimeline, cubicBezier } = motion
  const cribble = cubicBezier(BEZ_X1, BEZ_Y1, BEZ_X2, BEZ_Y2)

  const ring = hero.querySelector<HTMLElement>('[data-burst="ring"]')
  const satEquatorial = hero.querySelector<HTMLElement>(
    '[data-burst="sat-equatorial"]'
  )
  const satPolar = hero.querySelector<HTMLElement>('[data-burst="sat-polar"]')
  const glow = hero.querySelector<HTMLElement>('[data-burst="glow"]')
  const carriers = [ring, satEquatorial, satPolar, glow].filter(
    (el): el is HTMLElement => el !== null
  )

  const channels = createBurstChannels()
  const cloudProxies = makeProxies(BURST_CLOUD_COUNT)
  const islandProxies = makeProxies(BURST_ISLAND_COUNT)
  const shardProxies = makeProxies(BURST_SHARD_COUNT)

  const tl = createTimeline({
    autoplay: false,
    // Site ease everywhere a beat doesn't say otherwise.
    defaults: { ease: cribble }
  })

  // Rumble: builds through 0.15, then resolves into the cascade instead of
  // shaking under the whole pin — a 0.15 residual keeps the planet uneasy
  // while it sheds.
  tl.add(
    channels,
    {
      rumble: [
        { to: 1, duration: 0.15 * DURATION, ease: 'inQuad' },
        { to: 0.15, duration: 0.2 * DURATION, ease: cribble }
      ]
    },
    0
  )

  // Clouds: each puff breathes inward first (the renderer draws the
  // negative overshoot as a small suck toward the surface) before flinging
  // out along its escape vector.
  const CLOUDS_START = 0.12 * DURATION
  const CLOUD_FLIGHT = 0.2 * DURATION
  const CLOUD_SPACING =
    (0.5 * DURATION - CLOUDS_START - CLOUD_FLIGHT) / (BURST_CLOUD_COUNT - 1)
  cloudProxies.forEach((proxy, i) => {
    tl.add(
      proxy,
      {
        v: [
          { to: -0.06, duration: 0.22 * CLOUD_FLIGHT, ease: 'outSine' },
          { to: 1, duration: 0.78 * CLOUD_FLIGHT, ease: cribble }
        ]
      },
      CLOUDS_START + scatter(i, 7, BURST_CLOUD_COUNT) * CLOUD_SPACING
    )
  })

  // DOM hardware: the carriers fly while the CSS keyframes inside keep
  // running, so the orbits become corkscrew exits. Fades arrive late so
  // the craft stay legible while they clear the frame.
  const HW_START = 0.2 * DURATION
  const HW_LENGTH = 0.25 * DURATION
  if (satEquatorial) {
    tl.add(
      satEquatorial,
      {
        x: '-46vw',
        y: '-34vh',
        rotate: -16,
        duration: HW_LENGTH,
        opacity: {
          to: 0,
          delay: 0.55 * HW_LENGTH,
          duration: 0.45 * HW_LENGTH,
          ease: 'inSine'
        }
      },
      HW_START
    )
  }
  if (satPolar) {
    tl.add(
      satPolar,
      {
        x: '42vw',
        y: '38vh',
        rotate: 14,
        duration: HW_LENGTH,
        opacity: {
          to: 0,
          delay: 0.55 * HW_LENGTH,
          duration: 0.45 * HW_LENGTH,
          ease: 'inSine'
        }
      },
      HW_START
    )
  }
  if (ring) {
    tl.add(
      ring,
      {
        scale: 1.6,
        opacity: { to: 0, ease: 'inSine' },
        duration: HW_LENGTH
      },
      HW_START
    )
  }
  if (glow) {
    tl.add(glow, { opacity: 0, duration: HW_LENGTH, ease: 'inSine' }, HW_START)
  }

  // Trees: one master wavefront — per-tree seeded delays live in the
  // renderer, so a single scalar buys 340 individual launches.
  tl.add(channels, { treeWave: 1, duration: 0.45 * DURATION }, 0.3 * DURATION)

  // Shards: the crust tears fast and drifts — outExpo snaps each shard out
  // of the surface, the renderer carries the lift.
  const SHARDS_START = 0.35 * DURATION
  const SHARD_RIP = 0.18 * DURATION
  const SHARD_SPACING =
    (0.8 * DURATION - SHARDS_START - SHARD_RIP) / (BURST_SHARD_COUNT - 1)
  shardProxies.forEach((proxy, i) => {
    tl.add(
      proxy,
      { v: 1, duration: SHARD_RIP, ease: 'outExpo' },
      SHARDS_START + scatter(i, 3, BURST_SHARD_COUNT) * SHARD_SPACING
    )
  })

  // Islands: offset windows so the two spiral-outs read as separate
  // departures rather than a pair.
  islandProxies.forEach((proxy, i) => {
    tl.add(
      proxy,
      { v: 1, duration: 0.3 * DURATION },
      (0.35 + i * 0.12) * DURATION
    )
  })

  // Aurora lifts first, then the atmosphere shell blows off — the bare
  // marble is what the visitor descends toward.
  tl.add(channels, { aurora: 1, duration: 0.35 * DURATION }, 0.45 * DURATION)
  tl.add(
    channels,
    { atmosphere: 1, duration: 0.4 * DURATION },
    0.5 * DURATION
  )

  let attached = false
  // Mirrors whether the inline z-index guard is currently applied, so
  // seek() never has to read the style object back per scrub frame.
  let polarLifted = false
  // Last progress actually rendered — the pin's spring follower keeps
  // ticking through its convergence tail, where successive poses differ
  // by less than anything the timeline can express.
  let lastSeek = Number.NaN

  const syncArrayChannels = () => {
    for (let i = 0; i < BURST_CLOUD_COUNT; i++) {
      channels.clouds[i] = cloudProxies[i].v
    }
    for (let i = 0; i < BURST_ISLAND_COUNT; i++) {
      channels.islands[i] = islandProxies[i].v
    }
    for (let i = 0; i < BURST_SHARD_COUNT; i++) {
      channels.shards[i] = shardProxies[i].v
    }
  }

  // anime composes x/rotate/scale into style.transform; the individual
  // longhands are cleared too in case a future anime writes those instead.
  const clearInlineMotion = (el: HTMLElement) => {
    el.style.transform = ''
    el.style.translate = ''
    el.style.rotate = ''
    el.style.scale = ''
    el.style.opacity = ''
  }

  const seek = (p: number) => {
    // Late binding, same as the pin's pose path: attach once, whenever the
    // handle exists — Globe.tsx replays the object on renderer init, so
    // even a pre-WebGL attach sticks.
    if (!attached) {
      const handle = globeHandle()
      if (handle) {
        handle.setBurstChannels(channels)
        attached = true
      }
    }

    // Sub-epsilon deltas can't move any tween output (0.0002 of the pin
    // is a fifth of one anime time unit) — skip the timeline render, the
    // 21 proxy copies and the carrier style writes outright. The exact
    // endpoints always render: the renderer's resting scissor and the
    // carrier strip both key on true zeros, never on "close enough".
    if (p !== 0 && p !== 1 && Math.abs(p - lastSeek) < 0.0002) return
    lastSeek = p

    tl.seek(p * DURATION)
    syncArrayChannels()

    // THE STACKING-CONTEXT GOTCHA: the polar sat's CSS keyframes animate
    // z-index 0↔2 to interleave with the globe canvas (z-[1]) for limb
    // clipping. Any inline transform (even identity) or opacity < 1 on its
    // carrier creates a stacking context that flattens that interleave —
    // so at rest the carrier is stripped back to native (no inline styles
    // at all), and while flying it gets an explicit z-index 2 so the
    // departing craft rides above the planet instead of vanishing behind
    // it (inside the carrier's context its inner z keyframes can no longer
    // beat the canvas).
    if (satPolar) {
      if (p <= REST_EPSILON) {
        clearInlineMotion(satPolar)
        satPolar.style.zIndex = ''
        polarLifted = false
      } else if (!polarLifted) {
        satPolar.style.zIndex = '2'
        polarLifted = true
      }
    }
  }

  const dispose = () => {
    // revert() cancels the timeline and restores every target it touched:
    // carriers drop their anime-written inline styles, channel scalars and
    // proxies return to their build-time zeros.
    tl.revert()
    carriers.forEach(clearInlineMotion)
    if (satPolar) satPolar.style.zIndex = ''
    // The renderer keeps reading the attached object after a kill, so zero
    // everything explicitly — all-zero is contractually byte-identical to
    // a renderer without a burst.
    channels.clouds.fill(0)
    channels.islands.fill(0)
    channels.shards.fill(0)
    channels.treeWave = 0
    channels.atmosphere = 0
    channels.aurora = 0
    channels.rumble = 0
  }

  // anime force-ticks the paused timeline at time 0 during construction
  // (createTimeline().init() and every add() re-init), which can leave
  // identity inline styles on the carriers before the pin's first scrub
  // update ever calls seek(). Settle to a true rest state now — for the
  // polar sat that strips the stacking context the limb trick can't
  // survive.
  seek(0)

  return { seek, dispose }
}
