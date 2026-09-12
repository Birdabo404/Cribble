'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  requestExtensionIdentity,
  type ExtensionIdentity
} from '@/lib/extensionBridge'

// Gap between one identity attempt resolving and the next starting.
// requestExtensionIdentity has its own 3.5s internal timeout, so attempts
// are sequential by construction — never overlapping.
const POLL_GAP_MS = 2500

export interface ExtensionDetection {
  detected: boolean
  checked: boolean
  /** The latest handshake answer — null until the extension replies, and
   *  null again if a refresh finds it gone. Carries isRegistered /
   *  hasSyncToken / userId, which is how the welcome stage tells
   *  "installed" apart from "linked to this account". */
  identity: ExtensionIdentity | null
  /** One more handshake on demand, for right after device registration
   *  when the page needs the extension's updated view of itself. Stable
   *  across renders so effects can depend on it. */
  refresh: () => Promise<ExtensionIdentity | null>
}

export function useExtensionDetection(enabled: boolean): ExtensionDetection {
  const [detected, setDetected] = useState(false)
  // Flips true once the first attempt settles, whatever it found — lets
  // callers tell "still checking" apart from "checked and absent" while
  // polling keeps running underneath.
  const [checked, setChecked] = useState(false)
  const [identity, setIdentity] = useState<ExtensionIdentity | null>(null)

  // Shared by the poll loop and refresh() so attempts stay sequential:
  // two overlapping CRIBBLE_WEB_REQUEST_ID posts would race for the same
  // reply, and the loser would time out and read as "absent".
  const inFlightRef = useRef<Promise<ExtensionIdentity | null> | null>(null)

  // One handshake. A call while another is pending joins it instead of
  // starting a second. A null answer un-detects on purpose: it hands the
  // search back to the poll loop below, which is the only thing that
  // keeps looking, so a removed extension is noticed and a transient
  // miss self-heals on the next tick.
  const attempt = useCallback((): Promise<ExtensionIdentity | null> => {
    if (inFlightRef.current) return inFlightRef.current
    const request = requestExtensionIdentity().then((result) => {
      inFlightRef.current = null
      setChecked(true)
      setIdentity(result)
      setDetected(result !== null)
      return result
    })
    inFlightRef.current = request
    return request
  }, [])

  // Exactly one more handshake, after whatever is already pending has
  // settled, so the answer reflects the extension's state at or after
  // the call — registration posted just before must be visible in it.
  const refresh = useCallback(async (): Promise<ExtensionIdentity | null> => {
    if (inFlightRef.current) await inFlightRef.current
    return attempt()
  }, [attempt])

  useEffect(() => {
    if (!enabled || detected) return

    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      const result = await attempt()
      if (cancelled || result !== null) return
      timer = window.setTimeout(() => {
        void poll()
      }, POLL_GAP_MS)
    }

    // Coming back from the Web Store tab shouldn't wait out the gap:
    // skip whatever remains of it and attempt right away. The in-flight
    // guard keeps attempts sequential — a wake during an attempt is
    // simply absorbed by it.
    const wake = () => {
      if (document.visibilityState === 'hidden' || inFlightRef.current) return
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      void poll()
    }

    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    void poll()

    return () => {
      cancelled = true
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [enabled, detected, attempt])

  return { detected, checked, identity, refresh }
}
