// Server wrapper for /u/[username]. The interactive profile stayed a
// client component (ProfileClient.tsx) — this layer exists so every
// public profile ships crawlable metadata (unique title/description,
// canonical, OG/Twitter card) and ProfilePage JSON-LD, the programmatic
// SEO surface a client page cannot provide.
//
// Data comes from the same cached loader as /api/profile/[username]
// (60s Data Cache entry per lowercased handle), so metadata, the OG
// card sibling route and the API ride one DB hit per TTL. The client
// still fetches the live payload itself — a metadata snapshot up to a
// minute stale is fine for crawlers, not for the follow button.

import type { Metadata } from 'next'
import { formatNumber } from '@/components/dashboard-v2/format'
import { resolveShareOrigin } from '@/lib/appUrl'
import {
  gateProfileForViewer,
  loadPublicProfileCached,
  PROFILE_USERNAME_RE,
  type PublicProfile
} from '@/lib/publicProfile'
import { JsonLd } from '@/lib/seo'
import ProfileClient from './ProfileClient'

// Share origin (never localhost — a dev NEXT_PUBLIC_DOMAIN is skipped)
// so the JSON-LD Person URL matches the canonical/OG URLs, which all
// resolve through the same helper.
const SITE_URL = resolveShareOrigin()

interface Props {
  params: Promise<{ username: string }>
}

// Crawlers are anonymous viewers, so privacy gating runs with a null
// viewer before any field is read. 'error' means the loader threw (a
// transient 5xx path — never cached, and never worth a noindex);
// 'missing' covers both malformed handles and genuine 404s.
type ProfileSnapshot =
  | { state: 'missing' }
  | { state: 'error' }
  | { state: 'ok'; profile: PublicProfile }

async function snapshotProfile(rawUsername: string): Promise<ProfileSnapshot> {
  const username = String(rawUsername || '').trim()
  if (!PROFILE_USERNAME_RE.test(username)) return { state: 'missing' }
  try {
    const result = await loadPublicProfileCached(username.toLowerCase())()
    if (!result.ok) return { state: 'missing' }
    return { state: 'ok', profile: gateProfileForViewer(result.profile, null) }
  } catch {
    return { state: 'error' }
  }
}

/** '@handle ranks #N on Cribble with a score of S. Best streak: … Top
 *  tools: …' — only from fields the anonymous gate left visible. */
function buildDescription(profile: PublicProfile): string {
  const handle = profile.username
  const parts: string[] = []
  if (profile.rank !== null) {
    parts.push(
      `@${handle} ranks #${profile.rank} on Cribble with a score of ${formatNumber(profile.score)}.`
    )
  } else if (profile.score > 0) {
    parts.push(
      `@${handle} scored ${formatNumber(profile.score)} on Cribble, the AI coding leaderboard.`
    )
  } else {
    parts.push(`@${handle} is on Cribble, the AI coding leaderboard.`)
  }
  if (profile.longestStreak > 0) {
    parts.push(
      `Best streak: ${profile.longestStreak} ${profile.longestStreak === 1 ? 'day' : 'days'}.`
    )
  }
  if (profile.topTools.length > 0) {
    parts.push(`Top tools: ${profile.topTools.map((t) => t.name).join(', ')}.`)
  }
  return parts.join(' ')
}

// Titles are bare — the root layout's '%s · Cribble' template appends
// the brand. No explicit OG/Twitter image: Next wires the colocated
// opengraph-image.tsx into both cards automatically.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params
  const snapshot = await snapshotProfile(username)

  switch (snapshot.state) {
    case 'missing':
      return {
        title: 'Pilot not found',
        description:
          'No profile on file for this callsign on Cribble, the AI coding leaderboard.',
        robots: { index: false, follow: false }
      }
    case 'error':
      // Transient failure: minimal metadata and crucially NO noindex —
      // a database hiccup must not tell Google to drop the page.
      return { title: `@${String(username || '').trim()}` }
    case 'ok':
      break
    default: {
      const exhaustive: never = snapshot
      throw new Error(`Unhandled profile snapshot: ${exhaustive}`)
    }
  }

  const profile = snapshot.profile
  const handle = profile.username

  if (profile.isPrivate) {
    // Private mode: the account stays reachable but out of the index,
    // and no stats leak through the description.
    return {
      title: `@${handle}`,
      robots: { index: false, follow: false }
    }
  }

  const title =
    profile.rank !== null
      ? `@${handle} — Rank #${profile.rank}`
      : `@${handle} on the AI leaderboard`
  const description = buildDescription(profile)
  // Canonical uses the profile's own casing so every typed variant of
  // the handle consolidates onto one indexed URL.
  const canonical = `/u/${handle}`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'profile'
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description
    }
  }
}

export default async function PilotProfilePage({ params }: Props) {
  const { username } = await params
  const snapshot = await snapshotProfile(username)

  // ProfilePage structured data for public profiles only — private and
  // missing accounts give crawlers nothing to lift. The client renders
  // its own not-found / error states, so this page never calls
  // notFound(); the URL keeps resolving exactly as it did before.
  const publicProfile =
    snapshot.state === 'ok' && !snapshot.profile.isPrivate
      ? snapshot.profile
      : null

  return (
    <>
      {publicProfile && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'ProfilePage',
            mainEntity: {
              '@type': 'Person',
              name: publicProfile.display_name,
              alternateName: `@${publicProfile.username}`,
              url: `${SITE_URL}/u/${encodeURIComponent(publicProfile.username)}`,
              ...(publicProfile.profile_image
                ? { image: publicProfile.profile_image }
                : {})
            }
          }}
        />
      )}
      <ProfileClient username={username} />
    </>
  )
}
