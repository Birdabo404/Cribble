'use client'

import { useEffect, useState } from 'react'
import { requestExtensionIdentity } from '@/lib/extensionBridge'

// Gap between one identity attempt resolving and the next starting.
// requestExtensionIdentity has its own 3.5s internal timeout, so attempts
// are sequential by construction — never overlapping.
const POLL_GAP_MS = 2500

export function useExtensionDetection(enabled: boolean): {
  detected: boolean
  checked: boolean
} {
  const [detected, setDetected] = useState(false)
  // Flips true once the first attempt settles, whatever it found — lets
  // callers tell "still checking" apart from "checked and absent" while
  // polling keeps running underneath.
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!enabled || detected) return

    let cancelled = false
    let timer: number | undefined
    let inFlight = false

    const poll = async () => {
      if (inFlight) return
      inFlight = true
      const identity = await requestExtensionIdentity()
      inFlight = false
      if (cancelled) return
      setChecked(true)
      if (identity) {
        setDetected(true)
        return
      }
      timer = window.setTimeout(() => {
        void poll()
      }, POLL_GAP_MS)
    }

    // Coming back from the Web Store tab shouldn't wait out the gap:
    // skip whatever remains of it and attempt right away. The inFlight
    // guard keeps attempts sequential — a wake during an attempt is
    // simply absorbed by it.
    const wake = () => {
      if (document.visibilityState === 'hidden' || inFlight) return
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
  }, [enabled, detected])

  return { detected, checked }
}
