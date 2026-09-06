'use client'

// The affiliate mark, modeled 1:1 on X's affiliation badge: the team's
// square profile picture sitting right next to a member's name at the
// exact height of the verification badge beside it — small corner
// radius plus X's hairline: a 1px semi-transparent ring drawn over the
// image edge (inset overlay, not an outer border) so white logos hold
// their shape on the light canvas and dark logos on the dark one.
// Tailwind `white` resolves to --c-white, which flips to near-black ink
// under html.light, so the one ring class covers both themes. Renders
// everywhere the blue check renders (board rows, podium, player card,
// /u/ profile). Always clickable through to the team's /u/ page, same
// as X routes to the org.
//
// The server only emits `team` for ACTIVE affiliations to approved,
// non-banned TEAM accounts (getAffiliatedTeamsBatch), so rendering this
// whenever the field is present is already correctly gated.
//
// Board rows and podium cards are themselves <button>s, so the click
// must never bubble (it would open the player card over the navigation)
// and plain left-clicks navigate programmatically — nested-anchor
// default actions inside buttons are unreliable across browsers.
// Modified clicks (cmd/ctrl/middle) keep native anchor behavior.

import { Avatar } from '@/components/leaderboard/Avatar'

export interface TeamRef {
  username: string
  name: string
  logo: string | null
}

export function TeamMiniLogo({
  team,
  size = 16,
  className = ''
}: {
  team: TeamRef
  size?: number
  className?: string
}) {
  const href = `/u/${encodeURIComponent(team.username)}`
  const label = `Affiliated with @${team.username}`

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation()
    if (e.defaultPrevented) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    window.location.assign(href)
  }

  // The clip lives on an inner span so the anchor itself can carry an
  // after: hit-area extension (the /u/ profile hands one in for phones).
  return (
    <a
      href={href}
      onClick={onClick}
      onAuxClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        className="relative block h-full w-full overflow-hidden"
        style={{ borderRadius: Math.max(2, Math.round(size * 0.22)) }}
      >
        <Avatar
          src={team.logo}
          char={team.name[0]?.toUpperCase() ?? '?'}
          imgClassName="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center bg-zinc-900 font-display text-[8px] leading-none text-zinc-300"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 border border-white/15"
          style={{ borderRadius: 'inherit' }}
        />
      </span>
    </a>
  )
}
