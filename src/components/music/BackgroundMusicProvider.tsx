'use client'

// Background music for the authenticated shell. Owns a single
// HTMLAudioElement (same lifecycle pattern as the welcome-page ambience)
// mounted once in AppShell, so client navigations never remount or
// restart playback. Route gating: music plays on the four main surfaces
// (dashboard, bag, shop, profile) and pauses everywhere else, keeping
// currentTime so returning resumes where it left off.
//
// Preferences are device-local (localStorage), mirroring the other
// Appearance settings — no server sync. Mute pauses the element rather
// than merely zeroing volume so CPU/network stay quiet.
//
// Loading is lazy: the element mounts with no src and preload='none',
// so entering the shell muted or on a non-music route downloads nothing
// (eager src + preload='auto' used to pull ~4.6MB on every app entry).
// The first actual playback request attaches the src; from then on
// track swaps and resume behave exactly as before.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { usePathname } from 'next/navigation'
import {
  BACKGROUND_TRACKS,
  DEFAULT_MUSIC_VOLUME,
  MUSIC_MUTED_KEY,
  MUSIC_VOLUME_KEY,
  clampMusicVolume,
  isMusicPlayPath,
  nextTrackIndex,
  parseStoredMuted,
  parseStoredVolume
} from '@/lib/backgroundMusic'

export interface BackgroundMusicContextValue {
  /** Stored slider value, 0–1. Muting never rewrites it. */
  volume: number
  muted: boolean
  /** True only while the element is audibly playing — false off-route,
   *  while muted, or while autoplay is still blocked. */
  playing: boolean
  currentTitle: string
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  /** Jump to the next track (with wrap). Playback continues only when
   *  already on an allowlisted route and not muted. */
  skipNext: () => void
}

const BackgroundMusicCtx = createContext<BackgroundMusicContextValue | null>(null)

// Prefs resolve client-side; SSR renders defaults, and consumers gate
// their controls behind a mounted flag (as the Appearance page already
// does) to keep hydration clean.
function readStoredVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_MUSIC_VOLUME
  try {
    return parseStoredVolume(window.localStorage.getItem(MUSIC_VOLUME_KEY))
  } catch {
    return DEFAULT_MUSIC_VOLUME
  }
}

function readStoredMuted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return parseStoredMuted(window.localStorage.getItem(MUSIC_MUTED_KEY))
  } catch {
    return false
  }
}

export function BackgroundMusicProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''
  const [volume, setVolumeState] = useState<number>(readStoredVolume)
  const [muted, setMutedState] = useState<boolean>(readStoredMuted)
  const [trackIndex, setTrackIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Lazy-load latch: flips true the first time playback is actually
  // wanted (shouldPlay, or a skip on a music surface). Until then the
  // element keeps no src and nothing downloads.
  const musicRequestedRef = useRef(false)

  // One element for the provider's lifetime; tracks swap via src.
  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'none'
    const handlePlay = () => setPlaying(true)
    const handlePause = () => setPlaying(false)
    // Playlist advance with wrap: Yellow → Mellow → Yellow → …
    const handleEnded = () => setTrackIndex((index) => nextTrackIndex(index))
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audioRef.current = audio
    return () => {
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.pause()
      audio.currentTime = 0
      audioRef.current = null
    }
  }, [])

  // Track swaps (ended → next, skip) touch the element only once music
  // has been requested. This effect also runs on mount, and before the
  // latch is set, assigning src here would start a download nobody asked
  // for — the pointer still moves via trackIndex, and the first playback
  // request below picks up whichever track it lands on.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !musicRequestedRef.current) return
    audio.src = BACKGROUND_TRACKS[trackIndex % BACKGROUND_TRACKS.length].src
  }, [trackIndex])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = muted ? 0 : volume
  }, [volume, muted])

  useEffect(() => {
    try {
      window.localStorage.setItem(MUSIC_VOLUME_KEY, String(volume))
      window.localStorage.setItem(MUSIC_MUTED_KEY, muted ? '1' : '0')
    } catch {}
  }, [volume, muted])

  const shouldPlay = isMusicPlayPath(pathname) && !muted

  // Play/pause gate. Deliberately not keyed on pathname itself: hopping
  // between allowlisted routes keeps shouldPlay true, so the effect never
  // re-runs and the music never restarts. trackIndex is a dep so the
  // ended → next-track swap re-attempts play() on the new src.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!shouldPlay) {
      // pause() keeps currentTime — returning to an allowlisted route
      // (or unmuting there) resumes from the same spot.
      audio.pause()
      return
    }
    // Playback is wanted: lift the lazy-load latch. Only the very first
    // request assigns a src — on later re-runs (returning to a music
    // route, unmuting) it is already set, and reassigning it would reset
    // currentTime instead of resuming.
    musicRequestedRef.current = true
    if (!audio.src) {
      audio.src = BACKGROUND_TRACKS[trackIndex % BACKGROUND_TRACKS.length].src
    }
    let cancelled = false
    function removeUnlockListeners() {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    function unlock() {
      removeUnlockListeners()
      if (cancelled || !audioRef.current) return
      audioRef.current.play().catch(() => {
        // Still blocked — the next route or preference change retries.
      })
    }
    audio.play().catch(() => {
      if (cancelled) return
      // Browsers reject autoplay before the first user gesture, so retry
      // once on the next pointer/key input (silent-catch style shared
      // with the welcome ambience).
      window.addEventListener('pointerdown', unlock)
      window.addEventListener('keydown', unlock)
    })
    return () => {
      cancelled = true
      removeUnlockListeners()
    }
  }, [shouldPlay, trackIndex])

  const setVolume = useCallback((value: number) => {
    const clamped = clampMusicVolume(value)
    setVolumeState(clamped)
    // Dragging the slider above zero while muted is an intent to listen.
    if (clamped > 0) setMutedState(false)
  }, [])

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value)
  }, [])

  const skipNext = useCallback(() => {
    // The index change swaps src (once music has been requested — which
    // starts the new track from 0) and re-runs the gate effect, so
    // playback continues only when shouldPlay still holds. The explicit
    // rewind covers the degenerate case where the wrap lands on the same
    // index and src never changes. Skipping on a music surface is a
    // deliberate request for music, so it lifts the lazy-load latch even
    // while muted; elsewhere (the settings page) it just moves the
    // pointer and nothing loads until playback is actually wanted.
    if (isMusicPlayPath(pathname)) musicRequestedRef.current = true
    const audio = audioRef.current
    if (audio) audio.currentTime = 0
    setTrackIndex((index) => nextTrackIndex(index))
  }, [pathname])

  const currentTitle = BACKGROUND_TRACKS[trackIndex % BACKGROUND_TRACKS.length].title

  const value = useMemo<BackgroundMusicContextValue>(
    () => ({ volume, muted, playing, currentTitle, setVolume, setMuted, skipNext }),
    [volume, muted, playing, currentTitle, setVolume, setMuted, skipNext]
  )

  return <BackgroundMusicCtx.Provider value={value}>{children}</BackgroundMusicCtx.Provider>
}

/** Null outside the app shell (marketing, login, welcome) — callers hide
 *  their controls in that case, same contract as useNavPrefs. */
export function useBackgroundMusic(): BackgroundMusicContextValue | null {
  return useContext(BackgroundMusicCtx)
}
