'use client'

// Floating FEEDBACK launcher, mounted once in the (app) layout so beta
// testers can report from any page. Bottom-LEFT on purpose: the Toaster
// stack owns the bottom-right corner (fixed bottom-5 right-5 z-[90]), so
// the launcher takes the opposite one. When the left command rail is
// active (md+ with position 'left') the button shifts past the rail via
// --nav-rail-w, gliding with the rail's own duration/easing on expand.
// z-[60] keeps it above page content but below portal modals (z-[80])
// and toasts (z-[90]). Like AppNav, renders nothing until mounted so
// the server markup never disagrees with the localStorage-seeded prefs.

import { useEffect, useState } from 'react'
import { useNavPrefs } from '@/components/nav/NavPrefsContext'
import { FeedbackModal } from './FeedbackModal'

export function FeedbackLauncher() {
  const prefs = useNavPrefs()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const railOffset =
    prefs?.position === 'left' ? 'md:left-[calc(var(--nav-rail-w)_+_1.25rem)]' : ''

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Send feedback"
        className={`group fixed bottom-5 left-5 z-[60] inline-flex h-9 items-center gap-2 rounded-full glass-pop px-4 font-mono text-[9px] tracking-[0.3em] text-zinc-300 [transition:left_560ms_var(--nav-ease),color_200ms_ease,box-shadow_300ms_ease] hover:text-zinc-50 hover:shadow-[var(--glass-shadow),inset_0_1px_0_var(--glass-highlight),0_0_18px_rgb(var(--accent-rgb)/0.18)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${railOffset}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 text-accent/80 transition-colors group-hover:text-accent"
          aria-hidden
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        FEEDBACK
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  )
}
