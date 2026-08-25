'use client'

// Landing hero header — wordmark, theme toggle, and the X/GitHub links.
// Extracted verbatim from src/app/page.tsx.

import { ACCENT } from '@/lib/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LiquidMark } from '@/components/brand/LiquidMark'

export function Header() {
  return (
    <header className="pt-6 sm:pt-8 flex items-center justify-between">
      <div className="flex items-center gap-2.5 text-sm tracking-[0.3em] sm:tracking-[0.4em] text-zinc-100 font-semibold">
        <LiquidMark size={22} />
        <span>
          CRIBBLE
          <span style={{ color: ACCENT }}>.</span>
        </span>
      </div>
      <nav className="flex items-center gap-1">
        <ThemeToggle className="mr-2" />
        <a
          href="https://x.com/cribble_ai"
          target="_blank"
          rel="noreferrer"
          aria-label="X"
          className="p-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <TwitterMark />
        </a>
        <a
          href="https://github.com/Birdabo404/Cribble"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="p-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <GithubMark />
        </a>
      </nav>
    </header>
  )
}

function GithubMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5C5.73.5.92 5.31.92 11.58c0 4.88 3.16 9.01 7.55 10.47.55.1.75-.24.75-.53 0-.26-.01-.95-.02-1.86-3.07.67-3.72-1.48-3.72-1.48-.5-1.27-1.23-1.6-1.23-1.6-1-.69.08-.67.08-.67 1.11.08 1.7 1.14 1.7 1.14.99 1.69 2.6 1.2 3.23.92.1-.72.39-1.2.7-1.48-2.45-.28-5.03-1.23-5.03-5.48 0-1.21.43-2.2 1.14-2.97-.11-.28-.5-1.42.11-2.96 0 0 .93-.3 3.05 1.13a10.6 10.6 0 0 1 2.78-.37c.94 0 1.89.13 2.78.37 2.12-1.43 3.05-1.13 3.05-1.13.61 1.54.22 2.68.11 2.96.71.77 1.14 1.76 1.14 2.97 0 4.26-2.58 5.19-5.04 5.46.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.06 0 .29.2.64.76.53 4.38-1.46 7.54-5.59 7.54-10.47C23.08 5.31 18.27.5 12 .5Z" />
    </svg>
  )
}

function TwitterMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M18.244 2H21l-6.52 7.45L22 22h-6.835l-4.79-6.272L4.8 22H2l6.99-7.99L2 2h7.012l4.33 5.741L18.244 2Zm-2.397 18.3h1.66L7.27 3.6H5.49l10.357 16.7Z" />
    </svg>
  )
}
