'use client'

// GLOBAL's second filter, beside the scope menu: Everywhere, then the
// countries that have a pilot on the country board. It stacks with the
// camp. The button stays dim while no country is picked, so an idle filter never
// reads as an applied one. For a signed-in viewer the last row opens
// profile settings, where the country board can be turned off.

import { IconChevronDown } from '@/components/leaderboard/icons'
import {
  countryButtonLabel,
  type CountryOption
} from '@/components/leaderboard/standingsScope'
import { useScopeMenu } from '@/components/leaderboard/useScopeMenu'
import { useSettingsModal } from '@/components/settings/SettingsModalContext'

export function StandingsCountryMenu({
  country,
  countries,
  pilotCount,
  signedIn,
  onCountry
}: {
  country: string | null
  countries: readonly CountryOption[]
  pilotCount: number
  signedIn: boolean
  onCountry: (country: string | null) => void
}) {
  const menu = useScopeMenu()
  const { openSettings } = useSettingsModal()
  const label = countryButtonLabel(country)
  const pick = (next: string | null) => {
    onCountry(next)
    menu.close()
  }

  return (
    <div className="bb-scope" ref={menu.rootRef}>
      <button
        ref={menu.triggerRef}
        type="button"
        className={country ? 'bb-seg bb-scope-trigger' : 'bb-seg bb-scope-trigger is-idle'}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.menuId}
        aria-label={`Country board, ${country ? label : 'everywhere'}`}
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
          aria-label="Country board"
          className="bb-scope-menu"
          onKeyDown={menu.onMenuKeyDown}
        >
          <div className="bb-scope-label" role="presentation">
            Country
          </div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={country === null}
            className="bb-scope-item"
            onClick={() => pick(null)}
          >
            Everywhere
            <span className="bb-scope-count">{pilotCount}</span>
          </button>
          {countries.map((item) => (
            <button
              key={item.code}
              type="button"
              role="menuitemradio"
              aria-checked={country === item.code}
              className="bb-scope-item"
              onClick={() => pick(item.code)}
            >
              {item.name}
              <span className="bb-scope-count">{item.count}</span>
            </button>
          ))}
          {signedIn && (
            <button
              type="button"
              role="menuitem"
              className="bb-scope-item bb-scope-action"
              onClick={() => {
                menu.close()
                openSettings('profile')
              }}
            >
              Country board settings →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
