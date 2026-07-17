'use client'

import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTheme } from 'next-themes'

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => void
}

function ThemeIcon({ isLight, className = 'h-3 w-3' }: { isLight: boolean; className?: string }) {
  return isLight ? (
    // sun icon
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ) : (
    // moon icon
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

/**
 * DARK / LIGHT toggle styled to match the terminal chrome.
 * Renders a fixed-size placeholder until mounted to avoid hydration
 * mismatch (next-themes resolves the theme client-side only).
 * Theme switches crossfade via the View Transitions API where available
 * (falls back to an instant swap elsewhere / under reduced motion).
 *
 * variant 'chip' is the standalone bordered button; 'rail' renders as a
 * command-rail row (icon column + clipped label, tooltip when collapsed).
 */
export function ThemeToggle({
  className = '',
  variant = 'chip'
}: {
  className?: string
  variant?: 'chip' | 'rail'
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isLight = mounted && resolvedTheme === 'light'

  const toggleTheme = () => {
    const next = isLight ? 'dark' : 'light'
    const doc = document as DocumentWithViewTransition
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (typeof doc.startViewTransition === 'function' && !reduceMotion) {
      // flushSync ensures next-themes applies the html class inside the
      // transition callback, so old/new snapshots differ and crossfade.
      doc.startViewTransition(() => {
        flushSync(() => setTheme(next))
      })
    } else {
      setTheme(next)
    }
  }

  const ariaLabel = isLight ? 'Switch to dark mode' : 'Switch to light mode'

  if (variant === 'rail') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="nav-row relative mx-2 flex h-10 w-[calc(100%-16px)] shrink-0 items-center rounded-lg font-mono text-zinc-400 transition-colors duration-150 hover:bg-white/[0.05] hover:text-zinc-100 active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
      >
        <span className="flex w-12 shrink-0 items-center justify-center">
          {mounted && <ThemeIcon isLight={isLight} className="h-[15px] w-[15px]" />}
        </span>
        <span className="nav-label-clip">
          <span className="nav-label text-[10px] tracking-[0.25em]">
            {mounted ? (isLight ? 'LIGHT' : 'DARK') : ''}
          </span>
        </span>
        <span className="nav-tip glass-pop rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.3em] text-zinc-200">
          THEME
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`flex items-center gap-1.5 text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 text-zinc-300 transition-[color,background-color,border-color,transform] duration-150 hover:border-zinc-600 hover:bg-white/[0.04] hover:text-zinc-100 active:scale-[0.98] active:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 font-mono ${className}`}
    >
      {!mounted ? (
        <span className="opacity-0">DARK</span>
      ) : (
        <>
          <ThemeIcon isLight={isLight} />
          {isLight ? 'LIGHT' : 'DARK'}
        </>
      )}
    </button>
  )
}
