'use client'

// Hero CTA — one square, bracket-framed action straight to /login (open
// beta; /api/waitlist and its rows stay for the people already on it) with
// the beta receipt beside it. Hover/press rules live in globals.css under
// .lx-cta: fill with the signal, press as a scale, no arrow, no slide.

import Link from 'next/link'

export function HeroCta() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <Link
        href="/login"
        className="lx-cta inline-block whitespace-nowrap border border-[color:var(--lx-line-strong)] px-5 py-3.5 font-data text-[12px] tracking-[0.18em] text-[color:var(--lx-ink)]"
      >
        <span aria-hidden className="lx-cta-bracket">
          [
        </span>{' '}
        CLAIM YOUR SPOT{' '}
        <span aria-hidden className="lx-cta-bracket">
          ]
        </span>
      </Link>

      <span className="font-data text-[length:var(--fs-label)] tracking-[0.2em] text-[color:var(--lx-ink-dim)]">
        OPEN BETA · FREE WHILE IN BETA
      </span>
    </div>
  )
}
