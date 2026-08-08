// /billboard — the buyer side of the Billboard ad train: the pitch, the
// submission composer with its live-preview card, and the status tracker
// for review feedback, live windows and click counts. Same shape as
// /teams: a server wrapper that owns the metadata, with everything
// visible in client components under src/components/billboard/.

import type { Metadata } from 'next'
import { BillboardLanding } from '@/components/billboard/BillboardLanding'
import { BILLBOARD_RAIL_PRICE_MIN_CENTS } from '@/lib/billboard'

const TITLE = 'Get on the Billboard — Cribble'
const DESCRIPTION =
  'Your logo, one line, and one link — on the leaderboard, dashboard, and every profile page ' +
  `for 7 days. From $${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100} a week, every card reviewed by a human.`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: '/billboard',
    siteName: 'Cribble',
    images: [{ url: '/preview.png' }]
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/preview.png']
  }
}

export default function BillboardPage() {
  return <BillboardLanding />
}
