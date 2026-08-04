'use client'

import { useId } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface FieldChromeProps {
  label: string
  description?: string
  error?: string | null
}

export interface TextFieldProps
  extends FieldChromeProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {}

export interface TextAreaProps
  extends FieldChromeProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {}

function FieldHeader({
  id,
  label,
  description
}: {
  id: string
  label: string
  description?: string
}) {
  return (
    <>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium leading-5 text-[color:var(--st-text)]"
      >
        {label}
      </label>
      {description && (
        <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
          {description}
        </p>
      )}
    </>
  )
}

/** Error text (left) + character counter (right); renders nothing when idle. */
function FieldFooter({
  errorId,
  error,
  length,
  maxLength
}: {
  errorId: string
  error?: string | null
  length?: number
  maxLength?: number
}) {
  const showCounter = maxLength !== undefined && length !== undefined
  if (!error && !showCounter) return null
  return (
    <div className="mt-1.5 flex items-baseline justify-between gap-3">
      {error ? (
        <p id={errorId} className="text-[12.5px] leading-4 text-[color:var(--st-danger)]">
          {error}
        </p>
      ) : (
        <span />
      )}
      {showCounter && (
        <span
          className={`shrink-0 text-[11.5px] tabular-nums ${
            length >= maxLength
              ? 'text-[color:var(--st-danger)]'
              : 'text-[color:var(--st-text-faint)]'
          }`}
        >
          {length}/{maxLength}
        </span>
      )}
    </div>
  )
}

export function TextField({
  label,
  description,
  error,
  id: idProp,
  maxLength,
  value,
  ...rest
}: TextFieldProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const errorId = `${id}-error`
  const length = typeof value === 'string' ? value.length : undefined

  return (
    <div className="w-full">
      <FieldHeader id={id} label={label} description={description} />
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="st-input mt-1.5 block w-full rounded-lg px-3 py-1.5 text-[14px] leading-6"
        {...rest}
      />
      <FieldFooter errorId={errorId} error={error} length={length} maxLength={maxLength} />
    </div>
  )
}

export function TextArea({
  label,
  description,
  error,
  id: idProp,
  maxLength,
  value,
  rows = 3,
  ...rest
}: TextAreaProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const errorId = `${id}-error`
  const length = typeof value === 'string' ? value.length : undefined

  return (
    <div className="w-full">
      <FieldHeader id={id} label={label} description={description} />
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="st-input mt-1.5 block w-full resize-y rounded-lg px-3 py-2 text-[14px] leading-6"
        {...rest}
      />
      <FieldFooter errorId={errorId} error={error} length={length} maxLength={maxLength} />
    </div>
  )
}
