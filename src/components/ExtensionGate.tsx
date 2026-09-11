'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MobileExtensionModal } from '@/components/extension/MobileExtensionModal'
import { fetchMe } from '@/lib/client/fetchMe'
import { parseCountMode } from '@/lib/countMode'
import { requestExtensionIdentity } from '@/lib/extensionBridge'
import {
  evaluateExtensionGate,
  isExtensionCapableBrowser,
  isExtensionInstallEnabled,
  shouldShowMobileExtensionNotice,
  type ExtensionGateInput
} from '@/lib/extensionInstall'

// Mirrors EXTENSION_STEP_ENABLED on /welcome: no listing in any store →
// no gate.
const GATE_ENABLED = isExtensionInstallEnabled()

// Cover fade-out on release. Short enough that the happy path reads as a
// beat, not a loading screen.
const COVER_FADE_MS = 150
// The handshake can hold the cover for up to IDENTITY_MS (3.5s, see
// extensionBridge). Fast verdicts should pass as an unlabeled black beat,
// so the mark waits this long before appearing.
const COVER_MARK_DELAY_MS = 600

// The cover must be in the first painted client frame — a passive effect
// runs after paint and would let one dashboard frame through. On the
// server (where 'use client' components still render once) useLayoutEffect
// warns, so fall back to useEffect there; neither runs during SSR.
const useClientLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

const noticeDismissKey = (userId: number) =>
  `cribble:ext-mobile-notice-dismissed:${userId}`

// users.metadata is free-form JSON, so trust nothing about its shape.
// Only a literal 'team' unlocks the ungated lane; absent, null, or
// malformed metadata gates as solo — the strict default — so a broken
// row can never skip the wall.
function readAccountType(
  metadata: unknown
): ExtensionGateInput['accountType'] {
  return typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as Record<string, unknown>).account_type === 'team'
    ? 'team'
    : 'solo'
}

// Same trust posture for count_mode: only a valid literal unlocks the
// tokens-only lane; absent or malformed metadata gates as a browser
// account — the strict default.
function readCountMode(metadata: unknown): ExtensionGateInput['countMode'] {
  if (typeof metadata !== 'object' || metadata === null) return null
  return parseCountMode((metadata as Record<string, unknown>).count_mode)
}

// off → holding (first client paint, capable browsers only)
// holding → fading → done (verdict 'allow' or any status failure)
// holding → unmount (verdict 'install': the redirect tears this layout down)
type CoverPhase = 'off' | 'holding' | 'fading' | 'done'

/**
 * Hard extension wall around the signed-in (app) surface. Runs one check
 * per app entry (the (app) layout persists across route changes): fetch
 * the account's status, run a single handshake on capable browsers, and
 * bounce to the /welcome install stage when the verdict is 'install'.
 *
 * Children stay mounted the whole time — the (app) group includes public
 * pages whose SSR content must survive. On extension-capable browsers
 * they instead sit under an opaque cover from the first client paint
 * until the first verdict settles: 'allow' releases it, any status
 * failure releases it too (401/403 is just signed out; 5xx and network
 * errors fail open so a dead endpoint can't brick the site), and
 * 'install' keeps it up while the redirect lands so the dashboard is
 * never teased. Non-capable browsers never get the cover.
 *
 * Also owns the one-time MobileExtensionModal for phone users — the gate
 * never redirects non-capable browsers, so this is the only surface that
 * tells them tracking is desktop-only.
 */
export function ExtensionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [coverPhase, setCoverPhase] = useState<CoverPhase>('off')
  const [coverMark, setCoverMark] = useState(false)
  // Doubles as visibility: non-null only while the notice should be up,
  // and the id keys the per-user dismiss flag when GOT IT is pressed.
  const [mobileNoticeUserId, setMobileNoticeUserId] = useState<number | null>(
    null
  )

  // Raise the cover before the browser paints the hydrated frame, but only
  // for browsers that can actually hit the wall. SSR renders without it
  // (navigator is undefined there), and this runs before paint, so neither
  // side ever shows the dashboard early.
  useClientLayoutEffect(() => {
    if (GATE_ENABLED && isExtensionCapableBrowser()) setCoverPhase('holding')
  }, [])

  useEffect(() => {
    if (coverPhase !== 'fading') return
    const id = window.setTimeout(() => setCoverPhase('done'), COVER_FADE_MS)
    return () => window.clearTimeout(id)
  }, [coverPhase])

  useEffect(() => {
    if (coverPhase !== 'holding') return
    const id = window.setTimeout(() => setCoverMark(true), COVER_MARK_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [coverPhase])

  useEffect(() => {
    if (!GATE_ENABLED) return

    let cancelled = false

    const releaseCover = () => {
      if (cancelled) return
      setCoverPhase((phase) => {
        if (phase !== 'holding') return phase
        // Reduced motion skips the fade and drops the cover in one step.
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'done'
          : 'fading'
      })
    }

    const check = async () => {
      // Reuse the nav's shared session probe. Public app pages must not hit
      // the account-only onboarding route unless authentication is positive.
      const session = await fetchMe()
      if (cancelled) return
      if (!session.ok) {
        releaseCover()
        return
      }
      const res = await fetch('/api/user/onboarding', {
        credentials: 'include'
      })
      if (cancelled) return
      // 401/403 means signed out — public (app) pages stay untouched. Any
      // other failure fails open: a flaky status endpoint must not brick
      // the whole app. Either way the verdict is settled, so the cover
      // comes down.
      if (!res.ok) {
        releaseCover()
        return
      }
      const data = (await res.json()) as {
        extensionLinked?: unknown
        metadata?: unknown
      }

      const capableBrowser = isExtensionCapableBrowser()
      const detected = capableBrowser
        ? (await requestExtensionIdentity()) !== null
        : false
      if (cancelled) return

      const verdict = evaluateExtensionGate({
        enabled: GATE_ENABLED,
        signedIn: true,
        accountType: readAccountType(data.metadata),
        countMode: readCountMode(data.metadata),
        capableBrowser,
        detected,
        linked: data.extensionLinked === true
      })
      switch (verdict) {
        case 'allow':
          releaseCover()
          return
        case 'install': {
          // The cover stays up through the redirect — this layout (and the
          // cover with it) unmounts when /welcome takes over, so the
          // dashboard is never seen. Live pathname rather than one captured
          // at mount: the user may have navigated during the check, and
          // ?next= should restore wherever they ended up.
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
      releaseCover()
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
      {(coverPhase === 'holding' || coverPhase === 'fading') && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-[9999] flex items-center justify-center bg-black transition-opacity ${
            coverPhase === 'fading'
              ? 'pointer-events-none opacity-0'
              : 'opacity-100'
          }`}
          style={{ transitionDuration: `${COVER_FADE_MS}ms` }}
        >
          {coverMark && (
            <span className="font-mono text-sm font-semibold tracking-[0.4em] text-zinc-100 motion-safe:animate-pulse">
              CRIBBLE<span className="text-accent">.</span>
            </span>
          )}
        </div>
      )}
      {mobileNoticeUserId !== null && (
        <MobileExtensionModal onClose={dismissMobileNotice} />
      )}
    </>
  )
}
