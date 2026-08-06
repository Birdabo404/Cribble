// Stroke icon set for the navigation shell — same 24px viewBox / 1.8
// stroke language as the AccountMenu and NotificationBell glyphs.

const PATHS = {
  console: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  standings: 'M18 20V10 M12 20V4 M6 20v-6',
  award: 'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M8.21 13.89 7 23l5-3 5 3-1.21-9.12',
  pilot: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  shop: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0',
  bag: 'M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9z M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2 M8 21v-5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5',
  team: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  sync: 'M21 12a9 9 0 1 1-2.64-6.36 M21 3v6h-6',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  close: 'M18 6 6 18 M6 6l12 12',
  signIn: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3'
} as const satisfies Record<string, string>

export type NavIconName = keyof typeof PATHS

export function NavIcon({
  name,
  className = 'h-4 w-4'
}: {
  name: NavIconName
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
