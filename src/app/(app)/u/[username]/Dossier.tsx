'use client'

// The DOSSIER block — the readable part of the record, under the banner
// in the content column: bio as body copy, then a <dl> of hairline meta
// rows (LOCATION / WEBSITE / NOW BUILDING / ENLISTED / LAST SEEN — only
// the rows that have a value), the FOLLOWING / FOLLOWERS counts as
// buttons that open the rosters (numerals in Plex Mono, tabular), the
// social marks as framed squares, the FOLLOWED BY proof and, for a
// signed-in visitor, the CHASE line. Phone rows are 44px tall; sm+ has
// a pointer and drops the floor.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'
import { SOCIAL_LABEL, SocialIcon, socialHref, type SocialKind } from '@/components/leaderboard/icons'
import type { FollowListKind } from '@/components/profile/FollowListModal'
import type { PublicProfileData } from '@/types/profile'
import { ChaseLine } from './ChaseLine'
import { monthYear, PATH_EXTERNAL, Stroke } from './parts'
import { agoUpper } from './ribbonLines'

const SOCIAL_KINDS: SocialKind[] = ['x', 'github', 'youtube', 'linkedin']

const prettyUrl = (raw: string) =>
  raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')

const META_LINK =
  'flex min-w-0 max-w-full items-center gap-1.5 transition-colors hover:underline hover:underline-offset-4'

/** One hairline meta row: tracked term left, ink value right. */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-4 border-b border-[color:var(--pf-line-soft)] sm:min-h-0 sm:py-2.5">
      <dt className="pf-micro w-24 shrink-0 sm:w-28">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--pf-ink)' }}>
        {children}
      </dd>
    </div>
  )
}

/** Roster opener: mono numeral + tracked label on one baseline. */
function CountButton({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-h-11 items-center sm:min-h-0">
      <span className="flex items-baseline gap-2">
        <span className="font-data text-[15px] font-medium tabular-nums sm:text-[14px]">
          {formatNumber(n)}
        </span>
        <span className="pf-micro transition-colors group-hover:text-[color:var(--pf-ink)]">{label}</span>
      </span>
    </button>
  )
}

export function Dossier({
  profile,
  isYou,
  chase,
  onEdit,
  onRoster,
  className = ''
}: {
  profile: PublicProfileData
  isYou: boolean
  chase: string | null
  onEdit: () => void
  onRoster: (kind: FollowListKind) => void
  className?: string
}) {
  const socials = SOCIAL_KINDS.map((kind) => ({ kind, value: profile.socials[kind] })).filter(
    (e): e is { kind: SocialKind; value: string } => Boolean(e.value)
  )

  return (
    <div className={`pf-panel ${className}`}>
      {/* bio — plain body copy, reads like any other profile */}
      {profile.bio ? (
        <p className="max-w-xl break-words text-[14px] leading-relaxed">{profile.bio}</p>
      ) : isYou ? (
        <button
          type="button"
          onClick={onEdit}
          className="flex min-h-11 items-center text-left text-[14px] transition-colors hover:text-[color:var(--pf-ink-2)] sm:min-h-0"
          style={{ color: 'var(--pf-ink-3)' }}
        >
          No bio yet — tell people what you do.
        </button>
      ) : null}

      <dl className="mt-4 border-t border-[color:var(--pf-line-soft)]">
        {profile.location && <MetaRow label="LOCATION">{profile.location}</MetaRow>}
        {profile.website && (
          <MetaRow label="WEBSITE">
            <a href={profile.website} target="_blank" rel="noopener noreferrer" className={META_LINK}>
              <span className="truncate">{prettyUrl(profile.website)}</span>
              <Stroke d={PATH_EXTERNAL} size={10} className="shrink-0" />
            </a>
          </MetaRow>
        )}
        {profile.project && (
          <MetaRow label="NOW BUILDING">
            <a
              href={profile.project.url}
              target="_blank"
              rel="noopener noreferrer"
              title={profile.project.url}
              className={META_LINK}
            >
              <span className="truncate">{profile.project.name}</span>
              <Stroke d={PATH_EXTERNAL} size={10} className="shrink-0" />
            </a>
          </MetaRow>
        )}
        <MetaRow label="ENLISTED">{monthYear(profile.memberSince)}</MetaRow>
        {!profile.isActive && (
          <MetaRow label="LAST SEEN">{agoUpper(profile.lastSeen, new Date())}</MetaRow>
        )}
      </dl>

      {/* counts + marks — 44px targets on phones. Below sm the four
          44px marks do not fit beside two counts at 390px, so they take
          a row of their own, left-aligned like everything else on the
          sheet (basis-full) rather than wrapping to a stray right-aligned
          tail; from sm they sit at the row's end. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <CountButton n={profile.following} label="FOLLOWING" onClick={() => onRoster('following')} />
        <CountButton
          n={profile.followers}
          label={profile.followers === 1 ? 'FOLLOWER' : 'FOLLOWERS'}
          onClick={() => onRoster('followers')}
        />
        {socials.length > 0 && (
          <span className="flex basis-full items-center gap-2 sm:ml-auto sm:basis-auto sm:gap-1.5">
            {socials.map(({ kind, value }) => (
              <a
                key={kind}
                href={socialHref(kind, value)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`@${profile.username} on ${SOCIAL_LABEL[kind]}`}
                title={SOCIAL_LABEL[kind]}
                className="pf-frame flex h-11 w-11 items-center justify-center text-[color:var(--pf-ink-2)] transition-colors hover:bg-[color:var(--pf-paper-3)] hover:text-[color:var(--pf-ink)] sm:h-7 sm:w-7"
              >
                <SocialIcon kind={kind} size={13} />
              </a>
            ))}
          </span>
        )}
      </div>

      {profile.followedBy && profile.followedBy.usernames.length > 0 && (
        <p className="mt-3 font-data text-[10px] tracking-[0.15em]" style={{ color: 'var(--pf-ink-3)' }}>
          FOLLOWED BY{' '}
          {profile.followedBy.usernames.map((name, i) => (
            <span key={name}>
              {i > 0 && <span> · </span>}
              <Link
                href={`/u/${encodeURIComponent(name)}`}
                className="transition-colors hover:text-[color:var(--pf-ink)]"
                style={{ color: 'var(--pf-ink-2)' }}
              >
                @{name}
              </Link>
            </span>
          ))}
          {profile.followedBy.total > profile.followedBy.usernames.length && (
            <span>
              {' '}+ {profile.followedBy.total - profile.followedBy.usernames.length} MORE YOU FOLLOW
            </span>
          )}
        </p>
      )}

      <ChaseLine text={chase} className="mt-3" />
    </div>
  )
}
