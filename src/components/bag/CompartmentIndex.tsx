'use client'

// Compartment index — the tabs + filters, in two shapes from one component.
// `rail` is the desktop left column (the game inventory's index): a
// positioned frame with registration crosses, compartment rows with dotted
// leaders and counts (active row inverted), then the FILTER stack: search
// well, ownership options, the rarity ladder (plates only) and CLEAR ALL.
// `strip` is the tablet/mobile form: a full-width 2-cell tab bar with
// counts, an optional search well, and one horizontally scrolling row of
// 44px chips. The page mounts both and hides one per breakpoint, so ids
// carry the layout name and never collide.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { IconSearch } from '@/components/leaderboard/icons'
import {
  BADGE_FILTER_OPTIONS,
  BAG_TABS,
  OWN_FILTER_OPTIONS,
  RARITY_LADDER,
  pad2,
  rarityColor,
  rarityColorA,
  type BadgeFilter,
  type BagTab,
  type OwnFilter,
  type RarityFilter
} from './bagModel'
import { DATA, FOCUS, INK, INVERT, LABEL, LINE, MICRO, MUTE, PAPER_BG } from './manifestChrome'

export type CompartmentIndexLayout = 'rail' | 'strip'

export interface CompartmentIndexProps {
  tab: BagTab
  onTab: (t: BagTab) => void
  plateCount: { usable: number; total: number }
  badgeCount: { unlocked: number | null; total: number }
  query: string
  onQuery: (q: string) => void
  ownFilter: OwnFilter
  onOwnFilter: (f: OwnFilter) => void
  rarityFilter: RarityFilter
  onRarityFilter: (r: RarityFilter) => void
  badgeFilter: BadgeFilter
  onBadgeFilter: (f: BadgeFilter) => void
  onClear: () => void
  layout: CompartmentIndexLayout
  className?: string
  /** Prefix for tab ids (`${idBase}-${layout}-tab-${tab}`) and the panel
   * ids the tabs point at (`${idBase}-panel-${tab}`). */
  idBase?: string
}

const RAIL_HEADING = `${MICRO} ${MUTE} px-3 pb-2 pt-3`
const CHIP = `inline-flex min-h-[var(--bag-tap)] shrink-0 snap-start items-center gap-2 border px-3 ${MICRO} ${FOCUS}`
/** 1px vertical hairline between chip groups in the strip. */
const DIVIDER = 'my-2 w-px shrink-0 self-stretch bg-[color:var(--bag-line)]'

export function CompartmentIndex({
  tab,
  onTab,
  plateCount,
  badgeCount,
  query,
  onQuery,
  ownFilter,
  onOwnFilter,
  rarityFilter,
  onRarityFilter,
  badgeFilter,
  onBadgeFilter,
  onClear,
  layout,
  className = '',
  idBase = 'bag'
}: CompartmentIndexProps) {
  const plates = tab === 'plates'
  const tabId = (value: BagTab) => `${idBase}-${layout}-tab-${value}`
  const panelId = (value: BagTab) => `${idBase}-panel-${value}`
  const searchId = `${idBase}-${layout}-search`

  // Only the visible compartment's filters count as "dirty": a leftover
  // rarity pick on PLATES should not surface CLEAR ALL while on BADGES.
  const dirty =
    query.trim() !== '' ||
    (plates ? ownFilter !== 'all' || rarityFilter !== 'all' : badgeFilter !== 'all')

  const countFor = (value: BagTab) =>
    value === 'plates'
      ? `${pad2(plateCount.usable)}/${plateCount.total}`
      : `${badgeCount.unlocked === null ? '--' : pad2(badgeCount.unlocked)}/${badgeCount.total}`

  // WAI-ARIA tabs: arrows / Home / End move + activate; focus follows.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = BAG_TABS.findIndex((entry) => entry.value === tab)
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % BAG_TABS.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + BAG_TABS.length) % BAG_TABS.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = BAG_TABS.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const value = BAG_TABS[next].value
    onTab(value)
    document.getElementById(tabId(value))?.focus()
  }

  // aria-controls only on the selected tab: the inactive compartment's
  // panel is not rendered, so pointing at it would name a missing id.
  const tabButton = (value: BagTab, cls: string, children: ReactNode) => {
    const active = value === tab
    return (
      <button
        key={value}
        type="button"
        role="tab"
        id={tabId(value)}
        aria-selected={active}
        aria-controls={active ? panelId(value) : undefined}
        tabIndex={active ? 0 : -1}
        onClick={() => onTab(value)}
        className={`${cls} ${FOCUS} ${active ? INVERT : `${PAPER_BG} ${INK} hover:bg-[color:var(--bag-well)]`}`}
      >
        {children}
      </button>
    )
  }

  const ownership = plates ? (
    <OptionGroup
      label="Ownership"
      layout={layout}
      options={OWN_FILTER_OPTIONS}
      value={ownFilter}
      onChange={onOwnFilter}
    />
  ) : (
    <OptionGroup
      label="Status"
      layout={layout}
      options={BADGE_FILTER_OPTIONS}
      value={badgeFilter}
      onChange={onBadgeFilter}
    />
  )

  /* ---------------------------------------------------------------- */
  /* rail                                                              */
  /* ---------------------------------------------------------------- */
  if (layout === 'rail') {
    return (
      <section
        aria-label="Compartment index"
        className={`bag-regmarks relative border ${LINE} ${PAPER_BG} ${className}`}
      >
        <div className={RAIL_HEADING}>[ INDEX ]</div>
        <div
          role="tablist"
          aria-label="Compartments"
          aria-orientation="vertical"
          onKeyDown={onTabKey}
          className={`border-b ${LINE}`}
        >
          {BAG_TABS.map((entry) =>
            tabButton(
              entry.value,
              `block w-full px-3 py-2.5 text-left ${LABEL}`,
              <span className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2">
                <span>{entry.label}</span>
                <span
                  aria-hidden
                  className={`min-w-[1em] border-b border-dotted ${
                    entry.value === tab ? 'border-[color:var(--bag-paper)]' : LINE
                  }`}
                />
                <span className="tabular-nums">{countFor(entry.value)}</span>
              </span>
            )
          )}
        </div>

        <div className={RAIL_HEADING}>FILTER</div>
        <div className="px-3 pb-3">
          <SearchWell id={searchId} tab={tab} query={query} onQuery={onQuery} size="rail" />
        </div>

        <div className={`border-t ${LINE} py-1.5`}>{ownership}</div>

        {plates && (
          <>
            <div className={`${RAIL_HEADING} border-t ${LINE}`}>RARITY</div>
            <div className="pb-1.5">
              <RarityLadder layout="rail" value={rarityFilter} onChange={onRarityFilter} />
            </div>
          </>
        )}

        {dirty && (
          <div className={`border-t ${LINE}`}>
            <button
              type="button"
              onClick={onClear}
              className={`block w-full px-3 py-3 text-left ${MICRO} ${INK} underline decoration-1 underline-offset-[3px] ${FOCUS}`}
            >
              CLEAR ALL
            </button>
          </div>
        )}
      </section>
    )
  }

  /* ---------------------------------------------------------------- */
  /* strip                                                             */
  /* ---------------------------------------------------------------- */
  return (
    <section aria-label="Compartment index" className={className}>
      <div
        role="tablist"
        aria-label="Compartments"
        onKeyDown={onTabKey}
        className={`grid grid-cols-2 gap-px border ${LINE} bg-[color:var(--bag-line)]`}
      >
        {BAG_TABS.map((entry) =>
          tabButton(
            entry.value,
            `flex min-h-[var(--bag-tap)] items-center justify-center gap-2 ${LABEL}`,
            <>
              <span>{entry.label}</span>
              <span className="tabular-nums">{countFor(entry.value)}</span>
            </>
          )
        )}
      </div>

      <StripFilters
        searchId={searchId}
        tab={tab}
        query={query}
        onQuery={onQuery}
        ownership={ownership}
        rarityFilter={rarityFilter}
        onRarityFilter={onRarityFilter}
        dirty={dirty}
        onClear={onClear}
      />
    </section>
  )
}

/* ================= strip filters ================= */

/** Search well (when open) over one scrolling chip row. The well sits
 * above the chips so opening it never pushes a chip off-screen. */
function StripFilters({
  searchId,
  tab,
  query,
  onQuery,
  ownership,
  rarityFilter,
  onRarityFilter,
  dirty,
  onClear
}: {
  searchId: string
  tab: BagTab
  query: string
  onQuery: (q: string) => void
  ownership: ReactNode
  rarityFilter: RarityFilter
  onRarityFilter: (r: RarityFilter) => void
  dirty: boolean
  onClear: () => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // A non-empty query keeps the well open even after the chip is toggled.
  const showSearch = searchOpen || query !== ''

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  const toggleSearch = () => {
    if (showSearch) {
      setSearchOpen(false)
      if (query !== '') onQuery('')
    } else {
      setSearchOpen(true)
    }
  }

  return (
    <>
      {showSearch && (
        <div className="mt-2">
          <SearchWell
            id={searchId}
            tab={tab}
            query={query}
            onQuery={onQuery}
            size="strip"
            inputRef={inputRef}
          />
        </div>
      )}

      <div
        className={`mt-2 flex snap-x gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      >
        <button
          type="button"
          onClick={toggleSearch}
          aria-expanded={showSearch}
          aria-controls={searchId}
          aria-label={showSearch ? 'Close search' : 'Open search'}
          className={`${CHIP} min-w-[var(--bag-tap)] justify-center px-0 ${
            showSearch ? INVERT : `${LINE} ${INK}`
          }`}
        >
          <IconSearch size={13} />
        </button>

        {ownership}

        {tab === 'plates' && (
          <>
            <span aria-hidden className={DIVIDER} />
            <RarityLadder layout="strip" value={rarityFilter} onChange={onRarityFilter} />
          </>
        )}

        {dirty && (
          <>
            <span aria-hidden className={DIVIDER} />
            <button
              type="button"
              onClick={onClear}
              className={`${CHIP} ${LINE} ${INK} underline decoration-1 underline-offset-[3px]`}
            >
              CLEAR ALL
            </button>
          </>
        )}
      </div>
    </>
  )
}

/* ================= shared pieces ================= */

function SearchWell({
  id,
  tab,
  query,
  onQuery,
  size,
  inputRef
}: {
  id: string
  tab: BagTab
  query: string
  onQuery: (q: string) => void
  size: 'rail' | 'strip'
  inputRef?: RefObject<HTMLInputElement>
}) {
  const label = tab === 'plates' ? 'Search plates' : 'Search badges'
  const height = size === 'rail' ? 'h-9' : 'min-h-[var(--bag-tap)]'
  // The input keeps outline-none; the well itself shows the ring while
  // anything inside it has focus, so the keyboard user sees where they are.
  return (
    <div
      id={id}
      className={`flex items-stretch border ${LINE} ${PAPER_BG} ${height} focus-within:outline focus-within:outline-1 focus-within:outline-offset-[-1px] focus-within:outline-[color:var(--bag-focus)]`}
    >
      <span className={`flex items-center pl-3 pr-2 ${MUTE}`}>
        <IconSearch size={12} />
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={label.toUpperCase()}
        aria-label={label}
        // 16px below md: anything smaller makes iOS zoom the page on focus
        className={`min-w-0 flex-1 bg-transparent pr-2 text-[16px] md:text-xs ${DATA} ${INK} placeholder:text-[color:var(--bag-mute)] placeholder:tracking-[0.18em] focus:outline-none`}
      />
      {query !== '' && (
        <button
          type="button"
          onClick={() => onQuery('')}
          className={`flex items-center border-l px-3 ${LINE} ${MICRO} ${MUTE} hover:text-[color:var(--bag-ink)] ${FOCUS}`}
        >
          CLEAR
        </button>
      )}
    </div>
  )
}

/** Ownership / status options. Rail: a vertical list where the active row
 * carries a 2px ink rule on the left. Strip: 44px chips, active inverted. */
function OptionGroup<T extends string>({
  label,
  layout,
  options,
  value,
  onChange
}: {
  label: string
  layout: CompartmentIndexLayout
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  if (layout === 'rail') {
    return (
      <div role="group" aria-label={label}>
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`block w-full border-l-2 py-2 pl-[10px] pr-3 text-left ${LABEL} ${FOCUS} ${
                active
                  ? `border-[color:var(--bag-ink)] ${INK}`
                  : `border-transparent ${MUTE} hover:text-[color:var(--bag-ink)]`
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`${CHIP} ${active ? INVERT : `${LINE} ${MUTE}`}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** ALL + the ladder. The active rarity paints in its own --r-* hue; the
 * rule beside it is the same hue at 0.7. ALL stays ink. In the strip a
 * pressed rarity chip also gets a 2px ink rule along its foot (the rail's
 * pressed row already has the 2px left rule), so the pressed state is
 * never carried by colour alone. */
function RarityLadder({
  layout,
  value,
  onChange
}: {
  layout: CompartmentIndexLayout
  value: RarityFilter
  onChange: (next: RarityFilter) => void
}) {
  const options: RarityFilter[] = ['all', ...RARITY_LADDER]
  const rail = layout === 'rail'
  return (
    <div role="group" aria-label="Rarity" className={rail ? undefined : 'flex gap-1.5'}>
      {options.map((option) => {
        const active = option === value
        const tinted = active && option !== 'all'
        const style = tinted
          ? rail
            ? { color: rarityColor(option), borderColor: rarityColorA(option, 0.7) }
            : {
                color: rarityColor(option),
                borderColor: rarityColorA(option, 0.7),
                borderBottomColor: 'var(--bag-ink)'
              }
          : undefined
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            style={style}
            className={
              rail
                ? `block w-full border-l-2 py-2 pl-[10px] pr-3 text-left ${LABEL} ${FOCUS} ${
                    active
                      ? tinted
                        ? ''
                        : `border-[color:var(--bag-ink)] ${INK}`
                      : `border-transparent ${MUTE} hover:text-[color:var(--bag-ink)]`
                  }`
                : `${CHIP} ${
                    active ? (tinted ? 'border-b-2' : INVERT) : `${LINE} ${MUTE}`
                  }`
            }
          >
            {option.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
