'use client'

// Privacy settings — the private-account and aggregate-insights toggles
// (is_private / insights_opt_out via GET/PATCH /api/user/profile; the
// PATCH echoes only { success }, so both switches are optimistic with
// revert-on-failure) plus static explainer rows covering sign-in,
// telemetry and deletion, ported from the old PrivacyModal copy in
// sentence case. The insights switch reads positively (checked =
// included), so it maps to the inverse of the stored opt-out flag.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from '@/components/Toaster'
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  SkeletonRow,
  Switch
} from '@/components/settings'

function LoadFailedRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5 sm:px-5 sm:py-4">
      <p className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
        Couldn&apos;t load your profile visibility.
      </p>
      <SettingsButton variant="ghost" onClick={onRetry}>
        Retry
      </SettingsButton>
    </div>
  )
}

const inlineLinkCls =
  'font-medium text-[color:var(--st-text)] underline decoration-[color:var(--st-border-strong)] underline-offset-2 transition-colors duration-150 hover:decoration-[color:var(--st-text)]'

export default function PrivacySettingsPage() {
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null)
  const [insightsIncluded, setInsightsIncluded] = useState<boolean | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsPrivate(null)
    setInsightsIncluded(null)
    setLoadFailed(false)

    fetch('/api/user/profile', { cache: 'no-store', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.success && data.profile) {
          setIsPrivate(data.profile.is_private === true)
          setInsightsIncluded(data.profile.insights_opt_out !== true)
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

  const togglePrivate = async (value: boolean) => {
    setIsPrivate(value)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_private: value })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) throw new Error('save failed')
    } catch {
      setIsPrivate(!value)
      toast({
        kind: 'error',
        title: 'SAVE FAILED',
        body: 'Could not update your profile visibility. Try again.'
      })
    }
  }

  const toggleInsights = async (value: boolean) => {
    setInsightsIncluded(value)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insights_opt_out: !value })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) throw new Error('save failed')
    } catch {
      setInsightsIncluded(!value)
      toast({
        kind: 'error',
        title: 'SAVE FAILED',
        body: 'Could not update your aggregate insights preference. Try again.'
      })
    }
  }

  const loading = isPrivate === null && !loadFailed

  return (
    <div className="space-y-8">
      <SettingsSection title="Profile visibility">
        {loading && <SkeletonRow />}
        {loadFailed && <LoadFailedRow onRetry={() => setAttempt((n) => n + 1)} />}
        {isPrivate !== null && (
          <SettingsRow
            label="Private account"
            description="Only followers can see your tools, badges, and achievements. Your rank stays visible on the leaderboard."
          >
            <Switch checked={isPrivate} onChange={togglePrivate} aria-label="Private account" />
          </SettingsRow>
        )}
        {insightsIncluded !== null && (
          <SettingsRow
            label="Aggregate insights"
            description="Count your activity in anonymized, aggregated usage trends — totals across many users, never your individual data. Turn off to be excluded."
          >
            <Switch
              checked={insightsIncluded}
              onChange={toggleInsights}
              aria-label="Aggregate insights"
            />
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title="How Cribble handles your data">
        <SettingsRow
          label="Sign-in"
          description="You sign in through X or GitHub OAuth. Cribble never sees a password and stores no email address. Signing out invalidates the session immediately."
        />
        <SettingsRow
          label="Telemetry"
          description="The extension records domain-level activity only — which AI tools you use and for how long. Page content, prompts, and conversations are never captured."
        />
        <SettingsRow
          label="Data deletion"
          description={
            <>
              Deleting your account erases your profile, scores, devices, and activity history —
              immediately and permanently, as required by GDPR Art. 17.{' '}
              <Link href="/settings/account" className={inlineLinkCls}>
                Delete your account in Account settings →
              </Link>
            </>
          }
        />
        <SettingsRow
          label="Privacy policy"
          description={
            <>
              The full policy covering the site and the extension.{' '}
              <Link href="/privacy" className={inlineLinkCls}>
                Read the privacy policy →
              </Link>
            </>
          }
        />
      </SettingsSection>
    </div>
  )
}
