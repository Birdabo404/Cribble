// AFFILIATES pane (approved teams only), on paper. The API only attaches
// the roster when the profile is an approved Team account — everyone
// else gets null and ProfileClient never mounts this pane, so it can
// never leak onto a pending or lapsed team. Rows in the shared grammar:
// a hairline-separated 2-up (1-up on phones) of square avatars (their own
// colours, like every photo on the record), name and @handle; the APPLY action sits in a row of its own above the
// roster (ApplyToTeamButton is shared with the team pages and keeps its
// own skin). The pane title and `n MEMBERS` aside live in the content
// column's PanelHeader (paneAside).

import Link from 'next/link'
import { formatNumber } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { ApplyToTeamButton } from '@/components/teams/ApplyToTeamButton'
import { isProTier } from '@/lib/entitlements'
import type { TeamAffiliatesList } from '@/lib/teamAffiliates'
import type { PublicProfileData } from '@/types/profile'

const AVATAR_IMG = 'h-9 w-9 shrink-0 border border-[color:var(--pf-line)] object-cover'
const AVATAR_FALLBACK =
  'flex h-9 w-9 shrink-0 items-center justify-center border border-[color:var(--pf-line)] bg-[color:var(--pf-paper-2)] font-display text-[11px] text-[color:var(--pf-ink-2)]'

export function AffiliatesPane({
  profile,
  affiliates
}: {
  profile: PublicProfileData
  affiliates: TeamAffiliatesList
}) {
  const hidden = affiliates.total - affiliates.members.length

  return (
    <div className="px-[var(--pf-gutter)] py-5">
      <div className="pf-row flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="pf-micro">ACTIVE ROSTER</span>
        <ApplyToTeamButton
          teamUserId={profile.userId}
          teamUsername={profile.username}
          teamName={profile.display_name}
          teamAvatar={profile.profile_image}
        />
      </div>

      {affiliates.members.length === 0 ? (
        <div className="pf-micro mt-4 py-4 text-center">NO AFFILIATES YET</div>
      ) : (
        <div className="mt-4 grid grid-cols-1 border-t border-[color:var(--pf-line-soft)] sm:grid-cols-2 sm:gap-x-6">
          {affiliates.members.map((member) => (
            <Link
              key={member.userId}
              href={`/u/${encodeURIComponent(member.username)}`}
              className="pf-row group flex min-h-11 items-center gap-3 border-b border-[color:var(--pf-line-soft)] py-2 transition-colors hover:bg-[color:var(--pf-paper-3)]"
            >
              <span className="inline-flex shrink-0">
                <Avatar
                  src={member.profile_image}
                  char={member.username[0]?.toUpperCase() ?? '?'}
                  imgClassName={AVATAR_IMG}
                  fallbackClassName={AVATAR_FALLBACK}
                />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-display text-[13px] font-medium group-hover:underline group-hover:underline-offset-4">
                    {member.display_name}
                  </span>
                  {isProTier(member.tier) && <VerifiedBadge size={12} />}
                </span>
                <span className="font-data block truncate text-[10px]" style={{ color: 'var(--pf-ink-3)' }}>
                  @{member.username}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {hidden > 0 && (
        <p className="pf-micro mt-3 text-center">+ {formatNumber(hidden)} MORE</p>
      )}
    </div>
  )
}
