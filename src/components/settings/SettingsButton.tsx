'use client'

import type { ButtonHTMLAttributes } from 'react'

export type SettingsButtonVariant = 'solid' | 'ghost' | 'danger-outline'

export interface SettingsButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: SettingsButtonVariant
  /** Shows a spinner and disables the button. */
  pending?: boolean
}

function variantClasses(variant: SettingsButtonVariant): string {
  switch (variant) {
    case 'solid':
      return 'border-transparent bg-[color:var(--st-accent)] text-[color:var(--st-accent-contrast)] hover:opacity-90'
    case 'ghost':
      return 'border-transparent bg-transparent text-[color:var(--st-text-muted)] hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]'
    case 'danger-outline':
      return 'border-[color:var(--st-danger-muted)] bg-transparent text-[color:var(--st-danger)] hover:bg-[color:var(--st-danger-bg)]'
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}

export function SettingsButton({
  variant = 'solid',
  pending = false,
  disabled,
  children,
  type = 'button',
  ...rest
}: SettingsButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium leading-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses(variant)}`}
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
