import { formatRelative } from '@/components/dashboard-v2/format'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AccountMenu } from './AccountMenu'
import { NotificationBell } from './NotificationBell'
import type { ActiveDevice, MeUser } from '@/types/dashboard'

export type ConnectionState = 'online' | 'idle' | 'offline'

export function Header({
  user,
  connection,
  lastSync,
  onSync,
  syncing,
  activeDevice,
  onLogout
}: {
  user: MeUser
  connection: ConnectionState
  lastSync: string | null
  onSync: () => void
  syncing: boolean
  activeDevice: ActiveDevice | null
  onLogout: () => void
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
        <NotificationBell />
        <div className="ml-1">
          <AccountMenu user={user} activeDevice={activeDevice} onLogout={onLogout} />
        </div>
      </div>
    </header>
  )
}
