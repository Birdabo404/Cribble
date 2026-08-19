'use client'

import { Skeleton } from '@/components/settings/Skeleton'

// Queue-shaped loading state: avatar + two text lines per row, matching
// AdminList row geometry so panels don't jump when the data lands. Drop
// inside a flush AdminSection (or any panel) while a list loads.

export interface AdminSkeletonListProps {
  /** Number of placeholder rows. */
  rows?: number
}

export function AdminSkeletonList({ rows = 4 }: AdminSkeletonListProps) {
  return (
    <div aria-hidden className="divide-y divide-[color:var(--st-border)]">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40 max-w-[55%]" />
            <Skeleton className="mt-2 h-3 w-64 max-w-[80%]" />
          </div>
        </div>
      ))}
    </div>
  )
}
