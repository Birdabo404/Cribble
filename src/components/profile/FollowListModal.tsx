'use client'

// Follower / following roster. Deliberately more than a list: every row
// carries its own FOLLOW button and FOLLOWS YOU chip, so opening
// someone's followers doubles as a discovery surface — the same loop
// that makes follower lists on X compulsively browsable.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from '@/components/leaderboard/Avatar'
import { FollowButton, FollowsYouChip } from '@/components/profile/FollowButton'
import type { FollowListUser } from '@/types/profile'

export type FollowListKind = 'followers' | 'following'

export function FollowListModal({
  username,
  kind,
  signedIn,
  onClose
}: {
  username: string
  kind: FollowListKind
  signedIn: boolean
  /** dirty = the viewer followed/unfollowed someone from inside the list. */
  onClose: (dirty: boolean) => void
}) {
  const [users, setUsers] = useState<FollowListUser[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failed, setFailed] = useState(false)
  const dirty = useRef(false)

  const close = useCallback(() => onClose(dirty.current), [onClose])

  const fetchPage = useCallback(
    async (offset: number) => {
      const res = await fetch(
        `/api/profile/${encodeURIComponent(username)}/follows?type=${kind}&offset=${offset}`,
        { credentials: 'include', cache: 'no-store' }
      )
      if (!res.ok) throw new Error('list fetch failed')
      const data = await res.json()
      if (!data.success) throw new Error('list fetch failed')
      return data as { users: FollowListUser[]; total: number; hasMore: boolean }
    },
    [username, kind]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchPage(0)
      .then((data) => {
        if (cancelled) return
        setUsers(data.users)
        setTotal(data.total)
        setHasMore(data.hasMore)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchPage])

  const loadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchPage(users.length)
      setUsers((prev) => [...prev, ...data.users])
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [close])

  const setRowFollowing = (userId: number, following: boolean) => {
    dirty.current = true
    setUsers((prev) =>
      prev.map((u) => (u.userId === userId ? { ...u, isFollowing: following } : u))
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label={`@${username} — ${kind}`}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} aria-hidden />
      <div
        className="relative flex max-h-[min(560px,calc(100vh-3rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">
              {kind === 'followers' ? 'FOLLOWERS' : 'FOLLOWING'}
            </span>
            {total !== null && (
              <span className="text-[10px] tabular-nums text-zinc-600">{total.toLocaleString('en-US')}</span>
            )}
          </div>
          <button
            onClick={close}
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="space-y-1 p-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg px-2.5 py-2.5">
                  <span className="h-9 w-9 rounded-full bg-white/[0.05]" />
                  <span className="h-3 w-32 rounded bg-white/[0.05]" />
                </div>
              ))}
            </div>
          )}

          {!loading && failed && (
            <div className="px-6 py-12 text-center text-[10px] tracking-[0.25em] text-zinc-600">
              ROSTER UNAVAILABLE
            </div>
          )}

          {!loading && !failed && users.length === 0 && (
            <div className="px-6 py-12 text-center">
              <div className="text-[10px] tracking-[0.3em] text-zinc-400">
                {kind === 'followers' ? 'NO WINGMEN YET' : 'NOT TRACKING ANYONE'}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                {kind === 'followers'
                  ? 'Be the first to back this pilot.'
                  : 'Follow pilots from the leaderboard to build a squadron.'}
              </p>
            </div>
          )}

          {!loading &&
            users.map((u) => (
              <div
                key={u.userId}
                className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors last:border-b-0 hover:bg-white/[0.03]"
              >
                <a href={`/u/${encodeURIComponent(u.username)}`} className="shrink-0" aria-label={`@${u.username}`}>
                  <Avatar
                    src={u.profile_image}
                    char={u.username[0]?.toUpperCase() ?? '?'}
                    imgClassName="h-9 w-9 rounded-full border border-zinc-800 object-cover"
                    fallbackClassName="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-display text-xs text-zinc-400"
                  />
                </a>
                <a href={`/u/${encodeURIComponent(u.username)}`} className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-display text-[13px] font-medium tracking-tight text-zinc-100">
                      {u.display_name}
                    </span>
                    {u.followsYou && !u.isYou && <FollowsYouChip />}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-zinc-600">@{u.username}</span>
                </a>
                {u.isYou ? (
                  <span className="shrink-0 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[8px] tracking-[0.25em] text-accent">
                    YOU
                  </span>
                ) : (
                  <FollowButton
                    targetUserId={u.userId}
                    following={u.isFollowing}
                    followsYou={u.followsYou}
                    signedIn={signedIn}
                    size="sm"
                    onChange={(change) => setRowFollowing(u.userId, change.following)}
                  />
                )}
              </div>
            ))}

          {!loading && hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full px-4 py-3 text-center text-[10px] tracking-[0.3em] text-zinc-500 transition-colors hover:bg-white/[0.03] hover:text-zinc-200 disabled:opacity-60"
            >
              {loadingMore ? 'LOADING…' : 'LOAD MORE'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
