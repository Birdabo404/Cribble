'use client'

// Account section — read-only OAuth identity, extension/device link state,
// session sign-out, and the GDPR erasure flow. The delete request mirrors
// the old DeleteAccountModal exactly: typed DELETE confirmation, optional
// waitlist email, then a hard replace to / on success (every piece of
// client state belongs to an account that no longer exists).

import { useCallback, useEffect, useState } from 'react'
import { formatRelative } from '@/components/dashboard-v2/format'
import {
  DangerZone,
  SettingsButton,
  SettingsRow,
  SettingsSection,
  SkeletonRow,
  TextField
} from '@/components/settings'
import { fetchMe } from '@/lib/client/fetchMe'
import {
  EXTENSION_INSTALL_URL,
  FIREFOX_EXTENSION_INSTALL_URL,
  isExtensionUnlinked
} from '@/lib/extensionInstall'
import type { ActiveDevice, MeUser, Tier } from '@/types/dashboard'
import { AgentCliSection } from '@/components/settings/AgentCliSection'
import { CursorProfileSection } from '@/components/settings/CursorProfileSection'

type MeState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; user: MeUser; activeDevice: ActiveDevice | null }

const IDENTITY_DESCRIPTION =
  'Your name, handle, and avatar come from the account you signed in with, so they are not editable here.'

// The /api/user/me response carries no auth-provider field, so no X/GitHub
// provider badge is shown — identity is presented provider-agnostically.

function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'FREE':
      return 'Free'
    case 'BASIC':
      return 'Basic'
    case 'PRO':
      return 'Pro'
    case 'PREMIUM':
      return 'Premium'
    case 'PREMIUM+':
      return 'Premium+'
    case 'AFFILIATE':
      return 'Affiliate'
    case 'TEAM':
      return 'Team'
    default: {
      const exhaustive: never = tier
      return exhaustive
    }
  }
}

/** Anchor styled like the solid SettingsButton (external store link). */
const installLinkCls =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-transparent bg-[color:var(--st-accent)] px-3 text-[13px] font-medium leading-none text-[color:var(--st-accent-contrast)] transition-colors duration-150 hover:opacity-90 md:h-8'

// One install link per live store listing. Settings can't know which
// browser the user will install in, so every live store gets a link.
const INSTALL_LINKS: { label: string; url: string }[] = [
  ...(EXTENSION_INSTALL_URL !== null
    ? [{ label: 'Install for Chrome', url: EXTENSION_INSTALL_URL }]
    : []),
  ...(FIREFOX_EXTENSION_INSTALL_URL !== null
    ? [{ label: 'Install for Firefox', url: FIREFOX_EXTENSION_INSTALL_URL }]
    : [])
]

/**
 * Link-state row. Three states, matching isExtensionUnlinked semantics:
 * an account that synced before but has no active device is offline, not
 * unlinked — it should not be told to install again.
 */
function DeviceRow({
  user,
  activeDevice
}: {
  user: MeUser
  activeDevice: ActiveDevice | null
}) {
  if (activeDevice) {
    return (
      <SettingsRow
        label="Linked device"
        description={`Last synced ${formatRelative(
          activeDevice.last_sync_at || user.last_extension_sync
        )}`}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--st-accent)]"
          />
          <span className="font-data text-[12.5px] leading-5 text-[color:var(--st-text)]">
            {activeDevice.device_uuid.slice(0, 8)}…
          </span>
        </span>
      </SettingsRow>
    )
  }

  if (!isExtensionUnlinked(user, activeDevice)) {
    return (
      <SettingsRow
        label="Extension offline"
        description={`Last synced ${formatRelative(
          user.last_extension_sync
        )}. Open a browser with the extension enabled to reconnect.`}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--st-text-faint)]"
          />
          <span className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            Not connected
          </span>
        </span>
      </SettingsRow>
    )
  }

  return (
    <SettingsRow
      label="No device linked"
      description="Install the browser extension to link this device and start counting your AI activity."
      stack
    >
      {INSTALL_LINKS.length > 0 ? (
        <span className="flex flex-wrap items-center gap-2">
          {INSTALL_LINKS.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={installLinkCls}
            >
              {link.label}
            </a>
          ))}
        </span>
      ) : undefined}
    </SettingsRow>
  )
}

export function AccountSection() {
  const [me, setMe] = useState<MeState>({ phase: 'loading' })
  const [signingOut, setSigningOut] = useState(false)

  // Inline delete-confirmation flow (expands within the danger card).
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [email, setEmail] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setMe({ phase: 'loading' })
    // Shared /me client cache (failures are never cached, so the retry
    // button always refetches).
    const result = await fetchMe()
    if (!result.ok || !result.data.user) {
      setMe({ phase: 'error' })
      return
    }
    setMe({
      phase: 'ready',
      user: result.data.user,
      activeDevice: result.data.activeDevice ?? null
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Mirrors useNavUser.logout, with a hard navigation so all in-memory
  // session state drops with the page.
  const signOut = useCallback(async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      window.location.href = '/login'
    }
  }, [signingOut])

  const armed = confirmText.trim().toUpperCase() === 'DELETE'

  const closeConfirm = useCallback(() => {
    if (deleting) return
    setConfirmOpen(false)
    setConfirmText('')
    setEmail('')
    setDeleteError(null)
  }, [deleting])

  const destroy = useCallback(async () => {
    if (!armed || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/user/delete', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: 'DELETE',
          ...(email.trim() ? { email: email.trim() } : {})
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Deletion failed')
      }
      // Hard navigation: every piece of client state (nav user, caches)
      // belongs to an account that no longer exists.
      window.location.replace('/')
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Deletion failed')
      setDeleting(false)
    }
  }, [armed, deleting, email])

  const username = me.phase === 'ready' ? me.user.twitter_username : null

  return (
    <div className="space-y-8">
      {me.phase === 'loading' && (
        <>
          <SettingsSection title="Identity" description={IDENTITY_DESCRIPTION}>
            <SkeletonRow />
          </SettingsSection>
          <SettingsSection title="Extension & device">
            <SkeletonRow />
          </SettingsSection>
        </>
      )}

      {me.phase === 'error' && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-4 py-4 [box-shadow:var(--st-panel-shadow)] sm:px-5">
          <p className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            Could not load your account details.
          </p>
          <SettingsButton variant="ghost" onClick={() => void load()}>
            Try again
          </SettingsButton>
        </div>
      )}

      {me.phase === 'ready' && (
        <>
          <SettingsSection title="Identity" description={IDENTITY_DESCRIPTION}>
            {/* flex-wrap + the name block's 10rem basis: when avatar +
                name + tier pill can't share ~390px, the pill wraps to
                its own line instead of crushing the name. One line
                everywhere >= sm (basis-0 restores flex-1 behavior). */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
              {me.user.twitter_profile_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={me.user.twitter_profile_image}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-full border border-[color:var(--st-border)] object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--st-border)] bg-[color:var(--st-panel-hover)] text-[16px] font-semibold text-[color:var(--st-text-muted)]"
                >
                  {(me.user.twitter_name || me.user.twitter_username || '?')
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
              )}
              <div className="min-w-0 grow basis-40 sm:basis-0">
                <div className="truncate text-[15px] font-medium leading-6 text-[color:var(--st-text)]">
                  {me.user.twitter_name || me.user.twitter_username || 'User'}
                </div>
                <div className="truncate text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                  @{me.user.twitter_username || 'user'}
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-[color:var(--st-border-strong)] px-2.5 py-0.5 text-[12px] font-medium leading-5 text-[color:var(--st-text-muted)]">
                {tierLabel(me.user.subscription_tier ?? 'FREE')} plan
              </span>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Extension & device"
            description="Cribble counts activity through the browser extension linked to this account."
          >
            <DeviceRow user={me.user} activeDevice={me.activeDevice} />
          </SettingsSection>
        </>
      )}

      <AgentCliSection />

      <CursorProfileSection />

      <SettingsSection title="Session">
        <SettingsRow
          label="Sign out"
          description="Signing out invalidates this session immediately."
        >
          <SettingsButton variant="ghost" onClick={() => void signOut()} pending={signingOut}>
            Sign out
          </SettingsButton>
        </SettingsRow>
      </SettingsSection>

      <DangerZone>
        <SettingsRow
          label="Delete account"
          description="Erases your profile, scores, devices, and activity history — immediately and permanently."
          stack
        >
          {confirmOpen ? undefined : (
            <SettingsButton variant="danger-outline" onClick={() => setConfirmOpen(true)}>
              Delete account…
            </SettingsButton>
          )}
        </SettingsRow>

        {confirmOpen && (
          <div
            className="space-y-4 px-4 py-4 sm:px-5"
            role="group"
            aria-label="Confirm account deletion"
          >
            <p className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
              You are about to erase{' '}
              <span className="font-medium text-[color:var(--st-text)]">
                {username ? `@${username}` : 'your account'}
              </span>
              . This is immediate and permanent — there is no undo and no recovery window.
              Erasure is processed under GDPR Art. 17.
            </p>

            <TextField
              label="Waitlist email"
              description="Also remove this email from the waitlist (optional). Your account itself stores no email address."
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={deleting}
            />

            <TextField
              label="Type DELETE to confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              spellCheck={false}
              disabled={deleting}
            />

            {deleteError && (
              <p role="alert" className="text-[13px] leading-5 text-[color:var(--st-danger)]">
                {deleteError}
              </p>
            )}

            {/* Two full-width halves below sm (grid cells stretch the
                intrinsic-width buttons); the compact right-aligned pair
                from sm up. */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end sm:gap-1.5">
              <SettingsButton variant="ghost" onClick={closeConfirm} disabled={deleting}>
                Cancel
              </SettingsButton>
              <SettingsButton
                variant="danger-outline"
                onClick={() => void destroy()}
                pending={deleting}
                disabled={!armed}
              >
                Delete forever
              </SettingsButton>
            </div>
          </div>
        )}
      </DangerZone>
    </div>
  )
}
