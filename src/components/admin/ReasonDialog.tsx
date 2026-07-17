'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Every staff mutation flows through this dialog: the action fires only
// with a written reason (mirroring the API's 10-char minimum), and that
// reason lands verbatim in the audit log next to the actor's name.

const REASON_MIN = 10
const REASON_MAX = 500

export function ReasonDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose
}: {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  /** Runs the action; resolve with an error message to keep the dialog open, or null on success. */
  onConfirm: (reason: string) => Promise<string | null>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = reason.trim()
  const valid = trimmed.length >= REASON_MIN

  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const failure = await onConfirm(trimmed)
      if (failure) {
        setError(failure)
        return
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-md border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="space-y-1">
          <h2
            className={`text-sm tracking-[0.15em] ${danger ? 'text-red-400' : 'text-zinc-100'}`}
          >
            {title}
          </h2>
          <p className="text-xs leading-relaxed text-zinc-500">{description}</p>
        </div>

        <label className="block space-y-1 text-xs text-zinc-400">
          <span>
            Reason — required, logged to the audit trail ({REASON_MIN} char minimum)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            rows={3}
            autoFocus
            placeholder="why are you doing this?"
            className="w-full resize-none rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:border-accent/50 focus:outline-none"
          />
          <span className="block text-right text-[10px] text-zinc-600">
            {trimmed.length}/{REASON_MAX}
          </span>
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-white/10 px-4 py-2 text-xs tracking-[0.15em] text-zinc-400 transition-colors hover:bg-white/5"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            className={`rounded-md px-4 py-2 text-xs tracking-[0.15em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              danger
                ? 'border border-red-500/40 text-red-300 hover:bg-red-950/40'
                : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            {submitting ? 'WORKING…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
