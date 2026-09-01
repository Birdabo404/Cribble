// /status — the public watchtower. A standalone route like /privacy
// (outside the (app) shell): the server renders the deep-space frame
// instantly and StatusConsole fills it client-side from GET /api/status.

import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusConsole } from '@/components/status/StatusConsole'
import { accentA } from '@/lib/theme'

const TITLE = 'Status — Cribble'
const DESCRIPTION =
  'Live health for the stack Cribble rides on — GitHub, ChatGPT, Claude, Cursor, and Grok — plus Cribble itself. ' +
  'Read from official public status feeds, checked every minute.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  // Unfurl image: the generated root card (src/app/opengraph-image.tsx),
  // referenced explicitly — defining openGraph here replaces the parent's
  // whole openGraph object, so the root file-based image does NOT cascade
  // into this page (Next merges metadata shallowly, by design).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: '/status',
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

export default function StatusPage() {
  return (
    <div className="min-h-screen-safe lx-hero relative overflow-hidden font-mono text-zinc-100 selection:bg-accent/20">
      {/* thin horizon line — same single accent signal as the landing */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-30"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentA(0.33)}, transparent)`
        }}
      />
      <div className="relative z-10 mx-auto flex min-h-screen-safe w-full max-w-3xl flex-col px-6">
        <StatusConsole />
        <footer className="flex items-center justify-between gap-4 border-t border-zinc-900 pb-8 pt-6 font-mono text-[10px] tracking-[0.3em] text-zinc-600">
          <span>CRIBBLE · 2026</span>
          <Link href="/" className="transition-colors hover:text-zinc-300">
            CRIBBLE.DEV
          </Link>
        </footer>
      </div>
    </div>
  )
}
