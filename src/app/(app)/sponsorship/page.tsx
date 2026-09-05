// /sponsorship — the buyer side of the sponsorship ad train: the pitch,
// the submission composer with its live-preview card, and the status
// tracker for review feedback, live windows and click counts. Same shape
// as /teams: a server wrapper that owns the metadata, with everything
// visible in client components under src/components/billboard/.

import type { Metadata } from 'next'
import { BillboardLanding } from '@/components/billboard/BillboardLanding'
import { BILLBOARD_RAIL_PRICE_MIN_CENTS } from '@/lib/billboard'

const TITLE = 'Sponsorship — Cribble'
const DESCRIPTION =
  'Your logo, one line, and one link — on the leaderboard, dashboard, and every profile page ' +
  `for 7 days. From $${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100} a week, every card reviewed by a human.`

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
    url: '/sponsorship',
    siteName: 'Cribble',
    images: [
      {
        url: '/opengraph-image.png',
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
    images: ['/opengraph-image.png']
  }
}

export default function SponsorshipPage() {
  return <BillboardLanding />
}
