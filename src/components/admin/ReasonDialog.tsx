'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { AdminButton } from './AdminButton'

// Every staff mutation flows through this dialog: the action fires only
// with a written reason (mirroring the API's 10-char minimum), and that
// reason lands verbatim in the audit log next to the actor's name.
//
// The portal targets document.body — outside the admin layout's scope
// element — so the dialog re-applies .admin-scope on its own root to pick
// up the --st-* tokens. display:contents keeps that wrapper from painting
// the scope's canvas background over the page.

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
  const titleId = useId()
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
    <div className="admin-scope contents">
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className="absolute inset-0 bg-[rgb(0_0_0/0.55)]"
          onClick={onClose}
          aria-hidden
        />
        <div className="relative w-full max-w-md space-y-4 rounded-2xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] p-5 shadow-[var(--st-panel-shadow)]">
          <div className="space-y-1">
            <h2
              id={titleId}
              className={`text-[15px] font-semibold leading-6 ${
                danger ? 'text-[color:var(--st-danger)]' : 'text-[color:var(--st-text)]'
              }`}
            >
              {title}
            </h2>
            <p className="text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              {description}
            </p>
          </div>

          <label className="block">
            <span className="block text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
              Reason — required and logged to the audit trail ({REASON_MIN} characters minimum)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              rows={3}
              autoFocus
              placeholder="Why are you doing this?"
              className="st-input mt-1.5 block w-full resize-none rounded-lg px-3 py-2 text-[16px] leading-6 md:text-[14px]"
            />
            <span className="mt-1 block text-right text-[11px] tabular-nums text-[color:var(--st-text-faint)]">
              {trimmed.length}/{REASON_MAX}
            </span>
          </label>

          {error && (
            <p className="text-[12.5px] leading-5 text-[color:var(--st-danger)]">{error}</p>
          )}

          <div className="flex items-center justify-end gap-2">
            <AdminButton variant="ghost" onClick={onClose}>
              Cancel
            </AdminButton>
            <AdminButton
              variant={danger ? 'danger' : 'primary'}
              onClick={submit}
              disabled={!valid}
              pending={submitting}
            >
              {confirmLabel}
            </AdminButton>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
