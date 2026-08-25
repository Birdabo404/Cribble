'use client'

// Hero CTA — one action, one receipt. The waitlist button/form/success
// state are gone (open beta; /api/waitlist and its rows stay for the people
// already on it): "Claim your spot" goes straight to /login, and the proof
// line beside it reuses the same live roster the globe annotation draws
// from, plus the 47-site claim the body copy already makes.

import Link from 'next/link'
import { PILOTS } from '../pilots'

export function HeroCta() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <Link
        href="/login"
        className="group inline-flex items-center gap-2.5 bg-white text-black text-sm font-medium px-5 py-3 sm:py-2.5 rounded-md hover:bg-zinc-200 transition-colors"
      >
        <span>Claim your spot</span>
        <span className="text-zinc-500 group-hover:translate-x-0.5 transition-transform">
          →
        </span>
      </Link>

      <span className="text-[length:var(--fs-label)] tracking-[0.2em] text-zinc-500">
        {PILOTS.length} PILOTS RANKED · 47 SITES TRACKED
      </span>
    </div>
  )
}
