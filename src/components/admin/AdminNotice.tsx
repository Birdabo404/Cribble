'use client'

import type { ReactNode } from 'react'

// Inline banner. warning = amber (needs attention / guard rails),
// danger = red (--st-danger, errors and destructive context),
// info = muted panel (neutral notes). Amber uses mid-saturation (600)
// utilities so one class string reads on both themes.

export type AdminNoticeTone = 'warning' | 'danger' | 'info'

export interface AdminNoticeProps {
  tone?: AdminNoticeTone
  className?: string
  children: ReactNode
}

function toneClasses(tone: AdminNoticeTone): string {
  switch (tone) {
    case 'warning':
      return 'border-amber-600/40 bg-amber-600/10 text-amber-600'
    case 'danger':
      return 'border-[color:var(--st-danger-muted)] bg-[color:var(--st-danger-bg)] text-[color:var(--st-danger)]'
    case 'info':
      return 'border-[color:var(--st-border)] bg-[color:var(--st-panel)] text-[color:var(--st-text-muted)]'
    default: {
      const exhaustive: never = tone
      return exhaustive
    }
  }
}

export function AdminNotice({ tone = 'info', className = '', children }: AdminNoticeProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={`rounded-lg border px-3.5 py-2.5 text-[13px] leading-5 ${toneClasses(tone)} ${className}`}
    >
      {children}
    </div>
  )
}
