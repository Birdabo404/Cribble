'use client'

import type { ReactNode } from 'react'

// The one section container for the console: header (title + optional
// count, description, right-aligned link/button) above a bordered
// rounded-xl panel on --st-panel. Lists and tables set flush to own the
// panel's inner geometry; forms and fact grids keep the default padding.

export interface AdminSectionProps {
  title?: string
  /** Muted count rendered next to the title (queue sizes). */
  count?: number
  description?: string
  /** Right-aligned header link/button. */
  action?: ReactNode
  /** Remove panel padding for flush children (AdminList / AdminTable). */
  flush?: boolean
  children: ReactNode
}

export function AdminSection({
  title,
  count,
  description,
  action,
  flush = false,
  children
}: AdminSectionProps) {
  const hasHeader = Boolean(title || description || action)
  return (
    <section>
      {hasHeader && (
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
                {title}
                {count !== undefined && (
                  <span className="ml-2 font-data text-[11px] font-medium tabular-nums text-[color:var(--st-text-faint)]">
                    {count}
                  </span>
                )}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
                {description}
              </p>
            )}
          </div>
          {action && (
            <div className="flex shrink-0 items-center gap-2 text-[12.5px] leading-5">
              {action}
            </div>
          )}
        </div>
      )}
      <div
        className={`rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] shadow-[var(--st-panel-shadow)] ${
          flush ? 'overflow-hidden' : 'p-4 sm:p-5'
        }`}
      >
        {children}
      </div>
    </section>
  )
}
