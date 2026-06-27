'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

async function registerDeviceWithBackend(
  user: MeUser,
  deviceUuid: string
): Promise<boolean> {
  const res = await fetch('/api/extension/sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceUuid,
      userId: user.id,
      events: [],
      batchId: crypto.randomUUID()
    })
  })
  return res.ok
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
    if (!user) return false
    if (!canStartHandshake(phaseRef.current)) return false

    transition('detecting')
    const identity = await requestExtensionIdentity()
    if (!identity?.deviceUuid) {
      transition('offline')
      return false
    }

    // Already bound to this device in this session — no work needed.
    const sameDevice = activeDeviceUuidRef.current === identity.deviceUuid
    if (
      connectedDeviceRef.current === identity.deviceUuid &&
      identity.isRegistered &&
      sameDevice
    ) {
      transition('linked')
      return true
    }

    let linked = identity.isRegistered && sameDevice
    if (!linked) {
      transition('linking')
      linked = await registerDeviceWithBackend(user, identity.deviceUuid)
    }

    if (!linked) {
      transition('offline')
      return false
    }

    connectedDeviceRef.current = identity.deviceUuid
    notifyDeviceRegistered({ deviceUuid: identity.deviceUuid, userId: user.id })
    await refreshDashboard({ scope: 'full' })
    transition('linked')
    return true
  }, [user, transition, refreshDashboard])

  const handleSync = useCallback(async () => {
    if (!user) return
    if (phaseRef.current === 'syncing') return

    transition('syncing')
    try {
      if (!activeDeviceUuidRef.current) {
        await attemptHandshake()
      }

      // "before" must be read AFTER handshake to avoid comparing against a
      // closure captured before device registration persisted.
      const beforeFetch = await fetchMe()
      const before = takeSnapshot(beforeFetch, ZERO_SNAPSHOT)

      const forceResult = await forceExtensionSync()

      const afterFetch = await refreshDashboard({ scope: 'full' })
      const after = takeSnapshot(afterFetch, before)

      // SYNC_COMPLETE can fire before user_scores is written; one retry
      // covers the gap without falling back to the 30s poll.
      if (forceResult.success && !snapshotChanged(before, after)) {
        await new Promise((resolve) => setTimeout(resolve, STALE_SYNC_RETRY_MS))
        await refreshDashboard({ scope: 'core' })
      }
    } finally {
      settleIdlePhase()
    }
  }, [user, transition, attemptHandshake, fetchMe, refreshDashboard, settleIdlePhase])

  // Re-runs when the server reports a different active device.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      void attemptHandshake()
    }, HANDSHAKE_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [user, activeDevice?.device_uuid, attemptHandshake])

  return {
    phase,
    syncing: phase === 'syncing',
    handleSync,
    attemptHandshake
  }
}
