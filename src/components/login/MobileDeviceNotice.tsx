'use client'

import { useEffect, useState } from 'react'

/**
 * Shown on /login to touch-only devices (phones, tablets). The cribble
 * browser extension only installs on desktop browsers, so mobile visitors
 * get a heads-up to switch to a laptop or PC before they sign in.
 *
 * Detection uses `hover: none` + `pointer: coarse` instead of viewport
 * width, so a narrow desktop window is never flagged and touchscreen
 * laptops (which also expose a fine pointer) stay exempt.
 */

const DISMISS_KEY = 'cribble-login-mobile-notice-dismissed'
const MOBILE_QUERY = '(hover: none) and (pointer: coarse)'

export function MobileDeviceNotice() {
  // Resolved in an effect so SSR and the first client render agree.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      // storage unavailable (private mode) — just show the notice
    }
    if (dismissed) return

    const mql = window.matchMedia(MOBILE_QUERY)
    const update = () => setVisible(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  const dismiss = () => {
    setVisible(false)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // best effort — worst case the notice reappears next visit
    }
  }

  if (!visible) return null

  return (
    <div
      role="note"
      className="lg-rise glass-pop mb-6 flex items-start gap-3 rounded-xl px-4 py-3.5"
      style={{ ['--d' as string]: '200ms' }}
    >
      <LaptopIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] tracking-[0.24em] text-zinc-300">
          BETTER ON A LAPTOP
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          cribble tracks your AI usage through a browser extension that
          isn&apos;t available on mobile. For the full experience, please
          switch to a PC or laptop.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="-m-1 shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-200"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function LaptopIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
