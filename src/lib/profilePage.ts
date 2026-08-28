import type { Metadata } from 'next'
import type { PublicProfileResult } from '@/lib/publicProfile'

export function isMissingProfile(result: PublicProfileResult): boolean {
  return !result.ok && result.status < 500
}

export function profileMetadata(result: PublicProfileResult): Metadata {
  if (!result.ok) {
    return {
      title: 'Profile not found — Cribble',
      description: 'This Cribble profile does not exist.',
      robots: { index: false, follow: false },
      openGraph: {
        title: 'Profile not found — Cribble',
        description: 'This Cribble profile does not exist.',
        type: 'website'
      }
    }
  }

  const profile = result.profile
  const title = `@${profile.username} — Cribble`
  const description = profile.bio || `${profile.display_name || `@${profile.username}`} on Cribble.`
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary', title, description }
  }
}
