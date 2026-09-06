'use client'

// The badge register: 32 inventory slots in a 1px-gap grid (4 / 5 / 6
// across) under a single listbox. Slot numbers come from the FULL catalog
// order, so filtering never renumbers a badge. Focus lives on the
// listbox; arrows move by one (left/right) or by the live column count
// (up/down, read from the resolved grid so the responsive classes stay
// the single source of truth). Trailing cells are filled with empty
// paper slots so the last row reads as inventory, not as a bare slab.

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ACHIEVEMENTS } from '@/lib/achievements'
import { badgeSerial, type AchievementRow } from './bagModel'
import { BadgeSlot, badgeOptionId } from './BadgeSlot'
import { RegisterEmpty } from './RegisterEmpty'
import { RegisterLoading } from './RegisterLoading'
import {
  BADGE_GRID,
  LISTBOX_BASE,
  LISTBOX_FOCUS_FALLBACK,
  fillerCount,
  readGridColumns,
  useGridColumns
} from './registerChrome'

export interface BadgeRegisterProps {
  rows: AchievementRow[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onActivate?: (id: string) => void
  onClearFilters: () => void
  label?: string
}

/** Catalog position per id — stable slot numbers regardless of filters. */
const CATALOG_INDEX: ReadonlyMap<string, number> = new Map(
  ACHIEVEMENTS.map((def, index) => [def.id, index])
)

const slotIndex = (id: string) => CATALOG_INDEX.get(id) ?? -1

export function BadgeRegister({
  rows,
  selectedId,
  loading,
  onSelect,
  onActivate,
  onClearFilters,
  label = 'Badges'
}: BadgeRegisterProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollOnSelect = useRef(false)

  const populated = !loading && rows.length > 0
  const cols = useGridColumns(gridRef, populated)
  const fillers = fillerCount(rows.length, cols)

  const selectedIndex =
    selectedId === null ? -1 : rows.findIndex((row) => row.id === selectedId)

  useEffect(() => {
    if (!scrollOnSelect.current) return
    scrollOnSelect.current = false
    gridRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const select = (id: string) => {
    onSelect(id)
    gridRef.current?.focus({ preventScroll: true })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const count = rows.length
    if (count === 0) return
    // Prefer the observed count; fall back to a live read before the
    // first ResizeObserver tick has landed.
    const stride =
      cols > 0 ? cols : gridRef.current ? readGridColumns(gridRef.current) : 1
    const last = count - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = selectedIndex < 0 ? 0 : (selectedIndex + 1) % count
        break
      case 'ArrowLeft':
        next = selectedIndex < 0 ? last : (selectedIndex - 1 + count) % count
        break
      case 'ArrowDown': {
        if (selectedIndex < 0) {
          next = 0
          break
        }
        const below = selectedIndex + stride
        // Step a row down; from a short last row's neighbour, land on the
        // final slot; from the last row itself, stay put.
        next =
          below <= last
            ? below
            : Math.floor(selectedIndex / stride) < Math.floor(last / stride)
              ? last
              : selectedIndex
        break
      }
      case 'ArrowUp': {
        if (selectedIndex < 0) {
          next = last
          break
        }
        const above = selectedIndex - stride
        next = above >= 0 ? above : selectedIndex
        break
      }
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Enter':
      case ' ':
        if (onActivate && selectedIndex >= 0) {
          event.preventDefault()
          onActivate(rows[selectedIndex].id)
        }
        return
      default:
        return
    }
    event.preventDefault()
    if (next === selectedIndex) return
    scrollOnSelect.current = true
    onSelect(rows[next].id)
  }

  let body
  if (loading) {
    body = <RegisterLoading variant="slots" />
  } else if (rows.length === 0) {
    body = <RegisterEmpty onClearFilters={onClearFilters} />
  } else {
    body = (
      <div
        ref={gridRef}
        role="listbox"
        aria-label={`${label} register`}
        aria-activedescendant={
          selectedIndex >= 0 && selectedId !== null ? badgeOptionId(selectedId) : undefined
        }
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={`${LISTBOX_BASE} ${BADGE_GRID} ${selectedIndex < 0 ? LISTBOX_FOCUS_FALLBACK : ''}`}
      >
        {rows.map((row) => (
          <BadgeSlot
            key={row.id}
            row={row}
            serial={badgeSerial(row.id)}
            index={slotIndex(row.id)}
            selected={row.id === selectedId}
            onSelect={() => select(row.id)}
          />
        ))}
        {Array.from({ length: fillers }, (_, i) => (
          <span
            key={`filler-${i}`}
            aria-hidden
            role="presentation"
            className="block bg-[color:var(--bag-paper)]"
          />
        ))}
      </div>
    )
  }

  return (
    <div data-register="badges" className="flex flex-col">
      {body}
    </div>
  )
}
