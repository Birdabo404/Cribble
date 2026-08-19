'use client'

import type { ReactNode } from 'react'

// Page lead: title + one-line purpose + optional right-aligned action.
// Sentence case only.

export interface AdminPageHeaderProps {
  title: string
  /** One line on what the page answers or what actions here imply. */
  description?: string
  /** Right-aligned control(s), e.g. an AdminButton or a link. */
  action?: ReactNode
}

export function AdminPageHeader({ title, description, action }: AdminPageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[21px] font-semibold leading-7 tracking-[-0.01em] text-[color:var(--st-text)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[13.5px] leading-5 text-[color:var(--st-text-muted)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  )
}
