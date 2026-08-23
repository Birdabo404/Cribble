'use client'

import { useEffect, useState } from 'react'
import {
  currentExtensionInstallUrl,
  isExtensionUnlinked
} from '@/lib/extensionInstall'
import { animDelay } from './anim'
import type { ExtensionLinkPhase } from '@/hooks/useExtensionSync'
import type { ActiveDevice, MeUser } from '@/types/dashboard'

const dismissKey = (userId: number) => `cribble:ext-nudge-dismissed:${userId}`

// Only 'offline' means the handshake ran and found nothing — every other
// phase is either in flight or already linked, where an install nudge would
// be wrong or premature.
function phaseShowsNudge(phase: ExtensionLinkPhase): boolean {
  switch (phase) {
    case 'offline':
      return true
    case 'unknown':
    case 'detecting':
    case 'linking':
    case 'linked':
    case 'syncing':
      return false
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

/**
 * Slim dismissible banner shown above the hero for users who have never
 * linked the extension, pointing them at this browser's store listing
 * (Chrome Web Store or Firefox Add-ons). Hidden while that listing isn't
 * live (its store URL unset), forever once dismissed (persisted in
 * localStorage per user), and on browsers that can't install the
 * extension — the INSTALL link would be a dead end there; phone users
 * get the one-time MobileExtensionModal instead.
 */
export function ExtensionNudge({
  user,
  activeDevice,
  phase
}: {
  user: Pick<MeUser, 'id' | 'last_extension_sync'> | null
  activeDevice: Pick<ActiveDevice, 'device_uuid'> | null
  phase: ExtensionLinkPhase
}) {
  const userId = user?.id ?? null

  // Starts hidden; flips visible only after the mount effect confirms this
  // user never dismissed it. The effect never runs during SSR, so no
  // window guard is needed on the initial state.
  const [dismissed, setDismissed] = useState(true)

  // Same start-hidden shape for capability: the matching store URL doubles
  // as the capability signal — non-null only on a desktop browser whose
  // listing is live. It reads navigator, so it must resolve in an effect —
  // deciding during render would make the first client render disagree
  // with the server's.
  const [installUrl, setInstallUrl] = useState<string | null>(null)

  useEffect(() => {
    setInstallUrl(currentExtensionInstallUrl())
  }, [])

  useEffect(() => {
    if (userId === null) return
    try {
      setDismissed(window.localStorage.getItem(dismissKey(userId)) === '1')
    } catch {
      // Storage unavailable — keep the nudge hidden rather than nag on
      // every load with no way to dismiss it permanently.
    }
  }, [userId])

  const dismiss = () => {
    setDismissed(true)
    if (userId === null) return
    try {
      window.localStorage.setItem(dismissKey(userId), '1')
    } catch {
      // Best effort — state still hides it for this session.
    }
  }

  if (
    installUrl === null ||
    !isExtensionUnlinked(user, activeDevice) ||
    !phaseShowsNudge(phase) ||
    dismissed
  ) {
    return null
  }

  return (
    <section className="relative col-span-12 overflow-hidden rounded-2xl glass-lite">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-ember/70"
      />
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
        <div className="anim-fade flex items-center gap-2.5" style={animDelay(60)}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-ember/50 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ember shadow-[0_0_8px_rgb(var(--ember-rgb)/0.7)]" />
          </span>
          <span className="font-data text-[10px] tracking-[0.35em] text-ember">EXTENSION</span>
        </div>

        <p className="anim-fade min-w-0 flex-1 text-xs text-zinc-400" style={animDelay(140)}>
          No extension linked. Install cribble-engine once and your grind starts counting.
        </p>

        <div className="anim-rise flex items-center gap-2" style={animDelay(220)}>
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded border border-ember/40 px-3 py-1.5 font-data text-[10px] tracking-[0.3em] text-ember transition-colors hover:bg-ember hover:text-black"
          >
            INSTALL →
          </a>
          <button
            onClick={dismiss}
            aria-label="Dismiss extension nudge"
            title="Dismiss"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-zinc-600 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="h-3 w-3"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  )
}
