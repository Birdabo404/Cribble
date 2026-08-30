// Dithered Earth renderer — "Phosphor & Ink".
//
// The globe is a raster of a planet, not a 3D object with a filter on
// top: one fullscreen triangle runs an analytic ray-sphere intersection
// per fragment (a mathematically exact silhouette — no polygon edges),
// shades it into a continuous luminance field (terminator, land/ocean
// split, fresnel rim, night-side city emission), and quantizes that
// field through a fixed 8×8 Bayer lattice locked to device pixels. The
// Earth image rotates BENEATH the screen — the faint shimmer as
// continents cross the dot lattice is the signature, not an artifact.
//
// No gradients anywhere in the output: every tone is dot density, the
// atmosphere is a halftone corona (dots thinning outward), and the
// scroll exit is dither dropout (a threshold bias driving density to
// zero), never an opacity fade. Every emitted pixel is fully opaque or
// fully transparent.
//
// Dark mode = phosphor: single-hue green with hierarchy by intensity —
// dim tone dots for the planet body, full-intensity lime (frame.accent)
// for city lights and pilot pins, like bright pixels on a monochrome CRT.
// Light mode = ink remap, NOT inversion: land carries dense ink, the
// shadow hemisphere goes near-solid, a solid ink limb ring anchors the
// silhouette, the whole disk keeps a density floor so lit ocean has
// tooth, and city lights become paper-knockout dots punched out of the
// ink field. `lightMode` arrives as a continuous 0..1 value and blends
// the two mappings smoothly.
//
// The land/city mask is baked at init from the GeoJSON already shipped
// for the previous renderer — rasterized to an equirect offscreen 2D
// canvas (R = land coverage with a slight blur for coastline density
// ramps, G = deterministic seeded city scatter) and uploaded once as a
// CanvasTexture. Zero binary assets.

import * as THREE from 'three'
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
  /**
   * Sets the scroll-pose TARGET (0 = resting orbit, 1 = full hero
   * push-in; clamped, non-finite ignored). Only stores the value — the
   * next render() call applies it, so a scrubbed timeline can write this
   * every scroll tick at no extra cost and the pose stays perfectly
   * synced to scroll. Never schedules a frame of its own.
   */
  setScrollPose: (progress: number) => void
}

/* ────────────────────────────────────────────────────────────────────────
   TUNING CONSTANTS — camera, pose, mask bake and the tonal mapping, all
   grouped here so the look can be dialed in without touching the shader
   assembly below. Coverages are dot densities in 0..1 fed to the Bayer
   threshold; 1.0 renders solid, 0.0 renders nothing.
   ──────────────────────────────────────────────────────────────────────── */

// The composition is authored against this half-extent (planet disk ≈
// 70% of the square globe footprint — same framing as the old renderer).
const FOOTPRINT_HALF_EXTENT = 1.42
// The canvas element is CANVAS_BLEED× the globe footprint on every side
// (Globe.tsx positions it with negative insets) and the frustum scales
// by the same factor, so pixels-per-world-unit — and the whole resting
// look — match a footprint-sized canvas exactly. The bleed buys room
// for the scroll push-in zoom and the halftone corona.
export const CANVAS_BLEED = 1.6
const FRUSTUM_HALF_HEIGHT = FOOTPRINT_HALF_EXTENT * CANVAS_BLEED // 2.272

const CAMERA_ELEVATION = 0.35 // radians of overhead tilt (isometric feel)
const AXIAL_TILT = (23.5 * Math.PI) / 180 // leans the pole to the right
const MAX_PIXEL_RATIO = 2

// Scroll pose — the hero pinned-entry push-in, driven externally through
// setScrollPose(p). "Zoom" tightens the ray-cast frustum (the ortho
// equivalent of dollying closer), pitch/yaw are ADDITIVE offsets so
// drag-to-spin and idle auto-spin keep working under the pose. Past
// DISSOLVE_START the pose ramps a dither-threshold bias that erodes the
// whole raster to nothing — the globe dissolves before heroPin's horizon
// flare at 0.78. p = 0 is byte-identical to a renderer without a pose.
const SCROLL_ZOOM_MAX = 1.7
const SCROLL_PITCH_MAX = 0.52 // rad about screen X at p = 1
const SCROLL_YAW_MAX = 0.75 // rad added to frame.phi at p = 1
const DISSOLVE_START = 0.6
const DISSOLVE_END = 0.85
const DISSOLVE_BIAS = 1.1 // coverage subtracted at full dissolve (>1 clears solids)

// Mask bake
const GEOJSON_URL = '/geo/countries-110m.geojson'
const MASK_WIDTH = 2048
const MASK_HEIGHT = 1024
const COAST_BLUR_PX = 2 // coastline density ramp width on the bake canvas
const CITY_COUNT = 600
const CITY_SEED = 96173
const CITY_MAX_LAT = 72 // no city sparks on the ice caps
const CITY_RADIUS_MIN = 1.1 // bake-canvas px
const CITY_RADIUS_MAX = 2.4

// Sun — camera-fixed (upper-left, tilted toward the viewer so roughly
// three quarters of the disk reads lit) with a slow yaw drift that is
// exactly zero at time 0, preserving the reduced-motion freeze contract.
const SUN_BASE: RGB = [-0.55, 0.5, 0.3]
const SUN_DRIFT_SPEED = 0.05 // rad/s of the oscillation phase
const SUN_DRIFT_MAX = 0.22 // rad of sun yaw at the oscillation peak
const TERMINATOR_LO = -0.12 // N·L where night fully wins
const TERMINATOR_HI = 0.28 // N·L where daylight fully wins

// Pins — the 28 pilot positions as sphere-space unit vectors, drawn
// in-shader as solid spot plates with a knockout moat so they separate
// from the surrounding dot field.
const PIN_ANCHOR_RADIUS = 1.04 // chip anchor sits just above the plate
const PIN_CORE_RADIUS = 0.042 // angular radius of the solid plate
const PIN_GAP_RADIUS = 0.075 // outer angular radius of the knockout moat
// world-direction · camera-direction below this counts as front-facing;
// -0.45 ≈ within ~63° of the view center, so label chips never hug the limb
const PIN_FRONT_DOT = -0.45
// Past this scroll pose the dissolve has eroded roughly half the raster —
// report every pin as back-facing so the pilot chip doesn't outlive the
// planet it is anchored to.
const PIN_HIDE_POSE = 0.72

// Tonal mapping — dark mode (phosphor). Tone dots render at
// PHOSPHOR_DIM × accent; city lights and pins render at full accent.
const PHOSPHOR_DIM = 0.7
const DARK_OCEAN_NIGHT = 0.02
const DARK_OCEAN_DAY = 0.16
const DARK_LAND_NIGHT = 0.055
const DARK_LAND_DAY = 0.45
const DARK_RIM_NIGHT = 0.1
const DARK_RIM_DAY = 0.26
const CITY_DAY_FADE = 0.85 // how much daylight suppresses city emission
const CITY_GAIN = 1.5 // night-side city coverage boost (pushes past 1 = solid)

// Tonal mapping — light mode (ink remap). Ink is #09090b, never mid-gray.
const INK_COLOR: RGB = [0.035, 0.035, 0.043]
const LIGHT_OCEAN_LIT = 0.12
const LIGHT_LAND_LIT = 0.74
const LIGHT_OCEAN_SHADOW = 0.88 // shadow hemisphere near-solid
const LIGHT_LAND_SHADOW = 0.96
const LIGHT_FLOOR = 0.1 // density floor — even lit ocean keeps tooth
const CITY_KNOCKOUT_GAIN = 2.6 // paper-knockout dot strength inside the ink
const LIMB_RING_CSS_PX = 1.5 // solid ink ring anchoring the silhouette

// Halftone corona — the atmosphere. Dots thin outward over this extent
// (world units past the limb); strength is the coverage at the limb.
const HALO_EXTENT = 0.18
const HALO_DARK = 0.3
const HALO_LIGHT = 0.12

/* ──────────────────────────────────────────────────────────────────────── */

// Screen basis under the fixed camera: screen X is world X, screen Y is
// (0, cos e, −sin e), and the view axis is (0, −sin e, −cos e).
const UP_Y = Math.cos(CAMERA_ELEVATION)
const UP_Z = -Math.sin(CAMERA_ELEVATION)
const VIEW_Y = -Math.sin(CAMERA_ELEVATION)
const VIEW_Z = -Math.cos(CAMERA_ELEVATION)
const COS_TILT = Math.cos(AXIAL_TILT)
const SIN_TILT = Math.sin(AXIAL_TILT)

const PIN_COUNT = PILOTS.length

// Classic 8×8 Bayer matrix; thresholds are (v + 0.5)/64 so coverage 0
// renders nothing and coverage 1 renders solid.
// prettier-ignore
const BAYER_8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]

type Ring = number[][]

interface CountryFeature {
  geometry: {
    type: string
    coordinates: Ring[] | Ring[][]
  }
}

/**
 * Same lat/lng → XYZ mapping the old renderer used (lng 0° at +Z, north
 * at +Y), so the pins land on the same spots of the same spinning frame.
 */
function latLngToUnit(lat: number, lng: number): RGB {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((90 - lng) * Math.PI) / 180
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ]
}

/** Deterministic PRNG — the city scatter must rebuild identically. */
function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function loadCountries(): Promise<CountryFeature[]> {
  const response = await fetch(GEOJSON_URL)
  if (!response.ok) {
    throw new Error(`Unable to load country geometry: ${response.status}`)
  }
  const collection = (await response.json()) as { features: CountryFeature[] }
  return collection.features
}

/**
 * Bakes the equirect land/city mask: R = land coverage (blurred a touch
 * so coastlines get density ramps), G = seeded city scatter inside land.
 */
async function bakeMask(): Promise<HTMLCanvasElement> {
  const features = await loadCountries()

  const toX = (lng: number) => ((lng + 180) / 360) * MASK_WIDTH
  const toY = (lat: number) => ((90 - lat) / 180) * MASK_HEIGHT

  // Sharp land pass, one Path2D per feature: evenodd handles lake/enclave
  // holes within a feature, while per-feature fills keep hairline overlaps
  // between neighboring countries from cancelling to unfilled slivers.
  const sharp = document.createElement('canvas')
  sharp.width = MASK_WIDTH
  sharp.height = MASK_HEIGHT
  const sharpCtx = sharp.getContext('2d', { willReadFrequently: true })
  if (!sharpCtx) throw new Error('2D context unavailable for the mask bake')
  sharpCtx.fillStyle = '#000'
  sharpCtx.fillRect(0, 0, MASK_WIDTH, MASK_HEIGHT)
  sharpCtx.fillStyle = '#f00'

  for (const feature of features) {
    const polygons = (
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates as Ring[]]
        : (feature.geometry.coordinates as Ring[][])
    )
    const path = new Path2D()
    for (const rings of polygons) {
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const x = toX(ring[i][0])
          const y = toY(ring[i][1])
          if (i === 0) path.moveTo(x, y)
          else path.lineTo(x, y)
        }
        path.closePath()
      }
    }
    // Fill thrice at ±width so the antimeridian seam (Fiji, Russia) stays
    // continuous under the blur pass below.
    for (const offset of [-MASK_WIDTH, 0, MASK_WIDTH]) {
      sharpCtx.save()
      sharpCtx.translate(offset, 0)
      sharpCtx.fill(path, 'evenodd')
      sharpCtx.restore()
    }
  }

  // Deterministic city scatter: seeded cosine-weighted sphere samples,
  // rejected against the sharp land interior.
  const random = mulberry32(CITY_SEED)
  const landData = sharpCtx.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT).data
  const cities: Array<{ x: number; y: number; r: number }> = []
  const maxAttempts = CITY_COUNT * 400
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (cities.length >= CITY_COUNT) break
    const lng = random() * 360 - 180
    const lat = (Math.asin(random() * 2 - 1) * 180) / Math.PI
    if (Math.abs(lat) > CITY_MAX_LAT) continue
    const px = Math.min(MASK_WIDTH - 1, Math.floor(toX(lng)))
    const py = Math.min(MASK_HEIGHT - 1, Math.floor(toY(lat)))
    if (landData[(py * MASK_WIDTH + px) * 4] < 250) continue
    cities.push({
      x: px,
      y: py,
      r: CITY_RADIUS_MIN + random() * (CITY_RADIUS_MAX - CITY_RADIUS_MIN),
    })
  }

  // Composite: blurred land into R, sharp city dots added into G.
  const mask = document.createElement('canvas')
  mask.width = MASK_WIDTH
  mask.height = MASK_HEIGHT
  const maskCtx = mask.getContext('2d')
  if (!maskCtx) throw new Error('2D context unavailable for the mask bake')
  maskCtx.fillStyle = '#000'
  maskCtx.fillRect(0, 0, MASK_WIDTH, MASK_HEIGHT)
  maskCtx.filter = `blur(${COAST_BLUR_PX}px)`
  maskCtx.drawImage(sharp, 0, 0)
  maskCtx.filter = 'none'
  maskCtx.globalCompositeOperation = 'lighter'
  maskCtx.fillStyle = '#0f0'
  for (const city of cities) {
    maskCtx.beginPath()
    maskCtx.arc(city.x, city.y, city.r, 0, Math.PI * 2)
    maskCtx.fill()
  }
  return mask
}

const formatFloat = (value: number) => value.toFixed(6)

const VERTEX_SHADER = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uMask;
uniform sampler2D uBayer;
uniform vec2 uResolution; // drawing-buffer pixels
uniform float uCell;      // Bayer cell size, drawing-buffer pixels
uniform float uHalfW;     // frustum half extents, world units (pre-zoom)
uniform float uHalfH;
uniform float uZoom;
uniform float uPhi;       // spin + pose yaw
uniform float uPitch;     // pose pitch
uniform float uDay;       // 0 = phosphor (dark), 1 = ink (light)
uniform vec3 uAccent;
uniform vec3 uSunDir;     // world space, unit
uniform float uDissolve;  // 0..1 scroll dropout
uniform float uRingWorld; // ink limb ring width, world units
uniform vec3 uPins[PIN_COUNT];

void main() {
  vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  vec2 plane = vec2(ndc.x * uHalfW, ndc.y * uHalfH) / uZoom;
  float rr = length(plane);

  vec2 cell = mod(floor(gl_FragCoord.xy / uCell), 8.0);
  float threshold = texture2D(uBayer, (cell + 0.5) / 8.0).r;

  vec3 camUp = vec3(0.0, CAM_UP_Y, CAM_UP_Z);
  vec3 camFwd = vec3(0.0, CAM_FWD_Y, CAM_FWD_Z);
  vec3 ink = vec3(INK_R, INK_G, INK_B);
  vec3 phosphorDim = uAccent * PHOSPHOR_DIM;

  float cov = 0.0;
  vec3 col = ink;

  if (rr < 1.0) {
    // Analytic ray-sphere hit under the orthographic view: plane lies in
    // the camera plane through the sphere center, so the front hit — and
    // its normal, since the sphere is unit — falls out directly.
    vec3 N = vec3(plane.x, 0.0, 0.0) + plane.y * camUp
      - sqrt(max(1.0 - rr * rr, 0.0)) * camFwd;

    // world → sphere-fixed frame: Ry(-phi) · Rz(+tilt) · Rx(-pitch)
    float cp = cos(uPitch);
    float sp = sin(uPitch);
    vec3 q = vec3(N.x, cp * N.y + sp * N.z, cp * N.z - sp * N.y);
    q = vec3(
      COS_TILT * q.x - SIN_TILT * q.y,
      SIN_TILT * q.x + COS_TILT * q.y,
      q.z
    );
    float cy = cos(uPhi);
    float sy = sin(uPhi);
    q = vec3(cy * q.x - sy * q.z, q.y, sy * q.x + cy * q.z);

    // equirect sample (lng 0° at +Z, north at +Y — matches the bake)
    vec2 uv = vec2(
      fract(0.75 - atan(q.z, q.x) / TWO_PI),
      asin(clamp(q.y, -1.0, 1.0)) / PI_C + 0.5
    );
    vec2 mask = texture2D(uMask, uv).rg;
    float land = mask.r;
    float city = mask.g;

    float daylight = smoothstep(TERM_LO, TERM_HI, dot(N, uSunDir));
    float rim = pow(1.0 - clamp(dot(N, -camFwd), 0.0, 1.0), 3.0);

    // dark mode: phosphor raster, hierarchy by intensity
    float covDark = mix(
      mix(D_OCEAN_NIGHT, D_OCEAN_DAY, daylight),
      mix(D_LAND_NIGHT, D_LAND_DAY, daylight),
      land
    );
    covDark += rim * mix(D_RIM_NIGHT, D_RIM_DAY, daylight);
    float cityGlow = city * (1.0 - daylight * CITY_DAY_FADE);
    covDark += cityGlow * CITY_GAIN;
    vec3 colDark = mix(phosphorDim, uAccent, clamp(cityGlow * 3.0, 0.0, 1.0));

    // light mode: ink remap — dense land, near-solid shadow hemisphere,
    // density floor everywhere, paper-knockout city dots, solid limb ring
    float covLight = mix(
      mix(L_OCEAN_LIT, L_LAND_LIT, land),
      mix(L_OCEAN_SHADOW, L_LAND_SHADOW, land),
      1.0 - daylight
    );
    covLight = max(covLight, L_FLOOR);
    covLight *= 1.0 - clamp(city * CITY_KNOCKOUT, 0.0, 1.0);
    covLight = max(covLight, step(1.0 - rr, uRingWorld));

    // pilot pins: solid spot plates with a knockout moat, in sphere space
    float pinDot = -1.0;
    for (int i = 0; i < PIN_COUNT; i++) {
      pinDot = max(pinDot, dot(q, uPins[i]));
    }
    if (pinDot > PIN_COS_CORE) {
      cov = 1.0;
      col = uAccent;
    } else {
      if (pinDot > PIN_COS_GAP) {
        covDark = 0.0;
        covLight = 0.0;
      }
      cov = mix(covDark, covLight, uDay);
      col = mix(colDark, ink, uDay);
    }
  } else {
    // halftone corona — the atmosphere as dots thinning outward
    float h = (rr - 1.0) / HALO_EXT;
    if (h < 1.0) {
      cov = mix(HALO_D, HALO_L, uDay) * (1.0 - h) * (1.0 - h);
      col = mix(phosphorDim, ink, uDay);
    }
  }

  // scroll exit: dither dropout — bias the whole field toward zero
  cov -= uDissolve * DISSOLVE_B;

  float on = step(threshold, cov);
  gl_FragColor = vec4(col * on, on);
}
`

export async function createDitherEarthRenderer(
  canvas: HTMLCanvasElement,
): Promise<EarthRenderer> {
  // Hard pixels are the aesthetic: no MSAA, and every fragment is written
  // fully opaque or fully transparent (NoBlending below), so the alpha
  // canvas composites without fringe.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  })

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(resource: T): T => {
    disposables.push(resource)
    return resource
  }

  try {
    const maskCanvas = await bakeMask()

    const maskTexture = track(new THREE.CanvasTexture(maskCanvas))
    maskTexture.wrapS = THREE.RepeatWrapping // longitude wraps
    maskTexture.wrapT = THREE.ClampToEdgeWrapping
    maskTexture.minFilter = THREE.LinearFilter
    maskTexture.magFilter = THREE.LinearFilter
    maskTexture.generateMipmaps = false

    const bayerData = new Uint8Array(64)
    for (let i = 0; i < 64; i++) {
      bayerData[i] = Math.round(((BAYER_8[i] + 0.5) / 64) * 255)
    }
    const bayerTexture = track(
      new THREE.DataTexture(bayerData, 8, 8, THREE.RedFormat, THREE.UnsignedByteType),
    )
    bayerTexture.minFilter = THREE.NearestFilter
    bayerTexture.magFilter = THREE.NearestFilter
    bayerTexture.needsUpdate = true

    // Pin directions in the sphere-fixed frame — shared by the shader
    // (spot plates) and the JS projection (chip anchoring) below.
    const pinDirs = PILOTS.map((pilot) => latLngToUnit(pilot.lat, pilot.lng))
    const pinVectors = pinDirs.map(([x, y, z]) => new THREE.Vector3(x, y, z))

    const uniforms = {
      uMask: { value: maskTexture },
      uBayer: { value: bayerTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCell: { value: 1 },
      uHalfW: { value: FRUSTUM_HALF_HEIGHT },
      uHalfH: { value: FRUSTUM_HALF_HEIGHT },
      uZoom: { value: 1 },
      uPhi: { value: 0 },
      uPitch: { value: 0 },
      uDay: { value: 0 },
      uAccent: { value: new THREE.Vector3(0.8, 1, 0) },
      uSunDir: { value: new THREE.Vector3(...SUN_BASE).normalize() },
      uDissolve: { value: 0 },
      uRingWorld: { value: 0 },
      uPins: { value: pinVectors },
    }

    const defines: Record<string, string> = {
      PIN_COUNT: String(PIN_COUNT),
      TWO_PI: formatFloat(Math.PI * 2),
      PI_C: formatFloat(Math.PI),
      CAM_UP_Y: formatFloat(UP_Y),
      CAM_UP_Z: formatFloat(UP_Z),
      CAM_FWD_Y: formatFloat(VIEW_Y),
      CAM_FWD_Z: formatFloat(VIEW_Z),
      COS_TILT: formatFloat(COS_TILT),
      SIN_TILT: formatFloat(SIN_TILT),
      INK_R: formatFloat(INK_COLOR[0]),
      INK_G: formatFloat(INK_COLOR[1]),
      INK_B: formatFloat(INK_COLOR[2]),
      PHOSPHOR_DIM: formatFloat(PHOSPHOR_DIM),
      TERM_LO: formatFloat(TERMINATOR_LO),
      TERM_HI: formatFloat(TERMINATOR_HI),
      D_OCEAN_NIGHT: formatFloat(DARK_OCEAN_NIGHT),
      D_OCEAN_DAY: formatFloat(DARK_OCEAN_DAY),
      D_LAND_NIGHT: formatFloat(DARK_LAND_NIGHT),
      D_LAND_DAY: formatFloat(DARK_LAND_DAY),
      D_RIM_NIGHT: formatFloat(DARK_RIM_NIGHT),
      D_RIM_DAY: formatFloat(DARK_RIM_DAY),
      CITY_DAY_FADE: formatFloat(CITY_DAY_FADE),
      CITY_GAIN: formatFloat(CITY_GAIN),
      L_OCEAN_LIT: formatFloat(LIGHT_OCEAN_LIT),
      L_LAND_LIT: formatFloat(LIGHT_LAND_LIT),
      L_OCEAN_SHADOW: formatFloat(LIGHT_OCEAN_SHADOW),
      L_LAND_SHADOW: formatFloat(LIGHT_LAND_SHADOW),
      L_FLOOR: formatFloat(LIGHT_FLOOR),
      CITY_KNOCKOUT: formatFloat(CITY_KNOCKOUT_GAIN),
      PIN_COS_CORE: formatFloat(Math.cos(PIN_CORE_RADIUS)),
      PIN_COS_GAP: formatFloat(Math.cos(PIN_GAP_RADIUS)),
      HALO_EXT: formatFloat(HALO_EXTENT),
      HALO_D: formatFloat(HALO_DARK),
      HALO_L: formatFloat(HALO_LIGHT),
      DISSOLVE_B: formatFloat(DISSOLVE_BIAS),
    }

    const geometry = track(new THREE.BufferGeometry())
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    )

    const material = track(
      new THREE.ShaderMaterial({
        uniforms,
        defines,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false,
      }),
    )

    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(mesh)
    const camera = new THREE.Camera() // the shader does all projection

    // Pooled getPinScreenPositions results — the draw loop calls it every
    // frame; callers read the pool in place and must not hold entries
    // across frames.
    const pinPositions: PinScreenPosition[] = pinDirs.map((_, index) => ({
      index,
      x: 0,
      y: 0,
      front: false,
    }))

    // Canvas CSS size, cached by resize() — reading clientWidth/Height per
    // frame forces synchronous layout (Globe.tsx's ResizeObserver keeps
    // these fresh instead).
    let viewWidth = 1
    let viewHeight = 1
    let halfW = FRUSTUM_HALF_HEIGHT
    let deviceHeight = 1
    let pixelRatio = 1
    // Pose state the shader and the pin projection share per frame.
    let scrollPose = 0
    let lastPhi = 0
    let lastPitch = 0
    let lastZoom = 1
    // Resting scissor: with the bleed most of the canvas is empty corona
    // room; at exact rest everything fits the central footprint, so clear
    // and raster clip to it and the idle spin stops paying for the bleed.
    let scissorActive = false

    const drawingBufferSize = new THREE.Vector2()

    const resize = () => {
      pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      viewWidth = width
      viewHeight = height
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      renderer.getDrawingBufferSize(drawingBufferSize)
      deviceHeight = drawingBufferSize.y

      uniforms.uResolution.value.copy(drawingBufferSize)
      // Bayer cells lock to device pixels: round(devicePixelRatio) buffer
      // pixels per cell, never below 1.
      uniforms.uCell.value = Math.max(1, Math.round(pixelRatio))
      halfW = FRUSTUM_HALF_HEIGHT * (width / height)
      uniforms.uHalfW.value = halfW
      uniforms.uHalfH.value = FRUSTUM_HALF_HEIGHT

      // Resting scissor rect: the centered footprint square plus a small
      // apron. setScissor is inert until render() flips setScissorTest on;
      // three multiplies the rect by the pixel ratio itself.
      const footprint = Math.ceil(height / CANVAS_BLEED) + 8
      renderer.setScissor(
        Math.floor((width - footprint) / 2),
        Math.floor((height - footprint) / 2),
        footprint,
        footprint,
      )
    }

    const setScrollPose = (progress: number) => {
      if (!Number.isFinite(progress)) return
      scrollPose = Math.min(1, Math.max(0, progress))
    }

    const render = ({ phi, time, lightMode, accent }: EarthFrame) => {
      lastPhi = phi + scrollPose * SCROLL_YAW_MAX
      lastPitch = scrollPose * SCROLL_PITCH_MAX
      lastZoom = 1 + (SCROLL_ZOOM_MAX - 1) * scrollPose

      uniforms.uPhi.value = lastPhi
      uniforms.uPitch.value = lastPitch
      uniforms.uZoom.value = lastZoom
      uniforms.uDay.value = Math.min(1, Math.max(0, lightMode))
      uniforms.uAccent.value.set(accent[0], accent[1], accent[2])

      // Camera-fixed sun with a slow yaw drift — exactly still at time 0
      // (the reduced-motion freeze), like the old renderer's sky drift.
      const drift = Math.sin(time * SUN_DRIFT_SPEED) * SUN_DRIFT_MAX
      const cd = Math.cos(drift)
      const sd = Math.sin(drift)
      uniforms.uSunDir.value
        .set(
          SUN_BASE[0] * cd + SUN_BASE[2] * sd,
          SUN_BASE[1],
          SUN_BASE[2] * cd - SUN_BASE[0] * sd,
        )
        .normalize()

      // Dissolve ramp: dropout begins at DISSOLVE_START, the raster is
      // fully eroded by DISSOLVE_END — before the pin's horizon flare.
      const dissolveT = Math.min(
        1,
        Math.max(0, (scrollPose - DISSOLVE_START) / (DISSOLVE_END - DISSOLVE_START)),
      )
      uniforms.uDissolve.value = dissolveT * dissolveT * (3 - 2 * dissolveT)

      // Ink limb ring width in world units, tracking zoom so it holds a
      // constant on-screen thickness.
      const pxPerUnit = (deviceHeight * lastZoom) / (2 * FRUSTUM_HALF_HEIGHT)
      uniforms.uRingWorld.value = (LIMB_RING_CSS_PX * pixelRatio) / pxPerUnit

      const atRest = scrollPose === 0
      if (atRest !== scissorActive) {
        scissorActive = atRest
        renderer.setScissorTest(atRest)
      }

      renderer.render(scene, camera)
    }

    const getPinScreenPositions = (): PinScreenPosition[] => {
      // Mirrors the shader's forward transform exactly:
      // world = Rx(pitch) · Rz(-tilt) · Ry(phi) · sphereDir
      const cy = Math.cos(lastPhi)
      const sy = Math.sin(lastPhi)
      const cp = Math.cos(lastPitch)
      const sp = Math.sin(lastPitch)
      const pinsLive = scrollPose < PIN_HIDE_POSE

      for (let index = 0; index < pinDirs.length; index++) {
        const entry = pinPositions[index]
        const dir = pinDirs[index]
        // Ry(phi)
        const x1 = dir[0] * cy + dir[2] * sy
        const z1 = -dir[0] * sy + dir[2] * cy
        // Rz(-tilt)
        const x2 = x1 * COS_TILT + dir[1] * SIN_TILT
        const y2 = -x1 * SIN_TILT + dir[1] * COS_TILT
        // Rx(pitch)
        const y3 = y2 * cp - z1 * sp
        const z3 = y2 * sp + z1 * cp

        entry.front = pinsLive && y3 * VIEW_Y + z3 * VIEW_Z < PIN_FRONT_DOT

        const screenX = x2 * PIN_ANCHOR_RADIUS
        const screenY = (y3 * UP_Y + z3 * UP_Z) * PIN_ANCHOR_RADIUS
        const ndcX = (screenX * lastZoom) / halfW
        const ndcY = (screenY * lastZoom) / FRUSTUM_HALF_HEIGHT
        entry.x = (ndcX * 0.5 + 0.5) * viewWidth
        entry.y = (0.5 - ndcY * 0.5) * viewHeight
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
    }
  } catch (error) {
    for (const resource of disposables) resource.dispose()
    renderer.dispose()
    if (!canvas.isConnected) renderer.forceContextLoss()
    throw error
  }
}
