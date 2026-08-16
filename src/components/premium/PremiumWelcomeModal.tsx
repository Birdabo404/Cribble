'use client'

// Post-checkout celebration — the X-Premium-style "your blue check is
// here" moment: the pixel verified badge front and center, amber chrome
// everywhere else. Shown once, by the shop page, when a subscription
// sync flips the tier to PRO (changed && isPro). Same portal/glass shell
// as MenuModal, kept self-contained so the shop doesn't have to import
// from AccountMenu.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { AMBER, PREMIUM_PERKS, formatPremiumSince } from '@/components/premium/premium'
import { VERIFIED_BLUE, VerifiedBadge } from '@/components/premium/VerifiedBadge'

function StrokeIcon({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

export function PremiumWelcomeModal({
  premiumSince,
  onClose
}: {
  premiumSince: string | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portaled to <body>: nav chrome uses backdrop-filter, which would trap
  // a fixed overlay inside it. z-[80] clears the shop content and toasts'
  // neighbors, same layer as EditProfileModal.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Cribble Premium"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        {/* amber keyline — the PRO signature, same treatment as the shop hero */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 h-[2px]"
          style={{
            background: `linear-gradient(90deg, transparent 4%, rgb(${AMBER} / 0.9) 50%, transparent 96%)`,
            boxShadow: `0 0 12px rgb(${AMBER} / 0.5)`
          }}
        />

        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: `rgb(${AMBER})`,
                boxShadow: `0 0 8px rgb(${AMBER} / 0.7)`
              }}
            />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">CRIBBLE PREMIUM</span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="h-4 w-4">
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {/* ---- celebration lockup ---- */}
          <div
            className="rounded-xl px-5 pb-5 pt-6 text-center"
            style={{
              border: `1px solid rgb(${AMBER} / 0.25)`,
              background: `linear-gradient(180deg, rgb(${AMBER} / 0.07), transparent 65%)`
            }}
          >
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl liquid-glass-inset">
              <VerifiedBadge size={44} />
            </span>
            <h2
              className="mt-4 text-base leading-snug [font-family:var(--font-pixel)]"
              style={{
                color: VERIFIED_BLUE,
                textShadow:
                  '0 0 18px rgba(29,155,240,0.45), 0 0 46px rgba(29,155,240,0.2)'
              }}
            >
              YOU&apos;RE VERIFIED
            </h2>
            <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
              The blue check is live next to your name.
            </p>
            <span
              className="mt-3.5 inline-block rounded border px-2 py-1 text-[8px] tracking-[0.3em]"
              style={{
                color: `rgb(${AMBER})`,
                borderColor: `rgb(${AMBER} / 0.4)`,
                background: `rgb(${AMBER} / 0.06)`
              }}
            >
              PREMIUM SINCE {formatPremiumSince(premiumSince)}
            </span>
          </div>

          {/* ---- the kit ---- */}
          <div className="mt-4">
            <div className="px-1.5 pb-1.5 text-[8px] tracking-[0.35em] text-zinc-600">
              YOUR FULL KIT
            </div>
            <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.02]">
              {PREMIUM_PERKS.map((perk) => (
                <li key={perk.label} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="shrink-0" style={{ color: `rgb(${AMBER} / 0.85)` }}>
                    <StrokeIcon d={perk.icon} className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs leading-relaxed text-zinc-300">{perk.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ---- CTAs ---- */}
          <div className="mt-5 space-y-2.5">
            <Link
              href="/leaderboard"
              className="block w-full rounded-lg px-4 py-3 text-center text-[10px] tracking-[0.3em] transition-colors"
              style={{
                color: `rgb(${AMBER})`,
                border: `1px solid rgb(${AMBER} / 0.45)`,
                background: `rgb(${AMBER} / 0.08)`,
                boxShadow: `0 0 24px -10px rgb(${AMBER} / 0.5)`
              }}
            >
              SEE IT ON THE BOARD <span aria-hidden>→</span>
            </Link>
            <a
              href="/api/portal"
              className="block w-full rounded-lg border border-white/[0.08] px-4 py-2.5 text-center text-[9px] tracking-[0.3em] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            >
              MANAGE SUBSCRIPTION
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
