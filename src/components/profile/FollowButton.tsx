'use client'

// The follow CTA, tuned for follow-through:
//  - FOLLOW / FOLLOW BACK render as a neutral filled button (no accent
//    color) — solid but quiet, like X. "FOLLOW BACK" names the
//    reciprocity so a returned visit converts.
//  - FOLLOWING goes quiet (outline) and only threatens UNFOLLOW in
//    rose on hover — undoing is possible but never invited.
//  - Clicks apply optimistically and roll back on failure; signed-out
//    visitors are routed to /login instead of a dead button.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface FollowChange {
  following: boolean
  /** Authoritative follower count from the server; null while optimistic. */
  followers: number | null
}

export function FollowButton({
  targetUserId,
  following,
  followsYou,
  signedIn,
  onChange,
  size = 'md'
}: {
  targetUserId: number
  following: boolean
  followsYou: boolean
  signedIn: boolean
  onChange: (change: FollowChange) => void
  size?: 'md' | 'sm'
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  // md carries a 44px floor below sm — it's the profile hero CTA.
  const sizeCls =
    size === 'md'
      ? 'min-h-11 px-5 py-2 text-[10px] tracking-[0.3em] sm:min-h-0'
      : 'px-3 py-1.5 text-[9px] tracking-[0.25em]'

  const toggle = async () => {
    if (!signedIn) {
      router.push('/login')
      return
    }
    if (pending) return

    const next = !following
    setPending(true)
    onChange({ following: next, followers: null })

    try {
      const res = next
        ? await fetch('/api/user/follow', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: targetUserId })
          })
        : await fetch(`/api/user/follow?userId=${targetUserId}`, {
            method: 'DELETE',
            credentials: 'include'
          })
      if (!res.ok) throw new Error('follow request failed')
      const data = await res.json()
      onChange({
        following: Boolean(data.following),
        followers: typeof data.followers === 'number' ? data.followers : null
      })
    } catch {
      onChange({ following: !next, followers: null })
    } finally {
      setPending(false)
    }
  }

  if (following) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed
        className={`group rounded-lg border border-zinc-700 font-semibold text-zinc-300 transition-colors hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-60 ${sizeCls}`}
      >
        <span className="group-hover:hidden">FOLLOWING</span>
        <span className="hidden group-hover:inline">UNFOLLOW</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={false}
      className={`rounded-lg bg-zinc-100 font-semibold text-zinc-900 transition-colors hover:bg-zinc-300 disabled:opacity-60 ${sizeCls}`}
    >
      {followsYou ? 'FOLLOW BACK' : 'FOLLOW'}
    </button>
  )
}

/** Reciprocity chip — quiet X-style pill: neutral fill, no border, muted
 *  text. Renders beside the follow CTA (profile) or the handle (lists). */
export function FollowsYouChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded bg-white/[0.08] px-1.5 py-[3px] text-[8px] font-medium tracking-[0.2em] text-zinc-400 ${className}`}
    >
      FOLLOWS YOU
    </span>
  )
}
