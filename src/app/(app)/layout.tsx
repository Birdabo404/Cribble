// Authenticated app shell — persists across /dashboard, /leaderboard,
// /dashboard/achievements, and /profile so the navigation chrome never
// remounts on route changes. Marketing/onboarding pages (/, /login,
// /welcome) intentionally keep their own chrome outside this group.

import { Geist } from 'next/font/google'
import { AppShell } from '@/components/nav/AppShell'
import { ExtensionGate } from '@/components/ExtensionGate'
import { FeedbackLauncher } from '@/components/feedback/FeedbackLauncher'
import { FeedbackProvider } from '@/components/feedback/FeedbackContext'
import { SettingsModalHost } from '@/components/settings/SettingsModalHost'
import { SettingsModalProvider } from '@/components/settings/SettingsModalContext'
import { Toaster } from '@/components/Toaster'

// The settings modal's type stack (was loaded by the deleted /settings
// layout). Loaded here — not the root layout — so only (app) pages carry
// it; exposed to the modal's .settings-scope as --font-settings.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-settings',
  display: 'swap'
})

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // Provider sits OUTSIDE AppShell so the nav chrome it renders
    // (AccountMenu, NotificationBell) can open the settings modal.
    <SettingsModalProvider>
      <FeedbackProvider>
        <AppShell>
          {/* Hard extension wall: signed-in users whose extension is required
              but missing get bounced to the /welcome install stage. Checks once
              per app entry since this layout persists across (app) routes. */}
          <ExtensionGate>{children}</ExtensionGate>
          {/* Mounted once for every (app) route so toasts fired from any page
              (sync results, achievements, notifications) always render. */}
          <Toaster />
          {/* Floating only for mobile/top-nav; desktop left-nav owns its trigger. */}
          <FeedbackLauncher />
          {/* Settings modal — mounted INSIDE AppShell (not next to the
              provider) so its Appearance section can reach the NavPrefs,
              BackgroundMusic, and theme providers. */}
          <SettingsModalHost fontVariable={geist.variable} />
        </AppShell>
      </FeedbackProvider>
    </SettingsModalProvider>
  )
}
