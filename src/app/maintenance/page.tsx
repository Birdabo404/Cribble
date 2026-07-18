import type { Metadata } from 'next'
import { VoidScreen } from '@/components/system/VoidScreen'

// Maintenance / coming-soon screen. While the site lock is on, the
// middleware rewrites locked sectors (e.g. /shop in production) here, so
// the visitor keeps their URL but sees the sealed-sector scene.
export const metadata: Metadata = {
  title: 'Under Construction — Cribble',
  description: 'This sector is sealed for outfitting. Check back soon.',
  robots: { index: false, follow: false },
}

export default function MaintenancePage() {
  return <VoidScreen variant="maintenance" />
}
