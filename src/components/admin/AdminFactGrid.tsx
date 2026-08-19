'use client'

import type { ReactNode } from 'react'

// Label/value grid for dossier facts (created, last login, score…).
// Labels are font-data microlabels; values stay 13px ink.

export interface AdminFact {
  label: string
  value: ReactNode
}

export interface AdminFactGridProps {
  facts: readonly AdminFact[]
  /** Column count at full width; collapses to 2 on small screens. */
  columns?: 2 | 3 | 4
  className?: string
}

function columnClasses(columns: 2 | 3 | 4): string {
  switch (columns) {
    case 2:
      return 'grid-cols-2'
    case 3:
      return 'grid-cols-2 sm:grid-cols-3'
    case 4:
      return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
    default: {
      const exhaustive: never = columns
      return exhaustive
    }
  }
}

export function AdminFactGrid({ facts, columns = 3, className = '' }: AdminFactGridProps) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${columnClasses(columns)} ${className}`}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
            {fact.label}
          </dt>
          <dd className="mt-1 truncate text-[13px] leading-5 text-[color:var(--st-text)]">
            {fact.value ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}
