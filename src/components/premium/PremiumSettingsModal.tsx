'use client'

// The Cribble Premium settings screen (X-Premium style), opened from the
// account menu. Subscribers get a verified-badge status band ("Your blue
// check is live." + PREMIUM SINCE <MON YYYY>), the perk list, and
// quick-access rows (manage subscription / supply depot); free accounts
// get the blue-check upsell. Reads state from /api/user/cosmetics.
// Same portal/glass shell as MenuModal, kept self-contained.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { tierAccent } from '@/components/dashboard-v2/format'
import { AMBER, PREMIUM_PERKS, formatPremiumSince } from '@/components/premium/premium'
import { VERIFIED_BLUE, VerifiedBadge } from '@/components/premium/VerifiedBadge'

interface PremiumState {
  isPro: boolean
  premiumSince: string | null
}

/** Signed-out / failed fetch degrades to the upsell — the checkout and
 *  portal routes enforce auth themselves. */
const NEUTRAL_STATE: PremiumState = { isPro: false, premiumSince: null }

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

function SectionCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-1.5 pb-1.5 text-[8px] tracking-[0.35em] text-zinc-600">{label}</div>
      <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.02]">
        {children}
      </div>
    </div>
  )
}

function PerkRows() {
  return (
    <>
      {PREMIUM_PERKS.map((perk) => (
        <div key={perk.label} className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="shrink-0" style={{ color: `rgb(${AMBER} / 0.85)` }}>
            <StrokeIcon d={perk.icon} />
          </span>
          <span className="text-xs leading-relaxed text-zinc-300">{perk.label}</span>
        </div>
      ))}
    </>
  )
}

const quickRowCls =
  'group flex w-full items-center gap-3 px-3.5 py-3 text-left text-[10px] tracking-[0.3em] text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-zinc-50'
const quickArrowCls = 'ml-auto text-zinc-600 transition-colors group-hover:text-zinc-300'

export function PremiumSettingsModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<PremiumState | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/cosmetics', { cache: 'no-store', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.success) {
          setState({
            isPro: data.isPro === true,
            premiumSince: typeof data.premiumSince === 'string' ? data.premiumSince : null
          })
        } else {
          setState(NEUTRAL_STATE)
        }
      })
      .catch(() => {
        if (!cancelled) setState(NEUTRAL_STATE)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const renderBody = () => {
    if (state === null) {
      return (
        <div className="space-y-4 p-4" aria-busy="true">
          <span className="block h-[72px] animate-pulse rounded-xl bg-white/[0.05]" />
          <span className="block h-[180px] animate-pulse rounded-xl bg-white/[0.05]" />
          <span className="block h-[88px] animate-pulse rounded-xl bg-white/[0.05]" />
        </div>
      )
    }

    if (state.isPro) {
      return (
        <div className="space-y-4 p-4">
          {/* status band — the badge is the anchor, X "Verified since" style */}
          <div
            className="flex items-center gap-3.5 rounded-xl px-4 py-3.5"
            style={{
              border: `1px solid rgb(${AMBER} / 0.28)`,
              background: `linear-gradient(180deg, rgb(${AMBER} / 0.06), transparent 70%)`
            }}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg liquid-glass-inset">
              <VerifiedBadge size={28} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-[8px] tracking-[0.3em] ${tierAccent('PRO')}`}
                >
                  PREMIUM
                </span>
                <span className="text-xs text-zinc-300">Your blue check is live.</span>
              </div>
              <div className="mt-1.5 text-[9px] tracking-[0.3em] text-zinc-400">
                PREMIUM SINCE {formatPremiumSince(state.premiumSince)}
              </div>
            </div>
          </div>

          <SectionCard label="YOUR KIT">
            <PerkRows />
          </SectionCard>

          <SectionCard label="QUICK ACCESS">
            <a href="/api/portal" className={quickRowCls}>
              MANAGE SUBSCRIPTION
              <span className={quickArrowCls}>→</span>
            </a>
            <Link href="/shop" onClick={onClose} className={quickRowCls}>
              SUPPLY DEPOT
              <span className={quickArrowCls}>→</span>
            </Link>
          </SectionCard>
        </div>
      )
    }

    return (
      <div className="space-y-4 p-4">
        {/* upsell hero — the blue check is the pitch, X-Premium style */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 pb-4 pt-5 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl liquid-glass-inset">
            <VerifiedBadge size={40} />
          </span>
          <h3
            className="mt-3 text-sm leading-snug [font-family:var(--font-pixel)]"
            style={{
              color: VERIFIED_BLUE,
              textShadow:
                '0 0 18px rgba(29,155,240,0.45), 0 0 46px rgba(29,155,240,0.2)'
            }}
          >
            GET THE BLUE CHECK
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            Verified next to your name, everywhere it shows.
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
            Full pilot kit included. Cancel anytime.
          </p>
        </div>

        <SectionCard label="THE KIT">
          <PerkRows />
        </SectionCard>

        <div className="flex items-center justify-center gap-2">
          {['$6.99 / MO', '$49.99 / YR'].map((price) => (
            <span
              key={price}
              className="rounded border border-white/[0.08] bg-white/[0.02] px-2 py-1 text-[9px] tracking-[0.2em] text-zinc-400 [font-family:var(--font-pixel)]"
            >
              {price}
            </span>
          ))}
        </div>

        <Link
          href="/shop"
          onClick={onClose}
          className="block w-full rounded-lg px-4 py-3 text-center text-[10px] tracking-[0.3em] transition-colors"
          style={{
            color: `rgb(${AMBER})`,
            border: `1px solid rgb(${AMBER} / 0.45)`,
            background: `rgb(${AMBER} / 0.08)`,
            boxShadow: `0 0 24px -10px rgb(${AMBER} / 0.5)`
          }}
        >
          GO PREMIUM <span aria-hidden>→</span>
        </Link>
      </div>
    )
  }

  // Portaled to <body> for the same backdrop-filter containing-block
  // reason as MenuModal.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Cribble Premium"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
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
        {renderBody()}
      </div>
    </div>,
    document.body
  )
}
