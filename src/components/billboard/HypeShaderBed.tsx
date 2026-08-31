'use client'

// The WebGL bed behind the hype announcement: an ambient caustic in the
// tier's accent (gold by default) radiating from the celebrated
// player's avatar seat, plus a one-shot shockwave that sweeps the full
// banner width when the rank lands. Two flavors share the one quad:
// the caustic shimmer (default) and an ember smolder for burn events.
// This is scenery behind legible text, so the energy budget is tiny —
// the caustic peaks around 0.18 alpha and mostly sits under 0.08 — and
// the renderer is sized to match: one fullscreen quad, no antialiasing,
// low-power preference, DPR capped at 2. No scene graph beyond the
// single mesh; the quad is authored directly in clip space.
//
// Contract with the consumer (HypeAnnouncement, mounted via
// next/dynamic ssr:false):
// - The parent owns the viewport (>= sm) and prefers-reduced-motion
//   gates. WebGL2 support is OUR gate: probed once per session (module
//   cache, LiquidMark's useWebGl2Support pattern); unsupported
//   browsers render null and the banner simply has no bed.
// - `origin` is the avatar's x within the bed as 0..1 — a live uniform
//   that follows layout changes without re-initialising the renderer.
// - `accentVar` names the CSS variable (a bare rgb triplet, e.g. the
//   staging theme's --lb-silver) resolved into the uGold uniform — the
//   bed's caustic/shockwave hue. Defaults to --lb-gold, the historical
//   fixed accent the uniform is named after.
// - `flavor` picks the bed's temperament, live like origin (synced
//   into the uFlavor uniform via ref — switching never rebuilds the
//   renderer or material). 'caustic', the default, is the historical
//   shimmer and renders it untouched: every ember term in the shader
//   is gated off at uFlavor 0. 'ember' smolders instead — sparse
//   spark motes drifting up through the banner, densest at the
//   origin's heat seat, plus a hotter, twitchier flicker on the
//   caustic near the origin — all inside the same energy budget
//   (ambient mostly under 0.08, brief peaks ~0.18), and the burst
//   shockwave fires exactly as in caustic mode.
// - `burst` is a counter, not a flag: every increment fires one
//   shockwave (uBurst animates 0 → 1 over ~700ms, then rests at 0).
//   Mounting with burst > 0 fires once too, so a "rank lands" beat
//   scheduled right at mount still gets its pulse.
// - `paused` freezes the loop wholesale — no time advance, no renders,
//   including an in-flight burst, which resumes where it left off.
//   Globe-style previousTime bookkeeping (the clock accumulates only
//   while running) makes resume jump-free.
//
// Prop changes never rebuild the renderer: props sync into refs the
// rAF loop reads each frame. Lifecycle discipline follows Globe /
// ditherEarthRenderer: ResizeObserver on the host driving
// setSize + uResolution, rAF cancelled while document.hidden, full
// dispose on unmount, and the GL context force-lost only once the
// canvas has left the DOM (a StrictMode remount reuses it).

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export type HypeShaderBedProps = {
  /** Horizontal position of the heat source (the avatar) in the bed, 0..1. */
  origin: number
  /** Shockwave counter — each increment fires one pulse. */
  burst: number
  /** Freeze the loop (hover pause); all state survives across it. */
  paused: boolean
  /** CSS variable holding the bed's accent as a bare rgb triplet
   *  (the staging theme's accentVar). Resolved into uGold. */
  accentVar?: string
  /** Bed temperament: 'caustic' (default) shimmers as ever; 'ember'
   *  smolders — rising spark motes and a hotter flicker near the
   *  origin, inside the same energy budget. */
  flavor?: 'caustic' | 'ember'
  className?: string
}

/** One shockwave sweep, avatar to far edge. */
const BURST_MS = 700
/** Ambient caustic master gain — the one internal brightness knob. */
const AMBIENT_HEAT = 1
/** Dark-theme --lb-gold (255 214 68) for when the CSS variable fails to parse. */
const FALLBACK_GOLD = new THREE.Vector3(255 / 255, 214 / 255, 68 / 255)
/** Dropped frames slow time rather than jump it (same cap as Globe). */
const MAX_FRAME_MS = 34

// The quad already spans clip space (PlaneGeometry(2, 2)), so the
// camera matrices are bypassed — the mesh stays glued to the viewport
// at zero transform cost.
const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Three passes: (1) a domain-warped value-noise caustic, hottest near
// x = uOrigin and seated away from the banner's top/bottom edges;
// (2) the uBurst shockwave — a thin crest with a soft trailing wake
// expanding from the origin, gold-white at the wavefront; (3) a 4x4
// Bayer ordered dither quantising the intensity so the gradients sit
// in the same visual family as the app's dither-kit surfaces. uFlavor
// (0 caustic / 1 ember) is branch-gated: at 0 every ember term stays
// at its neutral value and the output is the historical caustic; at 1
// the caustic clock runs hotter near the origin, a flicker breathes
// the heat, and sparse spark motes drift up through the banner. Output
// is premultiplied (rgb pre-scaled by alpha) over transparent black.
const FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform float uOrigin;
uniform float uBurst;
uniform float uFlavor;
uniform vec3 uGold;
uniform vec2 uResolution;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(11.3, 7.9);
    amplitude *= 0.5;
  }
  return value;
}

// One layer of rising ember motes ('ember' flavor only). The sample
// domain scrolls downward so its cells drift up the banner; each cell
// rolls a die for whether it hosts a mote at all (sparse embers, not a
// particle sheet), seats it off-centre, and twinkles it on its own
// phase. The jitter stays inside the cell so motes never clip on cell
// walls, and p is aspect-corrected so they stay round.
float sparkLayer(vec2 p, float scale, float rise, float gate) {
  vec2 q = vec2(p.x, p.y - uTime * rise) * scale;
  vec2 cell = floor(q);
  float seed = hash(cell);
  if (seed < gate) return 0.0;
  vec2 centre = 0.36 * (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5);
  float d = length(fract(q) - 0.5 - centre);
  float core = smoothstep(0.32, 0.04, d);
  float twinkle = 0.55 + 0.45 * sin(uTime * (3.0 + 5.0 * seed) + seed * 43.0);
  return core * twinkle;
}

// Classic 4x4 Bayer thresholds, column-major, normalised to (0, 1).
float bayer(vec2 fragCoord) {
  int x = int(mod(fragCoord.x, 4.0));
  int y = int(mod(fragCoord.y, 4.0));
  mat4 thresholds = mat4(
    0.0, 12.0, 3.0, 15.0,
    8.0, 4.0, 11.0, 7.0,
    2.0, 14.0, 1.0, 13.0,
    10.0, 6.0, 9.0, 5.0
  );
  return (thresholds[x][y] + 0.5) / 16.0;
}

void main() {
  vec2 st = vUv;
  // Aspect-corrected space: y spans one banner height, x in the same
  // physical units — noise cells stay round and the shockwave stays a
  // true circle however wide the bed stretches.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2(st.x * aspect, st.y);

  // Heat proximity to the avatar — shared by the caustic's radiate
  // falloff and the ember terms below.
  float dx = abs(st.x - uOrigin);
  float heatProx = exp(-5.5 * dx * dx);

  // ── 0. Ember flavor terms ───────────────────────────────────────
  // Neutral by construction in caustic mode: the branch is skipped and
  // drift/flicker/motes hold 0.07/1.0/0.0, reproducing the historical
  // output exactly.
  float drift = 0.07;
  float flicker = 1.0;
  float motes = 0.0;
  if (uFlavor > 0.001) {
    // The heat runs faster and breathes near the origin: up to ~1.5x
    // clock speed, ±14% brightness on a fast-in-time / slow-in-x
    // noise — a smolder, never a strobe.
    drift = mix(0.07, 0.105, uFlavor * heatProx);
    flicker = 1.0 + 0.28 * uFlavor * heatProx *
      (noise(vec2(uTime * 1.8, p.x * 1.4)) - 0.5);
    // Two mote layers for depth (near: bigger and faster, far: dimmer
    // and slower), densest at the heat seat, fading toward the top
    // edge like sparks cooling off. The field is capped at 1 so the
    // mote add below never exceeds its 0.12 budget.
    float moteSeat = smoothstep(0.02, 0.16, st.y) *
      (1.0 - smoothstep(0.6, 0.98, st.y));
    float moteField = sparkLayer(p, 6.0, 0.11, 0.94) +
      0.6 * sparkLayer(p, 9.5, 0.065, 0.94);
    motes = min(moteField, 1.0) * mix(0.22, 1.0, heatProx) * moteSeat * uFlavor;
  }

  // ── 1. Ambient caustic ──────────────────────────────────────────
  // Two fbm lookups warp the domain of a third; squared smoothstep
  // pulls sparse bright filaments out of the field instead of an even
  // haze. Drift is very slow — this has to be watchable for a 30s hold.
  float t = uTime * drift;
  vec2 warp = vec2(
    fbm(p * 2.5 + vec2(t, -0.6 * t)),
    fbm(p * 2.5 + vec2(5.2 - 0.8 * t, 1.3 + t))
  );
  float field = fbm(p * 2.5 + 1.9 * warp + vec2(0.5 * t, 0.0));
  float caustic = smoothstep(0.48, 0.92, field);
  caustic *= caustic;

  // Heat radiates from the avatar: the gaussian falloff (heatProx,
  // hoisted above) over a small floor so the far side never reads
  // fully dead, then a vertical seat so the glow sits inside the
  // banner rather than slicing across its edges.
  float radiate = mix(0.18, 1.0, heatProx);
  float seat = smoothstep(0.0, 0.3, st.y) * (1.0 - smoothstep(0.7, 1.0, st.y));

  // Budget: 0.035 base glow + up to 0.13 on filament peaks ≈ 0.17 max;
  // ember's flicker swings that ±14% near the origin, still under the
  // ~0.18 peak (flicker is exactly 1.0 in caustic mode).
  float intensity = (0.035 + 0.13 * caustic) * radiate * seat * uHeat * flicker;

  // ── 2. One-shot shockwave ───────────────────────────────────────
  // A ring expanding from the avatar; span reaches the far edge so the
  // pulse always crosses the full width. Deceleration curve reads as a
  // released shock rather than a linear wipe.
  vec2 source = vec2(uOrigin * aspect, 0.5);
  float span = length(vec2(max(uOrigin, 1.0 - uOrigin) * aspect, 0.5));
  float progress = 1.0 - pow(1.0 - uBurst, 2.0);
  float radius = progress * span;
  float dist = distance(p, source);

  // step() gates the idle state (uBurst rests at exactly 0); the tail
  // fade keeps the pulse from cutting off while still airborne.
  float pulseActive = step(0.0001, uBurst) * (1.0 - smoothstep(0.72, 1.0, uBurst));
  // Nothing ahead of the crest, a soft wake behind it — one clean band.
  float ahead = 1.0 - smoothstep(0.0, 0.03, dist - radius);
  float wake = smoothstep(radius - 0.34, radius, dist);
  float wave = ahead * wake * pulseActive;
  float crest = (1.0 - smoothstep(0.0, 0.07, abs(dist - radius))) * pulseActive;

  intensity += wave * mix(0.5, 1.0, seat) * 0.30;

  // Spark motes ride over the smolder at ≤ 0.12 — sparse enough that
  // stacked on the ambient they stay inside the ~0.18 peak budget.
  intensity += 0.12 * motes;

  // Gold body, whitened right at the wavefront — and at mote cores,
  // which read white-hot rather than saturated accent. motes is 0 in
  // caustic mode, so the max reduces to the historical crest term.
  vec3 color = mix(uGold, vec3(1.0), max(0.55 * crest * wave, 0.4 * motes));

  // ── 3. Ordered dither ───────────────────────────────────────────
  // Threshold-quantise to 64 levels: visible stepping texture in the
  // gradients (the dither-kit look) at ~0.016 per step — texture, not
  // noise.
  intensity = clamp(intensity, 0.0, 1.0);
  intensity = floor(intensity * 64.0 + bayer(gl_FragCoord.xy)) / 64.0;

  gl_FragColor = vec4(color * intensity, intensity);
}
`

export default function HypeShaderBed({
  origin,
  burst,
  paused,
  accentVar = '--lb-gold',
  flavor = 'caustic',
  className = ''
}: HypeShaderBedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const webgl2 = useWebGl2Support()
  // Fades in only after the loop has actually painted a frame, so the
  // bed eases in rather than popping (LiquidMark's useFadeIn, keyed to
  // the first real render instead of mount).
  const [shown, setShown] = useState(false)

  const originRef = useRef(clampOrigin(origin))
  const flavorRef = useRef(flavorValue(flavor))
  const pausedRef = useRef(paused)
  const lastBurstRef = useRef(burst)
  // Mounting with burst > 0 counts as a fire — the consumer increments
  // on a beat that may tick before this canvas exists.
  const burstPendingRef = useRef(burst > 0)
  // Restarts the loop after paused/hidden; owned by the init effect.
  const wakeRef = useRef<(() => void) | null>(null)
  /** The var name the init effect resolves, plus a live handle onto the
   *  mounted uGold so a later accent change retints in place — prop
   *  changes never rebuild the renderer (the refs pattern above). */
  const accentVarRef = useRef(accentVar)
  const accentUniformRef = useRef<{ value: THREE.Vector3 } | null>(null)

  useEffect(() => {
    originRef.current = clampOrigin(origin)
  }, [origin])

  useEffect(() => {
    flavorRef.current = flavorValue(flavor)
  }, [flavor])

  useEffect(() => {
    accentVarRef.current = accentVar
    accentUniformRef.current?.value.copy(readAccent(accentVar))
  }, [accentVar])

  useEffect(() => {
    if (burst > lastBurstRef.current) burstPendingRef.current = true
    lastBurstRef.current = burst
  }, [burst])

  useEffect(() => {
    pausedRef.current = paused
    if (!paused) wakeRef.current?.()
  }, [paused])

  useEffect(() => {
    if (webgl2 !== true) return
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power'
    })
    renderer.setClearColor(0x000000, 0)

    const uniforms = {
      uTime: { value: 0 },
      uHeat: { value: AMBIENT_HEAT },
      uOrigin: { value: originRef.current },
      uBurst: { value: 0 },
      uFlavor: { value: flavorRef.current },
      uGold: { value: readAccent(accentVarRef.current) },
      uResolution: { value: new THREE.Vector2(1, 1) }
    }
    accentUniformRef.current = uniforms.uGold

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      // The shader outputs premultiplied color (rgb pre-scaled by
      // alpha), so blend with ONE / ONE_MINUS_SRC_ALPHA — a normal
      // src-alpha blend would multiply alpha in twice.
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false
    })
    const mesh = new THREE.Mesh(geometry, material)
    // The vertex shader bypasses the camera, so the frustum test would
    // run against a transform the quad never uses.
    mesh.frustumCulled = false
    scene.add(mesh)

    // Size from the parent (the bed's seat in the banner): the canvas
    // itself is absolutely positioned to fill it.
    const host = canvas.parentElement ?? canvas
    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      // Device pixels, to match gl_FragCoord for the dither lattice.
      uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio)
    }

    let disposed = false
    let running = false
    let frame = 0
    let previousTime = 0
    // Accumulates only while running — pause/resume never jumps time,
    // and an in-flight burst (anchored to this clock) freezes with it.
    let clock = 0
    let burstStartClock: number | null = null
    let firstFramePending = true

    const tick = (time: number) => {
      frame = 0
      if (disposed) return
      if (pausedRef.current || document.hidden) {
        running = false
        return
      }

      clock += Math.min(Math.max(time - previousTime, 0), MAX_FRAME_MS)
      previousTime = time

      if (burstPendingRef.current) {
        burstPendingRef.current = false
        burstStartClock = clock
      }
      let burstProgress = 0
      if (burstStartClock !== null) {
        burstProgress = (clock - burstStartClock) / BURST_MS
        if (burstProgress >= 1) {
          // Pulse finished — rest at exactly 0 so the shader's idle
          // gate holds.
          burstStartClock = null
          burstProgress = 0
        }
      }

      uniforms.uTime.value = clock / 1000
      uniforms.uOrigin.value = originRef.current
      uniforms.uFlavor.value = flavorRef.current
      uniforms.uBurst.value = burstProgress
      renderer.render(scene, camera)

      if (firstFramePending) {
        firstFramePending = false
        setShown(true)
      }

      frame = window.requestAnimationFrame(tick)
    }

    const wake = () => {
      if (disposed || running) return
      if (pausedRef.current || document.hidden) return
      running = true
      previousTime = performance.now()
      frame = window.requestAnimationFrame(tick)
    }
    wakeRef.current = wake

    const onVisibilityChange = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(frame)
        frame = 0
        running = false
      } else {
        wake()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()
    wake()

    return () => {
      disposed = true
      wakeRef.current = null
      accentUniformRef.current = null
      window.cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      resizeObserver.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      // Only kill the raw GL context once the canvas has left the DOM:
      // a StrictMode remount reuses the same canvas (and context)
      // immediately.
      if (!canvas.isConnected) renderer.forceContextLoss()
    }
  }, [webgl2])

  if (webgl2 !== true) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      style={{ opacity: shown ? 1 : 0, transition: 'opacity 480ms ease' }}
    />
  )
}

// A NaN origin (a consumer measuring an unmounted node) centers rather
// than pinning the heat to an edge.
function clampOrigin(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

// The flavor prop as the shader's uFlavor float (0 caustic / 1 ember).
function flavorValue(flavor: NonNullable<HypeShaderBedProps['flavor']>): number {
  return flavor === 'ember' ? 1 : 0
}

// The accent variables are space-separated RGB triplets ("255 214 68";
// light theme "202 138 4"), themed per mode. Resolved at renderer init
// and on accentVar changes only — a theme flip mid-show keeps the
// mounted color, which beats rebuilding a renderer for scenery this
// faint. An unparseable variable falls back to the dark-theme gold.
function readAccent(cssVar: string): THREE.Vector3 {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim()
  const channels = raw.split(/\s+/).map(Number)
  if (channels.length === 3 && channels.every((c) => Number.isFinite(c))) {
    return new THREE.Vector3(
      channels[0] / 255,
      channels[1] / 255,
      channels[2] / 255
    )
  }
  return FALLBACK_GOLD.clone()
}

// Probed once per session (module cache, per LiquidMark): `null` until
// the client mounts — which also keeps a ticker re-key remount cheap —
// then a stable boolean for the rest of the session.
let webgl2Supported: boolean | null = null

function useWebGl2Support() {
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    if (webgl2Supported === null) {
      try {
        webgl2Supported = Boolean(
          document.createElement('canvas').getContext('webgl2')
        )
      } catch {
        webgl2Supported = false
      }
    }
    setSupported(webgl2Supported)
  }, [])
  return supported
}
