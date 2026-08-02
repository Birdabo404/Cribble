import type { Metadata } from 'next'
import { VoidScreen } from '@/components/system/VoidScreen'

// Sign-in wall. While the site lock is on, the middleware rewrites
// session-gated sectors (e.g. /shop) here for signed-out visitors — the
// URL is preserved, so signing in and coming back lands on the real page.
export const metadata: Metadata = {
  title: 'Pilots Only — Cribble',
  description: 'This sector is reserved for registered pilots. Sign in to enter.',
  robots: { index: false, follow: false },
}

export default function RestrictedPage() {
  return <VoidScreen variant="restricted" />
}
