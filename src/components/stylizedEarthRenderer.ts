import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import ConicPolygonGeometry from 'three-conic-polygon-geometry'
import { PILOTS } from '@/components/landing/pilots'

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
}

/* ────────────────────────────────────────────────────────────────────────
   TUNING CONSTANTS — palette, lighting and layout knobs, grouped here so
   the look can be dialed in without touching scene-construction code.
   `lightMode` lerps every DAY value toward its NIGHT counterpart
   (lightMode 1 = light theme = day side, 0 = dark theme = night side).
   ──────────────────────────────────────────────────────────────────────── */

// Geometry layout (planet radius = 1)
const OCEAN_RADIUS = 1
const OCEAN_DETAIL = 3 // icosphere subdivisions — lower = chunkier facets
const LAND_BOTTOM_RADIUS = 0.96 // buried under the faceted ocean, no gaps
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
const FRUSTUM_HALF_HEIGHT = 1.42 // ortho half-extent; planet disk ≈ 72% of canvas

// Ocean
const OCEAN_DAY = '#2f9de8' // clear sky-blue (turquoise-planet reference)
const OCEAN_NIGHT = '#1b3f80' // readable deep blue, never black
const OCEAN_RIM_DAY = '#7df0dc' // turquoise limb glow
const OCEAN_RIM_NIGHT = '#3f86d1'
const OCEAN_RIM_STRENGTH = 0.52
const OCEAN_RIM_POWER = 3.0

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
// Frustum worst case (square canvas, FRUSTUM_HALF_HEIGHT 1.42): at the
// top/side orbit extremes the island center reaches R on one axis, so
//   R + extent·scale + bobAmp·cos(elev) ≤ 1.42 − margin.
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
    scale: 0.15, // trimmed from 0.16 so the ring clears the frustum top
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
         ├─ tiltGroup (23.5° axial tilt, fixed)
         │  ├─ planetSpin (rotation.y = frame.phi) — ocean, continents,
         │  │                             trees, city dots, user pins
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
    const oceanMaterial = themedMaterial(OCEAN_DAY, new THREE.Color(OCEAN_NIGHT))
    // Cheap faceted fresnel rim. With an orthographic camera the view
    // direction is (0,0,1) in view space, so the rim term needs only the
    // fragment normal — guaranteed to compile against the Lambert shader.
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
    const ocean = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(OCEAN_RADIUS, OCEAN_DETAIL)),
      oceanMaterial,
    )
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

      const treeMatrix = new THREE.Matrix4()
      const treeAlign = new THREE.Quaternion()
      const treeYaw = new THREE.Quaternion()
      const treeScale = new THREE.Vector3()
      const canopyTint = new THREE.Color()
      treeSpots.forEach((spot, index) => {
        const direction = latLngToVector3(spot.lat, spot.lng, 1)
        const surface = hillRadius(spot.lng, spot.lat) - TREE_SINK
        treeAlign.setFromUnitVectors(UP, direction)
        treeYaw.setFromAxisAngle(UP, spot.yaw)
        treeAlign.multiply(treeYaw)
        treeScale.setScalar(spot.scale)
        treeMatrix.compose(
          direction.multiplyScalar(surface),
          treeAlign,
          treeScale,
        )
        trunkMesh.setMatrixAt(index, treeMatrix)
        canopyMesh.setMatrixAt(index, treeMatrix)
        canopyMesh.setColorAt(
          index,
          canopyTint.set(TREE_CANOPY_COLORS[spot.colorIndex]),
        )
      })
      trunkMesh.instanceMatrix.needsUpdate = true
      canopyMesh.instanceMatrix.needsUpdate = true
      if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true
      planetSpin.add(trunkMesh, canopyMesh)
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
    const cloudRigs: Array<{
      node: THREE.Object3D
      direction: THREE.Vector3
      bobSpeed: number
      bobPhase: number
    }> = []
    for (const placement of CLOUD_PLACEMENTS) {
      // draw PRNG values unconditionally so placements keep their look
      // even if one cloud kind is missing from the file
      const puffYaw = cloudRandom() * Math.PI * 2
      const bobSpeed = 0.35 + cloudRandom() * 0.4
      const bobPhase = cloudRandom() * Math.PI * 2
      const source = cloudsGltf?.scene.getObjectByName(placement.kind)
      if (!source) continue

      const puff = source.clone()
      puff.position.set(0, 0, 0) // node translations carry authored spread
      puff.rotation.y = puffYaw
      puff.scale.setScalar(placement.scale)
      puff.scale.y *= CLOUD_PROP_SQUASH

      const direction = latLngToVector3(placement.lat, placement.lng, 1)
      const holder = new THREE.Group()
      holder.quaternion.setFromUnitVectors(UP, direction)
      holder.position.copy(direction).multiplyScalar(CLOUD_ALTITUDE)
      holder.add(puff)
      cloudSpin.add(holder)
      cloudRigs.push({ node: holder, direction, bobSpeed, bobPhase })
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
      placement: (typeof ISLAND_PLACEMENTS)[number]
    }> = []
    for (const placement of ISLAND_PLACEMENTS) {
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
      islandRigs.push({ node: holder, placement })
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

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)

      const halfWidth = FRUSTUM_HALF_HEIGHT * (width / height)
      camera.left = -halfWidth
      camera.right = halfWidth
      camera.top = FRUSTUM_HALF_HEIGHT
      camera.bottom = -FRUSTUM_HALF_HEIGHT
      camera.updateProjectionMatrix()

      // sizeAttenuation: false works in device pixels
      cityDotMaterial.size = CITY_DOT_SIZE * pixelRatio
    }

    const render = ({ phi, time, lightMode, accent }: EarthFrame) => {
      const day = Math.min(1, Math.max(0, lightMode))

      planetSpin.rotation.y = phi
      // clouds ignore phi entirely: dragging spins the ground, not the sky
      cloudSpin.rotation.y = time * CLOUD_ROTATE_SPEED
      for (const cloud of cloudRigs) {
        // constant offset when time is frozen at 0 (reduced motion)
        const altitude =
          CLOUD_ALTITUDE +
          Math.sin(time * cloud.bobSpeed + cloud.bobPhase) *
            CLOUD_BOB_AMPLITUDE
        cloud.node.position.copy(cloud.direction).multiplyScalar(altitude)
      }
      for (const island of islandRigs) {
        // same contract: frozen time yields a fixed pose (the old corner
        // angles), not a snap to 0 — and drag (phi) never moves an orbit
        const { placement } = island
        const angle = placement.orbitStart + time * placement.orbitSpeed
        island.node.rotation.y = placement.yaw + time * placement.spinSpeed
        island.node.position.set(
          placement.orbitRadius * Math.cos(angle),
          placement.orbitRadius * Math.sin(angle) * islandScreenYToWorld +
            Math.sin(time * placement.bobSpeed + placement.bobPhase) *
              placement.bobAmp,
          0,
        )
      }

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
      cloudMaterial.emissive.lerpColors(cloudEmissiveNight, cloudEmissiveDay, day)

      accentColor.setRGB(accent[0], accent[1], accent[2], THREE.SRGBColorSpace)
      pinMaterial.color.copy(accentColor)

      cityDotMaterial.opacity = CITY_DOT_OPACITY * (1 - day)
      cityDots.visible = day < 0.985

      auroraUniforms.uTime.value = time
      auroraUniforms.uOpacity.value = AURORA_STRENGTH * (1 - day)
      aurora.visible = day < 0.985

      atmoNight
        .copy(accentColor)
        .lerp(atmoNightBase, 1 - ATMO_NIGHT_ACCENT_MIX)
      atmoUniforms.uColor.value.lerpColors(atmoNight, atmoDay, day)
      atmoUniforms.uStrength.value = lerp(
        ATMO_NIGHT_STRENGTH,
        ATMO_DAY_STRENGTH,
        day,
      )

      if (oceanShader) {
        ;(oceanShader.uniforms.uRimColor.value as THREE.Color).lerpColors(
          oceanRimNight,
          oceanRimDay,
          day,
        )
      }

      renderer.render(scene, camera)
    }

    const getPinScreenPositions = (): PinScreenPosition[] => {
      planetSpin.updateWorldMatrix(true, false)
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      return pinAnchors.map((anchor, index) => {
        projected.copy(anchor).applyMatrix4(planetSpin.matrixWorld)
        worldDirection.copy(projected).normalize()
        const front = worldDirection.dot(cameraForward) < PIN_FRONT_DOT
        projected.project(camera)
        return {
          index,
          x: (projected.x * 0.5 + 0.5) * width,
          y: (0.5 - projected.y * 0.5) * height,
          front,
        }
      })
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
    return { render, resize, destroy, getPinScreenPositions }
  } catch (error) {
    for (const resource of disposables) resource.dispose()
    renderer.dispose()
    if (!canvas.isConnected) renderer.forceContextLoss()
    throw error
  }
}
