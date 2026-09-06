'use client'

// The follow CTA, tuned for follow-through:
//  - FOLLOW / FOLLOW BACK render as a neutral filled button (no accent
//    color) — solid but quiet, like X. "FOLLOW BACK" names the
//    reciprocity so a returned visit converts.
//  - FOLLOWING goes quiet (outline) and only threatens UNFOLLOW on hover
//    — undoing is possible but never invited. The threat (label swap and
//    the hazard inks) is pointer-only, gated behind @media (hover: hover):
//    a touch tap leaves :hover stuck on the button, so on a phone
//    FOLLOW -> FOLLOWING would otherwise read UNFOLLOW in red at once.
//  - Clicks apply optimistically and roll back on failure; signed-out
//    visitors are routed to /login instead of a dead button.
//  - `className` is appended to the button: callers hand in per-slot
//    sizing (a full-width 44px row on phones, inline beside a name).
//  - `variant` picks the skin. 'glass' (default) is the app-wide look
//    used by leaderboard cards and the roster modals. 'paper' is the
//    /u/[username] UNIT RECORD row grammar: FOLLOW is the inverted
//    .pf-plate row, FOLLOWING the framed .pf-frame row whose hover
//    threat prints in --pf-alert. Both skins share every behaviour.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface FollowChange {
  following: boolean
  /** Authoritative follower count from the server; null while optimistic. */
  followers: number | null
}

export type FollowVariant = 'glass' | 'paper'
type FollowSize = 'md' | 'sm'

interface FollowSkin {
  /** FOLLOW / FOLLOW BACK. */
  follow: string
  /** FOLLOWING (pointer hover → UNFOLLOW). Needs `group` for the label
   *  swap; every hover: here stacks under [@media(hover:hover)]. */
  following: string
  size: Record<FollowSize, string>
}

/** md carries a 44px floor and an 11px type floor below sm — it's the
 *  profile hero CTA. */
function skinFor(variant: FollowVariant): FollowSkin {
  switch (variant) {
    case 'glass':
      return {
        follow:
          'inline-flex items-center justify-center rounded-lg bg-zinc-100 font-semibold text-zinc-900 transition-colors hover:bg-zinc-300 disabled:opacity-60',
        following:
          'group inline-flex items-center justify-center rounded-lg border border-zinc-700 font-semibold text-zinc-300 transition-colors [@media(hover:hover)]:hover:border-rose-400/50 [@media(hover:hover)]:hover:bg-rose-500/10 [@media(hover:hover)]:hover:text-rose-300 disabled:opacity-60',
        size: {
          md: 'min-h-11 px-5 py-2 text-[11px] sm:text-[10px] tracking-[0.3em] sm:min-h-0',
          sm: 'px-3 py-1.5 text-[9px] tracking-[0.25em]'
        }
      }
    case 'paper':
      return {
        follow:
          'pf-plate inline-flex items-center justify-center font-data font-medium uppercase transition-opacity hover:opacity-90 disabled:opacity-60',
        following:
          'group pf-frame inline-flex items-center justify-center font-data font-medium uppercase text-[color:var(--pf-ink-2)] transition-colors [@media(hover:hover)]:hover:border-[color:var(--pf-alert)] [@media(hover:hover)]:hover:text-[color:var(--pf-alert)] disabled:opacity-60',
        size: {
          // 0.18em: the dossier's stencil tracking (dossier.css), so
          // FOLLOWING + the FOLLOWS YOU stamp share one spine row
          md: 'min-h-11 px-5 text-[11px] tracking-[0.18em] lg:min-h-10',
          sm: 'h-9 px-3 text-[10px] tracking-[0.18em]'
        }
      }
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}

export function FollowButton({
  targetUserId,
  following,
  followsYou,
  signedIn,
  onChange,
  size = 'md',
  variant = 'glass',
  className = ''
}: {
  targetUserId: number
  following: boolean
  followsYou: boolean
  signedIn: boolean
  onChange: (change: FollowChange) => void
  size?: FollowSize
  variant?: FollowVariant
  className?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const skin = skinFor(variant)
  const sizeCls = skin.size[size]

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
        className={`${skin.following} ${sizeCls} ${className}`}
      >
        <span className="[@media(hover:hover)]:group-hover:hidden">FOLLOWING</span>
        <span className="hidden [@media(hover:hover)]:group-hover:inline">UNFOLLOW</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={false}
      className={`${skin.follow} ${sizeCls} ${className}`}
    >
      {followsYou ? 'FOLLOW BACK' : 'FOLLOW'}
    </button>
  )
}

/** Reciprocity chip. Glass: quiet X-style pill (neutral fill, no border,
 *  muted text) beside the follow CTA or a list handle. Paper: an ink
 *  stamp (.pf-stamp) in the secondary ink. */
export function FollowsYouChip({
  variant = 'glass',
  className = ''
}: {
  variant?: FollowVariant
  className?: string
}) {
  switch (variant) {
    case 'glass':
      return (
        <span
          className={`shrink-0 rounded bg-white/[0.08] px-1.5 py-[3px] text-[9px] font-medium tracking-[0.2em] text-zinc-400 sm:text-[8px] ${className}`}
        >
          FOLLOWS YOU
        </span>
      )
    case 'paper':
      return (
        <span className={`pf-stamp shrink-0 ${className}`} style={{ color: 'var(--pf-ink-2)' }}>
          FOLLOWS YOU
        </span>
      )
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}
