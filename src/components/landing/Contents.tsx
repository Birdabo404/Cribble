'use client'

// CONTENTS — the first thing below the fold. One hairline rail listing the
// five sheets (`SHEETS 01–05 · 01 ARENA · … · 05 FLIGHT PLAN`), each cell a
// link into its sheet, drawn between two rules in the hero rail's grammar:
// the top rule draws in (.st-line, the hero's [data-hero-line] move), the
// cells fade in 40ms apart. This is the only descent nav below lg — the
// rope's ticks take over on desktop — so it wraps to two rows on phones.

import { CSSProperties, MouseEvent } from 'react'
import { landingSmoother } from '@/lib/landingMotion'
import { SECTIONS } from './Descent'
import { Stage } from './scrollFx'

const CELL =
  'st flex items-center border-l border-[color:var(--lx-line)] px-3 py-3 sm:px-5'
const DIM = 'text-[color:var(--lx-ink-dim)]'
const INK = 'text-[color:var(--lx-ink)]'

/** Under transform-based smoothing the native anchor jump scrolls the
 *  (fixed) wrapper nowhere — route through the smoother. Without one,
 *  native behavior stands. */
function scrollToSheet(e: MouseEvent, id: string) {
  const smoother = landingSmoother()
  if (!smoother) return
  e.preventDefault()
  smoother.scrollTo(`#descent-${id}`, true)
}

function Rule({ delay }: { delay: string }) {
  return (
    <span
      aria-hidden
      className="st-line block h-px w-full"
      style={
        {
          '--d': delay,
          background: 'var(--lx-line)',
          transformOrigin: 'left center'
        } as CSSProperties
      }
    />
  )
}

export function Contents() {
  return (
    <Stage className="page-zoom-out mx-auto w-full max-w-6xl px-6 pt-[calc(var(--rhythm-3)*2)] pb-[var(--rhythm-3)]">
      <Rule delay="0ms" />

      {/* min-h (not h) so the rail keeps the hero rail's 48px on one row
          and grows when the cells wrap below sm */}
      <nav
        aria-label="Sheets of the manifest"
        className="flex min-h-12 flex-wrap items-stretch font-data text-[length:var(--fs-label)] tracking-[0.2em]"
      >
        <div
          className={`st flex items-center py-3 pr-3 sm:pr-5 ${DIM}`}
          style={{ '--d': '0ms' } as CSSProperties}
        >
          SHEETS 01–05
        </div>

        {SECTIONS.map((s, i) => (
          <div
            key={s.id}
            className={CELL}
            style={{ '--d': `${(i + 1) * 40}ms` } as CSSProperties}
          >
            <a
              href={`#descent-${s.id}`}
              onClick={(e) => scrollToSheet(e, s.id)}
              className="group whitespace-nowrap"
            >
              <span className={DIM}>{s.index}</span>{' '}
              <span
                className={`${INK} transition-colors duration-[160ms] group-hover:text-[color:var(--lx-signal)]`}
              >
                {s.label}
              </span>
            </a>
          </div>
        ))}
      </nav>

      <Rule delay="0ms" />
    </Stage>
  )
}
