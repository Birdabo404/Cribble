'use client'

// A one-group scope menu for a short list of windows. The burn board
// used to lay SEASON / 7D / ALL out as cells; this is that control as
// a single button, with the same hairline menu as the GLOBAL scope.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { IconChevronDown } from '@/components/leaderboard/icons'

export function WindowMenu<T extends string>({
  items,
  value,
  onChange,
  ariaLabel
}: {
  items: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const label = items.find((item) => item.id === value)?.label ?? items[0]?.label ?? ''

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
      ?.focus()
  }, [open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    if (!rows?.length) return
    const list = Array.from(rows)
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      list[(index + 1) % list.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      list[(index - 1 + list.length) % list.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      list[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      list[list.length - 1]?.focus()
    }
  }

  return (
    <div className="bb-scope" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="bb-seg bb-scope-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${ariaLabel}, ${label}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (open) return
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        {label}
        <IconChevronDown size={11} className={open ? 'bb-scope-chev is-open' : 'bb-scope-chev'} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className="bb-scope-menu bb-scope-menu-compact"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === value}
              className="bb-scope-item"
              onClick={() => {
                onChange(item.id)
                setOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
