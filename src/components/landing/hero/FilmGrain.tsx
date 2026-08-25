'use client'

// FILM GRAIN — one fixed, non-interactive sheet over the whole landing page
// (hero + descent together; app pages never render it). A tiled SVG
// feTurbulence noise texture at ~3.5% opacity with soft-light blending, so
// it modulates the picture like emulsion instead of graying it out. The
// sheet itself is static — the old steps() jitter (a fullscreen repaint
// every ~100ms) is gone; instead its opacity thickens with scroll velocity
// via --vel, so the grain reads as airframe buffeting: hard on the throttle,
// the picture roughens. z-50 clears the descent HUD (z-40) — harmless above
// everything, since pointer-events-none keeps it out of the input path —
// and the inset-0 frame clips the tile so it can never mint scrollbars.
export function FilmGrain() {
  return (
    <div
      aria-hidden
      className="lx-grain pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      <div className="lx-grain-tile" />

      <style jsx global>{`
        .lx-grain {
          /* opacity + blend belong on this viewport frame: it sits in the
             page's stacking context, so soft-light composites against the
             real page. (On the inner tile they'd blend against this
             frame's empty backdrop and render as flat noise instead.)
             0.035 is the resting base; --vel is smoothed scroll velocity
             (0..1) written on <html> by the scroll smoother. The var()
             fallback of 0 means the sheet renders at exactly the base
             opacity until (or unless) the motion layer arms. */
          opacity: calc(0.035 + var(--vel, 0) * 0.045);
          mix-blend-mode: soft-light;
        }
        /* soft-light is a near no-op over pure white, so on the light
           theme the grain only registers on inked/toned areas — paper
           tooth, not smoke. A notch lower anyway; tune here if the
           dossier ever looks smudged. */
        html.light .lx-grain {
          opacity: calc(0.03 + var(--vel, 0) * 0.04);
        }
        /* Only the full tier ever moves --vel; promote the sheet there so
           the per-frame opacity retarget is compositor-only instead of a
           fullscreen soft-light repaint. Off the full tier the opacity is
           effectively static and promotion would be a pure memory cost. */
        html.lx-motion-full .lx-grain {
          will-change: opacity;
        }
        .lx-grain-tile {
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='256'%20height='256'%3E%3Cfilter%20id='lxg'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.9'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3C/filter%3E%3Crect%20width='256'%20height='256'%20filter='url(%23lxg)'/%3E%3C/svg%3E");
          background-size: 256px 256px;
        }
        /* Reduced motion: pin the grain at its resting opacity so it can
           never pulse with velocity — the static texture stays, exactly as
           it did when this rule dropped the jitter animation. */
        @media (prefers-reduced-motion: reduce) {
          .lx-grain {
            opacity: 0.035;
          }
          html.light .lx-grain {
            opacity: 0.03;
          }
        }
      `}</style>
    </div>
  )
}
