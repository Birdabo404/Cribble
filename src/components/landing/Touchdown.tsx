'use client'

// TOUCHDOWN — the hero's bookend and the last sheet of the manifest. The
// same markup as the hero's left column (Numeral.tsx), with the score to
// beat replaced by a giant ∞ in the signal color: your gap to P1, until
// your first sync. The ∞ is a live Möbius ribbon (MobiusGap.tsx) — the
// data font has no ∞ glyph, so the text version fell back to a system
// face; it stays in the markup as the SSR / no-JS / reduced-motion
// picture under the canvas. Then the serif line, the same CTA, and a
// footer-style strip with the way back up. No glow, no rounded button,
// no sign-off. data-sec="touchdown" is what useSectionMotion's offstage
// observer looks up to freeze the ribbon when the sheet scrolls away.

import { CSSProperties, useRef } from 'react'
import Link from 'next/link'
import { landingSmoother } from '@/lib/landingMotion'
import { HeroCta } from './hero/HeroCta'
import { MobiusGap } from './MobiusGap'
import { Stage, useMaskedLines } from './scrollFx'

const CELL = 'flex items-center py-3.5 border-[color:var(--lx-line)]'
const LINK =
  'text-[color:var(--lx-ink-dim)] transition-colors hover:text-[color:var(--lx-ink)]'

/** scrollTo must go through the smoother when it's active — native smooth
 *  scroll fights the transform-based smoothing. */
function backToOrbit() {
  const smoother = landingSmoother()
  if (smoother) smoother.scrollTo(0, true)
  else window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** The serif line as a SplitText masked line rise, claimed via data-split
 *  so the stage's own .st reveal skips it (see useMaskedLines). A separate
 *  component because useMaskedLines reads the surrounding Stage's context
 *  — called from Touchdown itself (outside the Stage) the hook never hears
 *  "live" and the reveal strands the line hidden. */
function Verdict() {
  const ref = useMaskedLines<HTMLParagraphElement>(200)
  return (
    <p
      ref={ref}
      className="st mt-[var(--rhythm-3)] font-serif text-[length:var(--fs-tagline)] leading-[1.1] text-[color:var(--lx-ink-dim)]"
      style={{ '--d': '220ms' } as CSSProperties}
    >
      the board is live. your rank isn&apos;t.
    </p>
  )
}

export function Touchdown() {
  // The θ readout in the caption row; MobiusGap writes it per whole degree.
  const readoutRef = useRef<HTMLSpanElement>(null)
  return (
    <section className="relative" data-sec="touchdown">
      {/* An inline-size container so the numeral can size itself to the
          sheet (see .lx-numeral), exactly as the hero's left column does. */}
      <Stage className="page-zoom-out mx-auto flex w-full max-w-6xl flex-col px-6 pt-20 pb-16 sm:pt-28 md:pt-36 [container-type:inline-size]">
        <span
          aria-hidden
          className="st-line block h-px w-full"
          style={
            {
              '--d': '0ms',
              background: 'var(--lx-line)',
              transformOrigin: 'left center'
            } as CSSProperties
          }
        />

        <MobiusGap readoutRef={readoutRef} />

        <div
          className="st mt-[var(--rhythm-2)] flex items-center gap-4 font-data text-[length:var(--fs-label)] tracking-[0.2em] text-[color:var(--lx-ink-dim)]"
          style={{ '--d': '120ms' } as CSSProperties}
        >
          <span
            aria-hidden
            className="h-px w-10 shrink-0 sm:w-16"
            style={{ background: 'var(--lx-signal)' }}
          />
          <span className="whitespace-nowrap">
            YOUR GAP TO P1 · UNTIL YOUR FIRST SYNC
          </span>
          {/* Instrument readout for the ribbon's twist phase — decoration,
              hidden below sm so the label never wraps on phones. */}
          <span
            className="ml-auto hidden whitespace-nowrap text-[color:var(--lx-ink-faint)] sm:inline"
            aria-hidden
          >
            ONE SURFACE · ONE EDGE · <span ref={readoutRef}>θ ———</span>
          </span>
        </div>

        <Verdict />

        <div
          className="st mt-[var(--rhythm-3)]"
          style={{ '--d': '320ms' } as CSSProperties}
        >
          <HeroCta />
        </div>

        {/* Footer-style strip — the hero footer's grammar: cells draw their
            own left hairline (top hairline when stacked below sm). */}
        <div
          className="st mt-[calc(var(--rhythm-3)*2)] flex flex-col border-t border-[color:var(--lx-line)] font-data text-[length:var(--fs-label)] tracking-[0.2em] text-[color:var(--lx-ink-dim)] sm:flex-row sm:items-stretch"
          style={{ '--d': '420ms' } as CSSProperties}
        >
          <div className={`${CELL} gap-x-3 pr-5`}>
            <span>CRIBBLE · 2026</span>
            <span aria-hidden>·</span>
            <Link href="/privacy" className={LINK}>
              PRIVACY
            </Link>
            <span aria-hidden>·</span>
            <Link href="/status" className={LINK}>
              STATUS
            </Link>
          </div>

          <div
            className={`${CELL} border-t sm:ml-auto sm:border-l sm:border-t-0 sm:pl-5`}
          >
            <button
              type="button"
              onClick={backToOrbit}
              className={`whitespace-nowrap ${LINK}`}
            >
              BACK TO ORBIT ↑
            </button>
          </div>
        </div>
      </Stage>
    </section>
  )
}
