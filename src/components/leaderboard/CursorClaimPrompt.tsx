'use client'

// Auto-surface controller for the COIN-UP opt-in: mounted once on the
// leaderboard page so every signed-in account that hasn't linked a
// cursor.com profile meets the coin-up sequence, wherever they landed.
//
// Eligibility gate, cheapest check first:
//   1. per-user localStorage snooze (`cribble:cursor-optin:{userId}`)
//      storing {dismissCount, at} — show on dismissCount 0, or 1 with
//      7+ days elapsed; never after the second dismiss. Linking writes
//      a terminal marker so linked users never pay the GET again.
//   2. signed in — the cached fetchMe client.
//   3. not linked — GET /api/user/cursor-profile.
//
// Opens ~1.5s after the checks pass so the page's entrance cascade
// finishes and the glitch-in lands as its own moment. Closing without
// linking counts as a dismiss (this controller only ever owns
// auto-opened instances — CursorBoard's JOIN button is a separate,
// snooze-free path into the same modal).

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CursorOptInModal,
  type CursorOptInProfile
} from '@/components/leaderboard/CursorOptInModal'
import { fetchMe as requestMe } from '@/lib/client/fetchMe'

const OPEN_DELAY_MS = 1500
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
/** Written on link so later loads bail at the storage check. */
const TERMINAL_DISMISS = 99

const snoozeKey = (userId: number) => `cribble:cursor-optin:${userId}`

type Snooze = { dismissCount: number; at: number }

/** null = never dismissed; 'unavailable' = storage is unusable, so never
 *  prompt (no way to dismiss permanently would mean nagging every load —
 *  the ExtensionNudge rule). */
function readSnooze(userId: number): Snooze | null | 'unavailable' {
  try {
    const raw = window.localStorage.getItem(snoozeKey(userId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { dismissCount?: unknown }).dismissCount === 'number' &&
      typeof (parsed as { at?: unknown }).at === 'number'
    ) {
      return parsed as Snooze
    }
    // Unreadable record: treat as a first dismissal rather than deleting
    // someone's snooze by accident.
    return { dismissCount: 1, at: Date.now() }
  } catch {
    return 'unavailable'
  }
}

function writeSnooze(userId: number, snooze: Snooze): void {
  try {
    window.localStorage.setItem(snoozeKey(userId), JSON.stringify(snooze))
  } catch {
    // Best effort — session state still prevents an immediate re-open.
  }
}

function snoozeAllows(snooze: Snooze | null, now: number): boolean {
  if (snooze === null || snooze.dismissCount <= 0) return true
  if (snooze.dismissCount === 1) return now - snooze.at >= WEEK_MS
  return false
}

export function CursorClaimPrompt({
  onLinked,
  onViewBoard,
  onOpenChange
}: {
  /** The claim landed — the page stamps linkedStamp so mounted boards refetch. */
  onLinked?: (profile: CursorOptInProfile) => void
  /** Success CTA — the page jumps to the burn board's CURSOR source. */
  onViewBoard?: () => void
  /** Lets the page freeze the arena's ambient animation while covered. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState<number | null>(null)
  const linkedRef = useRef(false)

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    void (async () => {
      const me = await requestMe()
      if (cancelled || !me.ok || !me.data.user?.id) return
      const id = Number(me.data.user.id)

      const snooze = readSnooze(id)
      if (snooze === 'unavailable' || !snoozeAllows(snooze, Date.now())) return

      try {
        const response = await fetch('/api/user/cursor-profile', {
          credentials: 'include',
          cache: 'no-store'
        })
        const data: { success?: unknown; linked?: unknown } | null = await response
          .json()
          .catch(() => null)
        if (cancelled || !response.ok || data?.success !== true) return
        if (data.linked === true) {
          // Already linked (from settings or another device): stamp the
          // terminal marker so this account never pays the GET again.
          writeSnooze(id, { dismissCount: TERMINAL_DISMISS, at: Date.now() })
          return
        }
      } catch {
        // Link state unknown — do not interrupt on a guess.
        return
      }

      timer = setTimeout(() => {
        if (cancelled) return
        // Another dialog beat the timer — the JOIN-button modal, settings,
        // a player card. Stand down without touching the snooze counter;
        // the next page load gets to offer again. Dialogs parked under an
        // aria-hidden wrapper (the closed mobile nav drawer) don't count.
        const blocked = Array.from(
          document.querySelectorAll('[role="dialog"]')
        ).some((el) => el.closest('[aria-hidden="true"]') === null)
        if (blocked) return
        setUserId(id)
        setOpen(true)
      }, OPEN_DELAY_MS)
    })()

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    if (linkedRef.current || userId === null) return
    const snooze = readSnooze(userId)
    const dismissCount =
      snooze === 'unavailable' || snooze === null ? 0 : snooze.dismissCount
    writeSnooze(userId, { dismissCount: dismissCount + 1, at: Date.now() })
  }, [userId])

  const handleLinked = useCallback(
    (profile: CursorOptInProfile) => {
      linkedRef.current = true
      if (userId !== null) {
        writeSnooze(userId, { dismissCount: TERMINAL_DISMISS, at: Date.now() })
      }
      onLinked?.(profile)
    },
    [onLinked, userId]
  )

  const handleViewBoard = useCallback(() => {
    setOpen(false)
    onViewBoard?.()
  }, [onViewBoard])

  if (!open) return null

  return (
    <CursorOptInModal
      onClose={handleClose}
      onLinked={handleLinked}
      onViewBoard={handleViewBoard}
    />
  )
}
