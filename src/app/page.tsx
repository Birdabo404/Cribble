// Thin server wrapper for the landing page: the interactive hero lives
// in the 'use client' HomeV2 component, and this shell exists so the
// route can export keyword-tuned metadata (client components can't) and
// fetch the hero's live readings (player count, season, globe pins) on
// the server, where the service-role client lives.

import type { Metadata } from 'next'
import HomeV2 from '@/components/landing/HomeV2'
import { getLandingLive } from '@/lib/landingLive'

// ISR: the live readings are one Data Cache entry with the same 5-minute
// window (see landingLive.ts), so the page is rebuilt on the same beat
// and never rendered on the request path.
export const revalidate = 300

const TITLE = 'Cribble — AI Usage Leaderboard for Developers'
// <= 160 chars so search snippets and unfurls show the whole pitch.
const DESCRIPTION =
  'The AI usage leaderboard: see how your time in Cursor, ChatGPT and ' +
  'Claude stacks up against developers worldwide. One quiet extension ' +
  'keeps score.'

export const metadata: Metadata = {
  // absolute: the homepage is the site name itself, so the '%s · Cribble'
  // template from the root layout must not apply here.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  // og/twitter images come from the file-based src/app/opengraph-image.tsx
  // card — no explicit entry, or it would override the generated one.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: '/',
    siteName: 'Cribble'
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION
  }
}

export default async function Home() {
  // Never throws: every failure path is the all-null shape and HomeV2
  // falls back to dashes and the static roster.
  const live = await getLandingLive()
  return <HomeV2 live={live} />
}
