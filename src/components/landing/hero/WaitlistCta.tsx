'use client'

// Waitlist CTA — the "Claim your spot" row plus the inline-reveal email
// form and its success state. Owns its email/status state outright (nothing
// else on the page reads it), so extracting it from HomeV2 costs zero prop
// threading. Markup moved verbatim from src/app/page.tsx.

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { ACCENT, accentA } from '@/lib/theme'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function WaitlistCta() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [showForm, setShowForm] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') return
    setStatus('submitting')
    setErrorMsg('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setErrorMsg(data?.error || 'Something went wrong')
        return
      }
      setStatus('success')
    } catch {
      setStatus('error')
      setErrorMsg('Network error. Try again.')
    }
  }

  return (
    <>
      <div
        className="hero-item mt-7 flex flex-wrap items-center gap-3"
        style={{ ['--hr' as string]: '380ms' }}
      >
        <Link
          href="/login"
          className="group inline-flex items-center gap-2.5 bg-white text-black text-sm font-medium px-5 py-3 sm:py-2.5 rounded-md hover:bg-zinc-200 transition-colors"
        >
          <span>Claim your spot</span>
          <span className="text-zinc-500 group-hover:translate-x-0.5 transition-transform">
            →
          </span>
        </Link>

        {!showForm && status !== 'success' && (
          <button
            onClick={() => setShowForm(true)}
            className="py-2 text-[13px] sm:py-0 sm:text-xs tracking-[0.2em] text-zinc-400 hover:text-[color:var(--hg)] transition-colors"
            style={{ ['--hg' as string]: ACCENT }}
          >
            join the waitlist →
          </button>
        )}
      </div>

      {/* Waitlist form (inline reveal) */}
      {showForm && status !== 'success' && (
        <form onSubmit={submit} className="mt-5 max-w-md" noValidate>
          <div
            className="flex items-stretch border rounded-md bg-zinc-950/80 overflow-hidden transition-colors"
            style={{ borderColor: 'rgb(var(--z800))' }}
          >
            <span className="pl-3 pr-1 flex items-center text-zinc-600 text-xs select-none">
              ▸
            </span>
            <input
              type="email"
              required
              autoFocus
              placeholder="you@somewhere.dev"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (status === 'error') setStatus('idle')
              }}
              className="flex-1 bg-transparent px-2 py-3 text-base sm:py-2.5 sm:text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={status === 'submitting' || !email}
              className="text-[11px] tracking-[0.2em] px-4 border-l border-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{
                color: ACCENT,
                background: 'rgb(var(--accent-rgb)/0.10)'
              }}
            >
              {status === 'submitting' ? 'SENDING…' : 'JOIN'}
            </button>
          </div>
          {status === 'error' && (
            <p className="mt-2 text-[11px] text-rose-300">{errorMsg}</p>
          )}
          {status === 'idle' && (
            <p className="mt-2 text-[10px] tracking-wider text-zinc-600">
              No spam. One email when the gates open.
            </p>
          )}
        </form>
      )}

      {status === 'success' && (
        <div
          className="mt-6 max-w-md rounded-md border px-4 py-3 text-xs"
          style={{
            borderColor: `${accentA(0.33)}`,
            background: `${accentA(0.05)}`,
            color: ACCENT
          }}
        >
          <span className="tracking-[0.2em]">▸ ON THE LIST.</span>{' '}
          <span className="text-zinc-300">
            We&apos;ll ping {email} when your slot opens.
          </span>
        </div>
      )}
    </>
  )
}
