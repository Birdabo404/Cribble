'use client'

import { useEffect } from 'react'

const MAX_TILT_DEG = 1.7

/**
 * Dynamic-lensing tilt: panels lean subtly toward the cursor so the
 * travelling rim light catches at different angles, like light bending
 * through tilted glass. Writes only --tilt-x/--tilt-y (consumed by the
 * .liquid-glass transform), so updates are compositor-only — no repaints.
 * One delegated, rAF-throttled listener for all panels.
 */
export function GlassTilt() {
  useEffect(() => {
    if (
      window.matchMedia('(hover: none), (pointer: coarse)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }

    let raf = 0
    let lastEvent: PointerEvent | null = null
    let activePanel: HTMLElement | null = null

    const resetPanel = (panel: HTMLElement | null) => {
      if (!panel) return
      panel.style.setProperty('--tilt-x', '0deg')
      panel.style.setProperty('--tilt-y', '0deg')
    }

    const apply = () => {
      raf = 0
      const e = lastEvent
      if (!e) return
      const target = e.target as Element | null
      const panel = (target?.closest?.('.liquid-glass') as HTMLElement | null) ?? null

      if (panel !== activePanel) {
        resetPanel(activePanel)
        activePanel = panel
      }
      if (!panel) return

      const rect = panel.getBoundingClientRect()
      // -1..1 from panel center
      const dx = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const dy = ((e.clientY - rect.top) / rect.height) * 2 - 1
      // pressed-pane feel: leans down toward the cursor
      panel.style.setProperty('--tilt-x', `${(-dy * MAX_TILT_DEG).toFixed(3)}deg`)
      panel.style.setProperty('--tilt-y', `${(dx * MAX_TILT_DEG).toFixed(3)}deg`)
    }

    const onMove = (e: PointerEvent) => {
      lastEvent = e
      if (!raf) raf = requestAnimationFrame(apply)
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
      resetPanel(activePanel)
    }
  }, [])

  return null
}
