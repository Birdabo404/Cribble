'use client'

// Underlined tool-name chip in the hero copy.
// Extracted verbatim from src/app/page.tsx.

import { ReactNode } from 'react'

export function ToolChip({ children }: { children: ReactNode }) {
  return (
    <span className="font-medium text-zinc-200 border-b border-zinc-700/70">
      {children}
    </span>
  )
}
