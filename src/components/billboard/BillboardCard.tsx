'use client'

// The ticker's text card — the strip an operator announcement wears on
// the Billboard flipper (BillboardTicker), with a compact variant kept
// for dense lists. Two shapes:
//   sm — a compact pill in the nav chip language (see NavTopBar); a
//        title renders inline as "Title — text".
//   lg — the flipper's full-width sub-banner strip, broadcast
//        lower-third style: a 3px accent stripe on the left, a low-alpha
//        accent wash, an optional 32px logo (40px from sm up, accent
//        ring) spanning both lines, the title line on top and the text
//        under it. Padding and logo tighten below sm so the strip fits
//        phone-width banners without clipping. Without a title it stays
//        a single-line strip. accentColor arrives at runtime as
//        #rrggbb, so the tints are inline styles (hex + alpha suffix),
//        not classes; null renders the same strip in neutral zinc.
// Renders an <a> when given href, a <button> for onClick-only surfaces,
// otherwise an inert <div>. Copy always renders as plain text.
//
// Logos are URL-based and often twimg avatars, which go stale — like
// Avatar.tsx this drops the <img> on error instead of painting the
// broken-image glyph. A missing logo renders the same text-only shape.

import { useEffect, useState } from 'react'

const INTERACTIVE =
  'transition-[color,background-color,border-color,transform] duration-150 hover:border-zinc-600 hover:bg-white/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500'

const PILL_SM =
  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5'

const STRIP_LG =
  'relative flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 sm:px-4 sm:py-2.5'

// The two lines of the lg strip — BillboardTicker's hype layer mirrors
// these classes 1:1 so announce->hype flips read as one continuous
// surface.
const TITLE_LINE = 'truncate text-[11px] font-semibold uppercase leading-4 tracking-[0.2em] text-zinc-50'
const TEXT_LINE = 'truncate text-sm leading-5 text-zinc-200'

export function BillboardCard({
  text,
  title = null,
  logoUrl,
  accentColor = null,
  href,
  onClick,
  size = 'sm',
  animateIn = false,
  className = ''
}: {
  text: string
  /** Title line. lg renders it above the text; sm inlines it as
   *  "Title — text". null keeps the single-line shapes. */
  title?: string | null
  logoUrl?: string | null
  /** #rrggbb accent; null = neutral zinc. */
  accentColor?: string | null
  href?: string
  onClick?: () => void
  size?: 'sm' | 'lg'
  /** lg only: the staggered build-in (title line first, text ~150ms
   *  later). CSS animations restart when the classes land on fresh
   *  DOM — the ticker re-keys the card to replay the build-in. */
  animateIn?: boolean
  className?: string
}) {
  const [logoDead, setLogoDead] = useState(false)

  useEffect(() => setLogoDead(false), [logoUrl])

  const content =
    size === 'sm' ? (
      <>
        {logoUrl && !logoDead && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className="h-5 w-5 shrink-0 rounded object-cover"
            onError={() => setLogoDead(true)}
          />
        )}
        <span className="text-xs text-zinc-200">{title ? `${title} — ${text}` : text}</span>
      </>
    ) : (
      <>
        {/* Wash + stripe sit under the content (which carries relative);
            0x1A ≈ 10% alpha on the runtime hex. */}
        {accentColor && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: `${accentColor}1a` }}
          />
        )}
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-[3px] ${accentColor ? '' : 'bg-zinc-700'}`}
          style={accentColor ? { background: accentColor } : undefined}
        />
        {logoUrl && !logoDead && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className="relative h-8 w-8 shrink-0 rounded object-cover sm:h-10 sm:w-10"
            style={{
              boxShadow: `0 0 0 1px ${accentColor ? `${accentColor}80` : 'rgb(255 255 255 / 0.14)'}`
            }}
            onError={() => setLogoDead(true)}
          />
        )}
        <span className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          {title && (
            <span className={`${TITLE_LINE} ${animateIn ? 'billboard-build-title' : ''}`}>
              {title}
            </span>
          )}
          <span className={`${TEXT_LINE} ${animateIn ? 'billboard-build-text' : ''}`}>
            {text}
          </span>
        </span>
      </>
    )

  const base = size === 'sm' ? PILL_SM : STRIP_LG

  if (href) {
    return (
      <a href={href} onClick={onClick} className={`${base} ${INTERACTIVE} ${className}`}>
        {content}
      </a>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${INTERACTIVE} ${className}`}>
        {content}
      </button>
    )
  }

  return <div className={`${base} ${className}`}>{content}</div>
}
