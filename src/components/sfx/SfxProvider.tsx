'use client'

// UI sound effects for the app shell. Owns the device-local mute/volume
// preferences (localStorage, mirroring BackgroundMusicProvider) and one
// capture-phase pointerdown listener on document that plays the default
// `tap` for every interactive element — pointerdown, not click, for
// perceived snappiness. Per-element control via data-sfx:
// `data-sfx="off"` opts out, `data-sfx="toggleOn"` (etc.) overrides the
// default. That same listener doubles as the AudioContext unlock
// gesture required by browser autoplay policy.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  DEFAULT_SFX_VOLUME,
  SFX_MUTED_KEY,
  SFX_VOLUME_KEY,
  clampSfxVolume,
  isSfxName,
  parseStoredSfxMuted,
  parseStoredSfxVolume,
  playSfx,
  setSfxMuted,
  setSfxVolume,
  unlockSfx,
  type SfxName
} from '@/lib/sfx'

export interface SfxContextValue {
  /** Fire a palette sound. Safe anytime — no-ops when muted, before the
   *  first user gesture, or during SSR. */
  play: (name: SfxName) => void
  muted: boolean
  setMuted: (muted: boolean) => void
  /** Stored slider value, 0–1. Muting never rewrites it. */
  volume: number
  setVolume: (volume: number) => void
}

const SfxCtx = createContext<SfxContextValue | null>(null)

// Elements that tap by default; [data-sfx] lets anything else opt in.
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="switch"]',
  '[role="tab"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'summary',
  '[data-sfx]'
].join(', ')

// Prefs resolve client-side; SSR renders defaults, and consumers gate
// their controls behind a mounted flag (as the Appearance page already
// does) to keep hydration clean.
function readStoredSfxVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_SFX_VOLUME
  try {
    return parseStoredSfxVolume(window.localStorage.getItem(SFX_VOLUME_KEY))
  } catch {
    return DEFAULT_SFX_VOLUME
  }
}

function readStoredSfxMuted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return parseStoredSfxMuted(window.localStorage.getItem(SFX_MUTED_KEY))
  } catch {
    return false
  }
}

/** Resolve the sound for a pointerdown target, or null to stay silent. */
function soundForTarget(target: EventTarget | null): SfxName | null {
  if (!(target instanceof Element)) return null
  const el = target.closest(INTERACTIVE_SELECTOR)
  if (!el || el.matches(':disabled, [aria-disabled="true"]')) return null
  // data-sfx may sit on the element itself or on a wrapping container
  // (e.g. a whole toolbar opting out with data-sfx="off").
  const override = el.closest('[data-sfx]')?.getAttribute('data-sfx') ?? null
  if (override === null) return 'tap'
  if (override === 'off') return null
  return isSfxName(override) ? override : 'tap'
}

export function SfxProvider({ children }: { children: ReactNode }) {
  const [volume, setVolumeState] = useState<number>(readStoredSfxVolume)
  const [muted, setMutedState] = useState<boolean>(readStoredSfxMuted)

  // Keep the engine's module-level state in step with React state; the
  // engine (not this component) gates actual playback on it, so plain
  // playSfx calls from non-React code (GSAP timelines) behave too.
  useEffect(() => {
    setSfxMuted(muted)
  }, [muted])

  useEffect(() => {
    setSfxVolume(volume)
  }, [volume])

  useEffect(() => {
    try {
      window.localStorage.setItem(SFX_VOLUME_KEY, String(volume))
      window.localStorage.setItem(SFX_MUTED_KEY, muted ? '1' : '0')
    } catch {}
  }, [volume, muted])

  // One delegated capture-phase listener for the whole app. Capture so
  // stopPropagation inside widgets can't silently eat the feedback.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) return
      // Any primary pointerdown is an unlock gesture, interactive or not.
      unlockSfx()
      const name = soundForTarget(event.target)
      if (name) playSfx(name)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [])

  const play = useCallback((name: SfxName) => {
    playSfx(name)
  }, [])

  const setVolume = useCallback((value: number) => {
    const clamped = clampSfxVolume(value)
    setVolumeState(clamped)
    // Dragging the slider above zero while muted is an intent to hear.
    if (clamped > 0) setMutedState(false)
  }, [])

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value)
  }, [])

  const value = useMemo<SfxContextValue>(
    () => ({ play, muted, setMuted, volume, setVolume }),
    [play, muted, setMuted, volume, setVolume]
  )

  return <SfxCtx.Provider value={value}>{children}</SfxCtx.Provider>
}

// Outside the provider (marketing, login, welcome — or SSR) consumers
// get inert defaults, keeping play() safe to call unconditionally.
const SFX_FALLBACK: SfxContextValue = {
  play: () => {},
  muted: false,
  setMuted: () => {},
  volume: DEFAULT_SFX_VOLUME,
  setVolume: () => {}
}

export function useSfx(): SfxContextValue {
  return useContext(SfxCtx) ?? SFX_FALLBACK
}
