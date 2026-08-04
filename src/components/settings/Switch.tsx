'use client'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * Monochrome toggle: 36x20 track, 16px knob. Checked = accent track
 * (white in dark, black in light) with a contrast knob; unchecked = quiet
 * bordered track with a muted knob.
 */
export function Switch({ checked, onChange, disabled = false, id, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        backgroundColor: checked ? 'var(--st-accent)' : 'var(--st-panel-hover)',
        borderColor: checked ? 'var(--st-accent)' : 'var(--st-border-strong)'
      }}
      {...aria}
    >
      <span
        aria-hidden
        className="pointer-events-none block h-4 w-4 rounded-full transition-transform duration-150 ease-out"
        style={{
          backgroundColor: checked ? 'var(--st-accent-contrast)' : 'var(--st-text-muted)',
          transform: checked ? 'translateX(17px)' : 'translateX(1px)'
        }}
      />
    </button>
  )
}
