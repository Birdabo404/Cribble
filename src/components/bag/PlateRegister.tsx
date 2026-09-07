'use client'

// The plate register: a column-headed ledger of PlateRows under a single
// listbox. Focus lives on the listbox (one tab stop); arrows move the
// selection, aria-activedescendant names it, and the selection ring goes
// dashed while the list has keyboard focus. Rows sit in a 1px-gap grid on
// the soft line colour — hairlines without border stacks.

import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { PlateDef } from '@/lib/cosmetics/plates'
import { plateSerial, statusFor } from './bagModel'
import { PlateRow, plateOptionId } from './PlateRow'
import { RegisterEmpty } from './RegisterEmpty'
import { RegisterLoading } from './RegisterLoading'
import {
  LISTBOX_BASE,
  LISTBOX_FOCUS_FALLBACK,
  MICRO,
  PLATE_COLS,
  PLATE_ROW
} from './registerChrome'

export interface PlateRegisterProps {
  plates: PlateDef[]
  selectedId: string
  equippedPlate: string | null
  usableIds: ReadonlySet<string>
  loading: boolean
  /** Cosmetics sync failed: every row's status is unknown, not locked. */
  unknown?: boolean
  onSelect: (id: string) => void
  onActivate?: (id: string) => void
  onClearFilters: () => void
  compact?: boolean
  label?: string
}

/** Column captions, aligned to the row template. Hidden on compact. */
function ColumnHeader() {
  return (
    <div
      aria-hidden
      className={`${PLATE_ROW} ${PLATE_COLS} ${MICRO} h-7 border-b border-[color:var(--bag-line)] px-3 text-[color:var(--bag-mute)]`}
    >
      <span>ST</span>
      <span>NO</span>
      <span>PLATE</span>
      <span>NAME</span>
      <span className="hidden md:block">CLASS</span>
      <span className="hidden text-right xl:block">SRC</span>
    </div>
  )
}

export function PlateRegister({
  plates,
  selectedId,
  equippedPlate,
  usableIds,
  loading,
  unknown = false,
  onSelect,
  onActivate,
  onClearFilters,
  compact = false,
  label = 'Plates'
}: PlateRegisterProps) {
  const listRef = useRef<HTMLDivElement>(null)
  // Set by keyboard moves only: pointer selections already sit in view.
  const scrollOnSelect = useRef(false)

  const selectedIndex = plates.findIndex((plate) => plate.id === selectedId)

  useEffect(() => {
    if (!scrollOnSelect.current) return
    scrollOnSelect.current = false
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const select = (id: string) => {
    onSelect(id)
    // Keep focus on the listbox after a click so aria-activedescendant
    // and the arrow keys keep working from where the user just tapped.
    listRef.current?.focus({ preventScroll: true })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const count = plates.length
    if (count === 0) return
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = selectedIndex < 0 ? 0 : (selectedIndex + 1) % count
        break
      case 'ArrowUp':
        next = selectedIndex < 0 ? count - 1 : (selectedIndex - 1 + count) % count
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      case 'Enter':
      case ' ':
        if (onActivate && selectedIndex >= 0) {
          event.preventDefault()
          onActivate(plates[selectedIndex].id)
        }
        return
      default:
        return
    }
    event.preventDefault()
    if (next === selectedIndex) return
    scrollOnSelect.current = true
    onSelect(plates[next].id)
  }

  let body
  if (loading) {
    body = <RegisterLoading variant="rows" compact={compact} />
  } else if (plates.length === 0) {
    body = <RegisterEmpty onClearFilters={onClearFilters} />
  } else {
    body = (
      <div
        ref={listRef}
        role="listbox"
        aria-label={`${label} register`}
        aria-activedescendant={selectedIndex >= 0 ? plateOptionId(selectedId) : undefined}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={`${LISTBOX_BASE} ${selectedIndex < 0 ? LISTBOX_FOCUS_FALLBACK : ''}`}
      >
        {plates.map((plate) => (
          <PlateRow
            key={plate.id}
            plate={plate}
            serial={plateSerial(plate.id)}
            status={statusFor(plate.id, equippedPlate, usableIds)}
            selected={plate.id === selectedId}
            loading={false}
            unknown={unknown}
            compact={compact}
            onSelect={() => select(plate.id)}
          />
        ))}
      </div>
    )
  }

  return (
    <div data-register="plates" className="flex flex-col">
      {!compact && <ColumnHeader />}
      {body}
    </div>
  )
}
