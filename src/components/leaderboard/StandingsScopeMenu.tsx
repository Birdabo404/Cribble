'use client'

// The GLOBAL toolbar's scope control. SEASON / ALL-TIME used to be two
// cells; they are now the first group in this menu, with the camp cut
// (Everyone, then whichever majors have a #1 pilot) underneath. The
// closed button names the camp once one is on, and keeps ALL-TIME in
// the label so the window never disappears. Country is its own menu
// beside this one.

import { IconChevronDown } from '@/components/leaderboard/icons'
import {
  campLabel,
  scopeButtonLabel,
  type CampId,
  type CampOption,
  type StandingsWindowId
} from '@/components/leaderboard/standingsScope'
import { useScopeMenu } from '@/components/leaderboard/useScopeMenu'

const WINDOWS: { id: StandingsWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: 'alltime', label: 'ALL-TIME' }
]

export function StandingsScopeMenu({
  windowId,
  camp,
  camps,
  pilotCount,
  onWindow,
  onCamp
}: {
  windowId: StandingsWindowId
  camp: CampId | null
  camps: readonly CampOption[]
  pilotCount: number
  onWindow: (windowId: StandingsWindowId) => void
  onCamp: (camp: CampId | null) => void
}) {
  const menu = useScopeMenu()
  const label = scopeButtonLabel(windowId, camp)
  const pickCamp = (next: CampId | null) => {
    onCamp(next)
    menu.close()
  }

  return (
    <div className="bb-scope" ref={menu.rootRef}>
      <button
        ref={menu.triggerRef}
        type="button"
        className="bb-seg bb-scope-trigger"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.menuId}
        aria-label={`Standings scope, ${label}`}
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
          aria-label="Standings scope"
          className="bb-scope-menu"
          onKeyDown={menu.onMenuKeyDown}
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
                menu.close()
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
              <button
                type="button"
                role="menuitemradio"
                aria-checked={camp === null}
                className="bb-scope-item"
                onClick={() => pickCamp(null)}
              >
                Everyone
                <span className="bb-scope-count">{pilotCount}</span>
              </button>
              {camps.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={camp === item.id}
                  className="bb-scope-item"
                  onClick={() => pickCamp(item.id)}
                >
                  {campLabel(item.id)}
                  <span className="bb-scope-count">{item.count}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
