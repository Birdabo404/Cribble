import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import ConicPolygonGeometry from 'three-conic-polygon-geometry'
import { PILOTS } from '@/components/landing/pilots'
import { BURST_SHARD_COUNT, type BurstChannels } from '@/lib/globeBurst'

export type RGB = [number, number, number]

export interface EarthFrame {
  phi: number
  theta: number
  time: number
  lightMode: number
  accent: RGB
}

export interface PinScreenPosition {
  /** Index into the PILOTS roster. */
  index: number
  /** Canvas-relative CSS pixels. */
  x: number
  y: number
  /** True when the pin faces the camera (safe to label). */
  front: boolean
}

export interface EarthRenderer {
  render: (frame: EarthFrame) => void
  resize: () => void
  destroy: () => void
  getPinScreenPositions: () => PinScreenPosition[]
  /**
   * Sets the scroll-pose TARGET (0 = resting orbit, 1 = full hero
   * push-in; clamped, non-finite ignored). Only stores the value — the
   * next render() call applies it, so a scrubbed timeline can write this
   * every scroll tick at no extra cost and the pose stays perfectly
   * synced to scroll. Never schedules a frame of its own.
   */
  setScrollPose: (progress: number) => void
  /**
   * Attaches the scroll-burst channel object (see lib/globeBurst.ts for
   * the contract). Only the reference is stored — render() reads the
   * live values every frame, so the choreography tweens the numbers in
   * place at zero plumbing cost. Never attaching (or all-zero channels)
   * renders byte-identical to a renderer without a burst.
   */
  setBurstChannels: (channels: BurstChannels) => void
}

/* ────────────────────────────────────────────────────────────────────────
   TUNING CONSTANTS — palette, lighting and layout knobs, grouped here so
   the look can be dialed in without touching scene-construction code.
   `lightMode` lerps every DAY value toward its NIGHT counterpart
   (lightMode 1 = light theme = day side, 0 = dark theme = night side).
   ──────────────────────────────────────────────────────────────────────── */

// Geometry layout (planet radius = 1)
const OCEAN_RADIUS = 1
const OCEAN_WIDTH_SEGMENTS = 160 // smooth ocean sphere, longitude direction
const OCEAN_HEIGHT_SEGMENTS = 112 // latitude direction (~18k verts, built once)
const LAND_BOTTOM_RADIUS = 0.96 // buried under the ocean sphere, no gaps
const LAND_TOP_RADIUS = 1.03 // slab base of the extruded continents
const LAND_CURVATURE_RESOLUTION = 3 // degrees per surface subdivision

// Rolling hills — the cap surface rises above LAND_TOP_RADIUS by a seeded
// fbm field. hillElevation01/hillRadius below are THE shared terrain
// functions: caps, side-wall tops, trees, pilot pins and city dots all
// sample the same field, so every prop sits exactly on its local ground.
const HILL_MAX_HEIGHT = 0.045
const HILL_NOISE_SCALE = 2.6 // base fbm frequency (unit-sphere lattice)
const HILL_NOISE_OCTAVES = 4
const HILL_SHAPING = 1.35 // >1 flattens valleys while ridges stay bold
const AXIAL_TILT = (23.5 * Math.PI) / 180 // leans the pole to the right
const CAMERA_ELEVATION = 0.35 // radians of overhead tilt (isometric feel)
// The globe COMPOSITION is authored against this half-extent (planet disk
// ≈ 72% of the footprint; the island orbits, atmosphere and aurora all
// budget against it below). It used to be the whole frustum — and thus
// the canvas edge, which is exactly where the scroll-burst pieces used
// to pop out of existence mid-flight.
const FOOTPRINT_HALF_EXTENT = 1.42
// Burst bleed: the canvas element is CANVAS_BLEED× the globe footprint
// on every side (Globe.tsx positions it with negative insets, so the
// layout box — and the DOM orbit ring/satellites around it — never
// move), and the frustum scales by the same factor, so pixels per world
// unit and the whole resting look are identical. The bleed exists purely
// so the bursting clouds and islands fly across the hero instead of
// vanishing at the old footprint edge.
export const CANVAS_BLEED = 2.25
const FRUSTUM_HALF_HEIGHT = FOOTPRINT_HALF_EXTENT * CANVAS_BLEED // 3.195

// Scroll pose — the hero pinned-entry push-in, driven externally through
// setScrollPose(p). The camera is orthographic, so "push-in" is frustum
// zoom (the ortho equivalent of dollying closer): p 0→1 ramps camera.zoom
// 1→SCROLL_ZOOM_MAX (planet reads ~70% closer; the frustum tightens
// ~41%). Alongside the zoom, the whole tilt assembly pitches forward
// about the screen-horizontal axis and a small extra yaw rides on top of
// frame.phi, so the planet rolls away beneath the viewer. Both rotations
// are ADDITIVE offsets — drag-to-spin and idle auto-spin keep working
// under the pose. p = 0 is byte-identical to the renderer without a pose.
const SCROLL_ZOOM_MAX = 1.7 // visible half-extent 3.195/1.7 ≈ 1.88 still clears the resting island band (max reach ≈ 1.38) and the limb + hills (~1.075); past ~2.3 the islands would crop
const SCROLL_PITCH_MAX = 0.52 // rad about screen X at p = 1 (~30°)
const SCROLL_YAW_MAX = 0.75 // rad added to frame.phi at p = 1 (~43°)

// Scroll burst — the hero disassembly, driven externally through
// setBurstChannels() (lib/globeBurst.ts holds the channel contract).
// Channels arrive UNCLAMPED: the choreography's anticipation eases dip
// slightly negative before the fling, which renders as a small inward
// suck; anything that cannot go negative (scales, opacities, the tree
// wave) is clamped here. All-zero channels render byte-identical to a
// renderer without a burst, and every burst write is either an exact
// arithmetic identity at zero or latched so idle frames do no work.
//
// Clouds fling SCREEN-radially, not world-radially — a world-radial
// fling would push front-facing puffs along +Z straight at the ortho
// camera without ever leaving the frame. The holders live inside
// cloudSpin (which keeps turning with time) under the scroll-pitched
// tilt, so the escape heading re-derives every bursting frame from the
// puff's CURRENT resting point projected to the screen plane; it is
// then mapped back into holder space, so the screen travel is exactly
// channel × CLOUD_ESCAPE_DIST from any spin angle or pitch.
const CLOUD_ESCAPE_DIST = 7.2 // screen units at channel 1 — covers the bled canvas corner (3.195·√2 ≈ 4.5) plus puff extent from anywhere
const CLOUD_ESCAPE_BIAS = 0.12 // build-time radial blended into the live projection: keeps the heading stable and seeded when a resting point drifts over the screen center (a bare normalize would flip there)
const CLOUD_ESCAPE_Z_VAR = 0.35 // ± seeded view-axis component — depth crossing that never alters the screen path under the ortho camera
const CLOUD_BURST_TUMBLE = 2.6 // rad of extra puff yaw at channel 1
const CLOUD_BURST_GROW = 0.3 // fractional puff scale-up at channel 1
const CLOUD_BURST_SEED = 96173
const TREE_BURST_SEED = 50923 // separate PRNG — the resting scatter stays untouched
const TREE_BURST_DELAY_MAX = 0.6 // latest seeded launch delay, in treeWave units
const TREE_BURST_WINDOW = 0.4 // per-tree launch duration (delay + window ≤ 1, so every tree finishes by wave 1)
const TREE_BURST_LIFT = 0.55 // rise along the surface normal at full progress
const TREE_BURST_TUMBLE_MIN = 3.0 // rad about the seeded per-tree axis…
const TREE_BURST_TUMBLE_MAX = 7.0 // …at full progress
const SHARD_SEED = 78241
const SHARD_MAX_LAT = 55 // keep the crust rip-outs on the visible temperate band
const SHARD_MIN_POLYGON_AREA = 80 // cos-weighted deg² — only sizable landmasses shed shards
const SHARD_ROCK_RADIUS = 0.075
const SHARD_ROCK_DEPTH = 0.11 // inverted-cone root hanging below the grass line
const SHARD_CAP_RADIUS = 0.085 // slight grass lip over the rock rim
const SHARD_CAP_SQUASH = 0.42 // hemisphere → low grass dome
const SHARD_GROW_END = 0.25 // channel value where a shard reaches full size — grows fast, then rides the lift
const SHARD_LIFT = 0.5 // rise along the surface normal at channel 1
const SHARD_DRIFT = 0.25 // seeded tangent drift so the shards separate as they rip out
const SHARD_TUMBLE_MIN = 1.2 // rad about the seeded per-shard axis…
const SHARD_TUMBLE_MAX = 3.2 // …at channel 1
const SHARD_SIZE_MIN = 0.7 // seeded per-shard size range
const SHARD_SIZE_MAX = 1.3
const ISLAND_ESCAPE_RADIUS_GAIN = 3.6 // orbitRadius × (1 + channel·gain): 1.11 → 5.1 at channel 1, past the bled canvas corner (≈ 4.5) plus island extent
const ISLAND_ESCAPE_SPIN = 3.5 // rad of extra self-spin at channel 1 — the spiral-out reads as a fling, not a slide
const ATMO_BURST_GROW = 0.6 // shell scale 1 → 1.6 while uStrength fades to 0
const AURORA_BURST_LIFT = 0.5 // curtain rise along the tilted polar axis
const AURORA_BURST_GROW = 0.35
// The fade outruns the lift. This began as a workaround for the risen
// curtain slicing on the old footprint-sized canvas edge; the bled
// canvas clears it easily now (curtain top ≈ 2.3 < 3.195 even before
// the zoom is at full push), so the early dissolve — alpha 0 by channel
// ≈ 0.56 while the lift keeps carrying the invisible mesh — survives
// purely as a pacing choice: the sky empties before the shell blows.
const AURORA_BURST_FADE = 1.8
const RUMBLE_MAX = 0.012 // peak screen-space jitter of the tilt assembly
// two incommensurate sines per axis — cheap deterministic noise that is
// exactly zero whenever the channel is (and under frozen time)
const RUMBLE_FREQ_XA = 23.7
const RUMBLE_FREQ_XB = 41.3
const RUMBLE_FREQ_YA = 29.1
const RUMBLE_FREQ_YB = 47.9
const BURST_MIN_SCALE = 0.0001 // burst scales clamp here — matrices stay decomposable at "gone"

// Ocean — a smooth-shaded sphere painted per-VERTEX (vertex colors under
// a white-day / cool-night multiplier material), unlike the land which
// stays flat-shaded low-poly: light shallows hugging every coast and
// island, the clear reference blue on the shelf, darker mid-basin blue,
// and noise-driven teal / lighter patches so open water never reads
// flat. Coast proximity comes from a coarse land mask dilated into a
// small distance field (units below = mask cells), box-blurred and
// bilinearly sampled so the gradients stay continuous on the smooth
// surface; an fbm jitter waves the coastal bands and a fine fbm grain
// keeps big basins from reading as blank plastic. Turquoise lives ONLY
// in a tight shore band (and a thin limb line) — open water is calm
// plain blue with barely-there patch variation.
const OCEAN_SHORE = '#7df0dc' // turquoise right at the waterline
const OCEAN_SHALLOW = '#8fe3f5' // light coastal cyan
const OCEAN_MID = '#2f9de8' // clear sky-blue (turquoise-planet reference)
const OCEAN_DEEP = '#1468cd' // darker open-basin blue
const OCEAN_TEAL = '#35b8c9' // blue-leaning open-water patches, barely there
const OCEAN_NIGHT = '#1b3f80' // mid ocean after dark — deep blue, never black
const OCEAN_MASK_STEP = 2 // degrees per land-mask cell
const OCEAN_COAST_MAX_STEPS = 10 // BFS dilation cap — "far open water"
const OCEAN_SHORE_END = 0.8 // coast distance (cells) fully turquoise below
const OCEAN_SHALLOW_END = 1.6 // shore→shallow ramp ends here
const OCEAN_MID_START = 2.6 // shallow→mid ramp ends here
const OCEAN_DEEP_START = 5.2 // mid→deep ramp begins
const OCEAN_DEEP_END = 9.0 // fully deep past this distance
const OCEAN_TEAL_SCALE = 3.2 // fbm frequency of the teal patches
const OCEAN_TEAL_THRESHOLD = 0.56 // fbm value where teal starts bleeding in
const OCEAN_TEAL_MAX = 0.22 // strongest teal mix in open water
const OCEAN_LIGHT_SCALE = 6.0 // second fbm — subtle lighter-mid patches
const OCEAN_LIGHT_THRESHOLD = 0.58
const OCEAN_LIGHT_MAX = 0.18
const OCEAN_EDGE_JITTER_SCALE = 8.0 // fbm frequency of the coastline waviness
const OCEAN_EDGE_JITTER_CELLS = 0.6 // ± mask cells the coast bands wander
const OCEAN_GRAIN_SCALE = 12.0 // fine per-vertex tonal grain frequency
const OCEAN_GRAIN_STRENGTH = 0.03 // ± lightness swing of the grain
const OCEAN_RIM_DAY = '#7df0dc' // turquoise limb line
const OCEAN_RIM_NIGHT = '#3f86d1'
const OCEAN_RIM_STRENGTH = 0.38
const OCEAN_RIM_POWER = 5.0

// Continents — vertex-colored caps ramp from beach sand through vibrant
// garden green to deeper highland green (garden-planet reference), with a
// per-country hue nudge and meadow patchiness from a second noise field.
const LAND_SAND = '#f4e6b4'
const LAND_GRASS = '#8ad64d'
const LAND_MEADOW = '#b8e358' // sun-yellowed patches blended in by noise
const LAND_HIGHLAND = '#2fa85c'
const LAND_SAND_END = 0.13 // elevation01 where sand fades into grass
const LAND_GRASS_START = 0.3 // fully grass above this elevation01
const LAND_PATCH_SCALE = 5 // fbm frequency of the meadow patches
const ICE_DAY_COLOR = '#eef4f2' // Antarctica + Greenland caps
const SIDE_DAY_COLOR = '#eed7a1' // bright beach-sand cliff walls
const ICE_ISO_CODES = new Set(['010', '304']) // Antarctica, Greenland

// Night side: material colors collapse toward a dim cool tone
const NIGHT_LEVEL = 0.78 // luminance kept at night (0-1)
const NIGHT_COOL = '#33497f' // cool tint mixed into night materials
const NIGHT_COOL_MIX = 0.26

// Lighting (three r155+ "physical" light units)
const KEY_DAY = { color: '#fff1d6', intensity: 3.2 } // warm sun from the right
const KEY_NIGHT = { color: '#93a9e8', intensity: 1.55 } // bright cool moonlight
const KEY_POSITION = new THREE.Vector3(3.0, 1.2, 1.3)
const FILL_DAY = { color: '#bcd6ff', intensity: 0.45 } // cool bounce from the left
const FILL_NIGHT = { color: '#5570bd', intensity: 0.7 }
const FILL_POSITION = new THREE.Vector3(-2.4, 0.4, -0.8)
const HEMI_DAY = { sky: '#eaf3ff', ground: '#d9b98a', intensity: 0.85 }
const HEMI_NIGHT = { sky: '#6c85c8', ground: '#2a3557', intensity: 1.6 }

// Atmosphere — additive backside rim shell. The night rim is a pure cool
// blue: the accent no longer tints it (the aurora owns green at night).
const ATMO_RADIUS = 1.24
const ATMO_DAY = '#7cb8ff'
const ATMO_NIGHT_BASE = '#3a5fb4'
const ATMO_NIGHT_ACCENT_MIX = 0 // accent tint removed — no green rim wash
const ATMO_DAY_STRENGTH = 0.5
const ATMO_NIGHT_STRENGTH = 0.48
const ATMO_FALLOFF = 3.2 // tighter annulus hugging the limb

// Aurora — additive ribbons arcing over the north polar cap, dark mode
// only. This is the one place green survives at night.
const AURORA_BOTTOM = '#2ee6c8' // teal at the curtain base
const AURORA_MID = '#52e87c' // green through the body
const AURORA_TOP = '#8f7bf2' // violet wisps at the crown
const AURORA_STRENGTH = 1.15 // global opacity at full dark
const AURORA_SEGMENTS = 72 // quads along each ribbon
const AURORA_ROWS = 6 // quads across the curtain height
const AURORA_BANDS: Array<{
  baseLat: number
  latAmp: number // static wave amplitude of the arc, degrees
  lngCenter: number // 0 faces the camera (ribbons live outside the spin)
  lngSpan: number
  rBottom: number
  rTop: number
  waveFreq: number // static wave cycles along the ribbon
  phase: number
  opacity: number
}> = [
  { baseLat: 67, latAmp: 3.5, lngCenter: -12, lngSpan: 160, rBottom: 1.1, rTop: 1.3, waveFreq: 2.0, phase: 0.6, opacity: 1 },
  { baseLat: 72, latAmp: 2.5, lngCenter: 30, lngSpan: 115, rBottom: 1.12, rTop: 1.33, waveFreq: 1.6, phase: 2.8, opacity: 0.7 },
  { baseLat: 63, latAmp: 3.0, lngCenter: -55, lngSpan: 95, rBottom: 1.09, rTop: 1.22, waveFreq: 2.6, phase: 4.4, opacity: 0.55 },
]

// City dots — emissive golden points, only visible on the night side
const CITY_DOT_COLOR = '#ffd27d'
const CITY_DOT_LIFT = 0.008 // height above the local hill surface
const CITY_DOT_SIZE = 2.3 // CSS px (scaled by device pixel ratio)
const CITY_DOT_OPACITY = 0.9
const CITY_DOT_DENSITY = 1.0 // dots per country ∝ density * area^0.62
const CITY_DOT_MAX_PER_COUNTRY = 36
const CITY_DOT_TOTAL_CAP = 900
const CITY_DOT_MAX_LAT = 72 // no golden city lights on polar islands

// User pins — accent-colored markers standing on the local hill surface
const PIN_STEM_RADIUS = 0.0045
const PIN_STEM_HEIGHT = 0.045
const PIN_HEAD_RADIUS = 0.017
// world-direction · camera-direction below this counts as front-facing;
// -0.45 ≈ within ~63° of the view center, so label chips never hug the limb
const PIN_FRONT_DOT = -0.45

// Trees — trunk cones + blob canopies as two InstancedMeshes, scattered in
// forest clusters by the same seeded rejection sampler as the city dots.
const TREE_SEED = 7341
const TREE_TOTAL_CAP = 340
const TREE_MAX_PER_COUNTRY = 16
const TREE_DENSITY = 0.38 // trees per country ∝ density * area^0.62
const TREE_MAX_LAT = 62 // no forests on polar shores
const TREE_PER_CLUSTER = 5 // average forest-patch size
const TREE_CLUSTER_SPREAD = 3.4 // patch radius, degrees
const TREE_MIN_ELEVATION = 0.08 // keeps trunks off the waterline sand
const TREE_TRUNK_COLOR = '#8a6242'
const TREE_CANOPY_COLORS = ['#59c44a', '#7dd854', '#3fae52'] as const
const TREE_TRUNK_HEIGHT = 0.022
const TREE_TRUNK_RADIUS = 0.007
const TREE_CANOPY_RADIUS = 0.028
const TREE_SINK = 0.004 // buried slightly so trunks never float on slopes
const TREE_SCALE_MIN = 0.75
const TREE_SCALE_MAX = 1.5

// Clouds — GLTF puffs cloned from clouds-puffy.glb, ringing the planet in
// a fixed altitude band. Placements are hand-authored (lat/lng/scale) so
// the ring reads chunky but balanced from every spin angle; yaw and bob
// variation come from the seeded PRNG. The cloud shell is deliberately
// independent of the planet spin: dragging turns only the ground while
// the weather keeps drifting on its own clock.
const CLOUD_ALTITUDE = 1.15
const CLOUD_DAY = '#ffffff'
const CLOUD_NIGHT = '#e8eef9' // near-white silver — clouds stay white at night
const CLOUD_EMISSIVE_DAY = '#2a2a30' // soft constant lift under the warm sun
const CLOUD_EMISSIVE_NIGHT = '#98a0b4' // strong silver lift — never murky puffs
const CLOUD_PROP_SQUASH = 0.72 // radial (vertical) flattening of each puff
const CLOUD_ROTATE_SPEED = 0.05 // rad/s (rev ≈ 2 min) — visibly drifting, still calm
const CLOUD_BOB_AMPLITUDE = 0.008
const CLOUD_SEED = 20260808
const CITY_DOT_SEED = 1337
type CloudKind = 'CloudSmall' | 'CloudMedium' | 'CloudLarge'
const CLOUD_PLACEMENTS: Array<{
  kind: CloudKind
  lat: number
  lng: number
  scale: number
}> = [
  { kind: 'CloudLarge', lat: 16, lng: -28, scale: 0.19 },
  { kind: 'CloudMedium', lat: -26, lng: 12, scale: 0.18 },
  { kind: 'CloudSmall', lat: 44, lng: 58, scale: 0.26 },
  { kind: 'CloudMedium', lat: 6, lng: 102, scale: 0.155 },
  { kind: 'CloudLarge', lat: -36, lng: 148, scale: 0.145 },
  { kind: 'CloudSmall', lat: 30, lng: -168, scale: 0.24 },
  { kind: 'CloudMedium', lat: -14, lng: -108, scale: 0.19 },
  { kind: 'CloudSmall', lat: 50, lng: -70, scale: 0.205 },
  { kind: 'CloudMedium', lat: -46, lng: -55, scale: 0.15 },
  { kind: 'CloudSmall', lat: 12, lng: -52, scale: 0.13 },
  { kind: 'CloudMedium', lat: -32, lng: 76, scale: 0.2 },
]

// Floating islands — CC0 props on slow counter-rotating orbits around the
// planet in the screen plane. They live outside the tilt/spin groups: the
// orbit angle is purely time-driven (drag never moves them), with the
// existing bob and slow self-turn layered on top. The screen mapping is
// the same one the old corner parks used — worldX = screenX,
// worldY = screenY / cos(CAMERA_ELEVATION), worldZ = 0 — so orbit math
// reads directly in canvas units: center = (R·cos a, R·sin a).
//
// Composition worst case (FOOTPRINT_HALF_EXTENT 1.42): at the top/side
// orbit extremes the island center reaches R on one axis, so
//   R + extent·scale + bobAmp·cos(elev) ≤ 1.42 − margin
// keeps the resting orbits inside the globe footprint. Since the canvas
// grew its burst bleed this is a composition budget, not a clipping
// constraint (the canvas edge now sits at 3.195) — but the footprint is
// still the frame the resting hero is composed in, so the numbers stay.
// Worst-case screen extents measured per-vertex over every self-turn yaw
// (.cursor-artifacts/globe-orbit/measure-islands.mjs):
//   FloatingIslandLarge 1.681 local units (the debris ring reaches far
//   past the body), FloatingIslandSmall 1.058.
//   Large: 1.11 + 1.681·0.15 + 0.016·0.94 = 1.377 ≤ 1.42 (margin 0.043)
//   Small: 1.22 + 1.058·0.14 + 0.013·0.94 = 1.380 ≤ 1.42 (margin 0.040)
// Margins also absorb the static ±0.05 rad lean (≤ extent·0.05 ≈ 0.013).
// The large island's outer ring rocks dip inside the planet silhouette at
// the closest pass (1.11 − 0.252 < 1): they briefly slip behind the limb,
// which reads as a depth pass, not clipping. Transient overlaps with limb
// clouds, the chip band or the corner annotation are accepted — everything
// is moving, nothing sticks.
const ISLAND_GRASS_DAY = '#6fc44f' // retinted to sit near the vibrant caps
const ISLAND_ROCK_DAY = '#b08a5e' // warm sand-leaning cliff, near the sides
// Explicit night tones (the default nightVariant reads as a black blob
// against space) — dim moonlit green / cool slate so silhouettes survive.
const ISLAND_GRASS_NIGHT = '#4a7f5c'
const ISLAND_ROCK_NIGHT = '#5b6c9c'
const ISLAND_PLACEMENTS: Array<{
  kind: 'FloatingIslandLarge' | 'FloatingIslandSmall'
  orbitRadius: number // screen units from the planet center
  orbitStart: number // rad — the old corner angles, so time 0 matches today
  orbitSpeed: number // rad/s; opposite signs so the pair never looks locked
  scale: number
  yaw: number // initial heading (rad)
  lean: number // static z-tilt for character (rad)
  spinSpeed: number // rad/s of self-rotation
  bobAmp: number
  bobSpeed: number
  bobPhase: number
}> = [
  {
    kind: 'FloatingIslandLarge',
    orbitRadius: 1.11,
    orbitStart: -2.384, // atan2(-1.06, -1.12) — the old bottom-left park
    orbitSpeed: 0.03,
    scale: 0.15, // trimmed from 0.16 so the ring clears the footprint top
    yaw: 0.9,
    lean: -0.05,
    spinSpeed: 0.05,
    bobAmp: 0.016,
    bobSpeed: 0.45,
    bobPhase: 0.8,
  },
  {
    kind: 'FloatingIslandSmall',
    orbitRadius: 1.22,
    orbitStart: 0.772, // atan2(1.14, 1.17) — the old top-right park
    orbitSpeed: -0.022,
    scale: 0.14,
    yaw: -0.7,
    lean: 0.05,
    spinSpeed: -0.06,
    bobAmp: 0.013,
    bobSpeed: 0.6,
    bobPhase: 2.4,
  },
]

// Prop GLB sources (see public/models/LICENSES.md)
const CLOUDS_MODEL_URL = '/models/clouds-puffy.glb'
const ISLAND_MODEL_URLS = {
  FloatingIslandLarge: '/models/floating-island-large.glb',
  FloatingIslandSmall: '/models/floating-island-small.glb',
} as const

/* ──────────────────────────────────────────────────────────────────────── */

const GEOJSON_URL = '/geo/countries-110m.geojson'
const UP = new THREE.Vector3(0, 1, 0)

// Screen basis under the fixed ortho camera (the same mapping the island
// orbits use): screen X is world X, screen Y is (0, cos e, −sin e), and
// the view axis is (0, −sin e, −cos e). Factored out for the burst math.
const SCREEN_Y_WORLD_Y = Math.cos(CAMERA_ELEVATION)
const SCREEN_Y_WORLD_Z = -Math.sin(CAMERA_ELEVATION)
const VIEW_WORLD_Y = -Math.sin(CAMERA_ELEVATION)
const VIEW_WORLD_Z = -Math.cos(CAMERA_ELEVATION)

type Ring = number[][]
type PolygonCoords = Ring[]

interface CountryFeature {
  properties?: { name?: string; iso?: string }
  geometry?: {
    type: string
    coordinates: PolygonCoords | PolygonCoords[]
  }
}

/**
 * Same lat/lng → XYZ mapping as three-conic-polygon-geometry, so pins and
 * city dots land exactly on the extruded continents (lng 0° at +Z, north
 * at +Y).
 */
function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((90 - lng) * Math.PI) / 180
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0
  }
  return hash >>> 0
}

// Deterministic PRNG so the procedural scatter is identical every load.
function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function nightVariant(dayColor: string): THREE.Color {
  return new THREE.Color(dayColor)
    .multiplyScalar(NIGHT_LEVEL)
    .lerp(new THREE.Color(NIGHT_COOL), NIGHT_COOL_MIX)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/* ── Shared terrain noise ─────────────────────────────────────────────
   Deterministic 3D value-noise fbm sampled on the unit sphere. Sampling
   in 3D (instead of a lng/lat plane) keeps the field seamless across the
   antimeridian and the poles. Everything that needs ground height — cap
   extrusion, side-wall tops, trees, pins, city dots — goes through
   hillElevation01/hillRadius so they always agree. */

function noiseHash3(xi: number, yi: number, zi: number): number {
  let h =
    (Math.imul(xi, 0x27d4eb2f) ^
      Math.imul(yi, 0x165667b1) ^
      Math.imul(zi, 0x9e3779b9)) |
    0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const fade01 = (t: number) => t * t * (3 - 2 * t)

function valueNoise3(x: number, y: number, z: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const sx = fade01(x - x0)
  const sy = fade01(y - y0)
  const sz = fade01(z - z0)
  const n00 = lerp(noiseHash3(x0, y0, z0), noiseHash3(x0 + 1, y0, z0), sx)
  const n10 = lerp(noiseHash3(x0, y0 + 1, z0), noiseHash3(x0 + 1, y0 + 1, z0), sx)
  const n01 = lerp(noiseHash3(x0, y0, z0 + 1), noiseHash3(x0 + 1, y0, z0 + 1), sx)
  const n11 = lerp(
    noiseHash3(x0, y0 + 1, z0 + 1),
    noiseHash3(x0 + 1, y0 + 1, z0 + 1),
    sx,
  )
  return lerp(lerp(n00, n10, sy), lerp(n01, n11, sy), sz)
}

/** fbm over a unit direction; `offset` selects an independent field. */
function fbm3(
  dirX: number,
  dirY: number,
  dirZ: number,
  scale: number,
  octaves: number,
  offset: number,
): number {
  let sum = 0
  let norm = 0
  let amp = 1
  let frequency = scale
  for (let octave = 0; octave < octaves; octave++) {
    sum +=
      amp *
      valueNoise3(
        dirX * frequency + offset,
        dirY * frequency + offset,
        dirZ * frequency + offset,
      )
    norm += amp
    amp *= 0.5
    frequency *= 2
  }
  return sum / norm
}

/** Rolling-hill elevation, 0 (slab base / beach) to 1 (highest ridge). */
function hillElevation01(lng: number, lat: number): number {
  const p = latLngToVector3(lat, lng, 1)
  const n = fbm3(p.x, p.y, p.z, HILL_NOISE_SCALE, HILL_NOISE_OCTAVES, 0)
  // stretch the mid-heavy fbm distribution to reach real beaches and peaks
  const t = Math.min(1, Math.max(0, (n - 0.34) / 0.34))
  return Math.pow(t, HILL_SHAPING)
}

/** Local continent-cap surface radius (slab top + rolling hills). */
function hillRadius(lng: number, lat: number): number {
  return LAND_TOP_RADIUS + HILL_MAX_HEIGHT * hillElevation01(lng, lat)
}

/**
 * Copies one geometry group (an index range) of an indexed BufferGeometry
 * into a standalone non-indexed, position-only geometry. Used to split each
 * ConicPolygonGeometry into its side-wall and top-cap parts so they can be
 * merged into per-color meshes. Non-indexed suits the flat-shaded look:
 * computeVertexNormals then yields true face normals.
 */
function extractGroupGeometry(
  source: THREE.BufferGeometry,
  group: { start: number; count: number },
): THREE.BufferGeometry {
  const index = source.getIndex()
  const position = source.getAttribute('position')
  if (!index) throw new Error('Expected indexed conic polygon geometry')

  const positions = new Float32Array(group.count * 3)
  for (let i = 0; i < group.count; i++) {
    const vertex = index.getX(group.start + i)
    positions[i * 3] = position.getX(vertex)
    positions[i * 3 + 1] = position.getY(vertex)
    positions[i * 3 + 2] = position.getZ(vertex)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

interface PreparedPolygon {
  rings: Ring[]
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
  /** Rough spherical bbox area, in cos-weighted square degrees. */
  area: number
}

/**
 * Prepares a polygon for point sampling. Rings that cross the antimeridian
 * (e.g. Russia, Fiji) are remapped to a 0..360 longitude frame so the
 * point-in-polygon test stays planar-correct; the same frame is used for
 * sampling, so no coordinate ever needs mapping back.
 */
function preparePolygon(polygon: PolygonCoords): PreparedPolygon {
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of polygon[0]) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  let rings = polygon
  if (maxLng - minLng > 180) {
    rings = polygon.map((ring) =>
      ring.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat]),
    )
    minLng = Infinity
    maxLng = -Infinity
    for (const [lng] of rings[0]) {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
  }

  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180)
  const area = Math.max(
    0,
    (maxLng - minLng) * (maxLat - minLat) * Math.cos(midLat),
  )
  return { rings, minLng, maxLng, minLat, maxLat, area }
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

function pointInPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  if (!pointInRing(lng, lat, rings[0])) return false
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false
  }
  return true
}

function featurePolygons(feature: CountryFeature): PolygonCoords[] {
  const geometry = feature.geometry
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates as PolygonCoords]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as PolygonCoords[]
  return []
}

/* ── Ocean coast-distance field ───────────────────────────────────────
   Coarse lat/lng land mask (OCEAN_MASK_STEP° cells) rasterized from the
   non-ice country polygons, then dilated by a multi-source BFS into a
   small integer distance field: 0 = land, 1 = first ocean cell off the
   coast, … capped at OCEAN_COAST_MAX_STEPS = far open water. The raw
   grid would terrace on the smooth-shaded ocean, so a 3×3 box blur
   softens the BFS's square-metric rings and the returned sampler
   interpolates bilinearly between cell centers — coast distance comes
   out as a continuous float. Longitude wraps, latitude clamps. Runs
   once at init. */
function buildOceanCoastField(
  countries: CountryFeature[],
): (lng: number, lat: number) => number {
  const width = Math.round(360 / OCEAN_MASK_STEP)
  const height = Math.round(180 / OCEAN_MASK_STEP)
  const field = new Uint8Array(width * height).fill(OCEAN_COAST_MAX_STEPS)

  const cellX = (lng: number) => {
    const gx = Math.floor((lng + 180) / OCEAN_MASK_STEP) % width
    return gx < 0 ? gx + width : gx
  }
  const cellY = (lat: number) =>
    Math.min(height - 1, Math.max(0, Math.floor((lat + 90) / OCEAN_MASK_STEP)))
  const markLand = (lng: number, lat: number) => {
    field[cellY(lat) * width + cellX(lng)] = 0
  }

  for (const feature of countries) {
    if (ICE_ISO_CODES.has(feature.properties?.iso ?? '')) continue
    for (const polygon of featurePolygons(feature)) {
      const prepared = preparePolygon(polygon)

      // Walk every ring edge (subdivided below one cell) so small islands
      // and sparse straight coastlines always mark their cells…
      for (const ring of prepared.rings) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const [lngA, latA] = ring[i]
          const [lngB, latB] = ring[i + 1]
          const steps = Math.max(
            1,
            Math.ceil(
              Math.max(Math.abs(lngB - lngA), Math.abs(latB - latA)) /
                (OCEAN_MASK_STEP * 0.5),
            ),
          )
          for (let step = 0; step <= steps; step++) {
            const t = step / steps
            markLand(lerp(lngA, lngB, t), lerp(latA, latB, t))
          }
        }
      }

      // …and fill the interior cells of wide landmasses by containment.
      const gyStart = Math.max(
        0,
        Math.floor((prepared.minLat + 90) / OCEAN_MASK_STEP),
      )
      const gyEnd = Math.min(
        height - 1,
        Math.floor((prepared.maxLat + 90) / OCEAN_MASK_STEP),
      )
      const gxStart = Math.floor((prepared.minLng + 180) / OCEAN_MASK_STEP)
      const gxEnd = Math.floor((prepared.maxLng + 180) / OCEAN_MASK_STEP)
      for (let gy = gyStart; gy <= gyEnd; gy++) {
        const lat = -90 + (gy + 0.5) * OCEAN_MASK_STEP
        for (let gx = gxStart; gx <= gxEnd; gx++) {
          const wrapped = ((gx % width) + width) % width
          if (field[gy * width + wrapped] === 0) continue
          // sample in the polygon's own frame (0..360 when it crosses ±180)
          let lng = -180 + (gx + 0.5) * OCEAN_MASK_STEP
          if (lng < prepared.minLng) lng += 360
          if (lng < prepared.minLng || lng > prepared.maxLng) continue
          if (pointInPolygon(lng, lat, prepared.rings)) {
            field[gy * width + wrapped] = 0
          }
        }
      }
    }
  }

  // Multi-source BFS dilation (8-neighbourhood, longitude wraps).
  let frontier: number[] = []
  for (let index = 0; index < field.length; index++) {
    if (field[index] === 0) frontier.push(index)
  }
  for (let step = 1; step < OCEAN_COAST_MAX_STEPS && frontier.length; step++) {
    const next: number[] = []
    for (const index of frontier) {
      const gx = index % width
      const gy = (index / width) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = gy + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const neighbor = ny * width + ((gx + dx + width) % width)
          if (field[neighbor] > step) {
            field[neighbor] = step
            next.push(neighbor)
          }
        }
      }
    }
    frontier = next
  }

  // 3×3 box blur into a float field. Land (0) bleeds a little into the
  // first water cells, pulling them below 1 — still far under
  // OCEAN_SHALLOW_END, so land-adjacent water keeps its full shallow
  // cyan while the octagonal BFS rings round off.
  const blurred = new Float32Array(field.length)
  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = Math.min(height - 1, Math.max(0, gy + dy))
        for (let dx = -1; dx <= 1; dx++) {
          sum += field[ny * width + ((gx + dx + width) % width)]
        }
      }
      blurred[gy * width + gx] = sum / 9
    }
  }

  // Bilinear interpolation between the 4 surrounding cell centers —
  // longitude wraps, latitude clamps at the pole rows.
  return (lng, lat) => {
    const u = (lng + 180) / OCEAN_MASK_STEP - 0.5
    const v = (lat + 90) / OCEAN_MASK_STEP - 0.5
    const x0 = Math.floor(u)
    const y0 = Math.floor(v)
    const fx = u - x0
    const fy = v - y0
    const gx0 = ((x0 % width) + width) % width
    const gx1 = (gx0 + 1) % width
    const gy0 = Math.min(height - 1, Math.max(0, y0))
    const gy1 = Math.min(height - 1, Math.max(0, y0 + 1))
    const low = lerp(blurred[gy0 * width + gx0], blurred[gy0 * width + gx1], fx)
    const high = lerp(blurred[gy1 * width + gx0], blurred[gy1 * width + gx1], fx)
    return lerp(low, high, fy)
  }
}

/**
 * Per-vertex ocean paint for the smooth-shaded sphere (the land caps
 * stay per-face). The continuous coast distance drives a
 * shore→shallow→mid→deep ramp, with two extra detail layers so
 * smooth never means sterile: an fbm jitter on the sampled distance
 * waves the coastal bands organically instead of tracing mask cells,
 * and a fine fbm grain nudges lightness for subtle open-water texture.
 * Teal and lighter patches still bleed into open water only. Colors are
 * derived purely from vertex POSITION, so the sphere's duplicated
 * UV-seam and pole vertices paint identically — no visible seam.
 */
function paintOceanColors(
  geometry: THREE.BufferGeometry,
  coastDistance: (lng: number, lat: number) => number,
): void {
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const shore = new THREE.Color(OCEAN_SHORE)
  const shallow = new THREE.Color(OCEAN_SHALLOW)
  const mid = new THREE.Color(OCEAN_MID)
  const deep = new THREE.Color(OCEAN_DEEP)
  const teal = new THREE.Color(OCEAN_TEAL)
  const paint = new THREE.Color()

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const radius = Math.sqrt(x * x + y * y + z * z)
    const nx = x / radius
    const ny = y / radius
    const nz = z / radius
    // inverse of latLngToVector3
    const lat = 90 - (Math.acos(Math.min(1, Math.max(-1, ny))) * 180) / Math.PI
    let lng = 90 - (Math.atan2(nz, nx) * 180) / Math.PI
    if (lng > 180) lng -= 360

    const jitter =
      (fbm3(nx, ny, nz, OCEAN_EDGE_JITTER_SCALE, 2, 17.9) - 0.5) *
      2 *
      OCEAN_EDGE_JITTER_CELLS
    const distance = Math.max(0, coastDistance(lng, lat) + jitter)

    if (distance <= OCEAN_SHORE_END) {
      paint.copy(shore)
    } else if (distance < OCEAN_SHALLOW_END) {
      paint.lerpColors(
        shore,
        shallow,
        smoothstep(OCEAN_SHORE_END, OCEAN_SHALLOW_END, distance),
      )
    } else if (distance < OCEAN_MID_START) {
      paint.lerpColors(
        shallow,
        mid,
        smoothstep(OCEAN_SHALLOW_END, OCEAN_MID_START, distance),
      )
    } else {
      paint.lerpColors(
        mid,
        deep,
        smoothstep(OCEAN_DEEP_START, OCEAN_DEEP_END, distance),
      )
    }

    const openness = smoothstep(OCEAN_MID_START, OCEAN_DEEP_START, distance)
    if (openness > 0) {
      const tealPatch = fbm3(nx, ny, nz, OCEAN_TEAL_SCALE, 2, 91.7)
      paint.lerp(
        teal,
        smoothstep(OCEAN_TEAL_THRESHOLD, OCEAN_TEAL_THRESHOLD + 0.25, tealPatch) *
          OCEAN_TEAL_MAX *
          openness,
      )
      const lightPatch = fbm3(nx, ny, nz, OCEAN_LIGHT_SCALE, 2, 57.3)
      paint.lerp(
        shallow,
        smoothstep(
          OCEAN_LIGHT_THRESHOLD,
          OCEAN_LIGHT_THRESHOLD + 0.24,
          lightPatch,
        ) *
          OCEAN_LIGHT_MAX *
          openness,
      )
    }

    // fine tonal grain — keeps big basins from reading as flat plastic
    const grain = (fbm3(nx, ny, nz, OCEAN_GRAIN_SCALE, 2, 33.1) - 0.5) * 2
    paint.offsetHSL(0, 0, grain * OCEAN_GRAIN_STRENGTH)

    colors[i * 3] = paint.r
    colors[i * 3 + 1] = paint.g
    colors[i * 3 + 2] = paint.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/**
 * Night multiplier over the painted ocean (the day multiplier is pure
 * white), derived so mid-ocean water lands exactly on OCEAN_NIGHT after
 * dark — the ocean darkens to a readable deep blue, never black.
 */
function oceanNightTint(): THREE.Color {
  const mid = new THREE.Color(OCEAN_MID)
  const night = new THREE.Color(OCEAN_NIGHT)
  return new THREE.Color(night.r / mid.r, night.g / mid.g, night.b / mid.b)
}

/** Per-tree resting composition inputs + seeded launch data (burst). */
interface BurstTree {
  position: THREE.Vector3
  direction: THREE.Vector3
  align: THREE.Quaternion
  scale: number
  delay: number
  tumbleAxis: THREE.Vector3
  tumbleRate: number
}

async function loadCountries(): Promise<CountryFeature[]> {
  const response = await fetch(GEOJSON_URL)
  if (!response.ok) {
    throw new Error(`Unable to load country geometry: ${response.status}`)
  }
  const collection = (await response.json()) as { features: CountryFeature[] }
  return collection.features
}

export async function createStylizedEarthRenderer(
  canvas: HTMLCanvasElement,
): Promise<EarthRenderer> {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(resource: T): T => {
    disposables.push(resource)
    return resource
  }

  try {
    // Country geometry is load-bearing (no planet without it), but a prop
    // GLB failing must never take the scene down — those resolve to null
    // and the planet simply renders without that prop.
    const gltfLoader = new GLTFLoader()
    const loadProp = (url: string): Promise<GLTF | null> =>
      gltfLoader.loadAsync(url).catch(() => null)
    const [countries, cloudsGltf, islandLargeGltf, islandSmallGltf] =
      await Promise.all([
        loadCountries(),
        loadProp(CLOUDS_MODEL_URL),
        loadProp(ISLAND_MODEL_URLS.FloatingIslandLarge),
        loadProp(ISLAND_MODEL_URLS.FloatingIslandSmall),
      ])

    const scene = new THREE.Scene()

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30)
    camera.position.set(
      0,
      Math.sin(CAMERA_ELEVATION) * 8,
      Math.cos(CAMERA_ELEVATION) * 8,
    )
    camera.lookAt(0, 0, 0)
    const cameraForward = camera.getWorldDirection(new THREE.Vector3())

    /* Scene graph:
         scene
         ├─ tiltGroup (rotation.z = 23.5° axial tilt, fixed;
         │  │          rotation.x = scroll-pose pitch — Euler 'XYZ'
         │  │          applies Rx after Rz, i.e. about the parent/screen
         │  │          horizontal axis, so the tilted assembly pitches
         │  │          away beneath the viewer)
         │  ├─ planetSpin (rotation.y = frame.phi + scroll-pose yaw) —
         │  │              ocean, continents, trees, city dots, user
         │  │              pins, dormant burst shards
         │  ├─ cloudSpin (time-driven drift only, ignores drag) — puffs
         │  └─ aurora curtain (leans with the axis, never spins)
         ├─ floating islands (fixed screen corners, bob + slow self-turn)
         └─ atmosphere shell */
    const tiltGroup = new THREE.Group()
    tiltGroup.rotation.z = -AXIAL_TILT
    scene.add(tiltGroup)

    const planetSpin = new THREE.Group()
    const cloudSpin = new THREE.Group()
    tiltGroup.add(planetSpin, cloudSpin)

    // Lights stay in view space (outside the tilt) so the sun direction is
    // stable while the planet spins under it.
    const keyLight = new THREE.DirectionalLight(KEY_DAY.color, KEY_DAY.intensity)
    keyLight.position.copy(KEY_POSITION)
    const fillLight = new THREE.DirectionalLight(FILL_DAY.color, FILL_DAY.intensity)
    fillLight.position.copy(FILL_POSITION)
    const hemiLight = new THREE.HemisphereLight(
      HEMI_DAY.sky,
      HEMI_DAY.ground,
      HEMI_DAY.intensity,
    )
    scene.add(keyLight, fillLight, hemiLight)

    // Materials whose color lerps between day and night each frame.
    const themedMaterials: Array<{
      material: THREE.MeshLambertMaterial
      day: THREE.Color
      night: THREE.Color
    }> = []
    const themedMaterial = (
      day: string,
      night?: THREE.Color,
      params?: THREE.MeshLambertMaterialParameters,
    ) => {
      const material = track(
        new THREE.MeshLambertMaterial({
          color: day,
          flatShading: true,
          ...params,
        }),
      )
      themedMaterials.push({
        material,
        day: new THREE.Color(day),
        night: night ?? nightVariant(day),
      })
      return material
    }

    // ── Ocean ──────────────────────────────────────────────────────────
    // Smooth-shaded (unlike everything else) and painted per-vertex: the
    // material color is a day/night MULTIPLIER over the vertex colors —
    // white by day, a derived cool tint at night (see oceanNightTint) so
    // the painted hues survive but darken to deep blue after dark.
    const oceanMaterial = themedMaterial('#ffffff', oceanNightTint(), {
      vertexColors: true,
      flatShading: false,
    })
    // Cheap fresnel rim — a clean gradient limb glow over the smooth
    // normals. With an orthographic camera the view direction is (0,0,1)
    // in view space, so the rim term needs only the fragment normal —
    // guaranteed to compile against the Lambert shader.
    let oceanShader: { uniforms: Record<string, THREE.IUniform> } | null = null
    oceanMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: new THREE.Color(OCEAN_RIM_DAY) }
      shader.uniforms.uRimStrength = { value: OCEAN_RIM_STRENGTH }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          'uniform vec3 uRimColor;\nuniform float uRimStrength;\nvoid main() {',
        )
        .replace(
          '#include <opaque_fragment>',
          [
            `float rimTerm = pow(1.0 - saturate(normal.z), ${OCEAN_RIM_POWER.toFixed(1)});`,
            'outgoingLight += uRimColor * rimTerm * uRimStrength;',
            '#include <opaque_fragment>',
          ].join('\n'),
        )
      oceanShader = shader
    }
    const oceanGeometry = track(
      new THREE.SphereGeometry(
        OCEAN_RADIUS,
        OCEAN_WIDTH_SEGMENTS,
        OCEAN_HEIGHT_SEGMENTS,
      ),
    )
    // countries resolved before scene construction, so the coast field is
    // ready here and the color attribute lands before the first frame
    paintOceanColors(oceanGeometry, buildOceanCoastField(countries))
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial)
    planetSpin.add(ocean)

    // ── Continents ─────────────────────────────────────────────────────
    // One ConicPolygonGeometry per country polygon with the shared hill
    // field as its topHeight accessor (the torso's top edge follows it
    // too, so coastal walls meet the terrain exactly). Caps are painted
    // per-face — sand lowlands up through vibrant greens — and merge into
    // a single vertex-colored mesh; sides and ice merge into one mesh
    // each. The cap material's color is a day/night MULTIPLIER over the
    // vertex colors: white by day, a dim cool factor at night, so the
    // painted hues survive but darken after dark.
    const sideMaterial = themedMaterial(SIDE_DAY_COLOR)
    const capMaterial = themedMaterial('#ffffff', undefined, {
      vertexColors: true,
    })
    const iceMaterial = themedMaterial(ICE_DAY_COLOR)

    const sideParts: THREE.BufferGeometry[] = []
    const capParts: THREE.BufferGeometry[] = []
    const iceParts: THREE.BufferGeometry[] = []

    const paint = new THREE.Color()
    const sandColor = new THREE.Color(LAND_SAND)
    const grassColor = new THREE.Color(LAND_GRASS)
    const meadowColor = new THREE.Color(LAND_MEADOW)
    const highlandColor = new THREE.Color(LAND_HIGHLAND)

    // Per-face painting (all 3 vertices share one color): crisp facets
    // that match the flat shading instead of smearing gradients across
    // the big coastal triangles.
    const paintCapColors = (cap: THREE.BufferGeometry, hueJitter: number) => {
      const position = cap.getAttribute('position')
      const colors = new Float32Array(position.count * 3)
      for (let face = 0; face < position.count / 3; face++) {
        const i = face * 3
        const cx =
          (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3
        const cy =
          (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3
        const cz =
          (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
        const radius = Math.sqrt(cx * cx + cy * cy + cz * cz)
        const elevation = Math.min(
          1,
          Math.max(0, (radius - LAND_TOP_RADIUS) / HILL_MAX_HEIGHT),
        )

        if (elevation <= LAND_SAND_END) {
          paint.copy(sandColor)
        } else if (elevation < LAND_GRASS_START) {
          paint.lerpColors(
            sandColor,
            grassColor,
            smoothstep(LAND_SAND_END, LAND_GRASS_START, elevation),
          )
        } else {
          paint.lerpColors(
            grassColor,
            highlandColor,
            smoothstep(LAND_GRASS_START, 1, elevation),
          )
        }
        if (elevation > LAND_SAND_END) {
          // meadow patches + per-country hue nudge, greens only
          const patch = fbm3(
            cx / radius,
            cy / radius,
            cz / radius,
            LAND_PATCH_SCALE,
            2,
            41.3,
          )
          const grassiness = Math.min(
            1,
            (elevation - LAND_SAND_END) / (LAND_GRASS_START - LAND_SAND_END),
          )
          paint.lerp(
            meadowColor,
            Math.min(0.7, Math.max(0, (patch - 0.4) * 1.7)) * grassiness,
          )
          // hue nudge rotates toward fresh teal-greens only — a negative
          // (yellow-olive) direction is exactly the mix being retired
          paint.offsetHSL((hueJitter + 1) * 0.011, 0.02, 0)
        }

        for (let vertex = 0; vertex < 3; vertex++) {
          colors[(i + vertex) * 3] = paint.r
          colors[(i + vertex) * 3 + 1] = paint.g
          colors[(i + vertex) * 3 + 2] = paint.b
        }
      }
      cap.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    }

    const hillAccessor = (lng: number, lat: number) => hillRadius(lng, lat)
    for (const feature of countries) {
      const iso = feature.properties?.iso ?? ''
      const name = feature.properties?.name ?? ''
      const isIce = ICE_ISO_CODES.has(iso)
      const hueJitter = ((hashString(iso || name) % 1000) / 500) - 1 // -1..1

      for (const polygon of featurePolygons(feature)) {
        const conic = new ConicPolygonGeometry(
          polygon,
          LAND_BOTTOM_RADIUS,
          hillAccessor,
          false, // closedBottom — buried inside the ocean sphere
          true, // closedTop
          true, // includeSides
          LAND_CURVATURE_RESOLUTION,
        )
        // Group order with these flags: [0] = side walls, [1] = top cap.
        sideParts.push(extractGroupGeometry(conic, conic.groups[0]))
        const cap = extractGroupGeometry(conic, conic.groups[1])
        if (isIce) {
          iceParts.push(cap)
        } else {
          paintCapColors(cap, hueJitter)
          capParts.push(cap)
        }
        conic.dispose()
      }
    }

    const addMergedMesh = (
      parts: THREE.BufferGeometry[],
      material: THREE.MeshLambertMaterial,
    ) => {
      if (!parts.length) return
      const merged = track(mergeGeometries(parts))
      merged.computeVertexNormals()
      for (const part of parts) part.dispose()
      planetSpin.add(new THREE.Mesh(merged, material))
    }

    addMergedMesh(sideParts, sideMaterial)
    addMergedMesh(capParts, capMaterial)
    addMergedMesh(iceParts, iceMaterial)

    // ── City dots (night-side golden lights) ───────────────────────────
    // Deterministic scatter: N ∝ area^0.62 points rejection-sampled inside
    // each country polygon (ice sheets excluded).
    const dotRandom = mulberry32(CITY_DOT_SEED)
    const dotPositions: number[] = []
    for (const feature of countries) {
      if (ICE_ISO_CODES.has(feature.properties?.iso ?? '')) continue

      for (const polygon of featurePolygons(feature)) {
        if (dotPositions.length / 3 >= CITY_DOT_TOTAL_CAP) break
        const prepared = preparePolygon(polygon)
        if (prepared.area <= 0 || prepared.minLat > CITY_DOT_MAX_LAT) continue
        const dotCount = Math.min(
          CITY_DOT_MAX_PER_COUNTRY,
          Math.max(1, Math.round(CITY_DOT_DENSITY * prepared.area ** 0.62)),
        )
        for (let dot = 0; dot < dotCount; dot++) {
          for (let attempt = 0; attempt < 16; attempt++) {
            const lng =
              prepared.minLng + dotRandom() * (prepared.maxLng - prepared.minLng)
            const lat =
              prepared.minLat + dotRandom() * (prepared.maxLat - prepared.minLat)
            if (Math.abs(lat) > CITY_DOT_MAX_LAT) continue
            if (pointInPolygon(lng, lat, prepared.rings)) {
              // ride the local hill so dots never sink under the terrain
              const point = latLngToVector3(
                lat,
                lng,
                hillRadius(lng, lat) + CITY_DOT_LIFT,
              )
              dotPositions.push(point.x, point.y, point.z)
              break
            }
          }
        }
      }
    }

    const cityDotGeometry = track(new THREE.BufferGeometry())
    cityDotGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(dotPositions), 3),
    )
    const cityDotMaterial = track(
      new THREE.PointsMaterial({
        color: CITY_DOT_COLOR,
        size: CITY_DOT_SIZE,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    const cityDots = new THREE.Points(cityDotGeometry, cityDotMaterial)
    planetSpin.add(cityDots)

    // ── Trees ──────────────────────────────────────────────────────────
    // Forest patches: per country polygon, a few cluster hearts are
    // rejection-sampled inside the rings, then trees scatter around each
    // heart (re-tested against the polygon). Every tree stands on the
    // shared hill field. Two InstancedMeshes = two draw calls; canopy
    // greens ride per-instance colors under the same white-multiplier
    // day/night lerp as the caps.
    const treeRandom = mulberry32(TREE_SEED)
    const treeSpots: Array<{
      lng: number
      lat: number
      scale: number
      yaw: number
      colorIndex: number
    }> = []
    for (const feature of countries) {
      if (treeSpots.length >= TREE_TOTAL_CAP) break
      if (ICE_ISO_CODES.has(feature.properties?.iso ?? '')) continue

      for (const polygon of featurePolygons(feature)) {
        if (treeSpots.length >= TREE_TOTAL_CAP) break
        const prepared = preparePolygon(polygon)
        if (prepared.area <= 0) continue
        if (prepared.minLat > TREE_MAX_LAT || prepared.maxLat < -TREE_MAX_LAT)
          continue
        const budget = Math.min(
          TREE_MAX_PER_COUNTRY,
          Math.round(TREE_DENSITY * prepared.area ** 0.62),
        )
        if (budget < 1) continue

        const clusters = Math.max(1, Math.round(budget / TREE_PER_CLUSTER))
        let remaining = budget
        for (let cluster = 0; cluster < clusters && remaining > 0; cluster++) {
          let heartLng = 0
          let heartLat = 0
          let heartFound = false
          for (let attempt = 0; attempt < 20; attempt++) {
            const lng =
              prepared.minLng + treeRandom() * (prepared.maxLng - prepared.minLng)
            const lat =
              prepared.minLat + treeRandom() * (prepared.maxLat - prepared.minLat)
            if (Math.abs(lat) > TREE_MAX_LAT) continue
            if (!pointInPolygon(lng, lat, prepared.rings)) continue
            heartLng = lng
            heartLat = lat
            heartFound = true
            break
          }
          if (!heartFound) continue

          const clusterSize = Math.min(
            remaining,
            TREE_PER_CLUSTER + Math.floor(treeRandom() * 4) - 1,
          )
          for (let tree = 0; tree < clusterSize; tree++) {
            if (treeSpots.length >= TREE_TOTAL_CAP) break
            for (let attempt = 0; attempt < 8; attempt++) {
              const spread = TREE_CLUSTER_SPREAD * Math.sqrt(treeRandom())
              const angle = treeRandom() * Math.PI * 2
              const lat = heartLat + Math.sin(angle) * spread
              const lng =
                heartLng +
                (Math.cos(angle) * spread) /
                  Math.max(0.35, Math.cos((lat * Math.PI) / 180))
              if (Math.abs(lat) > TREE_MAX_LAT) continue
              if (!pointInPolygon(lng, lat, prepared.rings)) continue
              if (hillElevation01(lng, lat) < TREE_MIN_ELEVATION) continue
              treeSpots.push({
                lng,
                lat,
                scale:
                  TREE_SCALE_MIN +
                  treeRandom() * (TREE_SCALE_MAX - TREE_SCALE_MIN),
                yaw: treeRandom() * Math.PI * 2,
                colorIndex: Math.floor(treeRandom() * TREE_CANOPY_COLORS.length),
              })
              remaining--
              break
            }
          }
        }
      }
    }

    // Burst wavefront state. The resting composition inputs persist (they
    // used to be composed once and discarded) so scrubbing the wave back
    // to 0 recomposes the exact original matrices; the per-tree launch
    // data is seeded by its own PRNG so the scatter above stays untouched.
    let treeBurst: {
      trunk: THREE.InstancedMesh
      canopy: THREE.InstancedMesh
      trees: BurstTree[]
    } | null = null

    if (treeSpots.length > 0) {
      const trunkGeometry = track(
        new THREE.CylinderGeometry(
          TREE_TRUNK_RADIUS * 0.55,
          TREE_TRUNK_RADIUS,
          TREE_TRUNK_HEIGHT,
          5,
        ),
      )
      trunkGeometry.translate(0, TREE_TRUNK_HEIGHT / 2, 0)
      const canopyGeometry = track(
        new THREE.IcosahedronGeometry(TREE_CANOPY_RADIUS, 1),
      )
      canopyGeometry.scale(1, 0.92, 1)
      canopyGeometry.translate(0, TREE_TRUNK_HEIGHT + TREE_CANOPY_RADIUS * 0.72, 0)

      const trunkMaterial = themedMaterial(TREE_TRUNK_COLOR)
      const canopyMaterial = themedMaterial('#ffffff') // × instance greens
      const trunkMesh = track(
        new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeSpots.length),
      )
      const canopyMesh = track(
        new THREE.InstancedMesh(canopyGeometry, canopyMaterial, treeSpots.length),
      )

      const treeBurstRandom = mulberry32(TREE_BURST_SEED)
      const treeMatrix = new THREE.Matrix4()
      const treeAlign = new THREE.Quaternion()
      const treeYaw = new THREE.Quaternion()
      const treeScale = new THREE.Vector3()
      const canopyTint = new THREE.Color()
      const burstTrees: BurstTree[] = []
      treeSpots.forEach((spot, index) => {
        const direction = latLngToVector3(spot.lat, spot.lng, 1)
        const surface = hillRadius(spot.lng, spot.lat) - TREE_SINK
        treeAlign.setFromUnitVectors(UP, direction)
        treeYaw.setFromAxisAngle(UP, spot.yaw)
        treeAlign.multiply(treeYaw)
        treeScale.setScalar(spot.scale)
        const position = direction.clone().multiplyScalar(surface)
        treeMatrix.compose(position, treeAlign, treeScale)
        trunkMesh.setMatrixAt(index, treeMatrix)
        canopyMesh.setMatrixAt(index, treeMatrix)
        canopyMesh.setColorAt(
          index,
          canopyTint.set(TREE_CANOPY_COLORS[spot.colorIndex]),
        )

        const tumbleAxis = new THREE.Vector3(
          treeBurstRandom() * 2 - 1,
          treeBurstRandom() * 2 - 1,
          treeBurstRandom() * 2 - 1,
        )
        if (tumbleAxis.lengthSq() < 1e-6) tumbleAxis.set(0, 1, 0)
        tumbleAxis.normalize()
        burstTrees.push({
          position,
          direction,
          align: treeAlign.clone(),
          scale: spot.scale,
          delay: treeBurstRandom() * TREE_BURST_DELAY_MAX,
          tumbleAxis,
          tumbleRate:
            TREE_BURST_TUMBLE_MIN +
            treeBurstRandom() * (TREE_BURST_TUMBLE_MAX - TREE_BURST_TUMBLE_MIN),
        })
      })
      trunkMesh.instanceMatrix.needsUpdate = true
      canopyMesh.instanceMatrix.needsUpdate = true
      if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true
      planetSpin.add(trunkMesh, canopyMesh)
      treeBurst = { trunk: trunkMesh, canopy: canopyMesh, trees: burstTrees }
    }

    // ── Continental shards (scroll-burst crust rip-outs) ───────────────
    // Dormant "newborn floating islands": an inverted rock cone under a
    // low grass dome. The rock reuses the continent side-wall material —
    // the shard IS torn crust, so its cliffs must match the coastline
    // cliffs it ripped out of. Seeded onto sizable temperate landmasses
    // via the same polygon test as the other scatters, resting flush in
    // the hill field, invisible and scale-ε until their channel rips
    // them out (grow fast, lift along the normal, tumble, drift apart).
    // They ride planetSpin, inheriting the ground spin they were part of.
    const shardGrassMaterial = themedMaterial(LAND_GRASS)
    const shardRockGeometry = track(
      new THREE.ConeGeometry(SHARD_ROCK_RADIUS, SHARD_ROCK_DEPTH, 7),
    )
    shardRockGeometry.rotateX(Math.PI) // apex down — the torn root
    shardRockGeometry.translate(0, -SHARD_ROCK_DEPTH / 2, 0) // rim at y = 0
    const shardCapGeometry = track(
      new THREE.SphereGeometry(SHARD_CAP_RADIUS, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
    )
    shardCapGeometry.scale(1, SHARD_CAP_SQUASH, 1)

    const shardRandom = mulberry32(SHARD_SEED)
    const shardLands: PreparedPolygon[] = []
    for (const feature of countries) {
      if (ICE_ISO_CODES.has(feature.properties?.iso ?? '')) continue
      for (const polygon of featurePolygons(feature)) {
        const prepared = preparePolygon(polygon)
        if (prepared.area < SHARD_MIN_POLYGON_AREA) continue
        if (prepared.minLat > SHARD_MAX_LAT || prepared.maxLat < -SHARD_MAX_LAT)
          continue
        shardLands.push(prepared)
      }
    }
    const shardRigs: Array<{
      node: THREE.Group
      direction: THREE.Vector3
      surfaceRadius: number
      restingAlign: THREE.Quaternion
      tangent: THREE.Vector3
      tumbleAxis: THREE.Vector3
      tumbleRate: number
      size: number
      lastChannel: number
    }> = []
    for (let shard = 0; shard < BURST_SHARD_COUNT && shardLands.length; shard++) {
      let lng = 0
      let lat = 0
      let found = false
      for (let attempt = 0; attempt < 40 && !found; attempt++) {
        const prepared =
          shardLands[Math.floor(shardRandom() * shardLands.length)]
        const sampleLng =
          prepared.minLng + shardRandom() * (prepared.maxLng - prepared.minLng)
        const sampleLat =
          prepared.minLat + shardRandom() * (prepared.maxLat - prepared.minLat)
        if (Math.abs(sampleLat) > SHARD_MAX_LAT) continue
        if (!pointInPolygon(sampleLng, sampleLat, prepared.rings)) continue
        lng = sampleLng
        lat = sampleLat
        found = true
      }
      if (!found) continue // channels tolerate a short rig list

      const direction = latLngToVector3(lat, lng, 1)
      // |lat| ≤ SHARD_MAX_LAT keeps direction well away from ±UP, so the
      // cross product below can never degenerate
      const tangent = new THREE.Vector3()
        .crossVectors(direction, UP)
        .normalize()
        .applyAxisAngle(direction, shardRandom() * Math.PI * 2)
      const tumbleAxis = new THREE.Vector3(
        shardRandom() * 2 - 1,
        shardRandom() * 2 - 1,
        shardRandom() * 2 - 1,
      )
      if (tumbleAxis.lengthSq() < 1e-6) tumbleAxis.set(0, 1, 0)
      tumbleAxis.normalize()

      const holder = new THREE.Group()
      holder.add(
        new THREE.Mesh(shardRockGeometry, sideMaterial),
        new THREE.Mesh(shardCapGeometry, shardGrassMaterial),
      )
      const surfaceRadius = hillRadius(lng, lat)
      holder.quaternion.setFromUnitVectors(UP, direction)
      holder.position.copy(direction).multiplyScalar(surfaceRadius)
      holder.scale.setScalar(BURST_MIN_SCALE)
      holder.visible = false
      planetSpin.add(holder)
      shardRigs.push({
        node: holder,
        direction,
        surfaceRadius,
        restingAlign: holder.quaternion.clone(),
        tangent,
        tumbleAxis,
        tumbleRate:
          SHARD_TUMBLE_MIN +
          shardRandom() * (SHARD_TUMBLE_MAX - SHARD_TUMBLE_MIN),
        size: SHARD_SIZE_MIN + shardRandom() * (SHARD_SIZE_MAX - SHARD_SIZE_MIN),
        lastChannel: 0,
      })
    }

    // ── User pins ──────────────────────────────────────────────────────
    // All pins merge into one emissive-looking mesh; its color tracks
    // frame.accent. Head positions are kept for screen projection.
    const pinMaterial = track(new THREE.MeshBasicMaterial({ color: '#ffffff' }))
    const pinAnchors: THREE.Vector3[] = []
    const pinParts: THREE.BufferGeometry[] = []
    for (const pilot of PILOTS) {
      const direction = latLngToVector3(pilot.lat, pilot.lng, 1)
      // each pin stands on its local hill (same field as the caps)
      const surfaceRadius = hillRadius(pilot.lng, pilot.lat)

      const stem = new THREE.CylinderGeometry(
        PIN_STEM_RADIUS,
        PIN_STEM_RADIUS,
        PIN_STEM_HEIGHT,
        5,
      ).toNonIndexed()
      stem.translate(0, PIN_STEM_HEIGHT / 2, 0)
      const head = new THREE.OctahedronGeometry(PIN_HEAD_RADIUS, 0)
      head.translate(0, PIN_STEM_HEIGHT + PIN_HEAD_RADIUS * 0.85, 0)

      const pin = mergeGeometries([stem, head])
      stem.dispose()
      head.dispose()
      pin.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction))
      pin.translate(
        direction.x * surfaceRadius,
        direction.y * surfaceRadius,
        direction.z * surfaceRadius,
      )
      pinParts.push(pin)

      pinAnchors.push(
        direction
          .clone()
          .multiplyScalar(
            surfaceRadius + PIN_STEM_HEIGHT + PIN_HEAD_RADIUS * 0.85,
          ),
      )
    }
    const pinGeometry = track(mergeGeometries(pinParts))
    for (const part of pinParts) part.dispose()
    planetSpin.add(new THREE.Mesh(pinGeometry, pinMaterial))

    // ── Props: GLTF clouds + floating islands ──────────────────────────
    // The GLBs arrive with flat-color PBR materials whose metalness the
    // converter left at 0.4; instead of patching them we swap every prop
    // mesh onto the scene's own themed flat-shaded Lamberts (keyed by the
    // authored material name), which also enrolls them in the day/night
    // lerp and the disposal ledger. Clones share the tracked geometries.
    const cloudMaterial = themedMaterial(CLOUD_DAY, new THREE.Color(CLOUD_NIGHT))
    cloudMaterial.emissive.set(CLOUD_EMISSIVE_DAY)
    const islandGrassMaterial = themedMaterial(
      ISLAND_GRASS_DAY,
      new THREE.Color(ISLAND_GRASS_NIGHT),
    )
    const islandRockMaterial = themedMaterial(
      ISLAND_ROCK_DAY,
      new THREE.Color(ISLAND_ROCK_NIGHT),
    )
    const propMaterials: Record<string, THREE.MeshLambertMaterial> = {
      Cloud: cloudMaterial,
      Grass: islandGrassMaterial,
      Rock: islandRockMaterial,
    }
    const adoptPropMaterials = (gltf: GLTF | null) => {
      if (!gltf) return
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        track(mesh.geometry)
        const original = mesh.material as THREE.Material
        mesh.material = propMaterials[original.name] ?? islandRockMaterial
        original.dispose()
      })
    }
    adoptPropMaterials(cloudsGltf)
    adoptPropMaterials(islandLargeGltf)
    adoptPropMaterials(islandSmallGltf)

    // Clouds: tangent-oriented clones riding cloudSpin at a fixed altitude
    // band, one holder group per placement so each can bob independently.
    const cloudRandom = mulberry32(CLOUD_SEED)
    const cloudBurstRandom = mulberry32(CLOUD_BURST_SEED)
    const cloudRigs: Array<{
      node: THREE.Object3D
      puff: THREE.Object3D
      /** Placement index — rigs skip missing GLTF kinds, channels don't. */
      channelIndex: number
      direction: THREE.Vector3
      bobSpeed: number
      bobPhase: number
      baseYaw: number
      baseScale: number
      /** Seeded view-axis escape component (depth crossing). */
      escapeZ: number
      /** Build-time screen radial — stabilizes the live escape heading. */
      escapeBiasX: number
      escapeBiasY: number
      burstActive: boolean
    }> = []
    for (const [channelIndex, placement] of CLOUD_PLACEMENTS.entries()) {
      // draw PRNG values unconditionally so placements keep their look
      // even if one cloud kind is missing from the file
      const puffYaw = cloudRandom() * Math.PI * 2
      const bobSpeed = 0.35 + cloudRandom() * 0.4
      const bobPhase = cloudRandom() * Math.PI * 2
      const escapeZ = (cloudBurstRandom() * 2 - 1) * CLOUD_ESCAPE_Z_VAR
      const source = cloudsGltf?.scene.getObjectByName(placement.kind)
      if (!source) continue

      const puff = source.clone()
      puff.position.set(0, 0, 0) // node translations carry authored spread
      puff.rotation.y = puffYaw
      puff.scale.setScalar(placement.scale)
      puff.scale.y *= CLOUD_PROP_SQUASH

      const direction = latLngToVector3(placement.lat, placement.lng, 1)
      // Screen radial of the resting point at build (cloudSpin at 0, only
      // the fixed axial tilt applied) — the CLOUD_ESCAPE_BIAS anchor.
      const resting = direction
        .clone()
        .multiplyScalar(CLOUD_ALTITUDE)
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), -AXIAL_TILT)
      let escapeBiasX = resting.x
      let escapeBiasY =
        resting.y * SCREEN_Y_WORLD_Y + resting.z * SCREEN_Y_WORLD_Z
      const biasLength = Math.hypot(escapeBiasX, escapeBiasY)
      escapeBiasX =
        biasLength > 1e-5
          ? (escapeBiasX / biasLength) * CLOUD_ESCAPE_BIAS
          : CLOUD_ESCAPE_BIAS
      escapeBiasY =
        biasLength > 1e-5 ? (escapeBiasY / biasLength) * CLOUD_ESCAPE_BIAS : 0

      const holder = new THREE.Group()
      holder.quaternion.setFromUnitVectors(UP, direction)
      holder.position.copy(direction).multiplyScalar(CLOUD_ALTITUDE)
      holder.add(puff)
      cloudSpin.add(holder)
      cloudRigs.push({
        node: holder,
        puff,
        channelIndex,
        direction,
        bobSpeed,
        bobPhase,
        baseYaw: puffYaw,
        baseScale: placement.scale,
        escapeZ,
        escapeBiasX,
        escapeBiasY,
        burstActive: false,
      })
    }

    // Floating islands: slow screen-plane orbits around the planet (scene
    // level, no tilt/spin inheritance), animated in the frame loop. The
    // builder poses each holder at its time-0 orbit position so the scene
    // is correct even before the first render call.
    const islandSources: Record<string, GLTF | null> = {
      FloatingIslandLarge: islandLargeGltf,
      FloatingIslandSmall: islandSmallGltf,
    }
    const islandScreenYToWorld = 1 / Math.cos(CAMERA_ELEVATION)
    const islandRigs: Array<{
      node: THREE.Group
      /** Placement index — rigs skip missing GLTFs, channels don't. */
      channelIndex: number
      placement: (typeof ISLAND_PLACEMENTS)[number]
    }> = []
    for (const [channelIndex, placement] of ISLAND_PLACEMENTS.entries()) {
      const source = islandSources[placement.kind]?.scene.getObjectByName(
        placement.kind,
      )
      if (!source) continue

      const island = source.clone()
      island.position.set(0, 0, 0)
      island.rotation.z = placement.lean
      island.scale.setScalar(placement.scale)

      const holder = new THREE.Group()
      holder.rotation.y = placement.yaw
      holder.position.set(
        placement.orbitRadius * Math.cos(placement.orbitStart),
        placement.orbitRadius *
          Math.sin(placement.orbitStart) *
          islandScreenYToWorld,
        0,
      )
      holder.add(island)
      scene.add(holder)
      islandRigs.push({ node: holder, channelIndex, placement })
    }

    // ── Atmosphere rim ─────────────────────────────────────────────────
    // Backside shell: the planet depth-occludes everything inside its
    // silhouette, leaving an additive annulus that is brightest at the
    // limb and fades outward. Orthographic camera ⇒ view-space normal.z
    // maps directly to distance from the limb.
    const atmoInner = Math.sqrt(1 - (OCEAN_RADIUS / ATMO_RADIUS) ** 2)
    const atmoUniforms = {
      uColor: { value: new THREE.Color(ATMO_DAY) },
      uStrength: { value: ATMO_DAY_STRENGTH },
    }
    const atmoMaterial = track(
      new THREE.ShaderMaterial({
        uniforms: atmoUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uStrength;
          varying vec3 vNormal;
          void main() {
            float edge = clamp(-vNormal.z / ${atmoInner.toFixed(4)}, 0.0, 1.0);
            float glow = pow(edge, ${ATMO_FALLOFF.toFixed(2)}) * uStrength;
            gl_FragColor = vec4(uColor, glow);
          }
        `,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    const atmosphere = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(ATMO_RADIUS, 4)),
      atmoMaterial,
    )
    scene.add(atmosphere)

    // ── Aurora (dark-mode polar ribbons) ───────────────────────────────
    // All bands merge into one additive curtain mesh living in tiltGroup:
    // it leans with the axis but does NOT ride planetSpin, so the arcs
    // always drape over the visible pole regardless of drag. Vertical
    // teal→green→violet gradient in the fragment shader; a slow vertex
    // sway + alpha shimmer driven purely by frame.time (static at 0).
    // Opacity scales with (1 - lightMode): dark mode only.
    const auroraPositions: number[] = []
    const auroraUvs: number[] = []
    const auroraAlphas: number[] = []
    const auroraPhases: number[] = []
    const auroraIndices: number[] = []
    for (const band of AURORA_BANDS) {
      const vertexBase = auroraPositions.length / 3
      for (let row = 0; row <= AURORA_ROWS; row++) {
        const v = row / AURORA_ROWS
        const radius = lerp(band.rBottom, band.rTop, v)
        for (let segment = 0; segment <= AURORA_SEGMENTS; segment++) {
          const u = segment / AURORA_SEGMENTS
          const lng = band.lngCenter + (u - 0.5) * band.lngSpan
          const lat =
            band.baseLat +
            band.latAmp *
              Math.sin(u * band.waveFreq * Math.PI * 2 + band.phase)
          const point = latLngToVector3(lat, lng, radius)
          auroraPositions.push(point.x, point.y, point.z)
          auroraUvs.push(u, v)
          auroraAlphas.push(band.opacity)
          auroraPhases.push(band.phase)
        }
      }
      const stride = AURORA_SEGMENTS + 1
      for (let row = 0; row < AURORA_ROWS; row++) {
        for (let segment = 0; segment < AURORA_SEGMENTS; segment++) {
          const a = vertexBase + row * stride + segment
          const b = a + 1
          const c = a + stride
          const d = c + 1
          auroraIndices.push(a, c, b, b, c, d)
        }
      }
    }
    const auroraGeometry = track(new THREE.BufferGeometry())
    auroraGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(auroraPositions), 3),
    )
    auroraGeometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(auroraUvs), 2),
    )
    auroraGeometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(new Float32Array(auroraAlphas), 1),
    )
    auroraGeometry.setAttribute(
      'aPhase',
      new THREE.BufferAttribute(new Float32Array(auroraPhases), 1),
    )
    auroraGeometry.setIndex(auroraIndices)

    const auroraUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uBottom: { value: new THREE.Color(AURORA_BOTTOM) },
      uMid: { value: new THREE.Color(AURORA_MID) },
      uTop: { value: new THREE.Color(AURORA_TOP) },
    }
    const auroraMaterial = track(
      new THREE.ShaderMaterial({
        uniforms: auroraUniforms,
        vertexShader: /* glsl */ `
          uniform float uTime;
          attribute float aAlpha;
          attribute float aPhase;
          varying vec2 vUv;
          varying float vAlpha;
          varying float vPhase;
          void main() {
            vUv = uv;
            vAlpha = aAlpha;
            vPhase = aPhase;
            // gentle horizontal sway, growing toward the curtain top
            float sway = sin(uTime * 0.55 + uv.x * 7.5 + aPhase) * 0.03 * uv.y;
            float c = cos(sway);
            float s = sin(sway);
            vec3 p = vec3(
              position.x * c - position.z * s,
              position.y,
              position.x * s + position.z * c
            );
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uOpacity;
          uniform vec3 uBottom;
          uniform vec3 uMid;
          uniform vec3 uTop;
          varying vec2 vUv;
          varying float vAlpha;
          varying float vPhase;
          void main() {
            vec3 color = vUv.y < 0.5
              ? mix(uBottom, uMid, smoothstep(0.0, 0.5, vUv.y))
              : mix(uMid, uTop, smoothstep(0.5, 1.0, vUv.y));
            float ends = pow(clamp(sin(3.14159 * vUv.x), 0.0, 1.0), 0.8);
            float base = smoothstep(0.0, 0.14, vUv.y);
            float crown = 1.0 - 0.85 * smoothstep(0.3, 1.0, vUv.y);
            float shimmer =
              0.82 + 0.18 * sin(uTime * 0.8 + vUv.x * 12.0 + vPhase * 2.0);
            float alpha = ends * base * crown * shimmer * vAlpha * uOpacity;
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    )
    const aurora = new THREE.Mesh(auroraGeometry, auroraMaterial)
    tiltGroup.add(aurora)

    // ── Frame plumbing ─────────────────────────────────────────────────
    const accentColor = new THREE.Color()
    const atmoNight = new THREE.Color()
    const atmoNightBase = new THREE.Color(ATMO_NIGHT_BASE)
    const atmoDay = new THREE.Color(ATMO_DAY)
    const oceanRimDay = new THREE.Color(OCEAN_RIM_DAY)
    const oceanRimNight = new THREE.Color(OCEAN_RIM_NIGHT)
    const keyDayColor = new THREE.Color(KEY_DAY.color)
    const keyNightColor = new THREE.Color(KEY_NIGHT.color)
    const fillDayColor = new THREE.Color(FILL_DAY.color)
    const fillNightColor = new THREE.Color(FILL_NIGHT.color)
    const hemiDaySky = new THREE.Color(HEMI_DAY.sky)
    const hemiNightSky = new THREE.Color(HEMI_NIGHT.sky)
    const hemiDayGround = new THREE.Color(HEMI_DAY.ground)
    const hemiNightGround = new THREE.Color(HEMI_NIGHT.ground)
    const cloudEmissiveDay = new THREE.Color(CLOUD_EMISSIVE_DAY)
    const cloudEmissiveNight = new THREE.Color(CLOUD_EMISSIVE_NIGHT)
    const projected = new THREE.Vector3()
    const worldDirection = new THREE.Vector3()
    // Pooled getPinScreenPositions results — the draw loop calls it every
    // frame, and fresh objects per pin per frame is steady GC pressure for
    // identical shapes. Callers read the pool in place and must not hold
    // entries across frames.
    const pinPositions: PinScreenPosition[] = pinAnchors.map((_, index) => ({
      index,
      x: 0,
      y: 0,
      front: false,
    }))
    // Scroll-burst scratch (reused sequentially across clouds, trees and
    // shards — zero per-frame allocation) plus restore-once latches so a
    // finished scrub snaps everything back to rest exactly once, after
    // which idle frames skip all burst work.
    const burstWorldQuat = new THREE.Quaternion()
    const burstInverseQuat = new THREE.Quaternion()
    const burstVec = new THREE.Vector3()
    const burstQuat = new THREE.Quaternion()
    const burstScale = new THREE.Vector3()
    const burstMatrix = new THREE.Matrix4()
    let burstChannels: BurstChannels | null = null
    let lastTreeWave = 0
    let treeBuffersDynamic = false
    let lastAtmoBurst = 0
    let lastAuroraBurst = 0
    let rumbleActive = false
    // Theme latch: every light/material/uniform write below is a pure
    // function of (day, accent), which are constant except during the
    // ~1s theme crossfade. NaN seeds force the first frame to write.
    let lastDay = Number.NaN
    let lastAccentR = Number.NaN
    let lastAccentG = Number.NaN
    let lastAccentB = Number.NaN
    let lastAtmoStrength = Number.NaN
    let lastAuroraOpacity = Number.NaN
    // Resting scissor: with the bleed, ~80% of the canvas is empty flight
    // area that only the burst ever touches. Whenever the pose and every
    // burst channel sit at exact rest (the composition budget keeps all
    // resting content inside FOOTPRINT_HALF_EXTENT), the scissor clips
    // clear + raster to the central footprint — the idle spin stops
    // paying for the bleed it isn't using.
    let scissorActive = false
    // Canvas CSS size, cached by resize(). getPinScreenPositions runs every
    // animation frame, and reading canvas.clientWidth/Height there forces a
    // synchronous whole-document layout each frame (the landing page also
    // writes CSS vars per frame, so every read pays a full reflow — measured
    // at >50% of scroll-time CPU). The ResizeObserver in Globe.tsx keeps
    // these fresh instead.
    let viewWidth = 1
    let viewHeight = 1

    const resize = () => {
      // DPR cap 1.5, down from 2: the bled canvas is CANVAS_BLEED× per
      // side, so the backing store grows with the SQUARE of the bleed —
      // at DPR 2 a 400px globe would carry a 1800² backing (5× the
      // pre-bleed store, before MSAA multiplies it again). 1.5 holds the
      // growth under 3×; the resting globe trades a little retina
      // sharpness, which the scroll push-in (ortho zoom) wins back.
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      viewWidth = width
      viewHeight = height
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)

      // Resting scissor rect: the centered footprint square plus a small
      // apron (rumble jitter is ≤0.012 world units — px-scale). Height is
      // the ortho camera's fixed axis, so px-per-world-unit — and with it
      // the footprint's pixel size — derives from height on BOTH axes.
      // setScissor is inert state until render() flips setScissorTest on.
      const footprint = Math.ceil(height / CANVAS_BLEED) + 8
      renderer.setScissor(
        Math.floor((width - footprint) / 2),
        Math.floor((height - footprint) / 2),
        footprint,
        footprint,
      )

      const halfWidth = FRUSTUM_HALF_HEIGHT * (width / height)
      camera.left = -halfWidth
      camera.right = halfWidth
      camera.top = FRUSTUM_HALF_HEIGHT
      camera.bottom = -FRUSTUM_HALF_HEIGHT
      camera.updateProjectionMatrix()

      // sizeAttenuation: false works in device pixels
      cityDotMaterial.size = CITY_DOT_SIZE * pixelRatio
    }

    // Scroll pose: a stored target the frame loop applies (see the
    // EarthRenderer interface). appliedZoom tracks the projection so a
    // matrix rebuild only happens on frames where the pose actually
    // moved — at pose 0 the projection is never touched.
    let scrollPose = 0
    let appliedZoom = 1
    const setScrollPose = (progress: number) => {
      if (!Number.isFinite(progress)) return
      scrollPose = Math.min(1, Math.max(0, progress))
    }

    // Burst channels: only the reference is stored — the choreography
    // tweens the numbers in place and render() reads them every frame.
    const setBurstChannels = (channels: BurstChannels) => {
      burstChannels = channels
    }

    const render = ({ phi, time, lightMode, accent }: EarthFrame) => {
      const day = Math.min(1, Math.max(0, lightMode))

      // additive yaw/pitch: the pose composes with drag + auto-spin (phi)
      // instead of overwriting them
      planetSpin.rotation.y = phi + scrollPose * SCROLL_YAW_MAX
      tiltGroup.rotation.x = scrollPose * SCROLL_PITCH_MAX

      const burst = burstChannels

      // Rumble rides tiltGroup.position — the rotation writes above own
      // tiltGroup.rotation, so there is no contention. Exactly zero the
      // moment the channel is, with a one-time snap back to the origin.
      const rumbleAmp = burst ? clamp01(burst.rumble) * RUMBLE_MAX : 0
      if (rumbleAmp > 0) {
        const jitterX =
          (0.62 * Math.sin(time * RUMBLE_FREQ_XA) +
            0.38 * Math.sin(time * RUMBLE_FREQ_XB)) *
          rumbleAmp
        const jitterY =
          (0.62 * Math.sin(time * RUMBLE_FREQ_YA) +
            0.38 * Math.sin(time * RUMBLE_FREQ_YB)) *
          rumbleAmp
        // screen-plane jitter: x maps straight through, y along the
        // screen-Y world axis so the shake never reads as a depth wobble
        tiltGroup.position.set(
          jitterX,
          jitterY * SCREEN_Y_WORLD_Y,
          jitterY * SCREEN_Y_WORLD_Z,
        )
        rumbleActive = true
      } else if (rumbleActive) {
        rumbleActive = false
        tiltGroup.position.set(0, 0, 0)
      }

      const zoom = 1 + (SCROLL_ZOOM_MAX - 1) * scrollPose
      if (zoom !== appliedZoom) {
        appliedZoom = zoom
        camera.zoom = zoom
        camera.updateProjectionMatrix()
      }

      // clouds ignore phi entirely: dragging spins the ground, not the sky
      cloudSpin.rotation.y = time * CLOUD_ROTATE_SPEED
      let cloudWorldReady = false
      for (const cloud of cloudRigs) {
        // constant offset when time is frozen at 0 (reduced motion) —
        // and the bob keeps breathing under the burst displacement below
        const altitude =
          CLOUD_ALTITUDE +
          Math.sin(time * cloud.bobSpeed + cloud.bobPhase) *
            CLOUD_BOB_AMPLITUDE
        cloud.node.position.copy(cloud.direction).multiplyScalar(altitude)

        const channel = burst ? (burst.clouds[cloud.channelIndex] ?? 0) : 0
        if (channel !== 0) {
          if (!cloudWorldReady) {
            // one world-rotation fetch per bursting frame: cloudSpin keeps
            // turning with time, so the escape heading must re-derive from
            // the CURRENT frame (see the CLOUD_ESCAPE_DIST block)
            cloudWorldReady = true
            cloudSpin.getWorldQuaternion(burstWorldQuat)
            burstInverseQuat.copy(burstWorldQuat).invert()
          }
          // resting point → screen plane; the seeded build-time bias keeps
          // the heading stable when the point drifts over the screen center
          burstVec
            .copy(cloud.direction)
            .multiplyScalar(CLOUD_ALTITUDE)
            .applyQuaternion(burstWorldQuat)
          const screenX = burstVec.x + cloud.escapeBiasX
          const screenY =
            burstVec.y * SCREEN_Y_WORLD_Y +
            burstVec.z * SCREEN_Y_WORLD_Z +
            cloud.escapeBiasY
          const radial = Math.hypot(screenX, screenY) || 1
          const radialX = screenX / radial
          const radialY = screenY / radial
          // world-space fling: unit screen radial + seeded depth, mapped
          // back into the holder's parent space so the screen travel is
          // exactly channel × CLOUD_ESCAPE_DIST
          burstVec
            .set(
              radialX,
              radialY * SCREEN_Y_WORLD_Y + cloud.escapeZ * VIEW_WORLD_Y,
              radialY * SCREEN_Y_WORLD_Z + cloud.escapeZ * VIEW_WORLD_Z,
            )
            .applyQuaternion(burstInverseQuat)
          cloud.node.position.addScaledVector(
            burstVec,
            channel * CLOUD_ESCAPE_DIST,
          )
          cloud.puff.rotation.y = cloud.baseYaw + channel * CLOUD_BURST_TUMBLE
          cloud.puff.scale.setScalar(
            Math.max(
              BURST_MIN_SCALE,
              cloud.baseScale * (1 + channel * CLOUD_BURST_GROW),
            ),
          )
          cloud.puff.scale.y *= CLOUD_PROP_SQUASH
          cloud.burstActive = true
        } else if (cloud.burstActive) {
          cloud.burstActive = false
          cloud.puff.rotation.y = cloud.baseYaw
          cloud.puff.scale.setScalar(cloud.baseScale)
          cloud.puff.scale.y *= CLOUD_PROP_SQUASH
        }
      }
      for (const island of islandRigs) {
        // same contract: frozen time yields a fixed pose (the old corner
        // angles), not a snap to 0 — and drag (phi) never moves an orbit
        const { placement } = island
        // spiral-out: radius grows and self-spin accelerates with the
        // channel (×1 and +0 at rest — exact identities, no branch needed)
        const channel = burst ? (burst.islands[island.channelIndex] ?? 0) : 0
        const orbitRadius =
          placement.orbitRadius * (1 + channel * ISLAND_ESCAPE_RADIUS_GAIN)
        const angle = placement.orbitStart + time * placement.orbitSpeed
        island.node.rotation.y =
          placement.yaw + time * placement.spinSpeed + channel * ISLAND_ESCAPE_SPIN
        island.node.position.set(
          orbitRadius * Math.cos(angle),
          orbitRadius * Math.sin(angle) * islandScreenYToWorld +
            Math.sin(time * placement.bobSpeed + placement.bobPhase) *
              placement.bobAmp,
          0,
        )
      }

      // Tree wavefront: the 2×340 matrix recomposes happen ONLY on frames
      // where the (clamped) wave moved; when it returns to 0 one final
      // pass restores the exact resting matrices, then the block idles.
      if (treeBurst) {
        const wave = burst ? clamp01(burst.treeWave) : 0
        if (wave !== lastTreeWave) {
          lastTreeWave = wave
          const { trunk, canopy, trees } = treeBurst
          if (!treeBuffersDynamic) {
            treeBuffersDynamic = true
            trunk.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
            canopy.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
          }
          for (let index = 0; index < trees.length; index++) {
            const tree = trees[index]
            const progress = smoothstep(0, TREE_BURST_WINDOW, wave - tree.delay)
            if (progress === 0) {
              burstScale.setScalar(tree.scale)
              burstMatrix.compose(tree.position, tree.align, burstScale)
            } else {
              burstVec
                .copy(tree.direction)
                .multiplyScalar(progress * TREE_BURST_LIFT)
                .add(tree.position)
              burstQuat
                .setFromAxisAngle(tree.tumbleAxis, progress * tree.tumbleRate)
                .multiply(tree.align)
              burstScale.setScalar(
                Math.max(BURST_MIN_SCALE, tree.scale * (1 - progress)),
              )
              burstMatrix.compose(burstVec, burstQuat, burstScale)
            }
            trunk.setMatrixAt(index, burstMatrix)
            canopy.setMatrixAt(index, burstMatrix)
          }
          trunk.instanceMatrix.needsUpdate = true
          canopy.instanceMatrix.needsUpdate = true
        }
      }

      // Shards recompose only when their channel moved, and stay invisible
      // (not merely scale-ε) whenever it is ≤ 0.
      for (let index = 0; index < shardRigs.length; index++) {
        const shard = shardRigs[index]
        const channel = burst ? (burst.shards[index] ?? 0) : 0
        if (channel === shard.lastChannel) continue
        shard.lastChannel = channel
        if (channel > 0) {
          shard.node.visible = true
          shard.node.position
            .copy(shard.direction)
            .multiplyScalar(shard.surfaceRadius + channel * SHARD_LIFT)
            .addScaledVector(shard.tangent, channel * SHARD_DRIFT)
          shard.node.quaternion
            .setFromAxisAngle(shard.tumbleAxis, channel * shard.tumbleRate)
            .multiply(shard.restingAlign)
          shard.node.scale.setScalar(
            Math.max(
              BURST_MIN_SCALE,
              smoothstep(0, SHARD_GROW_END, channel) * shard.size,
            ),
          )
        } else {
          shard.node.visible = false
          shard.node.position
            .copy(shard.direction)
            .multiplyScalar(shard.surfaceRadius)
          shard.node.quaternion.copy(shard.restingAlign)
          shard.node.scale.setScalar(BURST_MIN_SCALE)
        }
      }

      // Theme + accent: every write in this block is a pure function of
      // (day, accent), which are constant outside the ~1s theme crossfade
      // — Globe.tsx snaps its lightMode lerp onto the target, so `day`
      // reaches an exact fixed point instead of a float tail, and the
      // idle spin uploads zero theme uniforms.
      const themeMoved = day !== lastDay
      const accentMoved =
        accent[0] !== lastAccentR ||
        accent[1] !== lastAccentG ||
        accent[2] !== lastAccentB
      if (themeMoved) {
        lastDay = day
        keyLight.color.lerpColors(keyNightColor, keyDayColor, day)
        keyLight.intensity = lerp(KEY_NIGHT.intensity, KEY_DAY.intensity, day)
        fillLight.color.lerpColors(fillNightColor, fillDayColor, day)
        fillLight.intensity = lerp(FILL_NIGHT.intensity, FILL_DAY.intensity, day)
        hemiLight.color.lerpColors(hemiNightSky, hemiDaySky, day)
        hemiLight.groundColor.lerpColors(hemiNightGround, hemiDayGround, day)
        hemiLight.intensity = lerp(HEMI_NIGHT.intensity, HEMI_DAY.intensity, day)

        for (const themed of themedMaterials) {
          themed.material.color.lerpColors(themed.night, themed.day, day)
        }
        // clouds get an extra emissive lift after dark so they stay white
        cloudMaterial.emissive.lerpColors(
          cloudEmissiveNight,
          cloudEmissiveDay,
          day,
        )

        cityDotMaterial.opacity = CITY_DOT_OPACITY * (1 - day)
        cityDots.visible = day < 0.985

        if (oceanShader) {
          ;(oceanShader.uniforms.uRimColor.value as THREE.Color).lerpColors(
            oceanRimNight,
            oceanRimDay,
            day,
          )
        }
      }
      if (accentMoved) {
        lastAccentR = accent[0]
        lastAccentG = accent[1]
        lastAccentB = accent[2]
        accentColor.setRGB(accent[0], accent[1], accent[2], THREE.SRGBColorSpace)
        pinMaterial.color.copy(accentColor)
      }
      if (themeMoved || accentMoved) {
        atmoNight
          .copy(accentColor)
          .lerp(atmoNightBase, 1 - ATMO_NIGHT_ACCENT_MIX)
        atmoUniforms.uColor.value.lerpColors(atmoNight, atmoDay, day)
      }

      // burst: the curtain fade composes with the day/night factor (×1 at
      // rest — exact), while lift + scale write only when the channel moved
      const auroraBurst = burst ? burst.aurora : 0
      const auroraFade = 1 - clamp01(auroraBurst * AURORA_BURST_FADE)
      const auroraOpacity = AURORA_STRENGTH * (1 - day) * auroraFade
      if (auroraOpacity !== lastAuroraOpacity) {
        lastAuroraOpacity = auroraOpacity
        auroraUniforms.uOpacity.value = auroraOpacity
        aurora.visible = day < 0.985 && auroraFade > 0
      }
      // the sway/shimmer needs live time, but only while the curtain draws
      if (aurora.visible) auroraUniforms.uTime.value = time
      if (auroraBurst !== lastAuroraBurst) {
        lastAuroraBurst = auroraBurst
        aurora.position.y = auroraBurst * AURORA_BURST_LIFT
        aurora.scale.setScalar(
          Math.max(BURST_MIN_SCALE, 1 + auroraBurst * AURORA_BURST_GROW),
        )
      }

      // burst: the shell blows off — strength to 0 (×1 at rest — exact)
      // while the mesh scales up, written only when the value moved
      const atmoBurst = burst ? burst.atmosphere : 0
      const atmoStrength =
        lerp(ATMO_NIGHT_STRENGTH, ATMO_DAY_STRENGTH, day) *
        (1 - clamp01(atmoBurst))
      if (atmoStrength !== lastAtmoStrength) {
        lastAtmoStrength = atmoStrength
        atmoUniforms.uStrength.value = atmoStrength
      }
      if (atmoBurst !== lastAtmoBurst) {
        lastAtmoBurst = atmoBurst
        atmosphere.scale.setScalar(
          Math.max(BURST_MIN_SCALE, 1 + atmoBurst * ATMO_BURST_GROW),
        )
      }

      // Resting scissor: exact rest only — any pose or burst motion
      // renders unclipped across the full bleed.
      const atRest = scrollPose === 0 && burstAtRest(burst)
      if (atRest !== scissorActive) {
        scissorActive = atRest
        renderer.setScissorTest(atRest)
      }

      renderer.render(scene, camera)
    }

    /** Exact-rest test for the scissor: every channel at its build-time
     *  zero. 25 number compares — cheaper than one cleared bleed frame. */
    function burstAtRest(channels: BurstChannels | null): boolean {
      if (!channels) return true
      if (
        channels.rumble !== 0 ||
        channels.treeWave !== 0 ||
        channels.atmosphere !== 0 ||
        channels.aurora !== 0
      ) {
        return false
      }
      for (let i = 0; i < channels.clouds.length; i++) {
        if (channels.clouds[i] !== 0) return false
      }
      for (let i = 0; i < channels.islands.length; i++) {
        if (channels.islands[i] !== 0) return false
      }
      for (let i = 0; i < channels.shards.length; i++) {
        if (channels.shards[i] !== 0) return false
      }
      return true
    }

    const getPinScreenPositions = (): PinScreenPosition[] => {
      planetSpin.updateWorldMatrix(true, false)
      const width = viewWidth
      const height = viewHeight

      for (let index = 0; index < pinAnchors.length; index++) {
        const entry = pinPositions[index]
        projected.copy(pinAnchors[index]).applyMatrix4(planetSpin.matrixWorld)
        worldDirection.copy(projected).normalize()
        entry.front = worldDirection.dot(cameraForward) < PIN_FRONT_DOT
        projected.project(camera)
        entry.x = (projected.x * 0.5 + 0.5) * width
        entry.y = (0.5 - projected.y * 0.5) * height
      }
      return pinPositions
    }

    const destroy = () => {
      for (const resource of disposables) resource.dispose()
      renderer.dispose()
      // Only kill the raw GL context once the canvas has left the DOM: in
      // React strict-mode dev the replacement renderer reuses the same
      // canvas (and therefore the same context) immediately.
      if (!canvas.isConnected) renderer.forceContextLoss()
    }

    resize()
    return {
      render,
      resize,
      destroy,
      getPinScreenPositions,
      setScrollPose,
      setBurstChannels,
    }
  } catch (error) {
    for (const resource of disposables) resource.dispose()
    renderer.dispose()
    if (!canvas.isConnected) renderer.forceContextLoss()
    throw error
  }
}
