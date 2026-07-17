'use client'

// Profile editor — bio, status/role, base location, website, privacy,
// social links, and cosmetics. Values persist via PATCH
// /api/user/profile (bio & friends land in users.metadata; role also
// updates users.user_type so every surface that shows the badge stays
// in sync). The server sanitizes everything (lengths, URL schemes,
// social hosts) and enforces the paid gates (plate ownership), so this
// form stays honest but never blocks on them. The banner lives in its
// own editor (BannerStudioModal) so GIF hunting never convolutes this
// form.
//
// Layout system, deliberately small: four sections (IDENTITY / BASE /
// COMMS / COSMETICS) with the same `// HEADER` treatment as the profile
// page cards; exactly three type sizes (10px section, 9px label, 12px
// control); one 36px control height shared by inputs, status chips, and
// footer buttons. Social inputs carry their brand mark.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PlatePreview } from '@/components/cosmetics/PlateLayer'
import { SocialIcon, type SocialKind } from '@/components/leaderboard/icons'
import { ROLE_ICONS } from '@/components/roleIcons'
import { PLATES } from '@/lib/cosmetics/plates'
import { ROLE_OPTIONS } from '@/lib/roles'

const BIO_MAX = 160

export interface EditableProfile {
  bio: string
  location: string
  website: string
  equipped_plate: string | null
  role: string | null
  is_private: boolean
  socials: { x: string; github: string; youtube: string; linkedin: string }
}

/** From GET /api/user/cosmetics — which plates this account can equip. */
interface CosmeticsInfo {
  isPro: boolean
  ownedPlateIds: string[]
}

const SOCIAL_FIELDS: { kind: SocialKind; label: string; placeholder: string }[] = [
  { kind: 'x', label: 'X / TWITTER', placeholder: '@handle' },
  { kind: 'github', label: 'GITHUB', placeholder: 'username' },
  { kind: 'youtube', label: 'YOUTUBE', placeholder: '@channel' },
  { kind: 'linkedin', label: 'LINKEDIN', placeholder: 'username' }
]

const inputCls =
  'h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-accent/50 focus:bg-white/[0.05] focus:outline-none'

export function EditProfileModal({
  initial,
  onClose,
  onSaved
}: {
  initial: EditableProfile
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<EditableProfile>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cosmetics, setCosmetics] = useState<CosmeticsInfo | 'loading' | 'error'>('loading')

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

  // Ownership/tier for the plate picker. The server re-validates on
  // save, so a failed fetch only degrades the UI.
  useEffect(() => {
    let cancelled = false
    fetch('/api/user/cosmetics', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.success) {
          setCosmetics({
            isPro: data.isPro === true,
            ownedPlateIds: Array.isArray(data.ownedPlateIds)
              ? data.ownedPlateIds.map(String)
              : []
          })
        } else {
          setCosmetics('error')
        }
      })
      .catch(() => {
        if (!cancelled) setCosmetics('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const cosmeticsReady = cosmetics !== 'loading' && cosmetics !== 'error'
  const usablePlates = cosmeticsReady
    ? PLATES.filter(
        (p) =>
          cosmetics.ownedPlateIds.includes(p.id) ||
          (p.proExclusive === true && cosmetics.isPro)
      )
    : []

  const set = (patch: Partial<EditableProfile>) =>
    setForm((f) => ({ ...f, ...patch }))
  const setSocial = (key: keyof EditableProfile['socials'], value: string) =>
    setForm((f) => ({ ...f, socials: { ...f.socials, [key]: value } }))

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bio: form.bio,
          location: form.location,
          website: form.website,
          equipped_plate: form.equipped_plate,
          role: form.role,
          is_private: form.is_private,
          socials: form.socials
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Save failed')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        {/* ---------- header ---------- */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-200">EDIT PROFILE</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        {/* ---------- body ---------- */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <Section title="IDENTITY" first>
            <Field label="BIO" hint={`${form.bio.length}/${BIO_MAX}`}>
              <textarea
                value={form.bio}
                onChange={(e) => set({ bio: e.target.value.slice(0, BIO_MAX) })}
                rows={3}
                placeholder="Who are you? What are you building?"
                className={`${inputCls} h-auto resize-none py-2.5 leading-relaxed`}
              />
            </Field>

            {/* role picker is button-based, so no <label> wrapper — a label
                would re-dispatch clicks to its first button */}
            <div role="group" aria-label="Status">
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] tracking-[0.3em] text-zinc-500">STATUS</span>
                <span className="text-[9px] tracking-[0.15em] text-zinc-600">SHOWN ON YOUR PROFILE</span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {ROLE_OPTIONS.map((r) => {
                  const Icon = ROLE_ICONS[r.id]
                  const selected = form.role === r.id
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => set({ role: selected ? null : r.id })}
                      aria-pressed={selected}
                      title={r.hint}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[11px] transition-colors ${
                        selected
                          ? 'border-accent/60 bg-accent/10 text-zinc-50'
                          : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                      }`}
                    >
                      {Icon && <Icon size={12} className={selected ? 'text-accent' : 'text-zinc-500'} />}
                      {r.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </Section>

          <Section title="BASE">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="LOCATION">
                <input
                  value={form.location}
                  onChange={(e) => set({ location: e.target.value.slice(0, 30) })}
                  placeholder="Sector 7, Earth"
                  className={inputCls}
                />
              </Field>
              <Field label="WEBSITE">
                <input
                  value={form.website}
                  onChange={(e) => set({ website: e.target.value.slice(0, 100) })}
                  placeholder="https://yoursite.dev"
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[9px] tracking-[0.3em] text-zinc-300">
                  <svg
                    viewBox="0 0 24 24"
                    width={10}
                    height={10}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-zinc-500"
                    aria-hidden
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  PRIVATE ACCOUNT
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                  Only your followers can see your top tools and service record.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.is_private}
                aria-label="Private account"
                onClick={() => set({ is_private: !form.is_private })}
                className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
                  form.is_private
                    ? 'border-accent/60 bg-accent/25'
                    : 'border-zinc-700 bg-white/[0.04]'
                }`}
              >
                <span
                  className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
                    form.is_private
                      ? 'left-[18px] bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]'
                      : 'left-[3px] bg-zinc-500'
                  }`}
                />
              </button>
            </div>
          </Section>

          <Section title="COMMS">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SOCIAL_FIELDS.map(({ kind, label, placeholder }) => (
                <Field key={kind} label={label}>
                  <span className="relative block">
                    <SocialIcon
                      kind={kind}
                      size={12}
                      className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${
                        form.socials[kind] ? 'text-zinc-300' : 'text-zinc-600'
                      }`}
                    />
                    <input
                      value={form.socials[kind]}
                      onChange={(e) => setSocial(kind, e.target.value)}
                      placeholder={placeholder}
                      className={`${inputCls} pl-8`}
                    />
                  </span>
                </Field>
              ))}
            </div>
          </Section>

          <Section title="COSMETICS">
            {/* plate picker is button-based, so no <label> wrapper — same
                reasoning as the status picker above */}
            <div role="group" aria-label="Leaderboard plate">
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] tracking-[0.3em] text-zinc-500">
                  LEADERBOARD PLATE
                </span>
                <span className="text-[9px] tracking-[0.15em] text-zinc-600">
                  SHOWN ON THE BOARD
                </span>
              </div>

              {cosmetics === 'loading' ? (
                <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <div className="aspect-[4/1] animate-pulse rounded-xl bg-white/[0.04]" />
                  <div className="aspect-[4/1] animate-pulse rounded-xl bg-white/[0.04]" />
                </div>
              ) : usablePlates.length === 0 ? (
                <a
                  href="/shop"
                  className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-[10px] tracking-[0.15em] text-zinc-500 transition-colors hover:border-accent/40 hover:text-zinc-300"
                >
                  {cosmetics === 'error' ? 'PLATES UNAVAILABLE RIGHT NOW' : 'NO PLATES YET'}
                  <span className="shrink-0 text-accent">GET PLATES IN THE SHOP →</span>
                </a>
              ) : (
                <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => set({ equipped_plate: null })}
                    aria-pressed={form.equipped_plate === null}
                    className={`flex aspect-[4/1] w-full items-center justify-center rounded-xl border text-[10px] tracking-[0.3em] transition-colors ${
                      form.equipped_plate === null
                        ? 'border-accent/60 bg-accent/10 text-zinc-100'
                        : 'border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:border-zinc-600 hover:text-zinc-200'
                    }`}
                  >
                    NONE
                  </button>
                  {usablePlates.map((plate) => {
                    const selected = form.equipped_plate === plate.id
                    return (
                      <button
                        key={plate.id}
                        type="button"
                        onClick={() => set({ equipped_plate: selected ? null : plate.id })}
                        aria-pressed={selected}
                        title={plate.tagline}
                        className={`relative overflow-hidden rounded-xl transition-shadow ${
                          selected
                            ? 'ring-2 ring-accent/70 shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)]'
                            : 'ring-1 ring-white/[0.06] hover:ring-zinc-600'
                        }`}
                      >
                        <PlatePreview plateId={plate.id} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* ---------- footer ---------- */}
        <div className="flex items-center gap-3 border-t border-white/[0.08] px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-[10px] text-rose-300" role="alert">
            {error}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-zinc-800 px-4 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 rounded-lg bg-accent px-6 text-[10px] font-bold tracking-[0.3em] text-black shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)] transition-all hover:brightness-110 disabled:opacity-60"
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Section block with the same `// HEADER` voice as the profile page cards. */
function Section({
  title,
  first = false,
  children
}: {
  title: string
  first?: boolean
  children: ReactNode
}) {
  return (
    <section className={first ? '' : 'mt-5 border-t border-white/[0.06] pt-5'}>
      <h3 className="text-[10px] tracking-[0.35em] text-zinc-300">
        <span className="text-accent/80">{'// '}</span>
        {title}
      </h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[9px] tracking-[0.3em] text-zinc-500">{label}</span>
        {hint && (
          <span className="text-[9px] tabular-nums tracking-[0.15em] text-zinc-600">{hint}</span>
        )}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

