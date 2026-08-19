'use client'

import type { ReactNode } from 'react'

// Column table for where columns actually help (audit, trends depth,
// waitlist). Cell chrome (hairline borders, microlabel header, tabular
// nums) comes from the .ad-table rules in globals.css — pages emit plain
// <tr>/<td> children. Meant to sit inside a flush AdminSection.

export interface AdminTableColumn {
  label: ReactNode
  align?: 'left' | 'right'
  className?: string
}

export interface AdminTableProps {
  columns: readonly AdminTableColumn[]
  /**
   * Sticks the header row while the page scrolls. Only effective when the
   * table is not horizontally overflowing (sticky cannot escape a scroll
   * container, so this disables the overflow-x wrapper).
   */
  stickyHeader?: boolean
  className?: string
  /** <tr> rows; cells are styled by the scope's .ad-table rules. */
  children: ReactNode
}

export function AdminTable({
  columns,
  stickyHeader = false,
  className = '',
  children
}: AdminTableProps) {
  return (
    <div className={`${stickyHeader ? '' : 'overflow-x-auto'} ${className}`}>
      <table className="ad-table">
        <thead className={stickyHeader ? 'ad-table-sticky' : undefined}>
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                className={`${column.align === 'right' ? 'text-right' : 'text-left'} ${column.className ?? ''}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
