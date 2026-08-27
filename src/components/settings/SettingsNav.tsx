'use client'

// Settings section navigation for the settings modal: 220px sidebar on
// md+, horizontally scrollable pill tabs under the modal header below md.
// Selection is plain component state owned by SettingsModal — no routes.
// The sidebar footer carries sign-out + build info.

import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsSectionId } from './sectionIds'

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const ICON_USER = (
  <IconBase>
    <circle cx="8" cy="5.25" r="2.5" />
    <path d="M2.75 13.25a5.25 5.25 0 0 1 10.5 0" />
  </IconBase>
)

const ICON_ID_CARD = (
  <IconBase>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <circle cx="5.5" cy="6.9" r="1.35" />
    <path d="M3.6 10.9c.45-.95 1.15-1.4 1.9-1.4s1.45.45 1.9 1.4" />
    <path d="M9.25 6.5h3.25M9.25 9h2.25" />
  </IconBase>
)

const ICON_SUN = (
  <IconBase>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06" />
  </IconBase>
)

const ICON_BELL = (
  <IconBase>
    <path d="M8 2.25a3.9 3.9 0 0 0-3.9 3.9v1.9c0 .55-.18 1.08-.52 1.51l-.68.88c-.4.52-.03 1.28.63 1.28h8.94c.66 0 1.03-.76.63-1.28l-.68-.88a2.47 2.47 0 0 1-.52-1.51v-1.9A3.9 3.9 0 0 0 8 2.25Z" />
    <path d="M6.6 13.75a1.4 1.4 0 0 0 2.8 0" />
  </IconBase>
)

const ICON_SHIELD = (
  <IconBase>
    <path d="M8 1.75 13 3.7v4.3c0 3.17-2.13 5.42-5 6.55C5.13 13.42 3 11.17 3 8V3.7Z" />
    <path d="m5.9 8 1.5 1.5 2.7-2.7" />
  </IconBase>
)

const ICON_CARD = (
  <IconBase>
    <rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.5" />
    <path d="M1.75 6.75h12.5M4.25 9.75h2.5" />
  </IconBase>
)

const ICON_SIGN_OUT = (
  <IconBase>
    <path d="M6.25 2.75H4.1c-.75 0-1.35.6-1.35 1.35v7.8c0 .75.6 1.35 1.35 1.35h2.15" />
    <path d="M10.25 5.25 13 8l-2.75 2.75M13 8H6.25" />
  </IconBase>
)

interface SettingsNavItem {
  id: SettingsSectionId
  label: string
  icon: ReactNode
}

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: 'account', label: 'Account', icon: ICON_USER },
  { id: 'profile', label: 'Profile', icon: ICON_ID_CARD },
  { id: 'appearance', label: 'Appearance', icon: ICON_SUN },
  { id: 'notifications', label: 'Notifications', icon: ICON_BELL },
  { id: 'privacy', label: 'Privacy', icon: ICON_SHIELD },
  { id: 'billing', label: 'Billing', icon: ICON_CARD }
]

export interface SettingsNavProps {
  section: SettingsSectionId
  onSelect: (section: SettingsSectionId) => void
}

export function SettingsSidebar({ section, onSelect }: SettingsNavProps) {
  const [signingOut, setSigningOut] = useState(false)

  // Mirrors useNavUser.logout, but with a hard navigation so every piece
  // of in-memory session state is dropped with the page.
  const handleSignOut = useCallback(async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      window.location.href = '/login'
    }
  }, [signingOut])

  return (
    <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[color:var(--st-border)] p-3 md:flex">
      <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const active = item.id === section
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13.5px] leading-5 transition-colors duration-150 ${
                active
                  ? 'bg-[color:var(--st-panel-hover)] font-medium text-[color:var(--st-text)]'
                  : 'text-[color:var(--st-text-muted)] hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]'
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto border-t border-[color:var(--st-border)] pt-3">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] leading-5 text-[color:var(--st-text-muted)] transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)] disabled:cursor-wait disabled:opacity-60"
        >
          <span className="shrink-0">{ICON_SIGN_OUT}</span>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        <p className="mt-3 px-2.5 text-[11px] leading-4 text-[color:var(--st-text-faint)]">
          v0.1.1 · Private beta
        </p>
      </div>
    </aside>
  )
}

export function SettingsMobileTabs({ section, onSelect }: SettingsNavProps) {
  return (
    <nav
      aria-label="Settings sections"
      className="st-no-scrollbar flex shrink-0 snap-x gap-2 overflow-x-auto border-b border-[color:var(--st-border)] px-4 py-3 sm:px-6 md:hidden"
    >
      {SETTINGS_NAV_ITEMS.map((item) => {
        const active = item.id === section
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'true' : undefined}
            className={`inline-flex min-h-11 shrink-0 snap-start items-center whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium leading-5 transition-colors duration-150 ${
              active
                ? 'border-transparent bg-[color:var(--st-accent)] text-[color:var(--st-accent-contrast)]'
                : 'border-[color:var(--st-border)] text-[color:var(--st-text-muted)] hover:text-[color:var(--st-text)]'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
