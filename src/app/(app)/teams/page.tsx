// /teams — the Cribble Team pitch. Public and shareable (it sits on the
// site-lock allowlist), so this wrapper is a server component that owns
// the page metadata; everything visible lives in client components under
// src/components/teams/. The /team console (singular) stays the private
// roster surface for accounts that already fly colors.

import type { Metadata } from 'next'
import { TeamsLanding } from '@/components/teams/TeamsLanding'

const TITLE = 'Cribble Team — Fly Company Colors'
const DESCRIPTION =
  'Put your company on the board. One account becomes the team: the gold badge, the square mark, and up to ten pilots wearing your clickable logo. Every team verified by hand.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: '/teams',
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

export default function TeamsPage() {
  return <TeamsLanding />
}
