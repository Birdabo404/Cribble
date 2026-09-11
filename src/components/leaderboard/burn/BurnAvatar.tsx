'use client'

// Round avatar for a burn board row. The one shape on the board with a
// radius. The podium wears a static 2px ring in its medal hue — no spin,
// no glint, no breathe: the regalia is the hue, not the motion. 32px on
// phones, 36px on desktop, set by .bb-avatar's --bb-av per breakpoint so
// one element serves both.

import { Avatar } from '@/components/leaderboard/Avatar'
import { medalA, medalFor } from '@/components/leaderboard/types'

export type BurnAvatarProps = {
  src: string | null | undefined
  /** Monogram shown when there is no image, or it has rotted. */
  char: string
  /** X handle for Avatar's live refresh of a stale twimg URL. */
  handle?: string | null
  rank: number
}

export function BurnAvatar({ src, char, handle, rank }: BurnAvatarProps) {
  const medal = medalFor(rank)
  return (
    <span className="bb-avatar">
      {medal && (
        <span
          aria-hidden
          className="bb-avatar-ring"
          style={{ borderColor: medalA(medal.rgb, 0.85) }}
        />
      )}
      <Avatar
        src={src}
        char={char}
        handle={handle}
        imgClassName="bb-avatar-img"
        fallbackClassName="bb-avatar-fallback"
      />
    </span>
  )
}
