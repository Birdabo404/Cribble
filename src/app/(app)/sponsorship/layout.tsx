// /sponsorship shell — the buyer page renders in the .settings-scope
// monochrome design system, whose font stack reads var(--font-settings).
// That variable only exists where a layout injects Geist (settings,
// admin), so without this file the page silently falls back to
// system-ui. Same pattern as src/app/(app)/settings/layout.tsx, minus
// the chrome: no header, sidebar or max-width — the page component owns
// its own composition, and page.tsx owns the metadata.

import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'

// Loaded here (not the root layout) so the rest of the site keeps its
// existing type stack; exposed to the scope as --font-settings.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-settings',
  display: 'swap'
})

export default function SponsorshipLayout({ children }: { children: ReactNode }) {
  return <div className={`settings-scope ${geist.variable}`}>{children}</div>
}
