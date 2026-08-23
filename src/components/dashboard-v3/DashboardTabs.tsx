'use client'

// Route-backed tab strip shared by /dashboard and /dashboard/tokens.
// Plain links with aria-current (not role="tab"): each "tab" is a full
// page navigation, not an in-page panel switch.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { CSSProperties } from 'react'

interface DashboardTab {
  href: string
  label: string
  activeClassName: string
  /** TokenBoard's orange chip colors live outside the Tailwind palette,
   *  so the TOKENS active tint is applied as an inline style. */
  activeStyle?: CSSProperties
}

const TABS: DashboardTab[] = [
  {
    href: '/dashboard',
    label: 'CONSOLE',
    activeClassName: 'border-accent/30 bg-accent/[0.06] text-accent'
  },
  {
    href: '/dashboard/tokens',
    label: 'TOKENS',
    activeClassName: 'text-orange-300',
    activeStyle: {
      borderColor: 'rgb(251 146 60 / 0.35)',
      background: 'rgb(251 146 60 / 0.06)'
    }
  }
]

// Margin is the caller's concern: each page owns exactly one 24px gap
// under its banner (the tokens page already wraps this in an mt-6 div).
export function DashboardTabs({ className = '' }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Dashboard views"
      className={`mx-auto flex w-fit items-center gap-0.5 rounded-lg liquid-glass-inset p-0.5 ${className}`}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-[38px] items-center rounded-md border px-4 font-data text-[10px] tracking-[0.3em] transition-colors ${
              active
                ? tab.activeClassName
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
            style={active ? tab.activeStyle : undefined}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
