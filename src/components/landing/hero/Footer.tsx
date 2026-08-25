'use client'

// Landing hero footer — legal links plus the "built by" credit line.
// Extracted verbatim from src/app/page.tsx.

import Link from 'next/link'

export function Footer() {
  return (
    <footer className="pb-6 pt-10 flex flex-col items-start gap-3 text-[10px] tracking-[0.22em] text-zinc-600 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-2 sm:tracking-[0.3em]">
      <span className="inline-flex items-center gap-4">
        <span>CRIBBLE · 2026</span>
        <Link
          href="/privacy"
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          PRIVACY
        </Link>
        <Link
          href="/status"
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          STATUS
        </Link>
      </span>

      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 tracking-[0.22em] sm:tracking-[0.25em]">
        <span>BUILT BY</span>
        <a
          href="https://x.com/birdabo"
          target="_blank"
          rel="noreferrer"
          aria-label="@birdabo on X"
          className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatars/birdabo.jpg"
            alt=""
            width={14}
            height={14}
            className="size-3.5 rounded-full object-cover"
          />
          <span>@BIRDABO</span>
        </a>
        <span>WITH</span>
        <a
          href="https://cursor.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Cursor"
          className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <CursorMark />
          <span>CURSOR</span>
        </a>
      </span>
    </footer>
  )
}

function CursorMark({ size = 12 }: { size?: number }) {
  // Cursor's official mark (same Simple Icons path the tool icons use),
  // monochrome via currentColor so the link hover tint carries through.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
        fill="currentColor"
      />
    </svg>
  )
}
