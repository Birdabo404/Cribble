'use client'

// Beta feedback capture. Deliberately tiny: pick a category, type what
// happened, send — the report lands in the feedback table for triage in
// the admin panel. The current pathname rides along automatically so a
// bug report can be retraced to the page it came from.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'

const CATEGORIES = [
  { id: 'bug', label: 'BUG' },
  { id: 'idea', label: 'IDEA' },
  { id: 'other', label: 'OTHER' }
] as const

type FeedbackCategory = (typeof CATEGORIES)[number]['id']

const MESSAGE_MIN = 10
const MESSAGE_MAX = 2000

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const pathname = usePathname()
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mirror the API's cleaning exactly (strip control chars but keep
  // tabs/newlines, then trim) and count code points, not UTF-16 units —
  // matching the table's char_length CHECK. Counting the raw value would
  // let a pasted message with control characters pass here and still be
  // rejected server-side.
  const cleanedMessage = message
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
  const charCount = [...cleanedMessage].length
  const canSend =
    category !== null && charCount >= MESSAGE_MIN && charCount <= MESSAGE_MAX

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, sending])

  const send = async () => {
    if (!canSend || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          // Send the cleaned string the counter validated — the server's
          // cleaning is idempotent, so what was counted is what's accepted.
          message: cleanedMessage,
          ...(pathname ? { pagePath: pathname } : {})
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to send feedback')
      }
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send feedback')
    } finally {
      setSending(false)
    }
  }

  const counter =
    charCount > 0 && charCount < MESSAGE_MIN
      ? `${charCount}/${MESSAGE_MAX} · MIN ${MESSAGE_MIN}`
      : `${charCount}/${MESSAGE_MAX}`

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={sending ? undefined : onClose}
        aria-hidden
      />
      <div
        className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">SEND FEEDBACK</span>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
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

        {sent ? (
          <>
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3" />
                </svg>
              </span>
              <div className="text-xs tracking-[0.4em] text-zinc-100">FEEDBACK SENT</div>
              <p className="max-w-[280px] text-[10px] leading-relaxed text-zinc-500">
                Logged for review — thanks for helping shape the beta.
              </p>
            </div>
            <div className="flex items-center justify-end border-t border-white/[0.08] px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg border border-accent/40 bg-accent/10 px-6 text-[10px] font-bold tracking-[0.3em] text-accent transition-colors hover:bg-accent/20"
              >
                CLOSE
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {/* chip picker is button-based, so no <label> wrapper — a label
                  would re-dispatch clicks to its first button */}
              <div role="group" aria-label="Category">
                <span className="flex items-baseline justify-between">
                  <span className="text-[9px] tracking-[0.3em] text-zinc-500">CATEGORY</span>
                  <span className="text-[9px] tracking-[0.2em] text-zinc-600">REQUIRED</span>
                </span>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {CATEGORIES.map((c) => {
                    const selected = category === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCategory(selected ? null : c.id)}
                        aria-pressed={selected}
                        className={`flex h-9 items-center justify-center rounded-lg border text-[10px] tracking-[0.25em] transition-colors ${
                          selected
                            ? 'border-accent/60 bg-accent/10 text-zinc-50'
                            : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                        }`}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="text-[9px] tracking-[0.3em] text-zinc-500">MESSAGE</span>
                  <span className="text-[9px] tabular-nums tracking-[0.15em] text-zinc-600">
                    {counter}
                  </span>
                </span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={MESSAGE_MAX}
                  placeholder="What broke, what's missing, what would make this better?"
                  className="mt-1.5 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-accent/50 focus:bg-white/[0.05] focus:outline-none"
                />
              </label>

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
                >
                  {error}
                </div>
              )}

              <p className="text-[9px] leading-relaxed text-zinc-600">
                Your current page ({pathname || '/'}) is attached so the report can be retraced.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="rounded-lg border border-zinc-800 px-4 py-2 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-40"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={send}
                disabled={!canSend || sending}
                className="rounded-lg bg-accent px-5 py-2 text-[10px] font-bold tracking-[0.3em] text-black shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {sending ? 'SENDING…' : 'SEND'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
