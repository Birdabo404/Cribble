import type { ReactNode } from 'react'
import { animDelay } from './anim'

export function Panel({
  className = '',
  children
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`relative overflow-hidden rounded-2xl liquid-glass ${className}`}>
      {children}
    </section>
  )
}

export function PanelHeader({
  title,
  subtitle,
  action
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="anim-fade flex items-start justify-between gap-3" style={animDelay(60)}>
      <div>
        <div className="text-[10px] tracking-[0.4em] text-zinc-300">{title}</div>
        {subtitle && <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

/** Soft accent radial glow, positioned by the caller via className. */
export function AccentGlow({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded-full blur-3xl ${className}`}
      style={{
        background: 'radial-gradient(circle, rgb(var(--accent-rgb)/0.4), transparent 70%)'
      }}
    />
  )
}
