// Client-side shapes for the public profile surfaces (/u/[username],
// follow lists). The base profile type is shared with the server
// builder so the page can never drift from what the API assembles.

import type { PublicProfile } from '@/lib/publicProfile'

export interface ViewerFollowContext {
  isYou: boolean
  isFollowing: boolean
  followsYou: boolean
}

export interface MutualFollowProof {
  usernames: string[]
  total: number
}

/** Payload of GET /api/profile/[username]. */
export interface PublicProfileData extends PublicProfile {
  followers: number
  following: number
  /** null when the visitor is signed out. */
  viewer: ViewerFollowContext | null
  /** "Followed by @a and @b" proof; null when empty or signed out. */
  followedBy: MutualFollowProof | null
}

/** One row of GET /api/profile/[username]/follows. */
export interface FollowListUser {
  userId: number
  username: string
  display_name: string
  profile_image: string | null
  tier: string
  isYou: boolean
  isFollowing: boolean
  followsYou: boolean
}
