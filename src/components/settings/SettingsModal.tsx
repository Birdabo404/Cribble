'use client'

// The floating settings dialog — replaces the old /settings/* pages.
// Everything inside lives in the .settings-scope monochrome design system
// (see globals.css): components style with the scoped --st-* tokens only,
// never zinc/gray utilities. Fixed-height panel, 220px section sidebar on
// md+ (pill tabs below md), content scrolls per section.
//
// Portals to <body> like FeedbackModal: nav backdrop-filter traps fixed
// overlays, and z-[80] keeps it above page chrome (toasts sit at z-[90]
// so save feedback fired from inside the modal stays visible).

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { SettingsSectionId } from './sectionIds'
import { SettingsMobileTabs, SettingsSidebar } from './SettingsNav'
import { AccountSection } from './sections/AccountSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { BillingSection } from './sections/BillingSection'
import { NotificationsSection } from './sections/NotificationsSection'
import { PrivacySection } from './sections/PrivacySection'
import { ProfileSection } from './sections/ProfileSection'

const SECTION_COMPONENTS: Record<SettingsSectionId, () => React.JSX.Element> = {
  account: AccountSection,
  profile: ProfileSection,
  appearance: AppearanceSection,
  notifications: NotificationsSection,
  privacy: PrivacySection,
  billing: BillingSection
}

export interface SettingsModalProps {
  section: SettingsSectionId
  /** Geist variable class (--font-settings), loaded by the (app) layout. */
  fontVariable: string
  onSelectSection: (section: SettingsSectionId) => void
  onClose: () => void
}

export function SettingsModal({
  section,
  fontVariable,
  onSelectSection,
  onClose
}: SettingsModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const ActiveSection = SECTION_COMPONENTS[section]

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className={`settings-scope ${fontVariable} relative flex h-full max-h-[720px] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-[color:var(--st-border-strong)]`}
        style={{
          // .settings-scope carries a full-viewport min-height from its
          // full-page era — the panel must size to the dialog instead.
          minHeight: 0,
          background: 'var(--st-canvas)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)',
          animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards'
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[color:var(--st-border)] px-5 py-4 sm:px-6">
          <div>
            <h1 className="text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[color:var(--st-text)]">
              Settings
            </h1>
            <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]">
              Manage your account, preferences, and subscription.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="-mr-1.5 -mt-1 shrink-0 rounded-md p-1.5 text-[color:var(--st-text-muted)] transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </header>

        <SettingsMobileTabs section={section} onSelect={onSelectSection} />

        <div className="flex min-h-0 flex-1">
          <SettingsSidebar section={section} onSelect={onSelectSection} />
          {/* keyed by section so switching remounts content — fresh fetch,
              scroll reset to the top */}
          <main key={section} className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <ActiveSection />
          </main>
        </div>
      </div>
    </div>,
    document.body
  )
}
