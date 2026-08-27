import type { Metadata } from 'next'
import { VoidScreen } from '@/components/system/VoidScreen'

export const metadata: Metadata = {
  title: 'Not Found — Cribble',
  description: 'No Cribble route exists at these coordinates.',
  robots: { index: false, follow: false },
}

// Global 404 — any uncharted route drops the visitor into the void scene.
export default function NotFound() {
  return <VoidScreen variant="not-found" />
}
