'use client'

// GDPR Art. 17 erasure flow. Deliberately heavier than a yes/no dialog:
// the account plus every linked row is gone the moment the request lands,
// so the button stays disarmed until the user types DELETE. Accounts are
// OAuth-only and store no email, which is why waitlist removal needs the
// address typed in — it is the only way to match the signup.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const ERASED: string[] = [
  'PROFILE & HANDLE',
  'SCORES & RANK',
  'ACHIEVEMENTS',
  'LINKED DEVICES',
  'ACTIVITY HISTORY',
  'ACTIVE SESSIONS'
]

export function DeleteAccountModal({
  username,
  onClose
}: {
  username: string
  onClose: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [email, setEmail] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const armed = confirmText.trim().toUpperCase() === 'DELETE'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, deleting])

  const destroy = async () => {
    if (!armed || deleting) return
    setDeleting(true)
    setError(null)
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
      setError(e instanceof Error ? e.message : 'Deletion failed')
      setDeleting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-rose-400/50 focus:outline-none'

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="alertdialog"
      aria-modal="true"
      aria-label="Delete account"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={deleting ? undefined : onClose}
        aria-hidden
      />
      <div
        className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shadow-[0_0_8px_rgb(251_113_133/0.7)]" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">DELETE ACCOUNT</span>
          </div>
          <button
            onClick={onClose}
            disabled={deleting}
            className="text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-40"
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
          <p className="text-xs leading-relaxed text-zinc-300">
            You are about to erase <span className="text-zinc-50">@{username}</span>. This is
            immediate and permanent — there is no undo and no recovery window.
          </p>

          <div>
            <div className="text-[9px] tracking-[0.3em] text-zinc-500">WHAT GETS ERASED</div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {ERASED.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
                >
                  <span className="h-1 w-1 shrink-0 rounded-full bg-rose-400/70" />
                  <span className="text-[9px] tracking-[0.2em] text-zinc-400">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className="text-[9px] tracking-[0.3em] text-zinc-500">WAITLIST EMAIL</span>
              <span className="text-[9px] tracking-[0.2em] text-zinc-600">OPTIONAL</span>
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className={`${inputCls} mt-1.5`}
            />
            <span className="mt-1.5 block text-[10px] leading-relaxed text-zinc-500">
              Your account holds no email address. If you ever joined the waitlist, enter that
              address and it will be erased from our lists too.
            </span>
          </label>

          <label className="block">
            <span className="text-[9px] tracking-[0.3em] text-zinc-500">
              TYPE <span className="text-rose-300">DELETE</span> TO CONFIRM
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} mt-1.5 uppercase tracking-[0.3em]`}
            />
          </label>

          {error && (
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          <p className="text-[9px] leading-relaxed text-zinc-600">
            Erasure is processed immediately under GDPR Art. 17 — the right to be forgotten.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-zinc-800 px-4 py-2 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-40"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={destroy}
            disabled={!armed || deleting}
            className="rounded-lg bg-rose-500 px-5 py-2 text-[10px] font-bold tracking-[0.3em] text-white shadow-[0_0_18px_rgb(244_63_94/0.35)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {deleting ? 'ERASING…' : 'DELETE FOREVER'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
