'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatNumber } from '@/components/dashboard-v2/format'
import { toast } from '@/components/Toaster'
import { requestNotificationsRefresh } from '@/hooks/useNotifications'
import {
  forceExtensionSync,
  notifyDeviceRegistered,
  requestExtensionIdentity
} from '@/lib/extensionBridge'
import type {
  ActiveDevice,
  MeFetchResult,
  MeUser
} from '@/types/dashboard'

export type ExtensionLinkPhase =
  | 'unknown'
  | 'detecting'
  | 'linking'
  | 'linked'
  | 'syncing'
  | 'offline'

const HANDSHAKE_DELAY_MS = 500
const STALE_SYNC_RETRY_MS = 700

interface SyncSnapshot {
  totalScore: number
  totalVisits: number
  lastSync: string | null
}

const ZERO_SNAPSHOT: SyncSnapshot = {
  totalScore: 0,
  totalVisits: 0,
  lastSync: null
}

function takeSnapshot(result: MeFetchResult, fallback: SyncSnapshot): SyncSnapshot {
  if (!result.ok) return fallback
  return {
    totalScore: result.data.scores?.total_score || 0,
    totalVisits: result.data.stats?.total_visits || 0,
    lastSync:
      result.data.activeDevice?.last_sync_at ||
      result.data.user.last_extension_sync ||
      null
  }
}

function snapshotChanged(before: SyncSnapshot, after: SyncSnapshot): boolean {
  return (
    after.totalScore !== before.totalScore ||
    after.totalVisits !== before.totalVisits ||
    (!!after.lastSync && after.lastSync !== before.lastSync)
  )
}

// Blocks the auto-handshake effect from racing an in-flight transition.
function canStartHandshake(phase: ExtensionLinkPhase): boolean {
  switch (phase) {
    case 'unknown':
    case 'linked':
    case 'offline':
      return true
    case 'detecting':
    case 'linking':
    case 'syncing':
      return false
  }
}

interface RegistrationResult {
  ok: boolean
  syncToken: string | null
}

// Coarse cohort dimension for aggregate insights. Guarded because some
// embedders/browsers throw on Intl access; registration must never fail
// over a missing timezone.
function detectTimezone(): string | null {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof timezone === 'string' && timezone.length > 0 ? timezone : null
  } catch {
    return null
  }
}

async function registerDeviceWithBackend(
  userId: number,
  deviceUuid: string
): Promise<RegistrationResult> {
  const timezone = detectTimezone()
  const res = await fetch('/api/extension/sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceUuid,
      userId,
      events: [],
      batchId: crypto.randomUUID(),
      ...(timezone ? { timezone } : {})
    })
  })
  if (!res.ok) return { ok: false, syncToken: null }

  try {
    const body = await res.json()
    return {
      ok: true,
      syncToken: typeof body.syncToken === 'string' ? body.syncToken : null
    }
  } catch {
    return { ok: true, syncToken: null }
  }
}

export interface UseExtensionSyncArgs {
  user: MeUser | null
  activeDevice: ActiveDevice | null
  fetchMe: () => Promise<MeFetchResult>
  refreshDashboard: (opts: { scope: 'core' | 'full' }) => Promise<MeFetchResult>
}

export interface ExtensionSyncApi {
  phase: ExtensionLinkPhase
  syncing: boolean
  handleSync: () => Promise<void>
  attemptHandshake: () => Promise<boolean>
}

export function useExtensionSync({
  user,
  activeDevice,
  fetchMe,
  refreshDashboard
}: UseExtensionSyncArgs): ExtensionSyncApi {
  const [phase, setPhase] = useState<ExtensionLinkPhase>('unknown')
  const phaseRef = useRef<ExtensionLinkPhase>('unknown')
  const connectedDeviceRef = useRef<string | null>(null)
  const activeDeviceUuidRef = useRef<string | null>(activeDevice?.device_uuid ?? null)

  // The `user` object is replaced on every /api/user/me fetch (30s poll +
  // every refreshDashboard call). Callbacks must depend on the stable numeric
  // id — depending on the object identity made attemptHandshake (and the
  // auto-handshake effect below) re-fire after its own refreshDashboard(),
  // re-registering the device in a tight loop. Every registration rotates the
  // device sync token server-side, so the loop kept invalidating the token
  // the extension had just stored and ingestion 401'd forever.
  const userId = user?.id ?? null
  const userIdRef = useRef<number | null>(userId)

  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  useEffect(() => {
    activeDeviceUuidRef.current = activeDevice?.device_uuid ?? null
  }, [activeDevice?.device_uuid])

  const transition = useCallback((next: ExtensionLinkPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const settleIdlePhase = useCallback(() => {
    transition(connectedDeviceRef.current ? 'linked' : 'offline')
  }, [transition])

  const attemptHandshake = useCallback(async (): Promise<boolean> => {
    const sessionUserId = userIdRef.current
    if (!sessionUserId) return false
    if (!canStartHandshake(phaseRef.current)) return false

    transition('detecting')
    const identity = await requestExtensionIdentity()
    if (!identity?.deviceUuid) {
      transition('offline')
      return false
    }

    // Already bound to this device in this session — no work needed. A
    // registered device without a sync token still needs re-registration so
    // the server can issue one (its syncs would otherwise be rejected).
    const sameDevice = activeDeviceUuidRef.current === identity.deviceUuid
    if (
      connectedDeviceRef.current === identity.deviceUuid &&
      identity.isRegistered &&
      identity.hasSyncToken &&
      sameDevice
    ) {
      transition('linked')
      return true
    }

    let linked = identity.isRegistered && identity.hasSyncToken && sameDevice
    let issuedSyncToken: string | null = null
    if (!linked) {
      transition('linking')
      const registration = await registerDeviceWithBackend(
        sessionUserId,
        identity.deviceUuid
      )
      linked = registration.ok
      issuedSyncToken = registration.syncToken
    }

    if (!linked) {
      transition('offline')
      return false
    }

    connectedDeviceRef.current = identity.deviceUuid
    notifyDeviceRegistered({
      deviceUuid: identity.deviceUuid,
      userId: sessionUserId,
      ...(issuedSyncToken ? { syncToken: issuedSyncToken } : {})
    })
    await refreshDashboard({ scope: 'full' })
    transition('linked')
    return true
  }, [transition, refreshDashboard])

  const handleSync = useCallback(async () => {
    if (!userIdRef.current) return
    if (phaseRef.current === 'syncing') return

    // Handshake BEFORE entering the 'syncing' phase — canStartHandshake
    // blocks once we're syncing, so a handshake attempted inside the syncing
    // phase silently no-ops. This is also the manual recovery path: it
    // re-registers a never-linked device and re-issues a sync token the
    // extension may have lost, both required for the force sync to succeed.
    await attemptHandshake()

    transition('syncing')
    try {
      // "before" must be read AFTER handshake to avoid comparing against a
      // closure captured before device registration persisted.
      const beforeFetch = await fetchMe()
      const before = takeSnapshot(beforeFetch, ZERO_SNAPSHOT)

      const forceResult = await forceExtensionSync()

      const afterFetch = await refreshDashboard({ scope: 'full' })
      let after = takeSnapshot(afterFetch, before)

      // SYNC_COMPLETE can fire before user_scores is written; one retry
      // covers the gap without falling back to the 30s poll.
      if (forceResult.success && !snapshotChanged(before, after)) {
        await new Promise((resolve) => setTimeout(resolve, STALE_SYNC_RETRY_MS))
        const retryFetch = await refreshDashboard({ scope: 'core' })
        after = takeSnapshot(retryFetch, after)
      }

      const changed = snapshotChanged(before, after)
      const scoreDelta = after.totalScore - before.totalScore
      // The ZERO_SNAPSHOT fallback would inflate the delta to the full
      // lifetime total, so only celebrate when "before" actually loaded.
      if (beforeFetch.ok && changed && scoreDelta > 0) {
        toast({
          kind: 'score',
          title: 'SCORE SYNCED',
          body: `Total ${formatNumber(after.totalScore)} pts`,
          scoreDelta
        })
      } else if (forceResult.success || changed) {
        toast({
          kind: 'success',
          title: 'SYNC COMPLETE',
          body: 'Everything is up to date.'
        })
      } else {
        toast({
          kind: 'error',
          title: 'SYNC FAILED',
          body: 'Extension not responding. Check that Cribble is installed and enabled.'
        })
      }

      // A rank or milestone notification may have just been created
      // server-side; nudge the bell instead of waiting for its next poll.
      requestNotificationsRefresh()
    } finally {
      settleIdlePhase()
    }
  }, [transition, attemptHandshake, fetchMe, refreshDashboard, settleIdlePhase])

  // Runs once per login and when the server reports a different active
  // device. Depends on primitives only (see userIdRef note above): the
  // handshake itself refreshes the dashboard, and an object dependency here
  // would retrigger the effect on every refresh, looping registrations.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      void attemptHandshake()
    }, HANDSHAKE_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [userId, activeDevice?.device_uuid, attemptHandshake])

  return {
    phase,
    syncing: phase === 'syncing',
    handleSync,
    attemptHandshake
  }
}
