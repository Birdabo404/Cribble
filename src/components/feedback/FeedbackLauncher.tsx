'use client'

// Floating trigger for mobile and top-navigation layouts. Desktop left-rail
// layouts own feedback inside NavRail instead, keeping this global utility out
// of the page-content coordinate plane. The Toaster retains bottom-right.

import { useEffect, useState } from 'react'
import { useNavPrefs } from '@/components/nav/NavPrefsContext'
import { useFeedback } from './FeedbackContext'

export function FeedbackIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function FeedbackLauncher() {
  const prefs = useNavPrefs()
  const { openFeedback } = useFeedback()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted || !prefs) return null

  return (
    <button
      type="button"
      onClick={openFeedback}
      aria-haspopup="dialog"
      aria-label="Send feedback"
      className={`group fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-[max(1.25rem,env(safe-area-inset-left))] z-[60] inline-flex h-9 items-center gap-2 rounded-full glass-pop px-4 font-mono text-[9px] tracking-[0.3em] text-zinc-300 transition-[color,box-shadow] duration-200 hover:text-zinc-50 hover:shadow-[var(--glass-shadow),inset_0_1px_0_var(--glass-highlight),0_0_18px_rgb(var(--accent-rgb)/0.18)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${prefs.position === 'left' ? 'md:hidden' : ''}`}
    >
      <FeedbackIcon className="h-3.5 w-3.5 text-accent/80 transition-colors group-hover:text-accent" />
      FEEDBACK
    </button>
  )
}
