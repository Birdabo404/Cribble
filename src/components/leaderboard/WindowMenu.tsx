'use client'

// A one-group scope menu for a short list of windows. The burn board
// used to lay SEASON / 7D / ALL out as cells; this is that control as
// a single button, with the same hairline menu as the GLOBAL scope.

import { IconChevronDown } from '@/components/leaderboard/icons'
import { useScopeMenu } from '@/components/leaderboard/useScopeMenu'

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
  const menu = useScopeMenu()
  const label = items.find((item) => item.id === value)?.label ?? items[0]?.label ?? ''

  return (
    <div className="bb-scope" ref={menu.rootRef}>
      <button
        ref={menu.triggerRef}
        type="button"
        className="bb-seg bb-scope-trigger"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.menuId}
        aria-label={`${ariaLabel}, ${label}`}
        onClick={menu.toggle}
        onKeyDown={menu.onTriggerKeyDown}
      >
        {label}
        <IconChevronDown size={11} className={menu.open ? 'bb-scope-chev is-open' : 'bb-scope-chev'} />
      </button>
      {menu.open && (
        <div
          ref={menu.menuRef}
          id={menu.menuId}
          role="menu"
          aria-label={ariaLabel}
          className="bb-scope-menu bb-scope-menu-compact"
          onKeyDown={menu.onMenuKeyDown}
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
                menu.close()
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
