import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { loadPublicProfile, type PublicProfileResult } from '@/lib/publicProfile'
import { isMissingProfile, profileMetadata } from '@/lib/profilePage'
import { createServiceClient } from '@/lib/supabaseServer'
import PilotProfilePage from './ProfilePageClient'

interface ProfilePageProps {
  params: Promise<{ username: string }>
}

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,40}$/

// React's request cache lets metadata and the page share one lookup. The
// browser still loads the viewer-specific profile payload from the API, so
// valid-profile rendering and privacy gates remain unchanged.
const getPublicProfile = cache(async (username: string): Promise<PublicProfileResult> => {
  const normalized = username.trim()
  if (!USERNAME_RE.test(normalized)) {
    return { ok: false, status: 404, error: 'Profile not found' }
  }
  return loadPublicProfile(createServiceClient(), { username: normalized.toLowerCase() })
})


export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { username } = await params
  return profileMetadata(await getPublicProfile(username))
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const resolved = await params
  const result = await getPublicProfile(resolved.username)

  // Only a genuine absence becomes a route-level 404. Transient backend
  // failures keep the existing client-side retry state instead of being
  // mislabeled as missing content.
  if (isMissingProfile(result)) notFound()

  return <PilotProfilePage params={Promise.resolve(resolved)} />
}
