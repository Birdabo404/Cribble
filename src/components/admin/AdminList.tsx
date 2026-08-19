'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

// Divided row list — the console's primary queue surface. Rows are 12px
// vertical padding with a --st-panel-hover wash when interactive. Meant
// to sit inside a flush AdminSection.

export interface AdminListProps {
  children: ReactNode
  className?: string
}

export function AdminList({ children, className = '' }: AdminListProps) {
  return <ul className={`divide-y divide-[color:var(--st-border)] ${className}`}>{children}</ul>
}

export interface AdminListRowProps {
  /** Renders the row as a link. */
  href?: string
  /** Renders the row as a full-width button (ignored when href is set). */
  onClick?: () => void
  className?: string
  children: ReactNode
}

const ROW_BASE = 'flex w-full items-center gap-3 px-4 py-3 text-left'
const ROW_INTERACTIVE =
  'transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)]'

export function AdminListRow({ href, onClick, className = '', children }: AdminListRowProps) {
  if (href) {
    return (
      <li>
        <Link href={href} className={`${ROW_BASE} ${ROW_INTERACTIVE} ${className}`}>
          {children}
        </Link>
      </li>
    )
  }
  if (onClick) {
    return (
      <li>
        <button type="button" onClick={onClick} className={`${ROW_BASE} ${ROW_INTERACTIVE} ${className}`}>
          {children}
        </button>
      </li>
    )
  }
  return <li className={`${ROW_BASE} ${className}`}>{children}</li>
}
