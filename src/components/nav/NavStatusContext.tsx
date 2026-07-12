'use client'

// Page → nav status channel. The dashboard owns the extension sync flow
// (connection state, last sync, the sync action itself) but the button and
// status pill render inside the persistent nav shell. Pages publish their
// status through this context; the nav consumes it. Pages that publish
// nothing simply get a nav without the sync cluster.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react'

export type ConnectionState = 'online' | 'idle' | 'offline'

export interface NavStatus {
  connection: ConnectionState
  lastSync: string | null
  onSync: () => void
  syncing: boolean
}

export interface ConnectionMeta {
  label: string
  dotClass: string
}

export function connectionMeta(connection: ConnectionState): ConnectionMeta {
  switch (connection) {
    case 'online':
      return {
        label: 'LIVE',
        dotClass: 'bg-accent shadow-[0_0_10px_rgb(var(--accent-rgb)/0.7)]'
      }
    case 'idle':
      return { label: 'IDLE', dotClass: 'bg-amber-400' }
    case 'offline':
      return { label: 'OFFLINE', dotClass: 'bg-zinc-600' }
    default: {
      const exhaustive: never = connection
      return exhaustive
    }
  }
}

const ValueCtx = createContext<NavStatus | null>(null)
const SetterCtx = createContext<Dispatch<SetStateAction<NavStatus | null>> | null>(null)

export function NavStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<NavStatus | null>(null)
  return (
    <SetterCtx.Provider value={setStatus}>
      <ValueCtx.Provider value={status}>{children}</ValueCtx.Provider>
    </SetterCtx.Provider>
  )
}

export function useNavStatus(): NavStatus | null {
  return useContext(ValueCtx)
}

/**
 * Publish a page's sync status to the nav. Pass a memoized object — the
 * effect re-publishes whenever the identity changes. Cleared automatically
 * when the page unmounts.
 */
export function usePublishNavStatus(status: NavStatus | null): void {
  const setStatus = useContext(SetterCtx)
  useEffect(() => {
    if (!setStatus) return
    setStatus(status)
    return () => setStatus(null)
  }, [setStatus, status])
}
