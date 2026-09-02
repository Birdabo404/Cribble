'use client'

// THE DESCENT — the remaining sheets of the hero's manifest. The hero is
// page one of a document of record; the pinned "controlled fall" tears it,
// and what lands below is the rest of the same document: a contents rail,
// five sheets on the same substrate (arena → cockpit → identity → honors →
// flight plan), and the touchdown bookend. Same 1px hairlines, same Plex
// Mono labels, one signal color — nothing rounded, nothing glowing.
//
// Depth is read on the left, by the rope (DescentSpine) and, on phones, the
// 1px progress hairline (DescentProgress). Both are fixed overlays mounted
// from HomeV2 as siblings of #smooth-wrapper (position:fixed dies inside
// ScrollSmoother's transformed content) and measure their scroll geometry
// against the root this component owns. There is no HUD anymore.

import { RefObject } from 'react'
// Type-only on purpose: landingLive.ts is server code (service-role
// client) and must never enter this client bundle.
import type { LandingLive } from '@/lib/landingLive'
import { ArenaSection } from './ArenaSection'
import { CockpitSection } from './CockpitSection'
import { Contents } from './Contents'
import { HonorsSection } from './HonorsSection'
import { IdentitySection } from './IdentitySection'
import { RoadmapSection } from './RoadmapSection'
import { Touchdown } from './Touchdown'

/** The five sheets, in scroll order — shared with the Contents rail and the
 *  rope's ticks so the two can never drift apart. `id` doubles as the
 *  `#descent-{id}` anchor and the `[data-sec]` hook each sheet carries. */
export const SECTIONS = [
  { id: 'arena', label: 'ARENA', index: '01' },
  { id: 'cockpit', label: 'COCKPIT', index: '02' },
  { id: 'identity', label: 'IDENTITY', index: '03' },
  { id: 'honors', label: 'HONORS', index: '04' },
  { id: 'roadmap', label: 'FLIGHT PLAN', index: '05' }
] as const

export function Descent({
  rootRef,
  live
}: {
  /** Owned by HomeV2 and shared with the hoisted DescentSpine and
   *  DescentProgress, which both measure their scroll geometry against it. */
  rootRef: RefObject<HTMLDivElement>
  /** The hero's live readings (page.tsx, ISR) — the sheets print the same
   *  figures the rail does, so the manifest never disagrees with itself. */
  live: LandingLive
}) {
  return (
    <div
      ref={rootRef}
      className="lx-descent relative font-mono text-[color:var(--lx-ink)]"
    >
      <Contents />
      <ArenaSection live={live} />
      <CockpitSection playerCount={live.playerCount} />
      <IdentitySection />
      <HonorsSection />
      <RoadmapSection />
      <Touchdown />

      <style jsx global>{`
        /* ——— DARK MODE: deep space ——————————————————————————————————
           The hero's zenith gradient settles to --space-deep at the
           fold; the descent continues that exact tone under a sparser,
           dimmer star field — five sheets falling through one night.
           An altitude gradient rides ABOVE the star tiles (first in the
           background list = topmost paint): transparent at orbit, a
           whisper of stratosphere blue through the middle sheets — which
           also veils the stars, so "entering atmosphere" happens for
           free — then a faint warm accent tint at the very bottom under
           the touchdown. Scroll position itself reveals the altitude
           change; no JS. Alphas stay in the 0.02–0.07 band on purpose:
           atmosphere, not a banner gradient. */
        .lx-descent {
          background:
            linear-gradient(
              180deg,
              rgb(56 106 205 / 0) 0%,
              rgb(56 106 205 / 0) 16%,
              rgb(50 96 190 / 0.04) 34%,
              rgb(56 106 205 / 0.07) 54%,
              rgb(64 118 218 / 0.05) 70%,
              rgb(56 106 205 / 0.015) 84%,
              rgb(var(--accent-rgb) / 0.028) 94%,
              rgb(var(--accent-rgb) / 0.05) 100%
            ),
            radial-gradient(1.2px 1.2px at 37px 63px, rgb(190 210 255 / 0.22) 50%, transparent 55%),
            radial-gradient(1px 1px at 141px 158px, rgb(255 255 255 / 0.14) 50%, transparent 55%),
            var(--space-deep);
          background-size: 100% 100%, 240px 240px, 300px 300px, auto;
          /* sheet artifacts may poke past the viewport on phones; clip (not
             hidden) keeps this from becoming a scroll container, so page
             scroll + the flight plan's sticky column stay intact */
          overflow-x: clip;
        }

        /* Full tier (html.lx-motion-full, set by LandingScrollRuntime):
           the altitude gradient and star tiles above are superseded by the
           fixed .lx-atmo layer stack (globals.css), which cross-fades the
           same journey from the scrubbed --alt over the WHOLE page instead
           of keying it to this section's own height. This surface goes
           transparent so the two never double up; lite/still keep the
           static version. */
        html.lx-motion-full:not(.light) .lx-descent {
          background: none;
        }

        /* Light mode: the same white sheet as the hero — hero → descent is
           one document. The role tokens and z-scale re-pin the hero uses
           are widened to .lx-descent in globals.css, so nothing else needs
           re-pinning here. */
        html.light .lx-descent {
          background: #ffffff;
        }
      `}</style>
    </div>
  )
}
