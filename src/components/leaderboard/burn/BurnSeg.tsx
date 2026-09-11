// The toolbar's segmented text toggle — a hairline square group of mono
// uppercase cells (.bb-seg / .bb-segbtn in BurnStyles). The active cell
// is ember ink with a 2px ember rule along its bottom edge: the pager's
// aria-current underline promoted to the cell's own edge, so one mark
// says "current" everywhere on the board, and it never moves layout the
// way brackets or a weight bump would. Shared by the page's board tabs
// (GLOBAL / TOKENS / AI / TEAMS), the burn board's source and window
// toggles, and GLOBAL's SEASON / ALL-TIME scope.

export type BurnSegItem<T extends string> = {
  id: T
  label: string
}

export type BurnSegProps<T extends string> = {
  items: readonly BurnSegItem<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel: string
}

export function BurnSeg<T extends string>({ items, value, onChange, ariaLabel }: BurnSegProps<T>) {
  return (
    <div className="bb-seg" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className="bb-segbtn"
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
