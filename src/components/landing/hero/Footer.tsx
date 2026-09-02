'use client'

// Hero footer — the manifest's bottom strip: legal links left, the
// privacy stance and the credit line right. Cells draw their own left
// hairline (top hairline when stacked below sm); the strip's top rule is
// its own border so nothing doubles against the compartments above.

import Link from 'next/link'

const CELL = 'flex items-center py-3.5 border-[color:var(--lx-line)]'
const LINK =
  'text-[color:var(--lx-ink-dim)] transition-colors hover:text-[color:var(--lx-ink)]'

export function Footer() {
  return (
    <footer
      data-hero-enter
      className="lx-hero-exit flex flex-col border-t border-[color:var(--lx-line)] font-data text-[length:var(--fs-label)] tracking-[0.2em] text-[color:var(--lx-ink-dim)] sm:flex-row sm:items-stretch"
    >
      <div data-hero-cell className={`${CELL} gap-x-3 pr-5`}>
        <span>CRIBBLE · 2026</span>
        <span aria-hidden>·</span>
        <Link href="/privacy" className={LINK}>
          PRIVACY
        </Link>
        <span aria-hidden>·</span>
        <Link href="/status" className={LINK}>
          STATUS
        </Link>
      </div>

      <div
        data-hero-cell
        className={`${CELL} hidden whitespace-nowrap border-l px-5 lg:ml-auto lg:flex`}
      >
        <Link href="/privacy" className={LINK}>
          WE COUNT SHOWING UP, NOT WHAT YOU SAY.
        </Link>
      </div>

      <div
        data-hero-cell
        className={`${CELL} flex-wrap gap-x-2 gap-y-1 border-t sm:ml-auto sm:border-l sm:border-t-0 sm:pl-5 lg:ml-0`}
      >
        <span>BUILT BY</span>
        <a
          href="https://x.com/birdabo"
          target="_blank"
          rel="noreferrer"
          aria-label="@birdabo on X"
          className={`inline-flex items-center gap-1.5 ${LINK}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatars/birdabo.jpg"
            alt=""
            width={14}
            height={14}
            className="size-3.5 object-cover"
          />
          <span>@BIRDABO</span>
        </a>
        <span>WITH</span>
        <a
          href="https://cursor.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Cursor"
          className={`inline-flex items-center gap-1.5 ${LINK}`}
        >
          <CursorMark />
          <span>CURSOR</span>
        </a>
      </div>
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
