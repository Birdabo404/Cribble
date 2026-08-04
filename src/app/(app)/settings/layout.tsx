// Settings hub shell. Everything inside lives in the .settings-scope
// monochrome design system (see globals.css) — components style with the
// scoped --st-* tokens only, never zinc/gray utilities (light mode remaps
// those to warm cream values; this surface stays pure neutral).

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import { SettingsMobileTabs, SettingsSidebar } from '@/components/settings'

// Loaded here (not the root layout) so the rest of the site keeps its
// existing type stack; exposed to the scope as --font-settings.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-settings',
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'Settings - Cribble'
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`settings-scope ${geist.variable}`}>
      <div className="mx-auto w-full max-w-[960px] px-4 pb-24 sm:px-6">
        <header className="pb-6 pt-8 md:pt-12">
          <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.01em] text-[color:var(--st-text)]">
            Settings
          </h1>
          <p className="mt-1 text-[14px] leading-5 text-[color:var(--st-text-muted)]">
            Manage your account, preferences, and subscription.
          </p>
        </header>

        <SettingsMobileTabs />

        <div className="pt-4 md:flex md:gap-12 md:pt-2">
          <SettingsSidebar />
          <main className="min-w-0 flex-1 md:max-w-[640px]">{children}</main>
        </div>
      </div>
    </div>
  )
}
