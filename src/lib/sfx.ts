// Synthesized UI sound effects for the app shell: every sound is a tiny
// Web Audio graph (oscillators, filtered noise, envelopes) built in code
// — zero audio assets, and per-play micro-variation (±25 cents detune,
// slight gain jitter) so repeated clicks never sound machine-stamped.
// Pure module (no React); consumed by SfxProvider and the Appearance →
// Sound settings section. Preference keys are device-local (localStorage
// only — never server-synced), same as background music.
//
// Ear safety is enforced centrally: 3–5ms soft attacks (no pops),
// exponential releases, quiet per-sound levels, and a master gain →
// DynamicsCompressor limiter chain in front of the destination.

export type SfxName =
  | 'tap'
  | 'tapSoft'
  | 'toggleOn'
  | 'toggleOff'
  | 'open'
  | 'close'
  | 'channel'
  | 'powerOn'
  | 'pressStart'

/** Runtime mirror of SfxName, for validating data-sfx attribute values. */
export const SFX_NAMES: readonly SfxName[] = [
  'tap',
  'tapSoft',
  'toggleOn',
  'toggleOff',
  'open',
  'close',
  'channel',
  'powerOn',
  'pressStart'
]

export function isSfxName(value: string): value is SfxName {
  return (SFX_NAMES as readonly string[]).includes(value)
}

export const SFX_VOLUME_KEY = 'cribble.sfx.volume' // 0–1 float string
export const SFX_MUTED_KEY = 'cribble.sfx.muted' // '1' | '0'
export const DEFAULT_SFX_VOLUME = 0.5

/** Re-triggers of the same sound inside this window are dropped. */
export const SFX_THROTTLE_MS = 60
/** Hard cap on concurrently sounding effects. */
export const SFX_MAX_VOICES = 6

export function clampSfxVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SFX_VOLUME
  return Math.min(1, Math.max(0, value))
}

/** Raw localStorage value → volume, tolerating missing/garbage entries. */
export function parseStoredSfxVolume(raw: string | null): number {
  // Number('') and Number('   ') coerce to 0, which would read as
  // "silent" rather than "unset" — treat blank the same as missing.
  if (raw === null || raw.trim() === '') return DEFAULT_SFX_VOLUME
  return clampSfxVolume(Number(raw))
}

/** Raw localStorage value → muted flag; anything but '1' means audible. */
export function parseStoredSfxMuted(raw: string | null): boolean {
  return raw === '1'
}

/**
 * Pure gate shared by playSfx: drop the play when the same sound fired
 * within the throttle window or too many voices are already sounding.
 */
export function canPlaySfx(
  lastPlayedAtMs: number | undefined,
  nowMs: number,
  activeVoices: number
): boolean {
  if (activeVoices >= SFX_MAX_VOICES) return false
  return lastPlayedAtMs === undefined || nowMs - lastPlayedAtMs >= SFX_THROTTLE_MS
}

// --- Engine state (module singleton) ----------------------------------

interface SfxGraph {
  ctx: AudioContext
  master: GainNode
}

let graph: SfxGraph | null = null
let engineMuted = false
let engineVolume = DEFAULT_SFX_VOLUME
// Autoplay policy requires a user gesture before audio may start; flips
// true on the first pointerdown (the provider calls unlockSfx there).
let gestureSeen = false
let noiseBuffer: AudioBuffer | null = null
let activeVoiceCount = 0
const lastPlayedAt = new Map<SfxName, number>()

function handleVisibilityChange(): void {
  if (!graph) return
  // Suspend while hidden to save battery; resuming needs no fresh
  // gesture because the context already ran once.
  if (document.hidden) {
    void graph.ctx.suspend().catch(() => {})
  } else {
    void graph.ctx.resume().catch(() => {})
  }
}

function createGraph(): SfxGraph {
  const ctx = new AudioContext()
  const master = ctx.createGain()
  master.gain.value = engineVolume
  // Safety limiter: even a pile-up of overlapping voices stays tame.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -18
  limiter.knee.value = 12
  limiter.ratio.value = 12
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  master.connect(limiter)
  limiter.connect(ctx.destination)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  return { ctx, master }
}

/**
 * Create/resume the AudioContext. Call from inside a user gesture — the
 * provider's pointerdown listener does. No-ops while muted so muted
 * users never pay for an audio graph, but still records the gesture so
 * unmuting later can start the context immediately.
 */
export function unlockSfx(): void {
  if (typeof window === 'undefined') return
  gestureSeen = true
  if (engineMuted) return
  graph ??= createGraph()
  if (graph.ctx.state === 'suspended') {
    void graph.ctx.resume().catch(() => {})
  }
}

export function setSfxMuted(muted: boolean): void {
  engineMuted = muted
  // Unmuting via the settings switch happens inside a click gesture, so
  // the context may start right away; before any gesture this stays a
  // no-op and the next pointerdown unlocks instead.
  if (!muted && gestureSeen) unlockSfx()
}

export function setSfxVolume(volume: number): void {
  engineVolume = clampSfxVolume(volume)
  if (graph) {
    // setTargetAtTime, not .value, so slider drags don't zipper.
    graph.master.gain.setTargetAtTime(engineVolume, graph.ctx.currentTime, 0.02)
  }
}

/**
 * Fire a palette sound. Safe to call anytime: silently no-ops during
 * SSR, while muted, before the first user gesture, or while throttled.
 */
export function playSfx(name: SfxName): void {
  if (typeof window === 'undefined' || engineMuted || !graph) return
  const { ctx, master } = graph
  if (ctx.state !== 'running') {
    // e.g. clicked right after returning to the tab, before the
    // visibility resume settled — nudge it and drop this play. Never
    // schedule on a suspended context: queued sounds would all fire at
    // once on resume.
    void ctx.resume().catch(() => {})
    return
  }
  const now = performance.now()
  if (!canPlaySfx(lastPlayedAt.get(name), now, activeVoiceCount)) return
  lastPlayedAt.set(name, now)
  // Small lookahead so the attack ramp never starts in the past.
  const duration = scheduleSfx(name, ctx, master, ctx.currentTime + 0.005)
  activeVoiceCount += 1
  window.setTimeout(() => {
    activeVoiceCount = Math.max(0, activeVoiceCount - 1)
  }, duration * 1000 + 100)
}

// --- Synthesis helpers -------------------------------------------------

/** ±25 cents so repeated triggers of a sound never land identically. */
function randomDetuneCents(): number {
  return (Math.random() * 2 - 1) * 25
}

/** Slight per-play level variation (±8%). */
function jitter(level: number): number {
  return level * (0.92 + Math.random() * 0.16)
}

function oscVoice(
  ctx: BaseAudioContext,
  type: OscillatorType,
  frequency: number,
  t0: number
): OscillatorNode {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, t0)
  osc.detune.setValueAtTime(randomDetuneCents(), t0)
  return osc
}

/**
 * Shared ear-safety envelope: short linear attack (no pops) into an
 * exponential release, fully silent by t0 + duration.
 */
function envelope(
  ctx: BaseAudioContext,
  t0: number,
  peak: number,
  attack: number,
  duration: number
): GainNode {
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  gain.gain.setValueAtTime(0, t0 + duration)
  return gain
}

const NOISE_BUFFER_SECONDS = 1

/** One second of white noise, generated once and reused by every burst. */
function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1
  }
  noiseBuffer = buffer
  return buffer
}

interface BlipOptions {
  frequency: number
  /** Optional exponential pitch-glide target, reached ~70% through. */
  glideTo?: number
  peak: number
  duration: number
  type?: OscillatorType
  lowpass?: number
  attack?: number
}

/** Single filtered oscillator note — the building block of the palette. */
function playBlip(ctx: BaseAudioContext, out: AudioNode, t0: number, opts: BlipOptions): void {
  const {
    frequency,
    glideTo,
    peak,
    duration,
    type = 'triangle',
    lowpass = 2600,
    attack = 0.004
  } = opts
  const osc = oscVoice(ctx, type, frequency, t0)
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration * 0.7)
  }
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(lowpass, t0)
  const env = envelope(ctx, t0, jitter(peak), attack, duration)
  osc.connect(filter)
  filter.connect(env)
  env.connect(out)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

interface NoiseBurstOptions {
  frequency: number
  /** Optional exponential filter-sweep target, reached ~85% through. */
  frequencyEnd?: number
  q?: number
  peak: number
  duration: number
  attack?: number
}

/** Band-passed slice of the noise buffer, random offset per play. */
function playNoiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t0: number,
  opts: NoiseBurstOptions
): void {
  const { frequency, frequencyEnd, q = 1, peak, duration, attack = 0.004 } = opts
  const source = ctx.createBufferSource()
  source.buffer = getNoiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(frequency, t0)
  if (frequencyEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(frequencyEnd, t0 + duration * 0.85)
  }
  filter.Q.setValueAtTime(q, t0)
  const env = envelope(ctx, t0, jitter(peak), attack, duration)
  source.connect(filter)
  filter.connect(env)
  env.connect(out)
  const maxOffset = Math.max(0, NOISE_BUFFER_SECONDS - duration - 0.05)
  source.start(t0, Math.random() * maxOffset, duration + 0.05)
}

// --- The palette -------------------------------------------------------
// Tuned warm/soft — analog hardware, not phone notification. Peaks stay
// well under 1 and the master limiter catches pile-ups. Each recipe
// returns its duration in seconds for voice bookkeeping.

/** Primary click: short triangle blip, fast downward pitch glide. */
function playTap(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playBlip(ctx, out, t0, {
    frequency: 1400,
    glideTo: 900,
    peak: 0.22,
    duration: 0.05,
    lowpass: 2400,
    attack: 0.003
  })
  return 0.05
}

/** Quieter, duller sibling of tap for nav links and list rows. */
function playTapSoft(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playBlip(ctx, out, t0, {
    frequency: 1100,
    glideTo: 780,
    peak: 0.11,
    duration: 0.045,
    lowpass: 1800,
    attack: 0.003
  })
  return 0.045
}

/** Two-note micro-arpeggio going up (F#5 → C#6): "engaged". */
function playToggleOn(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playBlip(ctx, out, t0, { frequency: 740, peak: 0.13, duration: 0.06 })
  playBlip(ctx, out, t0 + 0.06, { frequency: 1109, peak: 0.16, duration: 0.09 })
  return 0.15
}

/** The same arpeggio going down, second note softer: "released". */
function playToggleOff(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playBlip(ctx, out, t0, { frequency: 1109, peak: 0.13, duration: 0.06 })
  playBlip(ctx, out, t0 + 0.06, { frequency: 740, peak: 0.1, duration: 0.09 })
  return 0.15
}

/** Modal in: filtered-noise swell sweeping up + soft rising blip. */
function playOpen(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playNoiseBurst(ctx, out, t0, {
    frequency: 500,
    frequencyEnd: 2200,
    q: 1.1,
    peak: 0.07,
    duration: 0.2,
    attack: 0.04
  })
  playBlip(ctx, out, t0 + 0.02, { frequency: 520, glideTo: 780, peak: 0.12, duration: 0.12 })
  return 0.22
}

/** Modal out: open mirrored — falling sweep, falling blip. */
function playClose(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playNoiseBurst(ctx, out, t0, {
    frequency: 2200,
    frequencyEnd: 500,
    q: 1.1,
    peak: 0.06,
    duration: 0.17,
    attack: 0.03
  })
  playBlip(ctx, out, t0 + 0.01, { frequency: 780, glideTo: 520, peak: 0.1, duration: 0.11 })
  return 0.18
}

/**
 * CRT channel switch: band-passed static burst + tiny square-wave zap.
 * Deliberately the quietest sound in the palette — it fires on
 * auto-rotation, so it must read as diegetic texture, not a notification.
 */
function playChannel(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playNoiseBurst(ctx, out, t0, { frequency: 1700, q: 0.9, peak: 0.05, duration: 0.09, attack: 0.003 })
  playBlip(ctx, out, t0, {
    frequency: 220,
    glideTo: 70,
    peak: 0.03,
    duration: 0.07,
    type: 'square',
    lowpass: 1200
  })
  return 0.1
}

/** TV power-on: low thump + upward sweep with a brief degauss wobble. */
function playPowerOn(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  const thump = oscVoice(ctx, 'sine', 66, t0)
  thump.frequency.exponentialRampToValueAtTime(50, t0 + 0.25)
  const thumpEnv = envelope(ctx, t0, jitter(0.4), 0.005, 0.35)
  thump.connect(thumpEnv)
  thumpEnv.connect(out)
  thump.start(t0)
  thump.stop(t0 + 0.4)

  const sweepStart = t0 + 0.05
  const sweep = oscVoice(ctx, 'triangle', 120, sweepStart)
  sweep.frequency.exponentialRampToValueAtTime(640, sweepStart + 0.45)
  const sweepFilter = ctx.createBiquadFilter()
  sweepFilter.type = 'lowpass'
  sweepFilter.frequency.setValueAtTime(1400, sweepStart)
  const sweepEnv = envelope(ctx, sweepStart, jitter(0.09), 0.06, 0.55)
  sweep.connect(sweepFilter)
  sweepFilter.connect(sweepEnv)
  sweepEnv.connect(out)

  // Degauss wobble: an LFO shakes the sweep's detune (in cents), fading
  // out over the first ~0.3s.
  const lfo = ctx.createOscillator()
  lfo.frequency.setValueAtTime(30, sweepStart)
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.setValueAtTime(45, sweepStart)
  lfoDepth.gain.linearRampToValueAtTime(0, sweepStart + 0.3)
  lfo.connect(lfoDepth)
  lfoDepth.connect(sweep.detune)

  sweep.start(sweepStart)
  sweep.stop(sweepStart + 0.6)
  lfo.start(sweepStart)
  lfo.stop(sweepStart + 0.35)
  return 0.65
}

/** Two-tone arcade confirm (E5 → B5) for clicking the CRT screen. */
function playPressStart(ctx: BaseAudioContext, out: AudioNode, t0: number): number {
  playBlip(ctx, out, t0, {
    frequency: 659,
    peak: 0.09,
    duration: 0.09,
    type: 'square',
    lowpass: 3200
  })
  playBlip(ctx, out, t0 + 0.09, {
    frequency: 988,
    peak: 0.11,
    duration: 0.14,
    type: 'square',
    lowpass: 3200
  })
  return 0.23
}

/**
 * Dispatch a recipe; returns the sound's duration in seconds. Takes any
 * BaseAudioContext — exported so tooling can render the palette through
 * an OfflineAudioContext (see .sfx-audition/); the app itself only calls
 * it via playSfx with the live singleton graph.
 */
export function scheduleSfx(
  name: SfxName,
  ctx: BaseAudioContext,
  out: AudioNode,
  t0: number
): number {
  switch (name) {
    case 'tap':
      return playTap(ctx, out, t0)
    case 'tapSoft':
      return playTapSoft(ctx, out, t0)
    case 'toggleOn':
      return playToggleOn(ctx, out, t0)
    case 'toggleOff':
      return playToggleOff(ctx, out, t0)
    case 'open':
      return playOpen(ctx, out, t0)
    case 'close':
      return playClose(ctx, out, t0)
    case 'channel':
      return playChannel(ctx, out, t0)
    case 'powerOn':
      return playPowerOn(ctx, out, t0)
    case 'pressStart':
      return playPressStart(ctx, out, t0)
    default: {
      const exhaustive: never = name
      return exhaustive
    }
  }
}
