'use client'

// Profile section — the public-profile form (bio, status/role, location,
// website, socials) over GET/PATCH /api/user/profile with baseline/dirty
// tracking and a sticky save bar. The server sanitizes on write (URLs
// normalized, off-platform socials dropped, text trimmed), so a successful
// save re-reads the canonical values instead of trusting local state.
// is_private is deliberately absent here: the Privacy section owns it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from '@/components/Toaster'
import {
  SaveBar,
  SettingsButton,
  SettingsRow,
  SettingsSection,
  SkeletonRow,
  TextArea,
  TextField
} from '@/components/settings'
import { ROLE_OPTIONS } from '@/lib/roles'

// Server-enforced limits (see src/app/api/user/profile/route.ts).
const BIO_MAX = 160
const LOCATION_MAX = 30
const WEBSITE_MAX = 100

interface SocialValues {
  x: string
  github: string
  youtube: string
  linkedin: string
}

interface ProfileFormValues {
  bio: string
  role: string | null
  location: string
  website: string
  socials: SocialValues
}

interface ProfileResponse {
  success?: boolean
  profile?: {
    username: string | null
    bio: string | null
    location: string | null
    website: string | null
    role: string | null
    socials?: Partial<Record<keyof SocialValues, string | null>> | null
  }
}

const SOCIAL_FIELDS: { key: keyof SocialValues; label: string; placeholder: string }[] = [
  { key: 'x', label: 'X / Twitter', placeholder: '@handle' },
  { key: 'github', label: 'GitHub', placeholder: 'username' },
  { key: 'youtube', label: 'YouTube', placeholder: '@channel' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'username' }
]

function toFormValues(profile: NonNullable<ProfileResponse['profile']>): ProfileFormValues {
  return {
    bio: profile.bio ?? '',
    role: profile.role ?? null,
    location: profile.location ?? '',
    website: profile.website ?? '',
    socials: {
      x: profile.socials?.x ?? '',
      github: profile.socials?.github ?? '',
      youtube: profile.socials?.youtube ?? '',
      linkedin: profile.socials?.linkedin ?? ''
    }
  }
}

function valuesEqual(a: ProfileFormValues, b: ProfileFormValues): boolean {
  return (
    a.bio === b.bio &&
    a.role === b.role &&
    a.location === b.location &&
    a.website === b.website &&
    a.socials.x === b.socials.x &&
    a.socials.github === b.socials.github &&
    a.socials.youtube === b.socials.youtube &&
    a.socials.linkedin === b.socials.linkedin
  )
}

/**
 * Client-side echo of the server's cleanHttpUrl: the API silently nulls
 * an unparseable website, so catching it here keeps the user's input from
 * disappearing without explanation. Empty is fine (clears the field).
 */
function websiteProblem(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Enter an http(s) URL'
    if (!url.hostname.includes('.')) return 'Enter a full domain, e.g. yoursite.dev'
    return null
  } catch {
    return 'Enter a valid URL'
  }
}

async function fetchProfile(): Promise<{
  username: string | null
  values: ProfileFormValues
} | null> {
  try {
    const res = await fetch('/api/user/profile', { credentials: 'include' })
    if (!res.ok) return null
    const data = (await res.json()) as ProfileResponse
    if (!data?.success || !data.profile) return null
    return { username: data.profile.username ?? null, values: toFormValues(data.profile) }
  } catch {
    return null
  }
}

/** Internal link-out styled as a quiet bordered button. */
const linkOutCls =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--st-border-strong)] px-3 text-[13px] font-medium leading-none text-[color:var(--st-text)] transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)] md:h-8'

export function ProfileSection() {
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [username, setUsername] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<ProfileFormValues | null>(null)
  const [form, setForm] = useState<ProfileFormValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [websiteError, setWebsiteError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setPhase('loading')
    const result = await fetchProfile()
    if (!result) {
      setPhase('error')
      return
    }
    setUsername(result.username)
    setBaseline(result.values)
    setForm(result.values)
    setPhase('ready')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(
    () => form !== null && baseline !== null && !valuesEqual(form, baseline),
    [form, baseline]
  )

  const setField = useCallback(
    <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) => {
      setForm((f) => (f ? { ...f, [key]: value } : f))
    },
    []
  )

  const setSocial = useCallback((key: keyof SocialValues, value: string) => {
    setForm((f) => (f ? { ...f, socials: { ...f.socials, [key]: value } } : f))
  }, [])

  const reset = useCallback(() => {
    setForm(baseline)
    setWebsiteError(null)
    setSaveError(null)
  }, [baseline])

  const save = useCallback(async () => {
    if (!form || !baseline || saving) return
    const problem = websiteProblem(form.website)
    if (problem) {
      setWebsiteError(problem)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const socialsChanged =
        form.socials.x !== baseline.socials.x ||
        form.socials.github !== baseline.socials.github ||
        form.socials.youtube !== baseline.socials.youtube ||
        form.socials.linkedin !== baseline.socials.linkedin

      const patch: Record<string, unknown> = {}
      if (form.bio !== baseline.bio) patch.bio = form.bio
      if (form.role !== baseline.role) patch.role = form.role
      if (form.location !== baseline.location) patch.location = form.location
      if (form.website !== baseline.website) patch.website = form.website
      if (socialsChanged) patch.socials = form.socials

      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Save failed')
      }

      const fresh = await fetchProfile()
      if (fresh) {
        setUsername(fresh.username)
        setBaseline(fresh.values)
        setForm(fresh.values)
      } else {
        // Refetch hiccup: fall back to snapshotting local state so the
        // save bar clears; the next load shows canonical values.
        setBaseline(form)
      }
      toast({ kind: 'success', title: 'PROFILE SAVED' })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Save failed'
      setSaveError(message)
      toast({ kind: 'error', title: 'SAVE FAILED', body: message })
    } finally {
      setSaving(false)
    }
  }, [form, baseline, saving])

  return (
    <div className="space-y-8">
      {phase === 'loading' && (
        <>
          <SettingsSection title="About">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </SettingsSection>
          <SettingsSection title="Social links">
            <SkeletonRow />
            <SkeletonRow />
          </SettingsSection>
          <SettingsSection title="Customization">
            <SkeletonRow />
            <SkeletonRow />
          </SettingsSection>
        </>
      )}

      {phase === 'error' && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-4 py-4 [box-shadow:var(--st-panel-shadow)] sm:px-5">
          <p className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            Could not load your profile.
          </p>
          <SettingsButton variant="ghost" onClick={() => void load()}>
            Try again
          </SettingsButton>
        </div>
      )}

      {phase === 'ready' && form && (
        <>
          <SettingsSection title="About" description="Shown publicly on your profile page.">
            <div className="px-4 py-4 sm:px-5">
              <TextArea
                label="Bio"
                value={form.bio}
                onChange={(e) => setField('bio', e.target.value)}
                maxLength={BIO_MAX}
                rows={3}
                placeholder="Who are you? What are you building?"
              />
            </div>

            <SettingsRow
              label="Status"
              description="Shown as a badge on your public profile."
              stack
            >
              <span className="relative block sm:inline-block">
                <select
                  value={form.role ?? ''}
                  onChange={(e) => setField('role', e.target.value || null)}
                  aria-label="Status"
                  className="st-input h-11 w-full appearance-none rounded-lg pl-3 pr-8 text-[16px] sm:w-44 md:h-8 md:text-[13px]"
                >
                  <option value="">None</option>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[color:var(--st-text-faint)]"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </span>
            </SettingsRow>

            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <TextField
                label="Location"
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                maxLength={LOCATION_MAX}
                placeholder="Sector 7, Earth"
              />
              <TextField
                label="Website"
                value={form.website}
                onChange={(e) => {
                  setField('website', e.target.value)
                  setWebsiteError(null)
                }}
                maxLength={WEBSITE_MAX}
                placeholder="https://yoursite.dev"
                inputMode="url"
                autoComplete="url"
                error={websiteError}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            title="Social links"
            description="A handle or a full profile URL on the platform's own domain."
          >
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
                <TextField
                  key={key}
                  label={label}
                  value={form.socials[key]}
                  onChange={(e) => setSocial(key, e.target.value)}
                  placeholder={placeholder}
                  autoComplete="off"
                  spellCheck={false}
                />
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Customization"
            description="Banner and plate editors live on their own surfaces."
          >
            <SettingsRow
              label="Profile banner"
              description="Banner Studio lives on your public profile."
            >
              <Link
                href={username ? `/u/${encodeURIComponent(username)}` : '/profile'}
                className={linkOutCls}
              >
                Open profile
              </Link>
            </SettingsRow>
            <SettingsRow
              label="Leaderboard plate"
              description="Equip plates you own from the shop."
            >
              <Link href="/shop" className={linkOutCls}>
                Open shop
              </Link>
            </SettingsRow>
          </SettingsSection>

          {saveError && (
            <p role="alert" className="text-[13px] leading-5 text-[color:var(--st-danger)]">
              {saveError}
            </p>
          )}
        </>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onReset={reset} />
    </div>
  )
}
