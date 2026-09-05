'use client'

// The SPINE — the record's left column from lg (296px, sticky) and its
// hero block below lg. Top to bottom: the identity — the square avatar
// in corner brackets (the photo itself untouched by either material),
// the decoded name, @handle and the DESIGNATION line (designation.ts) —
// which from lg sits in one 1px --pf-line frame, the first of the
// spine's stack of frames (its edges on the gutter like the menu,
// TRANSMISSIONS and RECRUIT below it), which the photo fills: a square
// the frame's content width less the ticks' margins (218px in the 296px
// spine), so it is centred by construction; under that frame the role
// / medal stamps and the presence
// marker; the action rows (FOLLOW or EDIT PROFILE as the inverted
// plate, SHARE and INVITE TO TEAM framed); the menu slot; the
// TRANSMISSIONS panel (lg only); and, for the owner, the RECRUIT frame
// around ReferralPlate (which draws its own paper plate inside). Below
// lg the identity is unframed: the caller hands the banner in as
// `banner` so it leads the hero and the 96px avatar overlaps it by half
// (218px, no overlap, from lg); from lg the
// banner belongs to the content column and `banner` is null. The menu
// (ProfileMenu) runs the other way: `menu` is the vertical list from lg
// and null below it, where ProfileClient mounts the horizontal strip as
// the sheet's own child — a sticky strip inside this block would stop
// sticking the moment the hero scrolled away with it.
//
// Medals and teams no longer ring or glow: a podium rank is a Stamp in
// its print ink, a team is still square (everyone is square here). The
// only colour is the live signal: the ONLINE lamp is the bright lime
// inside an ink rim (.pf-lamp) and its label prints in --pf-lime-ink.
// Follow psychology kept: FOLLOWS YOU sits beside the button only when
// it reads FOLLOWING (FOLLOW BACK already names the reciprocity).
// Horizontal padding everywhere here is --pf-gutter (the sheet gutter);
// the framed blocks (the lg identity frame, RECRUIT) pad their inside
// by --pf-inset.

import { useState, type CSSProperties, type ReactNode } from 'react'
import { Avatar } from '@/components/leaderboard/Avatar'
import { medalFor } from '@/components/leaderboard/types'
import { FollowButton, FollowsYouChip, type FollowChange } from '@/components/profile/FollowButton'
import { ReferralPlate } from '@/components/profile/ReferralPlate'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { ROLE_ICONS } from '@/components/roleIcons'
import { toast } from '@/components/Toaster'
import { isProTier } from '@/lib/entitlements'
import { ROLE_META } from '@/lib/roles'
import type { PublicProfileData } from '@/types/profile'
import { designationFor } from './designation'
import { Frame, Marker, medalInk, PanelHeader, PATH_EDIT, PATH_LOCK, PATH_SHARE, Stamp, Stroke } from './parts'
import { onRecruiterRoster } from './recruiter'
import { agoUpper } from './ribbonLines'
import { TransmissionsPanel } from './TransmissionsPanel'

/* ---------- row recipes (44px phones, 40px lg) ---------- */

const ROW =
  'flex min-h-11 w-full items-center justify-center gap-2 font-data text-[11px] font-medium uppercase tracking-[0.18em] lg:min-h-10'
/** The inverted primary row. */
const PRIMARY_ROW = `pf-plate ${ROW} transition-opacity hover:opacity-90`
/** Framed secondary rows. */
const FRAMED_ROW = `pf-frame ${ROW} text-[color:var(--pf-ink-2)] transition-colors hover:bg-[color:var(--pf-paper-3)] hover:text-[color:var(--pf-ink)] disabled:opacity-60 disabled:hover:bg-transparent`

/** Phone-only 44px hit area for the 16px team mark (14px each side);
 *  sm+ has a pointer and drops it. */
const TEAM_MARK_HIT = "after:absolute after:-inset-[14px] after:content-[''] sm:after:content-none"

/** Pushes the corner ticks 6px outside the avatar square. The avatar's
 *  lg margin (m-1.5, below) is the same 6px, so inside the identity
 *  frame the ticks' box is the margin box and lands on the inset line. */
const BRACKET_INSET = { '--pf-bracket-inset': '-6px' } as CSSProperties

export interface SpineProps {
  profile: PublicProfileData
  isYou: boolean
  signedIn: boolean
  /** Handle of the team the viewer recruits for — a live TEAM login's own,
   *  or the franchise behind a signed OWNER (recruiter.ts); null hides INVITE. */
  recruiterHandle: string | null
  copied: boolean
  onCopyLink: () => void
  onEdit: () => void
  onFollowChange: (change: FollowChange) => void
  /** The banner, below lg only (leads the hero). Null from lg. */
  banner: ReactNode
  /** The menu (ProfileMenu), from lg only (the vertical list under the
   *  actions). Null below lg, where it is the sheet's own child. */
  menu: ReactNode
  /** lg+ viewport: gates the TRANSMISSIONS fetch and picks the avatar's
   *  source size (the 218px portrait wants more pixels than the 96px hero). */
  desktop: boolean
}

export function Spine({
  profile,
  isYou,
  signedIn,
  recruiterHandle,
  copied,
  onCopyLink,
  onEdit,
  onFollowChange,
  banner,
  menu,
  desktop
}: SpineProps) {
  const roleKey = profile.role || null
  const RoleIcon = roleKey ? ROLE_ICONS[roleKey] : undefined
  const roleLabel = roleKey ? ROLE_META[roleKey] ?? null : null
  const medal = profile.rank !== null ? medalFor(profile.rank) : null
  const medalColor = medalInk(profile.rank)
  const designation = designationFor({ userId: profile.userId, rank: profile.rank, roleLabel })
  // only alongside FOLLOWING — FOLLOW BACK already says it
  const showFollowsYou = Boolean(profile.viewer?.followsYou && profile.viewer?.isFollowing)

  return (
    <div className="lg:sticky lg:top-[var(--pf-sticky-top)] lg:self-start">
      {banner}

      {/* ---------- identity ---------- */}
      <div className="pf-panel px-[var(--pf-gutter)] pb-5 lg:pt-6">
        {/* the identity frame, lg only: avatar, name, @handle and the
            DESIGNATION line in one 1px --pf-line box inset by --pf-inset
            (the ProfileClient menu's lg:border precedent), its outer
            edges on the gutter like the menu / TRANSMISSIONS / RECRUIT
            frames below. Inside the unfolding .pf-panel, so it unfolds
            with the identity. Below lg a bare block: the avatar is the
            hero pulled up over the banner (its -mt-12 still collapses
            through here) and a frame would cut across it. */}
        <div className="lg:border lg:border-[color:var(--pf-line)] lg:p-[var(--pf-inset)]">
          {/* avatar: brackets host outside (it owns the corner ticks), the
              .pf-photo host inside — the image renders in its own colours;
              the host is the motion hook's fade-in target and clips the
              square. 96px on phones, pulled up by half its height over the
              140px banner; from lg a square that fills the frame's content
              width (w-auto on a block, aspect-square for the height: 218px
              in the 296px spine) less the ticks' 6px overhang as its
              margin, so they clear the frame line (the bottom 6px collapses
              into the name row's mt-4). ProfileSkeleton mirrors these
              boxes. The monogram fallback is ~40% of either box. */}
          <div
            className="pf-brackets relative -mt-12 h-24 w-24 lg:m-1.5 lg:aspect-square lg:h-auto lg:w-auto"
            style={BRACKET_INSET}
          >
            {/* .pf-photo is position:relative, so size it explicitly — an
                `absolute inset-0` host collapses to 0px tall */}
            <div className="pf-photo h-full w-full overflow-hidden" style={{ background: 'var(--pf-paper-2)' }}>
              <Avatar
                src={profile.profile_image}
                char={profile.username[0]?.toUpperCase() ?? '?'}
                handle={profile.username}
                // 218px × 2 DPR from lg; 96px × 3 below it (Avatar.tsx:
                // past 400 a twimg URL trades _400x400 for the original)
                px={desktop ? 436 : 288}
                imgClassName="absolute inset-0 h-full w-full object-cover"
                fallbackClassName="absolute inset-0 flex items-center justify-center font-display text-[40px] font-light text-[color:var(--pf-ink-2)] lg:text-[88px]"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1
              data-pf-decode
              className="min-w-0 max-w-full break-words font-display text-[22px] font-light leading-tight tracking-tight lg:text-[26px]"
            >
              {profile.display_name}
            </h1>
            {isProTier(profile.tier) && <VerifiedBadge size={16} />}
            {profile.isTeam && <TeamBadge size={16} />}
            {profile.team && <TeamMiniLogo team={profile.team} size={16} className={TEAM_MARK_HIT} />}
          </div>

          <div className="mt-1 flex items-center gap-1.5 font-data text-[13px] lg:text-[12px]" style={{ color: 'var(--pf-ink-2)' }}>
            @{profile.username}
            {profile.isPrivate && (
              <span title="Private account — tools, decorations and activity are follower-only">
                <Stroke d={PATH_LOCK} size={11} />
              </span>
            )}
          </div>

          <div data-pf-decode className="pf-micro mt-2">
            {designation.line}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {roleLabel && (
            <Stamp ink="var(--pf-ink-2)" className="inline-flex items-center gap-1.5">
              {RoleIcon && <RoleIcon size={9} />}
              {roleLabel}
            </Stamp>
          )}
          {medal && medalColor && <Stamp ink={medalColor}>{medal.label}</Stamp>}
          <span className="pf-micro ml-auto flex items-center gap-2">
            {profile.isActive ? (
              <>
                {/* lime core + ink rim from the .pf-lamp recipe; the
                    label is the same hue as print ink (5.02:1 on paper) */}
                <Marker className="pf-lamp" />
                <span style={{ color: 'var(--pf-lime-ink)' }}>ONLINE</span>
              </>
            ) : (
              <>
                <Marker hollow />
                SEEN {agoUpper(profile.lastSeen, new Date())}
              </>
            )}
          </span>
        </div>
      </div>

      {/* ---------- actions (the phone compact bar's ScrollTrigger start) ---------- */}
      <div className="pf-panel pf-hero-actions flex flex-col gap-2 px-[var(--pf-gutter)] pb-5">
        {isYou ? (
          <>
            <button type="button" onClick={onEdit} className={PRIMARY_ROW}>
              <Stroke d={PATH_EDIT} size={11} />
              EDIT PROFILE
            </button>
            <button
              type="button"
              onClick={onCopyLink}
              className={FRAMED_ROW}
              title={copied ? 'Copied' : 'Copy profile link'}
            >
              <Stroke d={PATH_SHARE} size={12} />
              {copied ? 'COPIED' : 'SHARE'}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-stretch gap-2">
              <FollowButton
                variant="paper"
                targetUserId={profile.userId}
                following={profile.viewer?.isFollowing ?? false}
                followsYou={profile.viewer?.followsYou ?? false}
                signedIn={signedIn}
                onChange={onFollowChange}
                className="flex-1"
              />
              {showFollowsYou && <FollowsYouChip variant="paper" className="self-center" />}
            </div>
            <button
              type="button"
              onClick={onCopyLink}
              className={FRAMED_ROW}
              title={copied ? 'Copied' : 'Copy profile link'}
            >
              <Stroke d={PATH_SHARE} size={12} />
              {copied ? 'COPIED' : 'SHARE'}
            </button>
            {/* tier re-checked at render: recruiterHandle survives
                client-side nav onto a team profile. Keyed per pilot so
                a sent state never carries over to another record. */}
            {recruiterHandle !== null && profile.tier !== 'TEAM' && (
              <TeamInviteButton
                key={profile.userId}
                callsign={profile.username}
                onRoster={onRecruiterRoster(profile.team, recruiterHandle)}
              />
            )}
          </>
        )}
      </div>

      {/* ---------- menu (lg only; see the header) ---------- */}
      {menu}

      {/* ---------- transmissions (lg only; the feed is only fetched there) ---------- */}
      <TransmissionsPanel enabled={desktop} className="lg:mx-[var(--pf-gutter)] lg:mb-[var(--pf-gutter)]" />

      {/* ---------- recruit (owner only) ---------- */}
      {isYou && (
        <Frame className="pf-panel mx-[var(--pf-gutter)] mb-[var(--pf-gutter)]">
          <PanelHeader title="RECRUIT" className="px-[var(--pf-inset)] pt-[var(--pf-inset)]" />
          <div className="p-[var(--pf-inset)]">
            <ReferralPlate />
          </div>
        </Frame>
      )}
    </div>
  )
}

/* ===================================================================== */

/** Recruit action, rendered only for viewers with team authority (a live
 *  TEAM login or a signed OWNER — the invite route's own gate) on other
 *  pilots' profiles. idle → sending → sent is local state: pending
 *  invites aren't in the public payload, so "sent" lasts until a reload
 *  and a re-click after that gets the server's friendly 409 as an error
 *  toast. Mounts pre-disabled as ON YOUR ROSTER when the pilot already
 *  flies the viewer's colors. The server re-checks every guard (approval,
 *  seat cap, target eligibility) no matter what this renders. */
function TeamInviteButton({ callsign, onRoster }: { callsign: string; onRoster: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle')

  const invite = async () => {
    setPhase('sending')
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        toast({
          kind: 'error',
          title: 'INVITE FAILED',
          body: data?.error || 'Could not send the invite.'
        })
        setPhase('idle')
        return
      }
      toast({
        kind: 'success',
        title: 'INVITE SENT',
        body: `@${data.member?.username ?? callsign} has been invited to your roster.`
      })
      setPhase('sent')
    } catch {
      toast({ kind: 'error', title: 'INVITE FAILED', body: 'Could not send the invite.' })
      setPhase('idle')
    }
  }

  const label = onRoster
    ? 'ON YOUR ROSTER'
    : phase === 'sending'
      ? 'SENDING…'
      : phase === 'sent'
        ? 'INVITE SENT'
        : 'INVITE TO TEAM'

  return (
    <button
      type="button"
      onClick={() => void invite()}
      disabled={onRoster || phase !== 'idle'}
      className={`${FRAMED_ROW} whitespace-nowrap`}
    >
      {label}
    </button>
  )
}
