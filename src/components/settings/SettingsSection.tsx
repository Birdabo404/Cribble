'use client'

import type { ReactNode } from 'react'

export interface SettingsSectionProps {
  title: string
  description?: ReactNode
  children: ReactNode
}

/**
 * Section wrapper: heading + optional muted description above a bordered
 * panel card. Direct children (usually SettingsRow) are divided by
 * hairlines. Stack multiple sections with a `space-y-*` parent.
 */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-text)]">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            {description}
          </p>
        )}
      </div>
      <div className="divide-y divide-[color:var(--st-border)] rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] [box-shadow:var(--st-panel-shadow)]">
        {children}
      </div>
    </section>
  )
}
