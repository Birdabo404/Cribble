'use client'

// Banner-derived ambience for the profile page. Replaces the shared
// starfield on profile routes (AppShell skips it there): the pilot's own
// banner, blown up and heavily blurred, becomes a faint aurora that is
// strongest behind the hero card and dissolves into the page background
// by mid-scroll. Pilots without a banner keep the default banner duotone
// as the aurora, so no profile reads as unfinished.
//
// Deliberately static — one composited layer, zero animation loops (the
// old backdrop ran 70+ twinkle animations plus an asteroid streak). The
// only motion is a one-time cross-fade from the duotone tint to the
// banner once the image decodes. A faint grain layer dithers the blurred
// gradient so it doesn't band on pure black.

import { useEffect, useState } from 'react'

// 120px tile of SVG fractal noise, blended over the aurora only (the
// container mask clips it with everything else).
const GRAIN =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

export function ProfileAmbience({ src }: { src: string | null }) {
  const [dead, setDead] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setDead(false)
    setLoaded(false)
  }, [src])

  const banner = src && !dead ? src : null
  const showBanner = Boolean(banner) && loaded

  return (
    <div aria-hidden className="pf-amb pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* duotone aurora — instant atmosphere, hands off to the banner */}
      <div className="pf-amb-tint absolute inset-0" style={showBanner ? { opacity: 0 } : undefined} />

      {banner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={banner}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setDead(true)}
          className="pf-amb-img absolute inset-0 h-full w-full object-cover"
          style={showBanner ? undefined : { opacity: 0 }}
        />
      )}

      <div className="pf-amb-grain absolute inset-0" />

      <style jsx>{`
        .pf-amb {
          /* Aurora shape: brightest behind the hero card, gone by ~80%
             viewport height and toward the side edges. Fading the mask
             (not a scrim) means it dissolves into whatever the real page
             background is, so both themes work untouched. */
          mask-image: radial-gradient(
            140% 105% at 50% 0%,
            rgb(0 0 0 / 0.95) 18%,
            rgb(0 0 0 / 0.5) 48%,
            rgb(0 0 0 / 0.16) 66%,
            transparent 82%
          );
          -webkit-mask-image: radial-gradient(
            140% 105% at 50% 0%,
            rgb(0 0 0 / 0.95) 18%,
            rgb(0 0 0 / 0.5) 48%,
            rgb(0 0 0 / 0.16) 66%,
            transparent 82%
          );
        }
        .pf-amb-img {
          filter: blur(88px) saturate(0.85);
          /* overscan hides the blur's translucent edge ring */
          transform: scale(1.35);
          opacity: 0.26;
          transition: opacity 1200ms ease;
        }
        :global(html.light) .pf-amb-img {
          opacity: 0.15;
        }
        .pf-amb-tint {
          background:
            radial-gradient(90% 70% at 18% -12%, rgb(var(--banner-a) / 0.16), transparent 60%),
            radial-gradient(80% 65% at 88% -8%, rgb(var(--banner-b) / 0.12), transparent 62%);
          transition: opacity 1200ms ease;
        }
        :global(html.light) .pf-amb-tint {
          opacity: 0.55;
        }
        .pf-amb-grain {
          background-image: ${GRAIN};
          background-size: 120px 120px;
          mix-blend-mode: overlay;
          opacity: 0.5;
        }
        :global(html.light) .pf-amb-grain {
          opacity: 0.2;
        }
      `}</style>
    </div>
  )
}
