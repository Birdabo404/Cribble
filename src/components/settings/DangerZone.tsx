'use client'

import type { ReactNode } from 'react'

export interface DangerZoneProps {
  title?: string
  description?: ReactNode
  children: ReactNode
}

/**
 * Panel variant for destructive actions: danger-tinted heading + border,
 * rows divided like a regular section card.
 */
export function DangerZone({ title = 'Danger zone', description, children }: DangerZoneProps) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold leading-6 text-[color:var(--st-danger)]">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            {description}
          </p>
        )}
      </div>
      <div className="divide-y divide-[color:var(--st-border)] rounded-xl border border-[color:var(--st-danger-muted)] bg-[color:var(--st-panel)] [box-shadow:var(--st-panel-shadow)]">
        {children}
      </div>
    </section>
  )
}
