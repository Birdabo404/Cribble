'use client'

// One paid ad, reused 1:1 across the flipper, the profile rails, the
// buyer-side live preview and the admin queue so every surface shows
// exactly what airs. Three shapes:
//   sm — the original compact pill in the nav chip language (see
//        NavTopBar), kept for dense admin lists; a title renders inline
//        as "Title — text".
//   lg — the flipper's full-width sub-banner strip, broadcast
//        lower-third style: a 3px accent stripe on the left, a low-alpha
//        accent wash, a 44px logo (accent ring) spanning both lines, the
//        company/title line on top and the ad text under it. Without a
//        title it stays the original single-line strip. accentColor is
//        extracted from the logo server-side and arrives at runtime as
//        #rrggbb, so the tints are inline styles (hex + alpha suffix),
//        not classes; null renders the same strip in neutral zinc.
//   rail — the vertical profile-rails card (208px wide, canivibecodeit
//        style): the same wash + ring machinery with the stripe moved to
//        the top edge, a 36px logo with the AD tag opposite, the title
//        line under it and the ad text wrapping up to three clamped
//        lines. animateIn is a no-op here — the rails never rotate.
// Renders an <a> when given href (the /api/billboard/[id]/click
// redirect), a <button> for onClick-only surfaces, otherwise an inert
// <div>. Buyer text is untrusted and always renders as plain text.
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
  'relative flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-2.5'

const CARD_RAIL =
  'relative flex w-52 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 px-3.5 py-3'

// The two lines of the lg strip — BillboardTicker's hype layer mirrors
// these classes 1:1 so ad->hype flips read as one continuous surface.
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
  /** Company / brand identity line. lg renders it above the text; sm
   *  inlines it as "Title — text". null keeps the single-line shapes. */
  title?: string | null
  logoUrl?: string | null
  /** #rrggbb derived from the logo server-side; null = neutral zinc. */
  accentColor?: string | null
  href?: string
  onClick?: () => void
  size?: 'sm' | 'lg' | 'rail'
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
        <span className="text-[9px] tracking-[0.3em] text-zinc-500">AD</span>
      </>
    ) : size === 'lg' ? (
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
            className="relative h-11 w-11 shrink-0 rounded object-cover"
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
        <span className="relative shrink-0 text-[10px] tracking-[0.3em] text-zinc-500">AD</span>
      </>
    ) : (
      <>
        {/* Same accent machinery as lg — wash under the content, the
            stripe relocated to the top edge for the vertical shape and
            breathing on a slow cycle (the parked rails' only idle
            motion). */}
        {accentColor && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: `${accentColor}1a` }}
          />
        )}
        <span
          aria-hidden
          className={`billboard-rail-breathe absolute inset-x-0 top-0 h-[3px] ${accentColor ? '' : 'bg-zinc-700'}`}
          style={accentColor ? { background: accentColor } : undefined}
        />
        <span className="relative flex items-start justify-between gap-2">
          {logoUrl && !logoDead && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              aria-hidden
              loading="lazy"
              className="h-9 w-9 shrink-0 rounded object-cover"
              style={{
                boxShadow: `0 0 0 1px ${accentColor ? `${accentColor}80` : 'rgb(255 255 255 / 0.14)'}`
              }}
              onError={() => setLogoDead(true)}
            />
          )}
          <span className="ml-auto text-[9px] tracking-[0.3em] text-zinc-500">AD</span>
        </span>
        <span className="relative mt-2.5 flex min-w-0 flex-col gap-1">
          {title && <span className={TITLE_LINE}>{title}</span>}
          <span className="line-clamp-3 text-xs leading-5 text-zinc-200">{text}</span>
        </span>
      </>
    )

  const base = size === 'sm' ? PILL_SM : size === 'lg' ? STRIP_LG : CARD_RAIL

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
