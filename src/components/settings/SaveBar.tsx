'use client'

import { SettingsButton } from './SettingsButton'

export interface SaveBarProps {
  /** Bar renders only while true (slide/fade entrance, 150ms). */
  dirty: boolean
  /** Puts the save button in its pending-spinner state. */
  saving?: boolean
  onSave: () => void
  onReset: () => void
  message?: string
  saveLabel?: string
  /** Extra guard (e.g. validation errors) on top of `saving`. */
  saveDisabled?: boolean
}

/**
 * Sticky "Unsaved changes" bar. Render it as the last child of the
 * section page so it pins to the bottom of the content column.
 */
export function SaveBar({
  dirty,
  saving = false,
  onSave,
  onReset,
  message = 'Unsaved changes',
  saveLabel = 'Save',
  saveDisabled = false
}: SaveBarProps) {
  if (!dirty) return null

  return (
    <div className="sticky bottom-4 z-20 mt-6">
      <div className="st-savebar flex items-center justify-between gap-3 rounded-xl border border-[color:var(--st-border-strong)] bg-[color:var(--st-panel)] py-2 pl-4 pr-2">
        <span className="text-[13px] text-[color:var(--st-text-muted)]" role="status">
          {message}
        </span>
        <div className="flex items-center gap-1.5">
          <SettingsButton variant="ghost" onClick={onReset} disabled={saving}>
            Reset
          </SettingsButton>
          <SettingsButton
            variant="solid"
            onClick={onSave}
            pending={saving}
            disabled={saveDisabled}
          >
            {saveLabel}
          </SettingsButton>
        </div>
      </div>
    </div>
  )
}
