'use client'

// The GLOBAL toolbar's one scope control. SEASON / ALL-TIME used to be
// two cells; they are now the first group in this menu, with the cuts
// underneath: Everyone, the majors that have a #1 pilot, then the
// countries that have an opted-in pilot. One cut at a time. The closed
// button names the cut once one is on, and keeps ALL-TIME in the label
// so the window never disappears.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { IconChevronDown } from '@/components/leaderboard/icons'
import {
  campLabel,
  EVERYONE,
  sameCut,
  scopeButtonLabel,
  type CampOption,
  type CountryOption,
  type StandingsCut,
  type StandingsWindowId
} from '@/components/leaderboard/standingsScope'

const WINDOWS: { id: StandingsWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: 'alltime', label: 'ALL-TIME' }
]

export function StandingsScopeMenu({
  windowId,
  cut,
  camps,
  countries,
  pilotCount,
  onWindow,
  onCut
}: {
  windowId: StandingsWindowId
  cut: StandingsCut
  camps: readonly CampOption[]
  countries: readonly CountryOption[]
  pilotCount: number
  onWindow: (windowId: StandingsWindowId) => void
  onCut: (cut: StandingsCut) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const label = scopeButtonLabel(windowId, cut)

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

  const close = () => setOpen(false)
  const pick = (next: StandingsCut) => {
    onCut(next)
    close()
  }

  const everyoneItem = (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={cut.kind === 'everyone'}
      className="bb-scope-item"
      onClick={() => pick(EVERYONE)}
    >
      Everyone
      <span className="bb-scope-count">{pilotCount}</span>
    </button>
  )

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    if (!items?.length) return
    const list = Array.from(items)
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
        aria-label={`Standings scope, ${label}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (open) return
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        {label}
        <IconChevronDown
          size={11}
          className={open ? 'bb-scope-chev is-open' : 'bb-scope-chev'}
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Standings scope"
          className="bb-scope-menu"
          onKeyDown={onMenuKeyDown}
        >
          <div className="bb-scope-label" role="presentation">
            Window
          </div>
          {WINDOWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === windowId}
              className="bb-scope-item"
              onClick={() => {
                onWindow(item.id)
                close()
              }}
            >
              {item.label}
            </button>
          ))}
          {camps.length > 0 && (
            <>
              <div className="bb-scope-label bb-scope-label-rule" role="presentation">
                Camp
              </div>
              {everyoneItem}
              {camps.map((item) => {
                const itemCut: StandingsCut = { kind: 'camp', camp: item.id }
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sameCut(cut, itemCut)}
                    className="bb-scope-item"
                    onClick={() => pick(itemCut)}
                  >
                    {campLabel(item.id)}
                    <span className="bb-scope-count">{item.count}</span>
                  </button>
                )
              })}
            </>
          )}
          {countries.length > 0 && (
            <>
              <div className="bb-scope-label bb-scope-label-rule" role="presentation">
                Country
              </div>
              {camps.length === 0 && everyoneItem}
              {countries.map((item) => {
                const itemCut: StandingsCut = { kind: 'country', code: item.code }
                return (
                  <button
                    key={item.code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sameCut(cut, itemCut)}
                    className="bb-scope-item"
                    onClick={() => pick(itemCut)}
                  >
                    {item.name}
                    <span className="bb-scope-count">{item.count}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
