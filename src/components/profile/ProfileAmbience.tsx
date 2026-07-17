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
// banner once the image decodes. A whisper of monochrome grain dithers
// the blurred gradients so they don't band on pure black.

import { useCallback, useEffect, useState } from 'react'

export function ProfileAmbience({ src }: { src: string | null }) {
  const [dead, setDead] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setDead(false)
    setLoaded(false)
  }, [src])

  // Cache-hit races can complete the image before React wires up onLoad
  // (the hero card requests the same URL), so also probe `complete` when
  // the node mounts.
  const probe = useCallback((node: HTMLImageElement | null) => {
    if (!node || !node.complete) return
    if (node.naturalWidth > 0) setLoaded(true)
    else setDead(true)
  }, [])

  const banner = src && !dead ? src : null
  const showBanner = Boolean(banner) && loaded

  return (
    <div aria-hidden className="pf-amb pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* duotone aurora — instant atmosphere, hands off to the banner */}
      <div className="pf-amb-tint absolute inset-0" style={showBanner ? { opacity: 0 } : undefined} />

      {banner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={probe}
          src={banner}
          alt=""
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
        :global(html.light) .pf-amb {
          /* deeper mask for light: tint-on-white has half the contrast of
             glow-on-black, so the low-alpha tail vanishes — hold the mask
             open longer to carry the aurora as far down as dark mode. */
          mask-image: radial-gradient(
            140% 115% at 50% 0%,
            rgb(0 0 0) 20%,
            rgb(0 0 0 / 0.62) 50%,
            rgb(0 0 0 / 0.28) 70%,
            transparent 90%
          );
          -webkit-mask-image: radial-gradient(
            140% 115% at 50% 0%,
            rgb(0 0 0) 20%,
            rgb(0 0 0 / 0.62) 50%,
            rgb(0 0 0 / 0.28) 70%,
            transparent 90%
          );
        }
        .pf-amb-img {
          /* brightness lift keeps dark, moody banners from disappearing
             entirely once blurred down and masked */
          filter: blur(72px) saturate(0.9) brightness(1.18);
          /* overscan hides the blur's translucent edge ring */
          transform: scale(1.35);
          opacity: 0.38;
          transition: opacity 1200ms ease;
        }
        :global(html.light) .pf-amb-img {
          /* dark-mode parity. On white the aurora can't glow, only tint,
             and a blurred banner at dark-mode opacity barely moves the
             page — so run it much stronger and let saturation carry the
             color. Text is unaffected: it all sits on card surfaces. */
          filter: blur(72px) saturate(1.4);
          opacity: 0.8;
        }
        .pf-amb-tint {
          background:
            radial-gradient(90% 70% at 18% -12%, rgb(var(--banner-a) / 0.16), transparent 60%),
            radial-gradient(80% 65% at 88% -8%, rgb(var(--banner-b) / 0.12), transparent 62%);
          transition: opacity 1200ms ease;
        }
        :global(html.light) .pf-amb-tint {
          opacity: 0.85;
        }
        .pf-amb-grain {
          /* 120px tile of desaturated SVG fractal noise; the container
             mask already clips it to the aurora region. */
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 120px 120px;
          opacity: 0.03;
        }
        :global(html.light) .pf-amb-grain {
          opacity: 0.05;
        }
      `}</style>
    </div>
  )
}
