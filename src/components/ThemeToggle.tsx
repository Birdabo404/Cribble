'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

/**
 * DARK / LIGHT toggle styled to match the terminal chrome.
 * Renders a fixed-size placeholder until mounted to avoid hydration
 * mismatch (next-themes resolves the theme client-side only).
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isLight = mounted && resolvedTheme === 'light'

  return (
    <button
      type="button"
      onClick={() => setTheme(isLight ? 'dark' : 'light')}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      className={`flex items-center gap-1.5 text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 transition-colors font-mono ${className}`}
    >
      {!mounted ? (
        <span className="opacity-0">DARK</span>
      ) : isLight ? (
        <>
          {/* sun icon */}
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          LIGHT
        </>
      ) : (
        <>
          {/* moon icon */}
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          DARK
        </>
      )}
    </button>
  )
}
