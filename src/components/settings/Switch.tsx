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
 * Monochrome toggle. 36x20 track with a 16px knob on md+; below md the
 * track grows to 48x28 with a 24px knob for a usable touch target, so
 * the knob travel is responsive too (classes, not an inline transform).
 * Checked = accent track (white in dark, black in light) with a
 * contrast knob; unchecked = quiet bordered track with a muted knob.
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
      // Sound for the state being entered: pointerdown fires before the
      // click flips `checked`, so the target state is the inverse.
      data-sfx={checked ? 'toggleOff' : 'toggleOn'}
      className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 md:h-5 md:w-9"
      style={{
        backgroundColor: checked ? 'var(--st-accent)' : 'var(--st-panel-hover)',
        borderColor: checked ? 'var(--st-accent)' : 'var(--st-border-strong)'
      }}
      {...aria}
    >
      <span
        aria-hidden
        className={`pointer-events-none block h-6 w-6 rounded-full transition-transform duration-150 ease-out md:h-4 md:w-4 ${
          checked ? 'translate-x-[21px] md:translate-x-[17px]' : 'translate-x-[1px]'
        }`}
        style={{
          backgroundColor: checked ? 'var(--st-accent-contrast)' : 'var(--st-text-muted)'
        }}
      />
    </button>
  )
}
