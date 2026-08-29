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
// Layout system, deliberately small: one flat column of compact rows in
// a max-w-2xl glass panel — two-up grids where natural — sized to fit
// typical viewports without scrolling. Sans type on the settings-kit
// scale (13px medium labels, 12px muted hints, 14px controls at 36px),
// and strictly monochrome chrome: selection, focus, and the privacy
// toggle all speak zinc/white — the site's green stays out of here.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
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
  /** "Now Building" pinned project — name optional (server derives
   *  owner/repo or hostname from the URL when blank). */
  project_name: string
  project_url: string
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
  { kind: 'x', label: 'X / Twitter', placeholder: '@handle' },
  { kind: 'github', label: 'GitHub', placeholder: 'username' },
  { kind: 'youtube', label: 'YouTube', placeholder: '@channel' },
  { kind: 'linkedin', label: 'LinkedIn', placeholder: 'username' }
]

const labelCls = 'text-[13px] font-medium leading-5 text-zinc-200'
const hintCls = 'text-xs leading-5 text-zinc-500'

// text-base below sm: sub-16px inputs make iOS Safari zoom the page on focus.
const inputCls =
  'h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-base text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-zinc-400 focus:bg-white/[0.05] focus:outline-none sm:text-sm'

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
          project_name: form.project_name,
          project_url: form.project_url,
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
      className="fixed inset-0 z-[80] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] font-sans sm:items-center sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[calc(100svh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl glass-pop sm:max-h-[calc(100vh-3rem)]"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        {/* ---------- header ---------- */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Edit profile</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 sm:h-7 sm:w-7"
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
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          {/* bio */}
          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className={labelCls}>Bio</span>
              <span className="text-[11.5px] tabular-nums text-zinc-500">
                {form.bio.length}/{BIO_MAX}
              </span>
            </span>
            <textarea
              value={form.bio}
              onChange={(e) => set({ bio: e.target.value.slice(0, BIO_MAX) })}
              rows={3}
              placeholder="Who are you? What are you building?"
              className={`${inputCls} mt-1.5 h-auto resize-none py-2 leading-5`}
            />
          </label>

          {/* status — button-based picker, so no <label> wrapper: a label
              would re-dispatch clicks to its first button */}
          <div role="group" aria-label="Status">
            <div className="flex items-baseline justify-between">
              <span className={labelCls}>Status</span>
              <span className={hintCls}>Shown on your profile</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                    className={`flex h-10 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors sm:h-8 ${
                      selected
                        ? 'border-zinc-200 bg-zinc-100/10 text-zinc-50'
                        : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                    }`}
                  >
                    {Icon && <Icon size={13} className={selected ? 'text-zinc-100' : 'text-zinc-500'} />}
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* location | website */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={`block ${labelCls}`}>Location</span>
              <input
                value={form.location}
                onChange={(e) => set({ location: e.target.value.slice(0, 30) })}
                placeholder="City, Country"
                className={`${inputCls} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className={`block ${labelCls}`}>Website</span>
              <input
                value={form.website}
                onChange={(e) => set({ website: e.target.value.slice(0, 100) })}
                placeholder="https://yoursite.dev"
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </div>

          {/* now building — pinned project name | link. The link publishes
              it; a blank name gets derived server-side (owner/repo). */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="flex items-baseline justify-between">
                <span className={labelCls}>Now building</span>
                <span className={hintCls}>Shown on your card</span>
              </span>
              <input
                value={form.project_name}
                onChange={(e) => set({ project_name: e.target.value.slice(0, 40) })}
                placeholder="my-cool-app"
                className={`${inputCls} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className={`block ${labelCls}`}>Project link</span>
              <input
                value={form.project_url}
                onChange={(e) => set({ project_url: e.target.value.slice(0, 120) })}
                placeholder="https://github.com/you/repo"
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </div>

          {/* social links — one group label; each input carries its brand
              mark and keeps an aria-label since the visible label is shared */}
          <div>
            <span className={`block ${labelCls}`}>Social links</span>
            <div className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
              {SOCIAL_FIELDS.map(({ kind, label, placeholder }) => (
                <span key={kind} className="relative block">
                  <SocialIcon
                    kind={kind}
                    size={13}
                    className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${
                      form.socials[kind] ? 'text-zinc-300' : 'text-zinc-600'
                    }`}
                  />
                  <input
                    value={form.socials[kind]}
                    onChange={(e) => setSocial(kind, e.target.value)}
                    placeholder={placeholder}
                    aria-label={label}
                    className={`${inputCls} pl-9`}
                  />
                </span>
              ))}
            </div>
          </div>

          {/* private account */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
            <div className="min-w-0">
              <div className={labelCls}>Private account</div>
              <p className="mt-0.5 text-xs leading-4 text-zinc-500">
                Only your followers can see your top tools and service record.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.is_private}
              aria-label="Private account"
              onClick={() => set({ is_private: !form.is_private })}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out after:absolute after:-inset-3 after:content-[''] sm:after:content-none ${
                form.is_private
                  ? 'border-zinc-100 bg-zinc-100'
                  : 'border-zinc-700 bg-white/[0.04]'
              }`}
            >
              <span
                aria-hidden
                className={`pointer-events-none block h-4 w-4 rounded-full transition-transform duration-150 ease-out ${
                  form.is_private
                    ? 'translate-x-[17px] bg-zinc-950'
                    : 'translate-x-[1px] bg-zinc-500'
                }`}
              />
            </button>
          </div>

          {/* leaderboard plate — button-based picker, same no-<label>
              reasoning as the status picker above */}
          <div role="group" aria-label="Leaderboard plate">
            <div className="flex items-baseline justify-between">
              <span className={labelCls}>Leaderboard plate</span>
              <span className={hintCls}>Shown on the board</span>
            </div>

            {cosmetics === 'loading' ? (
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="aspect-[4/1] animate-pulse rounded-xl bg-white/[0.04]" />
                <div className="aspect-[4/1] animate-pulse rounded-xl bg-white/[0.04]" />
                <div className="aspect-[4/1] animate-pulse rounded-xl bg-white/[0.04]" />
              </div>
            ) : usablePlates.length === 0 ? (
              <Link
                href="/shop"
                className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-xs text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300"
              >
                {cosmetics === 'error' ? 'Plates are unavailable right now.' : 'No plates yet.'}
                <span className="shrink-0 text-zinc-400">Get plates in the shop →</span>
              </Link>
            ) : (
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => set({ equipped_plate: null })}
                  aria-pressed={form.equipped_plate === null}
                  className={`flex aspect-[4/1] w-full items-center justify-center rounded-xl border text-xs font-medium transition-colors ${
                    form.equipped_plate === null
                      ? 'border-zinc-200 bg-zinc-100/10 text-zinc-50'
                      : 'border-white/10 bg-white/[0.02] text-zinc-500 hover:border-zinc-600 hover:text-zinc-200'
                  }`}
                >
                  None
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
                          ? 'ring-2 ring-zinc-200'
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
        </div>

        {/* ---------- footer ---------- */}
        <div className="flex items-center gap-3 border-t border-white/[0.08] px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-xs text-rose-400" role="alert">
            {error}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg border border-white/10 px-4 text-[13px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 sm:h-9"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-11 rounded-lg bg-zinc-100 px-5 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-zinc-50 disabled:opacity-60 sm:h-9"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
