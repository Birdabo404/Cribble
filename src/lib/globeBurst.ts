// Burst-channel contract for the hero globe's scroll-burst disassembly.
//
// This module is deliberately dependency-free: it is the ONLY shared seam
// between the WebGL renderer (stylizedEarthRenderer.ts, which reads the
// channels every rAF) and the anime.js choreography (hero/heroBurst.ts,
// which tweens the numbers under a scrubbed timeline). The choreography
// side must never value-import from the renderer module — that would drag
// three.js into the landing motion chunk — so the counts and the factory
// live here instead.

/** Mirrors CLOUD_PLACEMENTS.length in stylizedEarthRenderer.ts. */
export const BURST_CLOUD_COUNT = 11
/** Mirrors ISLAND_PLACEMENTS.length in stylizedEarthRenderer.ts. */
export const BURST_ISLAND_COUNT = 2
/** Continental shards the renderer builds for the crust-tear beat. */
export const BURST_SHARD_COUNT = 8

/**
 * One mutable object per hero, tweened in place by the anime timeline and
 * read (never written) by the renderer's frame loop. All-zero must render
 * byte-identical to a renderer without a burst.
 *
 * Values are nominally 0..1 but arrive UNCLAMPED: anticipation eases
 * (`inBack`) dip slightly negative before the fling, which the renderer
 * renders as a small inward suck. Renderers must clamp anything that
 * cannot go negative (scales, opacities) and tolerate indices beyond
 * their own placement counts (`channels.clouds[i] ?? 0`).
 */
export interface BurstChannels {
  /** Per-cloud fling progress, index-aligned with CLOUD_PLACEMENTS. */
  clouds: number[]
  /** Per-island spiral-out progress, index-aligned with ISLAND_PLACEMENTS. */
  islands: number[]
  /** Per-shard rip-out progress (BURST_SHARD_COUNT entries). */
  shards: number[]
  /** Master tree wavefront — per-tree delays live in the renderer. */
  treeWave: number
  /** Atmosphere shell blow-off (scale up, strength to zero). */
  atmosphere: number
  /** Aurora curtain lift-and-dissolve. */
  aurora: number
  /** Pre-burst tremor amplitude on the planet assembly. */
  rumble: number
}

export function createBurstChannels(): BurstChannels {
  return {
    clouds: new Array<number>(BURST_CLOUD_COUNT).fill(0),
    islands: new Array<number>(BURST_ISLAND_COUNT).fill(0),
    shards: new Array<number>(BURST_SHARD_COUNT).fill(0),
    treeWave: 0,
    atmosphere: 0,
    aurora: 0,
    rumble: 0
  }
}
