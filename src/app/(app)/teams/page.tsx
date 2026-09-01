// /teams — the Cribble Team surface. Public and shareable (it sits on the
// site-lock allowlist), so this wrapper is a server component that owns
// the page metadata; everything visible lives in client components under
// src/components/teams/. The page is adaptive: TeamsHub probes the
// viewer's account and shows TEAM-tier companies their command deck,
// while everyone else gets the Team-plan buy page. (The recruitment
// board lives on the TEAMS leaderboard's HIRING tab, not here.) The
// /team console (singular) stays the private roster surface for
// accounts that already fly colors.

import type { Metadata } from 'next'
import { TeamsHub } from '@/components/teams/TeamsHub'

const TITLE = 'Cribble Team — Fly Company Colors'
const DESCRIPTION =
  'Put your company on the board. One account becomes the team: the gold badge, the square mark, and up to ten pilots wearing your clickable logo. Every team verified by hand.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Unfurl image: the generated root card (src/app/opengraph-image.tsx),
  // referenced explicitly — defining openGraph here replaces the parent's
  // whole openGraph object, so the root file-based image does NOT cascade
  // into this page (Next merges metadata shallowly, by design).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: '/teams',
    siteName: 'Cribble',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Cribble — a worldwide leaderboard for AI users.'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/opengraph-image']
  }
}

export default function TeamsPage() {
  return <TeamsHub />
}
