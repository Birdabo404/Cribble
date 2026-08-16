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

    const poll = async () => {
      const identity = await requestExtensionIdentity()
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

    void poll()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [enabled, detected])

  return { detected, checked }
}
