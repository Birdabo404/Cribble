'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { formatRelative, tierAccent } from '@/components/dashboard-v2/format'
import { ThemeToggle } from '@/components/ThemeToggle'
import { DeleteAccountModal } from '@/components/dashboard-v3/DeleteAccountModal'
import { useNavPrefs, type NavPosition } from '@/components/nav/NavPrefsContext'
import type { ActiveDevice, MeUser } from '@/types/dashboard'

type ModalId = 'store' | 'settings' | 'privacy' | 'delete'

/* ---------- icons (14px, stroke) ---------- */

function Icon({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  profile: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  award:
    'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M8.21 13.89 7 23l5-3 5 3-1.21-9.12',
  store: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  monetization:
    'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z M15 9.35A3.5 3.5 0 0 0 12.5 8.5h-1a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4h-1A3.5 3.5 0 0 1 9 15.65 M12 6.5v2 M12 15.5v2',
  privacy:
    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  signout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  trash:
    'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M10 11v6 M14 11v6'
}

/* ---------- modal shell ---------- */

function MenuModal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portaled to <body>: the nav chrome (rail/top bar) uses backdrop-filter,
  // which turns it into the containing block for position:fixed children —
  // without the portal this overlay would be trapped inside the nav.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative w-full max-w-md rounded-2xl glass-pop overflow-hidden"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="h-4 w-4">
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-[10px] tracking-[0.3em] text-zinc-500">{label}</span>
      <span className="text-xs text-zinc-200 flex items-center gap-2 min-w-0">{children}</span>
    </div>
  )
}

/** Section header + bordered card. Structure comes from grouping and
 *  hairlines, not from color — the accent stays out of it on purpose. */
function SettingSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-1.5 pb-1.5 text-[8px] tracking-[0.35em] text-zinc-600">{label}</div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.06]">
        {children}
      </div>
    </div>
  )
}

/* ---------- modal bodies ---------- */

function StoreModal({ onClose }: { onClose: () => void }) {
  const shelves = ['BOOSTS', 'THEMES', 'SEASON PASS']
  return (
    <MenuModal title="STORE" onClose={onClose}>
      <div className="p-5">
        <p className="text-xs text-zinc-400 leading-relaxed">
          The Cribble store is being stocked. Boosts, cosmetics, and season passes will land here.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {shelves.map((s) => (
            <div
              key={s}
              className="rounded-lg liquid-glass-inset px-3 py-4 text-center"
            >
              <div className="text-lg text-zinc-600">???</div>
              <div className="mt-1.5 text-[9px] tracking-[0.25em] text-zinc-500">{s}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-center text-[9px] tracking-[0.35em] text-accent/70">
          COMING SOON
        </div>
      </div>
    </MenuModal>
  )
}

/** LEFT / TOP segmented control. Hidden entirely outside the app shell
 *  (useNavPrefs returns null without a provider). */
function NavPositionToggle() {
  const prefs = useNavPrefs()
  if (!prefs) return null

  const options: { id: NavPosition; label: string; title: string }[] = [
    { id: 'left', label: 'LEFT', title: 'Side rail (desktop; mobile keeps the top bar)' },
    { id: 'top', label: 'TOP', title: 'Sticky top bar' }
  ]

  return (
    <span className="flex overflow-hidden rounded-lg border border-white/[0.08]">
      {options.map((opt) => {
        const active = prefs.position === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            aria-pressed={active}
            onClick={() => prefs.setPosition(opt.id)}
            className={`px-3 py-1.5 text-[9px] tracking-[0.3em] transition-colors ${
              active
                ? 'bg-accent/15 text-accent'
                : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </span>
  )
}

function SettingsModal({
  user,
  activeDevice,
  onClose,
  onDeleteAccount
}: {
  user: MeUser
  activeDevice: ActiveDevice | null
  onClose: () => void
  onDeleteAccount: () => void
}) {
  return (
    <MenuModal title="SETTINGS" onClose={onClose}>
      <div className="space-y-4 p-4">
        <SettingSection label="PREFERENCES">
          <SettingRow label="APPEARANCE">
            <ThemeToggle />
          </SettingRow>
          <SettingRow label="NAV BAR">
            <NavPositionToggle />
          </SettingRow>
        </SettingSection>

        <SettingSection label="ACCOUNT">
          <SettingRow label="SIGNED IN AS">
            <span className="truncate">@{user.twitter_username || 'user'}</span>
          </SettingRow>
          <SettingRow label="DEVICE">
            {activeDevice ? `${activeDevice.device_uuid.slice(0, 8)}…` : 'Not linked'}
          </SettingRow>
          <SettingRow label="LAST SYNC">
            {formatRelative(activeDevice?.last_sync_at || user.last_extension_sync)}
          </SettingRow>
        </SettingSection>

        <SettingSection label="DATA">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.3em] text-zinc-400">DELETE ACCOUNT</div>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                Erase your account and every trace of your data. Permanent.
              </p>
            </div>
            <button
              type="button"
              onClick={onDeleteAccount}
              className="shrink-0 rounded-lg border border-rose-400/30 px-3 py-1.5 text-[9px] tracking-[0.3em] text-rose-300 transition-colors hover:border-rose-400/50 hover:bg-rose-500/10"
            >
              DELETE…
            </button>
          </div>
        </SettingSection>

        <div className="pt-1 text-center text-[9px] tracking-[0.3em] text-zinc-600">
          v3 · PRIVATE BETA
        </div>
      </div>
    </MenuModal>
  )
}

function PrivacyModal({
  onClose,
  onDeleteAccount
}: {
  onClose: () => void
  onDeleteAccount: () => void
}) {
  const items: { title: string; icon: string; body: string }[] = [
    {
      title: 'SESSION',
      icon: ICONS.key,
      body: 'You sign in through X or GitHub OAuth — Cribble never sees a password and stores no email address. Signing out invalidates the session immediately.'
    },
    {
      title: 'TELEMETRY',
      icon: ICONS.activity,
      body: 'The extension records domain-level activity only — which AI tools you use and for how long. Page content, prompts, and conversations are never captured.'
    }
  ]
  return (
    <MenuModal title="PRIVACY & SECURITY" onClose={onClose}>
      <div className="space-y-2.5 p-4">
        {items.map((it) => (
          <div
            key={it.title}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
          >
            <div className="flex items-center gap-2 text-zinc-500">
              <Icon d={it.icon} className="h-3 w-3" />
              <span className="text-[9px] tracking-[0.3em]">{it.title}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{it.body}</p>
          </div>
        ))}

        <div className="rounded-xl border border-rose-500/[0.16] bg-rose-500/[0.03] px-3.5 py-3">
          <div className="flex items-center gap-2 text-zinc-500">
            <span className="text-rose-300/70">
              <Icon d={ICONS.trash} className="h-3 w-3" />
            </span>
            <span className="text-[9px] tracking-[0.3em]">DATA CONTROL</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
            Deleting your account erases your profile, scores, devices, and activity history —
            immediately and permanently, as required by GDPR Art. 17. Waitlist emails can be
            removed in the same step.
          </p>
          <button
            type="button"
            onClick={onDeleteAccount}
            className="mt-2.5 w-full rounded-lg border border-rose-400/30 px-3 py-2 text-[9px] tracking-[0.3em] text-rose-300 transition-colors hover:border-rose-400/50 hover:bg-rose-500/10"
          >
            DELETE MY ACCOUNT…
          </button>
        </div>
      </div>
    </MenuModal>
  )
}

/* ---------- dropdown ---------- */

export function AccountMenu({
  user,
  activeDevice,
  onLogout,
  variant = 'pill'
}: {
  user: MeUser
  activeDevice: ActiveDevice | null
  onLogout: () => void
  /** 'pill' = avatar pill for the top bar; 'rail' = command-rail row with a
   *  menu flying out to the right. */
  variant?: 'pill' | 'rail'
}) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<ModalId | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openModal = (id: ModalId) => {
    setOpen(false)
    setModal(id)
  }

  const itemCls =
    'w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[11px] tracking-[0.2em] text-zinc-300 hover:text-zinc-50 hover:bg-white/[0.05] transition-colors'

  const renderModal = () => {
    if (modal === null) return null
    switch (modal) {
      case 'store':
        return <StoreModal onClose={() => setModal(null)} />
      case 'settings':
        return (
          <SettingsModal
            user={user}
            activeDevice={activeDevice}
            onClose={() => setModal(null)}
            onDeleteAccount={() => setModal('delete')}
          />
        )
      case 'privacy':
        return (
          <PrivacyModal
            onClose={() => setModal(null)}
            onDeleteAccount={() => setModal('delete')}
          />
        )
      case 'delete':
        return (
          <DeleteAccountModal
            username={user.twitter_username || 'user'}
            onClose={() => setModal(null)}
          />
        )
      default: {
        const exhaustive: never = modal
        return exhaustive
      }
    }
  }

  const avatar = (sizeCls: string) =>
    user.twitter_profile_image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.twitter_profile_image}
        alt={user.twitter_username}
        className={`${sizeCls} rounded-full border border-zinc-800 object-cover`}
      />
    ) : (
      <div className={`${sizeCls} rounded-full border border-zinc-800 bg-zinc-900`} />
    )

  const menuPlacementCls =
    variant === 'rail'
      ? 'absolute top-0 left-full ml-3 w-64 origin-top-left'
      : 'absolute right-0 top-full mt-2 w-64 origin-top-right'
  const menuAnimation =
    variant === 'rail'
      ? 'glass-pop-in-side 180ms cubic-bezier(0.22, 1, 0.36, 1) backwards'
      : 'glass-pop-in 180ms cubic-bezier(0.22, 1, 0.36, 1) backwards'

  return (
    <div ref={rootRef} className="relative">
      {variant === 'rail' ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`nav-row relative mx-2 flex h-10 w-[calc(100%-16px)] shrink-0 items-center rounded-lg transition-colors ${
            open
              ? 'bg-white/[0.06] text-zinc-100'
              : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
          }`}
          aria-label="Open account menu"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className="flex w-12 shrink-0 items-center justify-center">
            {avatar('h-6 w-6')}
          </span>
          <span className="nav-label-clip">
            <span className="nav-label">
              <span className="truncate text-[10px] tracking-[0.25em] text-zinc-200">
                @{user.twitter_username || 'user'}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                className={`ml-auto mr-4 h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-200 ${
                  open ? 'rotate-180' : ''
                }`}
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
                />
              </svg>
            </span>
          </span>
          <span className="nav-tip glass-pop rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.3em] text-zinc-200">
            @{user.twitter_username || 'user'}
          </span>
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full border bg-zinc-950/70 transition-colors ${
            open ? 'border-accent/50' : 'border-zinc-800 hover:border-accent/40 hover:bg-zinc-900/80'
          }`}
          aria-label="Open account menu"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          {avatar('h-7 w-7')}
          <span className="hidden sm:inline text-[11px] text-zinc-100">
            @{user.twitter_username || 'user'}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            className={`h-3 w-3 text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          >
            <path
              fill="currentColor"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
            />
          </svg>
        </button>
      )}

      {open && (
        <div
          role="menu"
          className={`${menuPlacementCls} rounded-xl glass-pop overflow-hidden z-50`}
          style={{ animation: menuAnimation }}
        >
          {/* identity strip */}
          <div className="flex items-center gap-3 px-3.5 py-3 border-b border-white/[0.08]">
            {user.twitter_profile_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.twitter_profile_image}
                alt={user.twitter_username}
                className="h-9 w-9 rounded-full border border-zinc-800 object-cover"
              />
            ) : (
              <div className="h-9 w-9 rounded-full border border-zinc-800 bg-zinc-900" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-50 truncate">
                {user.twitter_name || user.twitter_username || 'User'}
              </div>
              <div className="text-[10px] text-zinc-500 truncate">
                @{user.twitter_username || 'user'}
              </div>
            </div>
            <span
              className={`text-[8px] tracking-[0.25em] px-1.5 py-0.5 rounded border shrink-0 ${tierAccent(user.subscription_tier)}`}
            >
              {(user.subscription_tier || 'FREE').toUpperCase()}
            </span>
          </div>

          <div className="py-1.5">
            <a
              href={
                user.twitter_username
                  ? `/u/${encodeURIComponent(user.twitter_username)}`
                  : '/profile'
              }
              role="menuitem"
              className={itemCls}
            >
              <span className="text-accent/70">
                <Icon d={ICONS.profile} />
              </span>
              PROFILE
              <span className="ml-auto text-zinc-600">→</span>
            </a>
            <a href="/dashboard/achievements" role="menuitem" className={itemCls}>
              <span className="text-accent/70">
                <Icon d={ICONS.award} />
              </span>
              ACHIEVEMENTS
              <span className="ml-auto text-zinc-600">→</span>
            </a>
            <button role="menuitem" onClick={() => openModal('store')} className={itemCls}>
              <span className="text-accent/70">
                <Icon d={ICONS.store} />
              </span>
              STORE
            </button>
            <button role="menuitem" onClick={() => openModal('settings')} className={itemCls}>
              <span className="text-accent/70">
                <Icon d={ICONS.settings} />
              </span>
              SETTINGS
            </button>
            <button
              role="menuitem"
              disabled
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[11px] tracking-[0.2em] text-zinc-600 cursor-not-allowed"
            >
              <span className="text-zinc-700">
                <Icon d={ICONS.monetization} />
              </span>
              MONETIZATION
              <span className="ml-auto text-[8px] tracking-[0.25em] px-1.5 py-0.5 rounded border border-accent/30 text-accent/80 bg-accent/5">
                SOON
              </span>
            </button>
            <button role="menuitem" onClick={() => openModal('privacy')} className={itemCls}>
              <span className="text-accent/70">
                <Icon d={ICONS.privacy} />
              </span>
              PRIVACY & SECURITY
            </button>
          </div>

          <div className="border-t border-white/[0.08] py-1.5">
            <button
              role="menuitem"
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[11px] tracking-[0.2em] text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition-colors"
            >
              <Icon d={ICONS.signout} />
              SIGN OUT
            </button>
          </div>
        </div>
      )}

      {renderModal()}
    </div>
  )
}
