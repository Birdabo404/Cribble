'use client'

// Avatar with graceful degradation. OAuth-era profile image URLs go stale
// (users change their avatar and Twitter 404s the old `_normal` variant),
// and a raw <img> then paints the browser's broken-image glyph inside the
// medal ring. This tries the high-res variant, falls back to the stored
// URL, and finally renders a monogram tile.

import { useEffect, useState } from 'react'
import { bannerFrameStyle, type BannerFrame } from '@/lib/bannerFrame'

/** twimg avatars are stored at multiple sizes; the OAuth flow persists the
 * 48px `_normal` variant which is blurry on retina. Swap in the 400px one. */
const upgraded = (src: string) =>
  src.includes('pbs.twimg.com') ? src.replace(/_normal(\.[a-z]+)(\?.*)?$/i, '_400x400$1$2') : src

export function Avatar({
  src,
  char,
  imgClassName,
  fallbackClassName,
  imgStyle
}: {
  src: string | null | undefined
  /** monogram character shown when no/broken image */
  char: string
  imgClassName: string
  fallbackClassName: string
  imgStyle?: React.CSSProperties
}) {
  const [stage, setStage] = useState<'hi' | 'original' | 'monogram'>('hi')

  useEffect(() => setStage('hi'), [src])

  const hi = src ? upgraded(src) : null

  if (!src || !hi || stage === 'monogram') {
    return <span className={fallbackClassName}>{char}</span>
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={stage === 'hi' ? hi : src}
      alt=""
      aria-hidden
      loading="lazy"
      className={imgClassName}
      style={imgStyle}
      onError={() => setStage(stage === 'hi' && hi !== src ? 'original' : 'monogram')}
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
