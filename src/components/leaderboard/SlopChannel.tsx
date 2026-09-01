'use client'

// CH 92 SLOPTOONS — the CRT's pirate channel, now PUBLIC DOMAIN THEATER.
// Loops a shuffled playlist of vetted public-domain / CC cartoons
// hotlinked from archive.org (see slopPlaylist.ts for the curation
// gate). archive.org serves the bytes with 206 range support, so the
// tube streams straight off their nodes — no server of ours in the
// path. No crossOrigin attribute: the plain <video> + CSS grade needs
// no pixel readback, and archive.org sends no CORS headers anyway.
// CrtAttract lazy-loads this module via next/dynamic, so it never
// rides the leaderboard's initial bundle.

import { useEffect, useRef } from 'react'
import { SLOP_PLAYLIST, shuffle, type SlopClip } from '@/components/leaderboard/slopPlaylist'

export type SlopStatus = 'connecting' | 'live' | 'offline'

type SlopChannelProps = {
  /** Starts true (autoplay policy); the screen click gesture unmutes. */
  muted: boolean
  /** Signal state up so the CRT can drive its static/NO CARRIER dressing. */
  onStatus: (status: SlopStatus) => void
}

/** Dead-air beat after a clip errors before the channel skips ahead. */
const ERROR_SKIP_MS = 2_500

export default function SlopChannel({ muted, onStatus }: SlopChannelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // The playlist driver lives in a mount-only effect; a ref keeps it on
  // the latest callback without re-running the whole session.
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  // React only applies `muted` as a property on mount — updates must go
  // through the DOM directly.
  useEffect(() => {
    const el = videoRef.current
    if (el) el.muted = muted
  }, [muted])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let order: SlopClip[] = shuffle(SLOP_PLAYLIST)
    let cursor = 0
    let skipTimer: ReturnType<typeof setTimeout> | null = null
    // Position to restore after a background-tab teardown; consumed by
    // the persistent loadedmetadata handler so a stale seek can never
    // land on the wrong clip.
    let seekTo = 0

    const clearSkipTimer = () => {
      if (skipTimer !== null) {
        clearTimeout(skipTimer)
        skipTimer = null
      }
    }

    // Point the tube at the current cursor. Assigning src kicks off the
    // media load algorithm; `playing` flips the status to 'live'.
    const tune = () => {
      onStatusRef.current('connecting')
      video.src = order[cursor].src
      void video.play().catch(() => {
        // Autoplay rejection or a load torn down mid-flight — the error/
        // stalled events (or the next tune) own the recovery.
      })
    }

    const advance = () => {
      seekTo = 0
      cursor += 1
      // End of the reel: reshuffle and wrap so the channel loops forever.
      if (cursor >= order.length) {
        order = shuffle(SLOP_PLAYLIST)
        cursor = 0
      }
      tune()
    }

    const onBuffering = () => onStatusRef.current('connecting')
    const onPlaying = () => onStatusRef.current('live')
    const onEnded = () => advance()
    const onError = () => {
      // Dead item / decode failure: read as signal loss, then skip.
      onStatusRef.current('offline')
      clearSkipTimer()
      skipTimer = setTimeout(() => {
        skipTimer = null
        advance()
      }, ERROR_SKIP_MS)
    }
    const onLoadedMetadata = () => {
      if (seekTo > 0) {
        // 206 range support upstream makes this an instant byte-range
        // seek rather than a re-download.
        video.currentTime = seekTo
        seekTo = 0
      }
    }

    video.addEventListener('loadstart', onBuffering)
    video.addEventListener('waiting', onBuffering)
    // Do not listen for `stalled`: buffered playback may continue without
    // another `playing` event, which would leave the tuning overlay stuck.
    video.addEventListener('playing', onPlaying)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    video.addEventListener('loadedmetadata', onLoadedMetadata)

    // Never stream into a background tab: park on hide (clearing src
    // aborts the download), re-tune to the same spot on return.
    const onVisibility = () => {
      if (document.hidden) {
        clearSkipTimer()
        seekTo = video.currentTime
        video.pause()
        video.removeAttribute('src')
        video.load()
      } else {
        tune()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    tune()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearSkipTimer()
      video.removeEventListener('loadstart', onBuffering)
      video.removeEventListener('waiting', onBuffering)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [])

  return (
    <div className="crt-slop" aria-hidden>
      <video
        ref={videoRef}
        className="crt-slop-video"
        autoPlay
        playsInline
        muted
      />
      <div className="crt-slop-tint" />
      <style jsx global>{`
        .crt-slop {
          position: absolute;
          inset: 0;
          overflow: hidden;
          /* Contain the multiply tint: it grades the feed, not the
             tube layers painting below this element. */
          isolation: isolate;
          pointer-events: none;
          background: #0a0703;
        }
        /* Amber phosphor grade, keyed to the monitor's --crt-p custom
           property: desaturate the feed, then multiply the phosphor color
           over it — the MODEL CRT·1984 only ever shipped one gun. Delete
           the filter + .crt-slop-tint for a full-color feed later. */
        .crt-slop-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: grayscale(1) contrast(1.1) brightness(1.05);
        }
        .crt-slop-tint {
          position: absolute;
          inset: 0;
          background: rgb(var(--crt-p));
          mix-blend-mode: multiply;
        }
      `}</style>
    </div>
  )
}
