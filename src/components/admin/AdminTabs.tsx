'use client'

// Underline tab bar for admin workspaces that show one bucket at a
// time. Each tab wears its bucket count in font-data; the row scrolls
// horizontally when the viewport is narrower than the tabs (mobile).
// Generic over the page's tab-id union so switch statements over the
// selected id stay exhaustively checkable.

export interface AdminTabItem<Id extends string = string> {
  id: Id
  label: string
  /** Muted tabular count after the label (bucket size). */
  count?: number
}

export interface AdminTabsProps<Id extends string = string> {
  tabs: readonly AdminTabItem<Id>[]
  active: Id
  onSelect: (id: Id) => void
  /** Accessible name for the tablist. */
  label: string
}

export function AdminTabs<Id extends string>({
  tabs,
  active,
  onSelect,
  label
}: AdminTabsProps<Id>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="st-no-scrollbar -mb-px flex gap-1 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px] leading-none transition-colors duration-150 md:h-9 ${
              isActive
                ? 'border-[color:var(--st-text)] font-medium text-[color:var(--st-text)]'
                : 'border-transparent text-[color:var(--st-text-muted)] hover:text-[color:var(--st-text)]'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`font-data text-[11px] font-medium tabular-nums ${
                  isActive
                    ? 'text-[color:var(--st-text-muted)]'
                    : 'text-[color:var(--st-text-faint)]'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
