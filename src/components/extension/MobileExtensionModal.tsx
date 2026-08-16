'use client'

// One-time "tracking is desktop-only" notice for phone users, mounted by
// ExtensionGate. Purely informational — evaluateExtensionGate already lets
// non-capable browsers straight through — so there is deliberately no
// Chrome Web Store CTA here (it would be a dead link on this device), just
// an acknowledgement. Same portal/glass shell as PremiumWelcomeModal;
// under `sm` it docks to the bottom edge as a safe-area-padded sheet.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export function MobileExtensionModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portaled to <body>: nav chrome uses backdrop-filter, which would trap
  // a fixed overlay inside it. z-[80] sits on the app's modal layer, same
  // as PremiumWelcomeModal / EditProfileModal.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center font-mono sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="The tracking extension runs on desktop Chrome only"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl glass-pop sm:rounded-2xl"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] py-1.5 pl-5 pr-1.5">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-ember/50 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ember shadow-[0_0_8px_rgb(var(--ember-rgb)/0.7)]" />
            </span>
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">CRIBBLE ENGINE</span>
          </div>
          {/* h-11/w-11 = 44px tap target — phones are the only audience. */}
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-200"
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

        <div className="px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <h2 className="text-sm leading-snug text-zinc-100">
            Tracking runs on desktop Chrome only.
          </h2>
          <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
            The cribble-engine extension can&apos;t install on this device. Your
            stats, the leaderboard, the store, and your profile all work right
            here — tracking picks back up the next time you open Cribble on
            desktop Chrome.
          </p>
          <button
            onClick={onClose}
            className="mt-5 flex min-h-[44px] w-full items-center justify-center rounded-lg border border-ember/40 bg-ember/10 px-4 py-3 text-[10px] tracking-[0.3em] text-ember transition-colors hover:bg-ember hover:text-black"
          >
            GOT IT
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
