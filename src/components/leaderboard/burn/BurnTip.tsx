'use client'

// A caption for a mark that does not explain itself — the verified check,
// the team logo. Hover or focus prints a square hairline bubble above it
// in the slab's mono register; `title` keeps the native fallback for
// touch long-press, and aria-describedby hands the same text to a reader.
// The wrapper is focusable itself only when its child is not (the badge
// is an <svg>; the team logo is already an <a>).

import { useId, type ReactNode } from 'react'

export function BurnTip({
  text,
  focusable = false,
  children
}: {
  text: string
  focusable?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <span className="bb-tip" title={text} tabIndex={focusable ? 0 : undefined} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="bb-tip-bubble">
        {text}
      </span>
    </span>
  )
}
