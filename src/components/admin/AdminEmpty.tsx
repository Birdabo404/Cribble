'use client'

import type { ReactNode } from 'react'

// Empty state: name the gap, one sentence of context, optionally the next
// action. No illustrations.

export interface AdminEmptyProps {
  title: string
  /** One sentence naming the next action or why the list is empty. */
  hint?: string
  action?: ReactNode
}

export function AdminEmpty({ title, hint, action }: AdminEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-[13.5px] font-medium leading-5 text-[color:var(--st-text)]">{title}</p>
      {hint && (
        <p className="mt-1 max-w-sm text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          {hint}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
