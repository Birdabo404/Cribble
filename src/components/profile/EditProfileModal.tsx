'use client'

// Profile editor — bio, status/role, base location, website, banner,
// and social links. Values persist via PATCH /api/user/profile (bio &
// friends land in users.metadata; role also updates users.user_type so
// every surface that shows the badge stays in sync). The server
// sanitizes everything (lengths, URL schemes, social hosts), so this
// form stays honest about limits but never blocks on them.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ROLE_ICONS } from '@/components/roleIcons'
import { ROLE_OPTIONS } from '@/lib/roles'

const BIO_MAX = 160

export interface EditableProfile {
  bio: string
  location: string
  website: string
  banner_image: string
  role: string | null
  socials: { x: string; github: string; youtube: string; linkedin: string }
}

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
          banner_image: form.banner_image,
          role: form.role,
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

  const inputCls =
    'w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-accent/50 focus:outline-none'

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
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">EDIT PROFILE</span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <Field label="BIO" hint={`${form.bio.length}/${BIO_MAX}`}>
            <textarea
              value={form.bio}
              onChange={(e) => set({ bio: e.target.value.slice(0, BIO_MAX) })}
              rows={3}
              placeholder="Who are you? What are you building?"
              className={`${inputCls} resize-none leading-relaxed`}
            />
          </Field>

          {/* role picker is button-based, so no <label> wrapper — a label
              would re-dispatch clicks to its first button */}
          <div role="group" aria-label="Status">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] tracking-[0.3em] text-zinc-500">STATUS</span>
              <span className="text-[9px] tracking-[0.2em] text-zinc-600">SHOWN ON YOUR PROFILE</span>
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
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[10px] transition-colors ${
                      selected
                        ? 'border-accent/60 bg-accent/10 text-zinc-100'
                        : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                    }`}
                  >
                    {Icon && <Icon size={12} />}
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="BASE / LOCATION">
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

          <Field label="BANNER IMAGE URL" hint="OPTIONAL">
            <input
              value={form.banner_image}
              onChange={(e) => set({ banner_image: e.target.value.slice(0, 300) })}
              placeholder="https://…/banner.png"
              className={inputCls}
            />
          </Field>

          <div className="border-t border-white/[0.06] pt-4">
            <div className="text-[9px] tracking-[0.3em] text-accent/80">{'// '}COMMS</div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="X / TWITTER">
                <input
                  value={form.socials.x}
                  onChange={(e) => setSocial('x', e.target.value)}
                  placeholder="@handle"
                  className={inputCls}
                />
              </Field>
              <Field label="GITHUB">
                <input
                  value={form.socials.github}
                  onChange={(e) => setSocial('github', e.target.value)}
                  placeholder="username"
                  className={inputCls}
                />
              </Field>
              <Field label="YOUTUBE">
                <input
                  value={form.socials.youtube}
                  onChange={(e) => setSocial('youtube', e.target.value)}
                  placeholder="@channel"
                  className={inputCls}
                />
              </Field>
              <Field label="LINKEDIN">
                <input
                  value={form.socials.linkedin}
                  onChange={(e) => setSocial('linkedin', e.target.value)}
                  placeholder="username"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-800 px-4 py-2 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-[10px] font-bold tracking-[0.3em] text-black shadow-[0_0_18px_rgb(var(--accent-rgb)/0.35)] transition-all hover:brightness-110 disabled:opacity-60"
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
        {hint && <span className="text-[9px] tabular-nums tracking-[0.2em] text-zinc-600">{hint}</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}
