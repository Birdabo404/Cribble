import { IconGlobe, SOCIAL_LABEL, SocialIcon, socialHref, type SocialKind } from './icons'
import type { Socials } from './types'

/** Same presentation order as the /u/[username] page; website globe last. */
const SOCIAL_ORDER: SocialKind[] = ['x', 'github', 'youtube', 'linkedin']

/** Short host label for the website tooltip, e.g. "cribble.dev". */
const websiteHost = (raw: string) =>
  raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')

/** Hover accent per card family: zinc for the season card, ember for
 *  the burn board card. */
const TONE_HOVER: Record<'zinc' | 'ember', string> = {
  zinc: 'hover:text-zinc-100',
  ember: 'hover:text-orange-300'
}

/**
 * Compact icon-anchor row for a player's outbound links (socials +
 * website), shared by both leaderboard stat cards. Renders nothing when
 * the player has no links, so callers can mount it as soon as the
 * profile payload hydrates.
 */
export function SocialLinkRow({
  username,
  socials,
  website,
  tone = 'zinc',
  className = ''
}: {
  username: string
  socials?: Socials | null
  website?: string | null
  tone?: 'zinc' | 'ember'
  className?: string
}) {
  const entries = SOCIAL_ORDER.flatMap((kind) => {
    const value = socials?.[kind]
    return value ? [{ kind, value }] : []
  })
  if (entries.length === 0 && !website) return null

  const anchor =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ' +
    'border-[rgb(var(--lb-panel-edge)/0.12)] bg-[rgb(var(--lb-panel-edge)/0.03)] ' +
    `text-zinc-500 transition-all hover:-translate-y-0.5 sm:h-7 sm:w-7 ${TONE_HOVER[tone]}`

  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      {entries.map(({ kind, value }) => (
        <a
          key={kind}
          href={socialHref(kind, value)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`@${username} on ${SOCIAL_LABEL[kind]}`}
          title={SOCIAL_LABEL[kind]}
          className={anchor}
        >
          <SocialIcon kind={kind} size={12} />
        </a>
      ))}
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`@${username}'s website`}
          title={websiteHost(website)}
          className={anchor}
        >
          <IconGlobe size={13} />
        </a>
      )}
    </span>
  )
}
