'use client'

// Ephemeral toast stack (bottom-right), styled on the liquid-glass system.
// `toast()` is callable from anywhere (hooks included) via a module-level
// store, sonner-style; pages that want toasts rendered mount <Toaster />.
// Emitting with no viewport mounted is a silent no-op. Overflow past
// MAX_VISIBLE evicts the oldest live toast through its animated exit path.

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'

export type ToastKind = 'score' | 'success' | 'info' | 'error'

export interface ToastInput {
  kind: ToastKind
  title: string
  body?: string
  /** Rendered as an accent "+N PTS" readout — the sync-confirmation hero. */
  scoreDelta?: number
  durationMs?: number
}

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  body: string | null
  scoreDelta: number | null
  durationMs: number
}

const DEFAULT_DURATION_MS = 5200
const EXIT_MS = 260
const MAX_VISIBLE = 4

type ToastListener = (item: ToastItem) => void
const listeners = new Set<ToastListener>()
let nextToastId = 1

export function toast(input: ToastInput): void {
  const item: ToastItem = {
    id: nextToastId++,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    scoreDelta: input.scoreDelta ?? null,
    durationMs: input.durationMs ?? DEFAULT_DURATION_MS
  }
  listeners.forEach((listener) => listener(item))
}

/* ---------- presentation ---------- */

const ICON_PATHS = {
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
  info: 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z M12 16v-4 M12 8h.01',
  alert:
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01'
}

interface ToastStyle {
  icon: string
  iconCls: string
  barCls: string
}

function toastStyle(kind: ToastKind): ToastStyle {
  switch (kind) {
    case 'score':
      return { icon: ICON_PATHS.bolt, iconCls: 'text-accent', barCls: 'bg-accent/70' }
    case 'success':
      return { icon: ICON_PATHS.check, iconCls: 'text-accent', barCls: 'bg-accent/70' }
    case 'info':
      return { icon: ICON_PATHS.info, iconCls: 'text-zinc-300', barCls: 'bg-zinc-400/50' }
    case 'error':
      return { icon: ICON_PATHS.alert, iconCls: 'text-rose-300', barCls: 'bg-rose-400/70' }
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

function StrokeIcon({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

interface ToastCardProps {
  item: ToastItem
  /** Parent-driven exit (eviction past MAX_VISIBLE); fires even while hovered. */
  forceExit: boolean
  /** Reports any exit start (timer, dismiss, eviction) so the stack counts live toasts. */
  onExitStart: (id: number) => void
  onDone: (id: number) => void
}

function ToastCard({ item, forceExit, onExitStart, onDone }: ToastCardProps) {
  const [leaving, setLeaving] = useState(false)
  const [hovered, setHovered] = useState(false)
  const remainingRef = useRef(item.durationMs)
  const resumedAtRef = useRef(Date.now())
  const leavingRef = useRef(false)
  const removeTimerRef = useRef<number | null>(null)

  const beginExit = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    onExitStart(item.id)
    removeTimerRef.current = window.setTimeout(() => onDone(item.id), EXIT_MS)
  }, [item.id, onExitStart, onDone])

  // Auto-dismiss timer that pauses while hovered (the progress bar pauses
  // in lockstep via animation-play-state below).
  useEffect(() => {
    if (leaving) return
    if (hovered) {
      remainingRef.current -= Date.now() - resumedAtRef.current
      return
    }
    resumedAtRef.current = Date.now()
    const timer = window.setTimeout(beginExit, Math.max(400, remainingRef.current))
    return () => window.clearTimeout(timer)
  }, [hovered, leaving, beginExit])

  // Eviction: begin the exit regardless of hover. beginExit no-ops if this
  // card already started leaving on its own.
  useEffect(() => {
    if (forceExit) beginExit()
  }, [forceExit, beginExit])

  // The removal timeout outlives interaction; clear it if the whole stack
  // unmounts mid-exit.
  useEffect(
    () => () => {
      if (removeTimerRef.current !== null) window.clearTimeout(removeTimerRef.current)
    },
    []
  )

  const style = toastStyle(item.kind)

  return (
    <div
      className="grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out"
      style={{
        gridTemplateRows: leaving ? '0fr' : '1fr',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(10px) scale(0.97)' : 'none'
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          role="status"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="toast-enter pointer-events-auto relative mt-3 overflow-hidden rounded-xl glass-pop"
        >
          <div className="flex items-start gap-3 px-4 py-3.5">
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg liquid-glass-inset ${style.iconCls}`}
            >
              <StrokeIcon d={style.icon} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] tracking-[0.16em] text-zinc-100">
                  {item.title}
                </span>
                {item.scoreDelta !== null && item.scoreDelta > 0 && (
                  <span className="shrink-0 text-sm font-semibold text-accent">
                    +{formatNumber(item.scoreDelta)}
                    <span className="ml-1 text-[9px] tracking-[0.2em] text-zinc-500">
                      PTS
                    </span>
                  </span>
                )}
              </div>
              {item.body && (
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{item.body}</p>
              )}
            </div>

            <button
              onClick={beginExit}
              className="-mr-1 -mt-1 p-1 text-zinc-600 transition-colors hover:text-zinc-200"
              aria-label="Dismiss notification"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="h-3.5 w-3.5">
                <path
                  fill="currentColor"
                  d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
                />
              </svg>
            </button>
          </div>

          {/* draining lifetime bar; pauses with the dismiss timer on hover */}
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/[0.06]">
            <div
              className={`h-full ${style.barCls}`}
              style={{
                transformOrigin: 'left center',
                animation: `toast-progress ${item.durationMs}ms linear forwards`,
                animationPlayState: hovered || leaving ? 'paused' : 'running'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

interface ToastEntry {
  item: ToastItem
  /** Exit in progress — self-initiated (timer/dismiss) or an eviction. */
  exiting: boolean
}

export function Toaster() {
  const [entries, setEntries] = useState<ToastEntry[]>([])

  useEffect(() => {
    const add: ToastListener = (item) => {
      setEntries((prev) => {
        const next: ToastEntry[] = [...prev, { item, exiting: false }]
        // The cap counts live (non-exiting) toasts. On overflow, mark the
        // oldest live ones as exiting so they animate out via ToastCard's
        // exit path instead of vanishing with a layout jump.
        let overflow = next.filter((entry) => !entry.exiting).length - MAX_VISIBLE
        if (overflow <= 0) return next
        return next.map((entry) => {
          if (overflow > 0 && !entry.exiting) {
            overflow -= 1
            return { ...entry, exiting: true }
          }
          return entry
        })
      })
    }
    listeners.add(add)
    return () => {
      listeners.delete(add)
    }
  }, [])

  const markExiting = useCallback((id: number) => {
    setEntries((prev) => {
      const target = prev.find((entry) => entry.item.id === id)
      if (!target || target.exiting) return prev
      return prev.map((entry) =>
        entry.item.id === id ? { ...entry, exiting: true } : entry
      )
    })
  }, [])

  const remove = useCallback((id: number) => {
    setEntries((prev) => prev.filter((entry) => entry.item.id !== id))
  }, [])

  // Always mounted (even when empty) so the aria-live region exists before
  // toasts arrive — screen readers announce additions reliably that way.
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(92vw,360px)] flex-col"
    >
      {entries.map((entry) => (
        <ToastCard
          key={entry.item.id}
          item={entry.item}
          forceExit={entry.exiting}
          onExitStart={markExiting}
          onDone={remove}
        />
      ))}
    </div>
  )
}
