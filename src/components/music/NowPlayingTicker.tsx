'use client'

// NOW PLAYING ticker — a hi-fi VFD readout that lights up in the lower
// right whenever the background music starts or changes track, scrolls
// the title as a dot-matrix marquee, then powers off. Like CrtAttract's
// amber monitor, the housing and ice-blue phosphor are pinned across
// themes: it is a physical appliance sitting on the page, not a toast.
//
// Lifecycle: off → warming (ignition flicker) → scrolling (~7.5s hold,
// hover pauses) → fading (power-off) → off. A track change while lit
// blinks the segments and swaps the text in place — no re-entrance.

import { Doto } from 'next/font/google'
import { useEffect, useRef, useState } from 'react'
import { useBackgroundMusic } from '@/components/music/BackgroundMusicProvider'
import { useSettingsModal } from '@/components/settings/SettingsModalContext'
import { prefersReducedMotion } from '@/lib/motion'

// Loaded here (not the root layout) so only the app shell pays for it.
const doto = Doto({
  subsets: ['latin'],
  weight: 'variable',
  axes: ['ROND'],
  display: 'swap',
  variable: '--font-vfd'
})

const WARM_MS = 420
const HOLD_MS = 7500
const FADE_MS = 520
const REDUCED_FADE_MS = 200

type TickerPhase = 'off' | 'warming' | 'scrolling' | 'fading'

function reducedNow(): boolean {
  return (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  )
}

/** OS media query + Cribble's in-app data-motion kill switch, live. */
function useReducedMotionLive(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const compute = () => setReduced(reducedNow())
    compute()
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    mq.addEventListener('change', compute)
    const mo = new MutationObserver(compute)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion']
    })
    return () => {
      mq.removeEventListener('change', compute)
      mo.disconnect()
    }
  }, [])
  return reduced
}

export function NowPlayingTicker() {
  const music = useBackgroundMusic()
  const { openSettings } = useSettingsModal()
  const reduced = useReducedMotionLive()

  const [phase, setPhase] = useState<TickerPhase>('off')
  const [title, setTitle] = useState('')
  const [blinkKey, setBlinkKey] = useState(0)
  const [hovered, setHovered] = useState(false)

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const holdRemainRef = useRef(HOLD_MS)

  const playing = music?.playing ?? false
  const currentTitle = music?.currentTitle ?? ''

  const prevPlayingRef = useRef(false)
  const prevTitleRef = useRef(currentTitle)

  useEffect(() => {
    const prevPlaying = prevPlayingRef.current
    const prevTitle = prevTitleRef.current
    prevPlayingRef.current = playing
    prevTitleRef.current = currentTitle

    if (playing && (!prevPlaying || currentTitle !== prevTitle)) {
      holdRemainRef.current = HOLD_MS
      setTitle(currentTitle)
      if (phaseRef.current === 'off') {
        // The pointer may still be parked where the last capsule faded
        // out (no mouseleave fires on an unmounted node), so a stale
        // hover must not pin the fresh one open forever.
        setHovered(false)
        setPhase('warming')
      } else {
        // Already lit (or mid-fade — a natural track end fires pause →
        // play within ~100ms): relight in place, blink only on a swap.
        if (currentTitle !== prevTitle) setBlinkKey((k) => k + 1)
        setPhase('scrolling')
      }
      return
    }
    if (!playing && prevPlaying && phaseRef.current !== 'off') {
      setPhase('fading')
    }
  }, [playing, currentTitle])

  useEffect(() => {
    if (phase === 'warming') {
      const id = window.setTimeout(
        () => setPhase('scrolling'),
        reduced ? 0 : WARM_MS
      )
      return () => window.clearTimeout(id)
    }
    if (phase === 'fading') {
      const id = window.setTimeout(
        () => setPhase('off'),
        reduced ? REDUCED_FADE_MS : FADE_MS
      )
      return () => window.clearTimeout(id)
    }
  }, [phase, reduced])

  // Pausable dismiss timer: hovering banks the remaining hold, leaving
  // re-arms it; a track swap (blinkKey) restarts from the full hold.
  useEffect(() => {
    if (phase !== 'scrolling' || hovered) return
    const startedAt = Date.now()
    const id = window.setTimeout(() => setPhase('fading'), holdRemainRef.current)
    return () => {
      window.clearTimeout(id)
      holdRemainRef.current = Math.max(
        0,
        holdRemainRef.current - (Date.now() - startedAt)
      )
    }
  }, [phase, hovered, blinkKey])

  if (!music || phase === 'off') return null

  const line = `NOW PLAYING "${title.toUpperCase()}"`

  return (
    <div
      role="status"
      aria-live="polite"
      data-phase={phase}
      data-reduced={reduced || undefined}
      className={`vfdt-root fixed bottom-5 right-5 z-[55] ${doto.variable}`}
    >
      <span className="sr-only">{`Now playing: ${title}`}</span>
      <button
        type="button"
        className="vfdt-capsule"
        aria-label={`Now playing: ${title} — open sound settings`}
        onClick={() => openSettings('appearance')}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <span className="vfdt-tube" aria-hidden>
          <span className="vfdt-skew">
            {reduced ? (
              <span className="vfdt-text vfdt-static">{line}</span>
            ) : (
              <span key={blinkKey} className="vfdt-track">
                <span className="vfdt-text vfdt-copy">{line}</span>
                <span className="vfdt-text vfdt-copy">{line}</span>
              </span>
            )}
          </span>
        </span>
        <span className="vfdt-glass" aria-hidden />
      </button>
    </div>
  )
}
