'use client'

import type { ReactNode } from 'react'

export interface SettingsRowProps {
  label: ReactNode
  description?: ReactNode
  /** Control slot, rendered on the right. */
  children?: ReactNode
  /**
   * Stack the control under the label on narrow viewports — use for wide
   * controls (text fields, segmented controls). Compact controls
   * (switches, small buttons) should stay inline.
   */
  stack?: boolean
}

export function SettingsRow({ label, description, children, stack = false }: SettingsRowProps) {
  return (
    <div
      className={
        stack
          ? 'flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5 sm:py-4'
          : 'flex items-center justify-between gap-6 px-4 py-3.5 sm:px-5 sm:py-4'
      }
    >
      <div className="min-w-0">
        <div className="text-[15px] leading-6 text-[color:var(--st-text)]">{label}</div>
        {description && (
          <div className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            {description}
          </div>
        )}
      </div>
      {children !== undefined && (
        <div className={stack ? 'w-full sm:w-auto sm:shrink-0' : 'shrink-0'}>{children}</div>
      )}
    </div>
  )
}
