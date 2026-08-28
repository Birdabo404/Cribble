import type { Metadata } from 'next'
import { VoidScreen } from '@/components/system/VoidScreen'

export const metadata: Metadata = {
  title: 'Profile not found — Cribble',
  description: 'This Cribble profile does not exist.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Profile not found — Cribble',
    description: 'This Cribble profile does not exist.',
    type: 'website'
  }
}

export default function ProfileNotFound() {
  return <VoidScreen variant="not-found" />
}
