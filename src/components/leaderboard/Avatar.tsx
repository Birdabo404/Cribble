'use client'

// Avatar with graceful degradation. OAuth-era profile image URLs go stale
// (users change their avatar and Twitter 404s the old `_normal` variant),
// and a raw <img> then paints the browser's broken-image glyph inside the
// medal ring. This tries the high-res variant, falls back to the stored
// URL, then — for rotted twimg URLs with a known handle — a live unavatar
// lookup of the user's CURRENT X picture, and finally a monogram tile.

import { useEffect, useState } from 'react'
import { isXAvatarUrl, xAvatarRefreshUrl } from '@/lib/avatarRefresh'
import { bannerFrameStyle, type BannerFrame } from '@/lib/bannerFrame'

/** The largest twimg size variant with a name; past it only the
 *  suffix-less original exists. */
const TWIMG_NAMED_MAX = 400

/** twimg avatars are stored at multiple sizes; the OAuth flow persists the
 * 48px `_normal` variant which is blurry on retina. Swap in the 400px one,
 * or — when the box needs more than 400 device pixels — drop the suffix
 * for X's original upload (its only larger variant; heavier, so only
 * asked for where it shows). */
const upgraded = (src: string, px: number) =>
  src.includes('pbs.twimg.com')
    ? src.replace(/_normal(\.[a-z]+)(\?.*)?$/i, px > TWIMG_NAMED_MAX ? '$1$2' : '_400x400$1$2')
    : src

export function Avatar({
  src,
  char,
  handle,
  imgClassName,
  fallbackClassName,
  imgStyle,
  px = TWIMG_NAMED_MAX
}: {
  src: string | null | undefined
  /** monogram character shown when no/broken image */
  char: string
  /** X handle for the live-avatar refresh when a stored twimg URL has
   *  rotted (the owner changed their X picture since last login). Omit
   *  on surfaces whose avatars aren't keyed by X handle. */
  handle?: string | null
  imgClassName: string
  fallbackClassName: string
  imgStyle?: React.CSSProperties
  /** Longest edge this instance renders at, in device pixels (CSS size ×
   *  DPR). Only twimg URLs are sizable: up to 400 the `_400x400` variant
   *  (the default), above it the original. GitHub avatars serve 460
   *  whatever is asked and unavatar has no size parameter. */
  px?: number
}) {
  const [stage, setStage] = useState<'hi' | 'original' | 'refresh' | 'monogram'>('hi')

  useEffect(() => setStage('hi'), [src])

  const hi = src ? upgraded(src, px) : null
  const refresh = src && handle && isXAvatarUrl(src) ? xAvatarRefreshUrl(handle) : null
  const shown =
    stage === 'hi' ? hi : stage === 'original' ? src : stage === 'refresh' ? refresh : null

  if (!src || !shown || stage === 'monogram') {
    return <span className={fallbackClassName}>{char}</span>
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      alt=""
      aria-hidden
      loading="lazy"
      className={imgClassName}
      style={imgStyle}
      onError={() =>
        setStage((s) => {
          if (s === 'hi' && hi !== src) return 'original'
          if (s !== 'refresh' && refresh) return 'refresh'
          return 'monogram'
        })
      }
    />
  )
}

/** Banner <img> that removes itself when the URL is dead, revealing
 * whatever default banner is rendered underneath it. An optional frame
 * applies the owner's saved reposition/zoom crop. */
export function SafeBannerImg({
  src,
  className,
  frame
}: {
  src: string
  className: string
  frame?: BannerFrame | null
}) {
  const [dead, setDead] = useState(false)

  useEffect(() => setDead(false), [src])

  if (dead) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      className={className}
      style={bannerFrameStyle(frame)}
      onError={() => setDead(true)}
    />
  )
}
