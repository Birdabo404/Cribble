'use client'

export interface SkeletonProps {
  /** Size/shape via Tailwind classes, e.g. "h-3.5 w-32 rounded-full". */
  className?: string
}

/** Pulsing placeholder block. */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-md bg-[color:var(--st-border)] ${className}`}
    />
  )
}

/**
 * Row-shaped loading state matching SettingsRow geometry (label +
 * description lines left, control blob right). Drop inside a
 * SettingsSection while data loads.
 */
export function SkeletonRow() {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-32 max-w-[45%]" />
        <Skeleton className="mt-2 h-3 w-56 max-w-[70%]" />
      </div>
      <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
    </div>
  )
}
