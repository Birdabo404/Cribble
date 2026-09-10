'use client'

// Season ticker — the thin strip under the masthead rule (which is its top
// edge; the strip draws only its bottom hairline). One track holds
// TICKER_SEGMENTS twice; globals.css (.shop-ticker-track) slides it by half
// its own width on a 40s linear loop, so the seam between the two copies is
// invisible. English segments are mono LABEL in mute, the Japanese
// interleaves are the JP face in ink, and every segment is followed by a
// low-opacity `///` glyph — including the last, so the loop seam carries
// the same divider as every other join. The strip is aria-hidden; readers
// get TICKER_SENTENCE as one static sentence. Hover pause and the
// reduced-motion freeze both live in the stylesheet.

import { Fragment } from 'react'
import { TICKER_SEGMENTS, TICKER_SENTENCE } from './catalog'
import { INK, JP, LABEL, LINE, MUTE } from './shopChrome'

/** Hiragana, katakana or CJK ideographs anywhere in the segment. */
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/

const SEG = 'shpt-seg inline-flex items-center whitespace-nowrap px-5 py-2'
/** Japanese at label size, the glossary's wide set, ink. */
const SEG_JP = `${SEG} ${JP} ${INK} text-[length:var(--shop-fs-label)] tracking-[0.2em] leading-none`
const SEG_EN = `${SEG} ${LABEL} ${MUTE}`
const SEP = `shpt-sep inline-flex items-center whitespace-nowrap ${LABEL} ${MUTE} opacity-40`

/** The loop is two identical halves; `copy` keys them apart. */
const TICKER_COPIES = [0, 1] as const

export function Ticker() {
  return (
    <div className="shpt-strip">
      <p className="sr-only">{TICKER_SENTENCE}</p>
      {/* one hairline per boundary: the strip's top edge is the masthead
          rule it always sits under; its own rule closes it below, as its
          own element so the page's entrance can draw it (drawRule) */}
      <div aria-hidden className="shop-ticker">
        <div className="shop-ticker-track items-center">
          {TICKER_COPIES.map((copy) =>
            TICKER_SEGMENTS.map((segment, i) => {
              const jp = JAPANESE.test(segment)
              return (
                <Fragment key={`${copy}-${i}`}>
                  <span lang={jp ? 'ja' : undefined} className={jp ? SEG_JP : SEG_EN}>
                    {segment}
                  </span>
                  <span className={SEP}>{'///'}</span>
                </Fragment>
              )
            })
          )}
        </div>
      </div>
      <div aria-hidden className={`shpt-rule border-t ${LINE}`} />
    </div>
  )
}
