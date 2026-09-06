'use client'

// Spec drawer — the mobile bottom sheet that hosts a spec sheet. Follows
// TokenPlayerCard's structure (fixed full-screen root, backdrop button,
// Escape, body scroll lock) with hard corners and a 120ms steps(1) cut
// instead of the spring. Focus moves to CLOSE on open, Tab is trapped
// inside the sheet, and focus returns to the opener on close.
//
// Portaled to document.body: the page sits inside .app-nav-inset, which is
// `relative z-10` (AppShell.tsx) — a stacking context that would cap any
// z-index inside it at 10, under the fixed top bar's z-40. The portal
// wrapper re-applies .bag-manifest so the --bag-* tokens still resolve
// outside the page's scope.

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '@/components/leaderboard/icons'
import { FOCUS, INK, LINE, MICRO, MUTE, PAPER_BG } from './manifestChrome'

export interface SpecDrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Wrap Tab / Shift+Tab inside `root`; anything hidden is skipped. */
function trapTab(event: KeyboardEvent, root: HTMLElement) {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null
  )
  if (nodes.length === 0) {
    event.preventDefault()
    return
  }
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement
  const inside = active instanceof HTMLElement && root.contains(active)
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault()
      last.focus()
    }
  } else if (!inside || active === last) {
    event.preventDefault()
    first.focus()
  }
}

export function SpecDrawer({ open, onClose, title, children }: SpecDrawerProps) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key === 'Tab' && sheetRef.current) trapTab(event, sheetRef.current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    // .bag-manifest re-scopes the tokens; it is a zero-height in-flow
    // wrapper at the end of <body>, the fixed root inside does the work.
    <div className="bag-manifest font-mono">
      <div className="fixed inset-0 z-[80] flex items-end justify-center">
        {/* --bag-veil: near-black at 0.72 on the panel, ink at 0.5 on paper */}
        <button
          type="button"
          tabIndex={-1}
          onClick={onClose}
          aria-label="Close spec sheet"
          className="absolute inset-0 cursor-default bg-[color:var(--bag-veil)]"
        />

        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`bag-cut relative flex max-h-[88svh] w-full flex-col border-t ${LINE} ${PAPER_BG} md:max-w-[640px] md:border-x`}
        >
          <div
            className={`flex shrink-0 items-center justify-between gap-3 border-b ${LINE} pl-[var(--bag-pad)]`}
          >
            <h2 id={titleId} className={`min-w-0 truncate ${MICRO} ${MUTE}`}>
              {title}
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className={`inline-flex min-h-[var(--bag-tap)] shrink-0 items-center gap-2 px-[var(--bag-pad)] ${MICRO} ${INK} ${FOCUS}`}
            >
              CLOSE
              <IconClose size={12} />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-[var(--bag-pad)] pb-[max(1rem,env(safe-area-inset-bottom))] pt-[var(--bag-pad)]">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
