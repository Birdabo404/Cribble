import { formatRelative } from './format'
import { ThemeToggle } from '@/components/ThemeToggle'
import type { MeUser } from '@/types/dashboard'

export type ConnectionState = 'online' | 'idle' | 'offline'

export function Header({
  user,
  connection,
  lastSync,
  onSync,
  syncing,
  onOpenAccount
}: {
  user: MeUser
  connection: ConnectionState
  lastSync: string | null
  onSync: () => void
  syncing: boolean
  onOpenAccount: () => void
}) {
  const dotColor =
    connection === 'online'
      ? 'bg-accent shadow-[0_0_10px_rgb(var(--accent-rgb)/0.7)]'
      : connection === 'idle'
      ? 'bg-amber-400'
      : 'bg-zinc-600'

  const stateLabel =
    connection === 'online' ? 'LIVE' : connection === 'idle' ? 'IDLE' : 'OFFLINE'

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="text-sm tracking-[0.4em] text-zinc-100 font-semibold">
          CRIBBLE<span className="text-accent">.</span>
        </div>
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-950/70">
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span className="text-[10px] tracking-[0.3em] text-zinc-400">{stateLabel}</span>
          <span className="text-[10px] text-zinc-700">·</span>
          <span className="text-[10px] tracking-[0.2em] text-zinc-500">SYNC {formatRelative(lastSync)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={onSync}
          disabled={syncing}
          className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 transition-colors disabled:opacity-50"
        >
          {syncing ? 'SYNCING…' : 'SYNC'}
        </button>
        <a
          href="/leaderboard"
          className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 transition-colors"
        >
          LEADERBOARD
        </a>
        <button
          onClick={onOpenAccount}
          className="ml-1 flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full border border-zinc-800 bg-zinc-950/70 hover:border-accent/40 hover:bg-zinc-900/80 transition-colors"
          aria-label="Open account"
        >
          {user.twitter_profile_image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.twitter_profile_image}
              alt={user.twitter_username}
              className="h-7 w-7 rounded-full border border-zinc-800 object-cover"
            />
          ) : (
            <div className="h-7 w-7 rounded-full border border-zinc-800 bg-zinc-900" />
          )}
          <span className="hidden sm:inline text-[11px] text-zinc-100">
            @{user.twitter_username || 'user'}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            className="h-3 w-3 text-zinc-500"
            aria-hidden
          >
            <path
              fill="currentColor"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
