'use client'

// Notification preferences — per-category feed toggles plus the email
// newsletter opt-in, backed by GET/PATCH /api/user/settings (metadata
// JSONB). Toggles save immediately: optimistic flip, patch just the
// changed key, then write the server's echo back into state; failures
// revert the flip and surface a toast. 'system' rows are always on by
// design and render as a disabled switch.

import { useEffect, useState } from 'react'
import { toast } from '@/components/Toaster'
import type { NotificationPrefCategory, NotificationPrefs } from '@/lib/notificationPrefs'
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  SkeletonRow,
  Switch
} from '@/components/settings'

interface Preferences {
  notifications: NotificationPrefs
  newsletter: boolean
}

const CATEGORY_ROWS: readonly {
  key: NotificationPrefCategory
  label: string
  description: string
}[] = [
  { key: 'rank', label: 'Rank & milestones', description: 'Rank changes and score milestones.' },
  { key: 'achievements', label: 'Achievements', description: 'When you unlock an achievement.' },
  { key: 'social', label: 'Social', description: 'New followers.' },
  { key: 'team', label: 'Team', description: 'Team invites and membership changes.' },
  { key: 'season', label: 'Season', description: 'Season starts, endings, and results.' },
  { key: 'shop', label: 'Shop & Premium', description: 'Cosmetics drops and premium updates.' }
]

function LoadFailedRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5 sm:px-5 sm:py-4">
      <p className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
        Couldn&apos;t load your notification preferences.
      </p>
      <SettingsButton variant="ghost" onClick={onRetry}>
        Retry
      </SettingsButton>
    </div>
  )
}

export default function NotificationsSettingsPage() {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPrefs(null)
    setLoadFailed(false)

    fetch('/api/user/settings', { cache: 'no-store', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.success && data.preferences) {
          setPrefs(data.preferences as Preferences)
        } else {
          setLoadFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  /** PATCH one changed key; apply/revert are pure state transforms so
   *  concurrent toggles of other keys are never clobbered on revert. */
  const persist = async (
    body: { notifications?: Partial<NotificationPrefs>; newsletter?: boolean },
    apply: (prev: Preferences) => Preferences,
    revert: (prev: Preferences) => Preferences
  ) => {
    setPrefs((prev) => (prev ? apply(prev) : prev))
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data.preferences) throw new Error('save failed')
      setPrefs(data.preferences as Preferences)
    } catch {
      setPrefs((prev) => (prev ? revert(prev) : prev))
      toast({
        kind: 'error',
        title: 'SAVE FAILED',
        body: 'Could not update your notification preferences. Try again.'
      })
    }
  }

  const toggleCategory = (key: NotificationPrefCategory, value: boolean) =>
    persist(
      { notifications: { [key]: value } },
      (prev) => ({ ...prev, notifications: { ...prev.notifications, [key]: value } }),
      (prev) => ({ ...prev, notifications: { ...prev.notifications, [key]: !value } })
    )

  const toggleNewsletter = (value: boolean) =>
    persist(
      { newsletter: value },
      (prev) => ({ ...prev, newsletter: value }),
      (prev) => ({ ...prev, newsletter: !value })
    )

  const loading = prefs === null && !loadFailed
  const retry = () => setAttempt((n) => n + 1)

  return (
    <div className="space-y-8">
      <SettingsSection
        title="In-app notifications"
        description="Choose what shows up in your notification feed."
      >
        {loading &&
          Array.from({ length: 7 }, (_, i) => <SkeletonRow key={i} />)}
        {loadFailed && <LoadFailedRow onRetry={retry} />}
        {prefs && (
          <>
            {CATEGORY_ROWS.map((row) => (
              <SettingsRow key={row.key} label={row.label} description={row.description}>
                <Switch
                  checked={prefs.notifications[row.key]}
                  onChange={(value) => toggleCategory(row.key, value)}
                  aria-label={row.label}
                />
              </SettingsRow>
            ))}
            <SettingsRow
              label="System announcements"
              description="Important service updates. Always on."
            >
              <Switch checked disabled onChange={() => {}} aria-label="System announcements" />
            </SettingsRow>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Email">
        {loading && <SkeletonRow />}
        {loadFailed && <LoadFailedRow onRetry={retry} />}
        {prefs && (
          <SettingsRow
            label="Product newsletter"
            description="Occasional product news and feature releases."
          >
            <Switch
              checked={prefs.newsletter}
              onChange={toggleNewsletter}
              aria-label="Product newsletter"
            />
          </SettingsRow>
        )}
      </SettingsSection>
    </div>
  )
}
