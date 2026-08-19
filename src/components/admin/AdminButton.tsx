'use client'

import type { ButtonHTMLAttributes } from 'react'

// The one button for the console. Same geometry as SettingsButton
// (h-11 touch, h-8 from md up); tones follow "color means state":
// primary = monochrome ink, ghost = quiet, danger = ban/reject/revoke,
// warn = attention-adjacent (suspend), good = approve/restore. Hue
// variants use mid-saturation (600) utilities so one class string reads
// on both themes.

export type AdminButtonVariant = 'primary' | 'ghost' | 'danger' | 'warn' | 'good'

export interface AdminButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: AdminButtonVariant
  /** Shows a spinner and disables the button. */
  pending?: boolean
}

function variantClasses(variant: AdminButtonVariant): string {
  switch (variant) {
    case 'primary':
      return 'border-transparent bg-[color:var(--st-accent)] text-[color:var(--st-accent-contrast)] hover:opacity-90'
    case 'ghost':
      return 'border-transparent bg-transparent text-[color:var(--st-text-muted)] hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]'
    case 'danger':
      return 'border-[color:var(--st-danger-muted)] bg-transparent text-[color:var(--st-danger)] hover:bg-[color:var(--st-danger-bg)]'
    case 'warn':
      return 'border-amber-600/40 bg-transparent text-amber-600 hover:bg-amber-600/10'
    case 'good':
      return 'border-emerald-600/40 bg-transparent text-emerald-600 hover:bg-emerald-600/10'
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}

export function AdminButton({
  variant = 'primary',
  pending = false,
  disabled,
  children,
  type = 'button',
  ...rest
}: AdminButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium leading-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 md:h-8 ${variantClasses(variant)}`}
      {...rest}
    >
      {pending && (
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 animate-spin"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <path d="M14.25 8A6.25 6.25 0 1 1 8 1.75" />
        </svg>
      )}
      {children}
    </button>
  )
}
