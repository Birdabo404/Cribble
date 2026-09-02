// The score to beat — SIM_ROSTER's P1, the same figure the Arena prints as
// TOP SCORE. The final number ships in the HTML (SSR, no-JS and reduced
// motion all show it); the entrance's count-up starts from 0 only once the
// hero is armed, which is why the root is a [data-hero-enter] block. Once
// settled, the board's liveness ticker (useTowerLiveness.ts) drifts it up
// to SCORE_CEILING by writing this <data>'s text in place.
//
// Fit: .lx-numeral (globals.css) sizes the digits to the column for seven
// glyphs — 929,369. The million is nine, so data-glyphs carries the count
// and the variant below narrows the fit by 7/9 (25.5cqi → 19.8cqi) when it
// reads 9; the ticker eases the size between the two at the crossing.

import { SIM_ROSTER } from '@/components/landing/data'

const P1 = SIM_ROSTER[0]
const numberFormat = new Intl.NumberFormat('en-US')
const P1_TEXT = numberFormat.format(P1.score)

export function Numeral() {
  return (
    <div data-hero-enter>
      <div className="lx-hero-title">
        <data
          value={String(P1.score)}
          data-hero-numeral
          data-glyphs={P1_TEXT.length}
          className="lx-numeral block data-[glyphs=9]:[font-size:min(var(--fs-numeral),19.8cqi)]"
        >
          {P1_TEXT}
        </data>
      </div>

      <div className="lx-hero-exit mt-[var(--rhythm-2)] flex items-center gap-4 font-data text-[length:var(--fs-label)] tracking-[0.2em] text-[color:var(--lx-ink-dim)]">
        <span
          aria-hidden
          className="h-px w-10 shrink-0 sm:w-16"
          style={{ background: 'var(--lx-signal)' }}
        />
        <span className="whitespace-nowrap">
          THE SCORE TO BEAT · P1 · {P1.callsign.toUpperCase()}
        </span>
      </div>
    </div>
  )
}
