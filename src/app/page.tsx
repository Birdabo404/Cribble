// Thin server wrapper for the landing page: the interactive hero lives
// in the 'use client' HomeV2 component, and this shell exists so the
// route can export keyword-tuned metadata (client components can't).

import type { Metadata } from 'next'
import HomeV2 from '@/components/landing/HomeV2'

const TITLE = 'Cribble — AI Usage Leaderboard for Developers'
const DESCRIPTION =
  'The AI usage leaderboard: see how your time in Cursor, ChatGPT, Claude ' +
  'and 47 AI sites stacks up against developers worldwide. One quiet ' +
  'extension keeps score — install it, forget it, check your rank.'

export const metadata: Metadata = {
  // absolute: the homepage is the site name itself, so the '%s · Cribble'
  // template from the root layout must not apply here.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: '/',
    siteName: 'Cribble',
    images: [
      {
        url: '/preview.png',
        width: 1200,
        height: 789,
        alt: 'Cribble — a worldwide leaderboard for developers'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/preview.png']
  }
}

export default function Home() {
  return <HomeV2 />
}
