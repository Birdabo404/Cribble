'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MobileExtensionModal } from '@/components/extension/MobileExtensionModal'
import { fetchMe } from '@/lib/client/fetchMe'
import { requestExtensionIdentity } from '@/lib/extensionBridge'
import {
  EXTENSION_INSTALL_URL,
  evaluateExtensionGate,
  isExtensionCapableBrowser,
  shouldShowMobileExtensionNotice
} from '@/lib/extensionInstall'

// Mirrors EXTENSION_STEP_ENABLED on /welcome: no store listing → no gate.
const GATE_ENABLED = EXTENSION_INSTALL_URL !== null

const noticeDismissKey = (userId: number) =>
  `cribble:ext-mobile-notice-dismissed:${userId}`

/**
 * Hard extension wall around the signed-in (app) surface. Runs one check
 * per app entry (the (app) layout persists across route changes): fetch
 * the account's status, run a single handshake on capable browsers, and
 * bounce to the /welcome install stage when the verdict is 'install'.
 * Children render immediately while the check is in flight, so the happy
 * path costs nothing — an uninstalled user sees at most ~4s of dashboard
 * before the redirect.
 *
 * Also owns the one-time MobileExtensionModal for phone users — the gate
 * never redirects non-capable browsers, so this is the only surface that
 * tells them tracking is desktop-only.
 */
export function ExtensionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  // Doubles as visibility: non-null only while the notice should be up,
  // and the id keys the per-user dismiss flag when GOT IT is pressed.
  const [mobileNoticeUserId, setMobileNoticeUserId] = useState<number | null>(
    null
  )

  useEffect(() => {
    if (!GATE_ENABLED) return

    let cancelled = false

    const check = async () => {
      const res = await fetch('/api/user/onboarding', {
        credentials: 'include'
      })
      // 401/403 means signed out — public (app) pages stay untouched. Any
      // other failure fails open: a flaky status endpoint must not brick
      // the whole app.
      if (!res.ok) return
      const data = (await res.json()) as { extensionLinked?: unknown }

      const capableBrowser = isExtensionCapableBrowser()
      const detected = capableBrowser
        ? (await requestExtensionIdentity()) !== null
        : false
      if (cancelled) return

      const verdict = evaluateExtensionGate({
        enabled: GATE_ENABLED,
        signedIn: true,
        capableBrowser,
        detected,
        linked: data.extensionLinked === true
      })
      switch (verdict) {
        case 'allow':
          return
        case 'install': {
          // Live pathname rather than one captured at mount — the user may
          // have navigated during the ~4s check, and ?next= should restore
          // wherever they ended up.
          const next = encodeURIComponent(window.location.pathname)
          router.replace(`/welcome?next=${next}`)
          return
        }
        default: {
          const exhaustive: never = verdict
          return exhaustive
        }
      }
    }

    void check().catch(() => {
      // Network hiccup — fail open, same reasoning as the !res.ok branch.
    })

    return () => {
      cancelled = true
    }
  }, [router])

  // Mobile desktop-only notice, separate from the gate check above: that
  // one decides whether to redirect, this one is purely informational and
  // needs a user id (dismissal is per-user), which comes from the shared
  // /me cache — deduped with the nav shell's fetch, so no extra request.
  useEffect(() => {
    if (!GATE_ENABLED) return

    let cancelled = false

    const check = async () => {
      // navigator / matchMedia reads live in the effect, never in render:
      // 'use client' components still server-render once, and the server
      // must not disagree with the first client render.
      const capableBrowser = isExtensionCapableBrowser()
      const mobileViewport = window.matchMedia('(pointer: coarse)').matches

      const result = await fetchMe()
      if (cancelled) return
      // Signed out (or /me failed) → no user to key the dismissal and
      // nothing tracking for them anyway. Never show.
      if (!result.ok) return
      const userId = result.data.user?.id ?? null
      if (userId === null) return

      // Starts dismissed: a browser that blocks localStorage would
      // otherwise be nagged on every load with no way to make GOT IT
      // stick — same trade-off as ExtensionNudge.
      let dismissed = true
      try {
        dismissed =
          window.localStorage.getItem(noticeDismissKey(userId)) === '1'
      } catch {
        // Storage unavailable — keep the notice hidden.
      }

      const show = shouldShowMobileExtensionNotice({
        enabled: GATE_ENABLED,
        signedIn: true,
        capableBrowser,
        mobileViewport,
        dismissed
      })
      if (show) setMobileNoticeUserId(userId)
    }

    void check()

    return () => {
      cancelled = true
    }
  }, [])

  const dismissMobileNotice = () => {
    if (mobileNoticeUserId !== null) {
      try {
        window.localStorage.setItem(noticeDismissKey(mobileNoticeUserId), '1')
      } catch {
        // Best effort — state still hides it for this session.
      }
    }
    setMobileNoticeUserId(null)
  }

  return (
    <>
      {children}
      {mobileNoticeUserId !== null && (
        <MobileExtensionModal onClose={dismissMobileNotice} />
      )}
    </>
  )
}
