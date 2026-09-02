'use client'

// Real UTC clock for the hero rail. SSR prints a dashed placeholder; on
// mount the element is written directly (textContent, no React state) once
// a second, aligned to the second boundary so it never visibly stutters.
// It keeps ticking under reduced motion: this is data, not motion.

import { useEffect, useRef } from 'react'

const PLACEHOLDER = '--:--:-- Z'

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatUtc(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(
    d.getUTCSeconds()
  )} Z`
}

export function UtcClock({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLTimeElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer = 0
    const tick = () => {
      const now = new Date()
      el.textContent = formatUtc(now)
      el.dateTime = `${now.toISOString().slice(0, 19)}Z`
      timer = window.setTimeout(tick, 1000 - now.getMilliseconds())
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <time
      ref={ref}
      dateTime=""
      suppressHydrationWarning
      className={`tabular-nums ${className}`}
    >
      {PLACEHOLDER}
    </time>
  )
}
