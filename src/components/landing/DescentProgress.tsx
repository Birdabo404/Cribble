'use client'

// PHONE PROGRESS — the rope's stand-in below lg: a 1px hairline pinned to
// the top edge whose signal-colored fill scales with the same fall progress
// the rope reads (hero pin start → touchdown). No gradient, no shadow, no
// readout. Mounted from HomeV2 as a sibling of #smooth-wrapper — fixed
// elements die inside ScrollSmoother's transformed content.

import { RefObject, useEffect, useRef, useState } from 'react'
import { onLandingRuntime, type LandingMotion } from '@/lib/landingMotion'
import { prefersReducedMotion } from '@/lib/motion'
import { fallStart } from './DescentSpine'

type ScrollTriggerInstance = ReturnType<LandingMotion['ScrollTrigger']['create']>

export function DescentProgress({
  heroRef,
  descentRef
}: {
  heroRef: RefObject<HTMLDivElement>
  descentRef: RefObject<HTMLDivElement>
}) {
  const [armed, setArmed] = useState(false)
  const [visible, setVisible] = useState(false)
  const fillRef = useRef<HTMLDivElement>(null)

  // Arms on any published tier (lite or full). The runtime never publishes
  // on 'still' — and reduced motion is checked again explicitly, like the
  // old HUD did — so nothing renders there.
  useEffect(() => {
    if (prefersReducedMotion()) return
    return onLandingRuntime(() => setArmed(true))
  }, [])

  // Progress is written straight to the DOM, never through React: the
  // trigger updates every scrolled frame, and a setState here would
  // re-render per frame. scaleX composites where a width write would
  // relayout the bar.
  useEffect(() => {
    if (!armed) return
    let triggers: ScrollTriggerInstance[] = []

    const off = onLandingRuntime(({ motion }) => {
      const hero = heroRef.current
      const root = descentRef.current
      const fill = fillRef.current
      if (!hero || !root || !fill || triggers.length) return
      const { ScrollTrigger } = motion
      const write = (progress: number) => {
        fill.style.transform = `scaleX(${progress.toFixed(4)})`
      }
      triggers = [
        // Wake once the hero is fully cleared — the bar overlays page
        // content, and there is no free margin on small screens.
        ScrollTrigger.create({
          start: () => window.innerHeight * 1.05,
          end: 'max',
          onToggle: (self) => setVisible(self.isActive)
        }),
        // Same domain as the rope: 0 at the hero's top (a numeric start,
        // never pushed by the hero pin — see DescentSpine's fallStart), 1
        // at touchdown, measured off the descent root so the pin-spacer
        // stays in flow. refreshPriority -1 for the same reason as there:
        // born before the pin builds, it must still refresh AFTER the
        // pin's spacer lands or `end` is measured 260vh short.
        ScrollTrigger.create({
          trigger: root,
          start: () => fallStart(hero),
          end: 'bottom bottom',
          refreshPriority: -1,
          onUpdate: (self) => write(self.progress)
        })
      ]
      // seed — callbacks only fire on change after this point
      setVisible(triggers[0].isActive)
      write(triggers[1].progress)
    })

    return () => {
      off()
      triggers.forEach((t) => t.kill())
      triggers = []
    }
  }, [armed, heroRef, descentRef])

  if (!armed) return null

  return (
    <div
      aria-hidden
      className="lx-progress pointer-events-none fixed inset-x-0 z-40 lg:hidden"
      style={{
        top: 'env(safe-area-inset-top, 0px)',
        opacity: visible ? 1 : 0
      }}
    >
      <div className="lx-progress-track h-px w-full">
        <div
          ref={fillRef}
          className="lx-progress-fill h-full w-full"
          style={{ transform: 'scaleX(0)', transformOrigin: '0 50%' }}
        />
      </div>

      <style jsx global>{`
        .lx-progress {
          /* outside .lx-hero / .lx-descent, so the landing accent and role
             tokens are re-pinned here (same values as globals.css) */
          --accent: #ccff00;
          --accent-rgb: 204 255 0;
          --lx-line: rgb(var(--z800) / 0.7);
          --lx-line-strong: rgb(var(--z700));
          --lx-ink: rgb(var(--z100));
          --lx-ink-dim: rgb(var(--z400));
          --lx-ink-faint: rgb(var(--z600));
          --lx-signal: var(--accent);
          transition: opacity 400ms ease;
        }
        html.light .lx-progress {
          --accent: #ff5e00;
          --accent-rgb: 255 94 0;
          --z50: 9 9 11;
          --z100: 24 24 27;
          --z200: 39 39 42;
          --z300: 63 63 70;
          --z400: 82 82 91;
          --z500: 113 113 122;
          --z600: 161 161 170;
          --z700: 212 212 216;
          --z800: 228 228 231;
          --z900: 244 244 245;
          --z950: 250 250 250;
          --lx-ink-dim: rgb(var(--z500));
        }
        .lx-progress-track {
          background: var(--lx-line);
        }
        .lx-progress-fill {
          background: var(--lx-signal);
        }
      `}</style>
    </div>
  )
}
