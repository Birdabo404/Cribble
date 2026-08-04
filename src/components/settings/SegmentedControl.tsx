'use client'

import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  disabled?: boolean
}

/**
 * Radio-group pill switcher. Roving tabindex: Tab lands on the selected
 * option, arrow keys move + select (wrapping), Home/End jump.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  'aria-label': ariaLabel
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const selectedIndex = options.findIndex((opt) => opt.value === value)
  // If value is stale/unknown, the first option still gets tabIndex=0 so
  // the group stays keyboard reachable (without falsely reporting checked).
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex

  const selectAt = (index: number) => {
    const target = options[index]
    if (!target) return
    onChange(target.value)
    buttonRefs.current[index]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % options.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + options.length) % options.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = options.length - 1
    }
    if (next !== null) {
      event.preventDefault()
      selectAt(next)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-lg border border-[color:var(--st-border)] bg-[color:var(--st-canvas)] p-0.5"
    >
      {options.map((opt, i) => {
        const selected = i === selectedIndex
        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonRefs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === tabbableIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(event) => handleKeyDown(event, i)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[13px] font-medium leading-5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? 'border-[color:var(--st-border-strong)] bg-[color:var(--st-panel-hover)] text-[color:var(--st-text)]'
                : 'border-transparent text-[color:var(--st-text-muted)] hover:text-[color:var(--st-text)]'
            }`}
          >
            {opt.icon && (
              <span aria-hidden className="shrink-0">
                {opt.icon}
              </span>
            )}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
