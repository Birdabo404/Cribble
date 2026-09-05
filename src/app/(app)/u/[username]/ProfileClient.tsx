'use client'

// Public pilot profile — /u/[username]. The UNIT RECORD.
//
// Paper, not glass: sand paper, charcoal ink, hairlines, no radius, no
// blur, no shadow (tokens and recipes in dossier.css, applied on the
// .pf-dossier root). From lg the sheet is a two-column dossier —
// a 296px sticky SPINE (Spine: avatar, identity, action rows, the menu,
// TRANSMISSIONS, RECRUIT), a hairline track, and the content column
// (StatusRibbon → BannerPlate → Dossier → the pane frame → footer).
// Below lg it is one column: the phone compact bar, then the spine as
// the hero block (banner first, avatar overlapping it), then the menu
// strip, then the content.
//
// The menu (ProfileMenu) swaps panes (panes/*) in place — RECORD ·
// HANGAR · LOADOUT · SERVICE RECORD · AFFILIATES; which of the optional
// two appear is tabsFor's call. It is built once here and mounted per
// tier: inside the spine from lg (the vertical list), and as the sheet's
// own child below lg — the phone strip is sticky, and a sticky box only
// sticks within its parent, so inside the spine it would leave with the
// hero. Each pane's title lives up here in the
// PanelHeader, with paneAside's right-hand cell. Data fetching, follow
// state and the modals stay in this file. Motion (boot unfold, menu
// plate, decodes, count-ups, scan line, compact bar) lives in
// useProfileMotion and is keyed off the .pf-* / data-pf-* hooks rendered
// here and in the extracted parts: the markup renders its final state,
// so reduced motion simply shows it.
//
// Backdrop: none. AppShell skips the starfield on /u/* and paints the
// page area around the sheet as a drafting board (.pf-page in
// globals.css: khaki under the sand sheet, blue-black under the
// blueprint), so the record reads as a sheet pinned to a board — its
// 1px --pf-line frame and the registration marks off its corners
// (.pf-sheet, dossier.css) are the only edges.

import './dossier.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'
import { BannerStudioModal } from '@/components/profile/BannerStudioModal'
import { EditProfileModal, type EditableProfile } from '@/components/profile/EditProfileModal'
import { FollowButton, type FollowChange } from '@/components/profile/FollowButton'
import { FollowListModal, type FollowListKind } from '@/components/profile/FollowListModal'
import { useSettingsModal } from '@/components/settings/SettingsModalContext'
import { useSfx } from '@/components/sfx/SfxProvider'
import { fetchMe } from '@/lib/client/fetchMe'
import type { PublicProfileData } from '@/types/profile'
import { BannerPlate } from './BannerPlate'
import { useChase } from './ChaseLine'
import { Dossier } from './Dossier'
import { paneAside } from './paneAside'
import { AffiliatesPane } from './panes/AffiliatesPane'
import { HangarPane } from './panes/HangarPane'
import { LoadoutPane } from './panes/LoadoutPane'
import { RecordPane } from './panes/RecordPane'
import { ServiceRecordPane } from './panes/ServiceRecordPane'
import { Frame, PAGE_WRAP, PanelHeader, PATH_EDIT, SHEET, Stroke } from './parts'
import { PROFILE_TAB_LABEL, ProfileMenu, useProfileTab, type ProfileTabId } from './ProfileMenu'
import { MissingPilot, ProfileError, ProfileSkeleton } from './ProfileScreens'
import { recruitingTeamHandle } from './recruiter'
import { revStamp } from './ribbonLines'
import { Spine } from './Spine'
import { StatusRibbon } from './StatusRibbon'
import { tabsFor } from './tabsFor'
import { LG_QUERY, useMediaQuery } from './useMediaQuery'
import { useProfileMotion } from './useProfileMotion'

export default function ProfileClient({ username }: { username: string }) {
  const { openSettings } = useSettingsModal()
  const { play } = useSfx()

  const [profile, setProfile] = useState<PublicProfileData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [roster, setRoster] = useState<FollowListKind | null>(null)
  const [editing, setEditing] = useState(false)
  const [editInitial, setEditInitial] = useState<EditableProfile | null>(null)
  const [bannerStudio, setBannerStudio] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Handle of the team the viewer recruits for (recruiter.ts) — set
   *  only when /me reports team authority; non-null is what unlocks the
   *  INVITE TO TEAM action, and Spine compares it against the pilot's
   *  affiliation for ON YOUR ROSTER. */
  const [recruiterHandle, setRecruiterHandle] = useState<string | null>(null)
  const recruiterChecked = useRef(false)
  const columnRef = useRef<HTMLElement>(null)
  /** lg+ decides where the banner and the menu live and whether
   *  TRANSMISSIONS fetch. */
  const desktop = useMediaQuery(LG_QUERY)

  const fetchProfile = useCallback(async () => {
    const res = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
      credentials: 'include',
      cache: 'no-store'
    })
    if (res.status === 404 || res.status === 400) return 'missing' as const
    if (!res.ok) return 'error' as const
    const data = await res.json()
    if (!data.success || !data.profile) return 'error' as const
    return data.profile as PublicProfileData
  }, [username])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchProfile()
      .then((result) => {
        if (cancelled) return
        if (result === 'missing' || result === 'error') {
          setStatus(result)
          return
        }
        setProfile(result)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [fetchProfile])

  // Silent refresh (post-edit / post-roster-changes): keep the page up
  // without blanking it back to the skeleton.
  const refreshProfile = useCallback(() => {
    fetchProfile()
      .then((result) => {
        if (result !== 'missing' && result !== 'error') setProfile(result)
      })
      .catch(() => {})
  }, [fetchProfile])

  // No document.title write here: page.tsx's generateMetadata already
  // ships the crawlable "@handle — Rank #N …" title (and the private-mode
  // and not-found variants) through the root template, and overwriting
  // it after the fetch handed JS-rendering crawlers the weaker string.

  const isPrivateAccount = profile?.isPrivate ?? false

  const handleFollowChange = useCallback(
    (change: FollowChange) => {
      // Engaged / released once the server confirms — the click already
      // tapped, and a rollback (followers null) stays silent.
      if (change.followers !== null) play(change.following ? 'toggleOn' : 'toggleOff')
      setProfile((p) => {
        if (!p || !p.viewer) return p
        const wasFollowing = p.viewer.isFollowing
        const followers =
          change.followers !== null
            ? change.followers
            : p.followers +
              (change.following === wasFollowing ? 0 : change.following ? 1 : -1)
        return {
          ...p,
          followers: Math.max(0, followers),
          viewer: { ...p.viewer, isFollowing: change.following }
        }
      })
      // Private accounts gate tools/badges on the follow edge, so once
      // the server confirms a follow (or unfollow) refetch to unlock —
      // or re-lock — the gated sections without a manual reload.
      if (isPrivateAccount && change.followers !== null) {
        refreshProfile()
      }
    },
    [isPrivateAccount, play, refreshProfile]
  )

  const openEditor = useCallback(async () => {
    // Edit from the user's *saved* values, not the profile view — the view
    // backfills socials from the OAuth provider, which shouldn't get
    // written back as if the user typed them.
    try {
      const res = await fetch('/api/user/profile', { credentials: 'include', cache: 'no-store' })
      const data = res.ok ? await res.json() : null
      const saved = data?.profile
      setEditInitial({
        bio: saved?.bio || '',
        location: saved?.location || '',
        website: saved?.website || '',
        project_name: saved?.project_name || '',
        project_url: saved?.project_url || '',
        equipped_plate: saved?.equipped_plate || null,
        role: saved?.role || null,
        is_private: saved?.is_private === true,
        socials: {
          x: saved?.socials?.x || '',
          github: saved?.socials?.github || '',
          youtube: saved?.socials?.youtube || '',
          linkedin: saved?.socials?.linkedin || ''
        }
      })
      setEditing(true)
    } catch {
      setEditInitial({
        bio: '',
        location: '',
        website: '',
        project_name: '',
        project_url: '',
        equipped_plate: null,
        role: null,
        is_private: false,
        socials: { x: '', github: '', youtube: '', linkedin: '' }
      })
      setEditing(true)
    }
  }, [])

  // The COPIED flash: one timer at a time (a second click restarts it
  // instead of racing the first) and none outliving the record. A denied
  // or unavailable clipboard skips the flash — the URL bar still has it.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )
  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/u/${encodeURIComponent(username)}`
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true)
        if (copiedTimer.current) clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }, [username])

  /* ---------------- derived ---------------- */

  const signedIn = profile?.viewer !== null && profile?.viewer !== undefined
  const isYou = profile?.viewer?.isYou ?? false

  // Everything the profile payload can say about invitability: a signed-in
  // viewer looking at someone else who isn't a team account (tier check,
  // not isTeam — pending/lapsed teams can't be affiliated either).
  const inviteEligibleProfile =
    profile !== null && signedIn && !isYou && profile.tier !== 'TEAM'

  // Whether the VIEWER may recruit is session-side state the public
  // payload deliberately omits, so ask /api/user/me — but only once, and
  // only after the profile shows an invitable pilot: signed-out visitors,
  // own-profile views and team profiles never pay for the call. Goes
  // through the shared /me client cache, so it often reuses the nav
  // shell's response (and the CHASE line's). The gate is /me's
  // team_authority — the same resolveTeamAuthority verdict the invite
  // route enforces, so a live TEAM login and a signed OWNER's personal
  // account both recruit; anything else leaves recruiterHandle null,
  // which keeps the button unrendered (the server re-checks regardless).
  // A failed /me read leaves the flag armed so a later profile refresh
  // does not re-ask; the button simply stays hidden this visit.
  useEffect(() => {
    if (!inviteEligibleProfile || recruiterChecked.current) return
    recruiterChecked.current = true
    let cancelled = false
    fetchMe()
      .then((result) => {
        if (cancelled || !result.ok) return
        const handle = recruitingTeamHandle(result.data.user)
        if (handle) setRecruiterHandle(handle)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [inviteEligibleProfile])

  // YOU n · GAP k PTS BEHIND|AHEAD — null unless a signed-in visitor is
  // reading someone else's record. Feeds the dossier and the ribbon.
  const chase = useChase(profile)

  // Pane tabs. Both hooks run before the fallback returns below, so the
  // inputs must be computable pre-ready: no payload → no HANGAR (nothing
  // docked, not the owner) and no AFFILIATES tab (the API only attaches
  // a roster for approved Team accounts). The same list feeds the menu
  // and the hash resolver, so a deep link can only land on a real pane.
  // (hangar is optional-chained too: a Data Cache entry written before
  // the field existed serves without it for up to the 60s TTL.)
  const tabs = tabsFor({
    hangarCount: profile?.hangar?.length ?? 0,
    isYou,
    hasAffiliates: profile?.affiliates != null
  })
  const [tab, setTab] = useProfileTab(tabs)

  useProfileMotion(columnRef, {
    ready: status === 'ready' && profile !== null,
    tab,
    tabIndex: tabs.indexOf(tab),
    isActive: profile?.isActive ?? false,
    desktop
  })

  /* ---------------- render ---------------- */

  if (status !== 'ready' || !profile) {
    if (status === 'missing') return <MissingPilot username={username} />
    if (status === 'loading') return <ProfileSkeleton />
    return <ProfileError />
  }

  // One banner element, two homes: it leads the phone hero (handed to
  // the spine) and tops the content column from lg.
  const banner = (
    <BannerPlate
      profile={profile}
      isYou={isYou}
      onEdit={() => setBannerStudio(true)}
      className={desktop ? 'mt-4' : ''}
    />
  )

  // One menu element, two homes (the mirror of the banner): a static
  // block in the spine from lg, framed and spaced by the lg: utilities;
  // below lg the sheet's own child right after the hero, so the strip's
  // sticky containing block is the whole sheet and it stays under the
  // compact bar for the entire scroll. Exactly one [role=tablist] is in
  // the DOM either way — the motion hook finds the plate by selector.
  const menu = (
    <ProfileMenu
      tabs={tabs}
      active={tab}
      onChange={setTab}
      className="lg:mx-[var(--pf-gutter)] lg:mb-[var(--pf-gutter)] lg:border lg:border-[color:var(--pf-line)]"
    />
  )

  // AFFILIATES can only be requested while the roster exists (the hook
  // falls back to RECORD otherwise), but the guard keeps the JSX honest.
  // HANGAR needs no guard: an empty fleet renders the owner's dock.
  const renderPane = (id: ProfileTabId) => {
    switch (id) {
      case 'record':
        return <RecordPane profile={profile} />
      case 'hangar':
        return <HangarPane profile={profile} isYou={isYou} onChanged={refreshProfile} />
      case 'loadout':
        return (
          <LoadoutPane
            profile={profile}
            isYou={isYou}
            onPublishAgents={() => openSettings('account')}
          />
        )
      case 'service-record':
        return <ServiceRecordPane profile={profile} isYou={isYou} />
      case 'affiliates':
        return profile.affiliates ? (
          <AffiliatesPane profile={profile} affiliates={profile.affiliates} />
        ) : (
          <RecordPane profile={profile} />
        )
      default: {
        const exhaustive: never = id
        return exhaustive
      }
    }
  }

  return (
    <div className={PAGE_WRAP}>
      {/* ---------- the sheet ----------
          lg: [spine 296px | hairline | content]. Below lg the grid is
          off and the children stack: compact bar → spine (hero) → menu
          strip → content. */}
      <section
        ref={columnRef}
        className={`${SHEET} lg:grid lg:grid-cols-[296px_1px_1fr]`}
        aria-label={`Unit record — @${profile.username}`}
      >
        {/* ---------- dot screen ----------
            The paper's grain (.pf-screen, dossier.css): an out-of-flow
            layer under every child rather than the sheet's own
            background, so its desktop drift is one composited transform
            instead of a whole-sheet repaint. Out of the grid's flow, so
            the column count above is unchanged. */}
        <span aria-hidden className="pf-screen">
          <span />
        </span>

        {/* ---------- phone compact bar ----------
            Sticky over the top of the sheet, on paper. Visible by
            default; the motion phase hides it until the hero actions
            (.pf-hero-actions) scroll away. -mb-12 lets the banner start
            underneath so the sheet's flow is unchanged. */}
        <div className="pf-compact -mb-12 h-12">
          <div className="pf-compact-inner flex h-12 items-center gap-3 border-b border-[color:var(--pf-line-soft)] px-[var(--pf-gutter)]">
            <span className="min-w-0 flex-1 truncate font-display text-[15px] font-medium leading-none">
              {profile.display_name}
            </span>
            <span className="pf-micro hidden shrink-0 tabular-nums sm:inline">
              {profile.rank !== null && `#${profile.rank} · `}
              {formatNumber(profile.score)} PTS
            </span>
            {isYou ? (
              <button
                type="button"
                onClick={openEditor}
                className="pf-plate flex h-11 shrink-0 items-center gap-1.5 px-4 font-data text-[10px] font-medium uppercase tracking-[0.18em]"
              >
                <Stroke d={PATH_EDIT} size={10} />
                EDIT
              </button>
            ) : (
              <FollowButton
                variant="paper"
                targetUserId={profile.userId}
                following={profile.viewer?.isFollowing ?? false}
                followsYou={profile.viewer?.followsYou ?? false}
                signedIn={signedIn}
                onChange={handleFollowChange}
                className="shrink-0"
              />
            )}
          </div>
        </div>

        {/* ---------- spine / phone hero ---------- */}
        <Spine
          profile={profile}
          isYou={isYou}
          signedIn={signedIn}
          recruiterHandle={recruiterHandle}
          copied={copied}
          onCopyLink={copyLink}
          onEdit={openEditor}
          onFollowChange={handleFollowChange}
          banner={desktop ? null : banner}
          menu={desktop ? menu : null}
          desktop={desktop}
        />

        {/* ---------- phone menu strip ----------
            Stuck under the compact bar (top = --pf-sticky-top + the
            bar's 3rem) for the whole scroll, since its parent is now the
            sheet itself. */}
        {!desktop && menu}

        {/* hairline track between the columns (lg). Not .pf-rule: that
            recipe is a horizontal 1px line the boot draws along x. */}
        <div aria-hidden className="hidden w-px self-stretch bg-[color:var(--pf-line-soft)] lg:block" />

        {/* ---------- content column ----------
            relative so the single .pf-scan line has a box to sweep; the
            sheet gutter on three sides. */}
        <div className="relative min-w-0 px-[var(--pf-gutter)] pb-6 pt-[var(--pf-gutter)]">
          <span aria-hidden className="pf-scan" />

          <StatusRibbon profile={profile} chase={chase} />

          {desktop && banner}

          <Dossier
            profile={profile}
            isYou={isYou}
            chase={chase}
            onEdit={openEditor}
            onRoster={setRoster}
            className="mt-5"
          />

          {/* ---------- pane frame ----------
              The panel re-keys on the tab so every switch mounts a fresh
              node for the motion hook to slide in. */}
          <Frame className="pf-panel mt-6">
            <PanelHeader
              title={PROFILE_TAB_LABEL[tab]}
              aside={paneAside(tab, profile)}
              className="px-[var(--pf-gutter)] pt-[var(--pf-inset)]"
            />
            <div key={tab} role="tabpanel" id={`pf-pane-${tab}`} aria-labelledby={`pf-tab-${tab}`}>
              {renderPane(tab)}
            </div>
          </Frame>

          <footer className="pf-panel mt-5 flex items-center justify-between gap-3 border-t border-[color:var(--pf-line-soft)] pt-3">
            <span className="pf-micro">CRIBBLE · {new Date().getFullYear()} · UNIT RECORD</span>
            <span className="pf-micro">{revStamp(profile.memberSince)}</span>
          </footer>
        </div>
      </section>

      {/* ---------- overlays ---------- */}
      {roster && (
        <FollowListModal
          username={profile.username}
          kind={roster}
          signedIn={signedIn}
          onClose={(dirty) => {
            setRoster(null)
            if (dirty) refreshProfile()
          }}
        />
      )}
      {editing && editInitial && (
        <EditProfileModal
          initial={editInitial}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            refreshProfile()
          }}
        />
      )}
      {bannerStudio && (
        <BannerStudioModal
          initialUrl={profile.banner_image || ''}
          initialFrame={profile.banner_frame ?? null}
          onClose={() => setBannerStudio(false)}
          onSaved={() => {
            setBannerStudio(false)
            refreshProfile()
          }}
        />
      )}
    </div>
  )
}
