// /bag shell — exists only to carry the document title. The page is a
// client component, so metadata has to come from a server layout; the
// root template renders this as "Bag · Cribble". No chrome: the page owns
// its own composition.

import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Bag' }

export default function BagLayout({ children }: { children: ReactNode }) {
  return children
}
