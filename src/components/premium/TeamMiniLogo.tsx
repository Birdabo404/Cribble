'use client'

// The affiliate mark: a small square team avatar sitting right next to a
// member's name, everywhere the blue check renders (board rows, podium,
// player card, /u/ profile). Square on purpose — companies are square,
// pilots are round — and always clickable through to the team's /u/ page.
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
  const label = `Affiliate of @${team.username}`

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation()
    if (e.defaultPrevented) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    window.location.assign(href)
  }

  return (
    <a
      href={href}
      onClick={onClick}
      onAuxClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 overflow-hidden rounded-[4px] border border-[rgb(var(--lb-gold)/0.45)] transition-transform hover:scale-110 ${className}`}
      style={{ width: size, height: size }}
    >
      <Avatar
        src={team.logo}
        char={team.name[0]?.toUpperCase() ?? '?'}
        imgClassName="h-full w-full object-cover"
        fallbackClassName="flex h-full w-full items-center justify-center bg-zinc-900 font-display text-[8px] leading-none text-zinc-300"
      />
    </a>
  )
}
