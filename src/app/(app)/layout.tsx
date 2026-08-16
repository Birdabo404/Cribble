// Authenticated app shell — persists across /dashboard, /leaderboard,
// /dashboard/achievements, and /profile so the navigation chrome never
// remounts on route changes. Marketing/onboarding pages (/, /login,
// /welcome) intentionally keep their own chrome outside this group.

import { AppShell } from '@/components/nav/AppShell'
import { FeedbackLauncher } from '@/components/feedback/FeedbackLauncher'
import { Toaster } from '@/components/Toaster'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      {/* Mounted once for every (app) route so toasts fired from any page
          (sync results, achievements, notifications) always render. */}
      <Toaster />
      {/* Beta feedback button — floats bottom-left on every (app) page,
          opposite the Toaster so reports and toasts never collide. */}
      <FeedbackLauncher />
    </AppShell>
  )
}
