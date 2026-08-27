// Staff console shell. Everything under /admin lives in the .admin-scope
// design system (see globals.css) — the same --st-* monochrome tokens as
// the settings hub, so both themes are first-class. The client AdminFrame
// owns the access gate (/api/admin/me), the rail/topbar chrome, and the
// staff identity context; pages just render their content via useAdmin().

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import { AdminFrame } from '@/components/admin/AdminShell'

// Loaded here (not the root layout) so the rest of the site keeps its
// existing type stack; exposed to the scope as --font-settings — shared
// with the settings modal, whose (app) layout loads the identical face.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-settings',
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'Staff - Cribble'
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`admin-scope ${geist.variable}`}>
      <AdminFrame>{children}</AdminFrame>
    </div>
  )
}
