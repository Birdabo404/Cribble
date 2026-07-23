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
  action,
  icon
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="anim-fade flex items-start justify-between gap-3" style={animDelay(60)}>
      <div>
        <div className="flex items-center gap-2 font-display text-[10px] font-medium tracking-[0.4em] text-zinc-300">
          {icon && <span className="text-ice/70">{icon}</span>}
          {title}
        </div>
        {subtitle && <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}