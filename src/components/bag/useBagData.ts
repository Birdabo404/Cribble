'use client'

// Bag data — everything /bag fetches and mutates, in one hook. Cosmetics
// (ownership + equip) and identity load in parallel on mount; achievements
// prefetch on idle once cosmetics resolve so the header counts are complete
// without opening the BADGES compartment. `equip` is the optimistic PATCH
// to /api/user/profile with rollback + toasts. All the pure rules live in
// bagModel.ts; this file owns nothing but state and the network.
//
// syncState is the fix for the old silent degrade: a failed cosmetics fetch
// used to render as "nothing owned". Now it reads 'error' and the header
// can offer RETRY; equip is a no-op until the sheet is synced.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/Toaster'
import { fetchMe } from '@/lib/client/fetchMe'
import { getPlate } from '@/lib/cosmetics/plates'
import {
  NEUTRAL_BADGES,
  NEUTRAL_COSMETICS,
  NEUTRAL_IDENTITY,
  defaultPlateSelection,
  usableIdsFor,
  type AchievementRow,
  type CosmeticsData,
  type Identity,
  type SyncState
} from './bagModel'

export type AchievementsState = 'idle' | 'loading' | 'ok' | 'error'

export interface BagData {
  /** null while the first load is in flight; neutral after a failure. */
  cosmetics: CosmeticsData | null
  identity: Identity
  equippedPlate: string | null
  equipping: boolean
  syncState: SyncState
  usableIds: Set<string>
  /** Spec-sheet default (equipped → first usable → catalog front). null
   * until cosmetics arrive; re-derived on every successful (re)load. */
  defaultPlateId: string | null
  /** null until the first achievements response; NEUTRAL_BADGES on failure. */
  achievements: AchievementRow[] | null
  achievementsState: AchievementsState
  /** Force the achievements fetch now (BADGES tab open). No-op once requested. */
  loadAchievements: () => void
  /** Optimistic equip/unequip. No-op while syncState !== 'ok' or while a
   * previous equip is still in flight. */
  equip: (nextPlateId: string | null) => Promise<void>
  /** Re-run the cosmetics + identity load (and achievements if they failed). */
  retry: () => void
}

interface CosmeticsResult {
  data: CosmeticsData
  /** false when the request failed — the neutral data is a guess, not a fact. */
  ok: boolean
}

const NEUTRAL_FAILURE: CosmeticsResult = { data: NEUTRAL_COSMETICS, ok: false }

async function fetchCosmetics(): Promise<CosmeticsResult> {
  try {
    const res = await fetch('/api/user/cosmetics', {
      cache: 'no-store',
      credentials: 'include'
    })
    // 401 is the server's definitive "no session": a signed-out visitor
    // truly carries nothing, so it is a successful neutral sync — not a
    // failure to retry. Every other non-ok status is.
    if (res.status === 401) return { data: NEUTRAL_COSMETICS, ok: true }
    if (!res.ok) return NEUTRAL_FAILURE
    const data = await res.json()
    if (!data?.success) return NEUTRAL_FAILURE
    return {
      ok: true,
      data: {
        isPro: Boolean(data.isPro),
        owned: new Set(
          Array.isArray(data.ownedPlateIds) ? data.ownedPlateIds.map(String) : []
        ),
        equipped: typeof data.equippedPlate === 'string' ? data.equippedPlate : null
      }
    }
  } catch {
    return NEUTRAL_FAILURE
  }
}

async function fetchIdentity(): Promise<Identity> {
  try {
    // Shared /me client cache — reuses the nav shell's request on a
    // hard load instead of firing a duplicate.
    const result = await fetchMe()
    if (!result.ok) return NEUTRAL_IDENTITY
    const user = result.data.user
    if (!user) return NEUTRAL_IDENTITY
    const totalScore = Number(result.data.scores?.total_score)
    return {
      name:
        typeof user.twitter_name === 'string' && user.twitter_name
          ? user.twitter_name
          : 'PILOT',
      username:
        typeof user.twitter_username === 'string' && user.twitter_username
          ? user.twitter_username
          : 'you',
      avatar:
        typeof user.twitter_profile_image === 'string' && user.twitter_profile_image
          ? user.twitter_profile_image
          : null,
      totalScore: Number.isFinite(totalScore) ? totalScore : null
    }
  } catch {
    return NEUTRAL_IDENTITY
  }
}

/** Run `cb` when the main thread goes idle; returns a cancel. Safari has
 * no requestIdleCallback, so it falls back to a short timeout. The
 * timeout ceiling keeps the counts from arriving seconds late under
 * hydration pressure. */
function whenIdle(cb: () => void): () => void {
  // typeof check (not `in`): lib.dom types Window with requestIdleCallback
  // unconditionally, so an `in` guard narrows the else branch to `never`.
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => cb(), { timeout: 1500 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(cb, 300)
  return () => window.clearTimeout(id)
}

export function useBagData(): BagData {
  const [cosmetics, setCosmetics] = useState<CosmeticsData | null>(null)
  const [identity, setIdentity] = useState<Identity>(NEUTRAL_IDENTITY)
  const [equippedPlate, setEquippedPlate] = useState<string | null>(null)
  const [equipping, setEquipping] = useState(false)
  // Synchronous twin of `equipping` for the guard inside equip(). State only
  // lands on the next render, so a second call arriving before that (Enter,
  // Enter on a row) would read a stale false and race the first PATCH.
  const equipInFlight = useRef(false)
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [defaultPlateId, setDefaultPlateId] = useState<string | null>(null)
  // Bumped by retry(); the load effect re-runs on every change.
  const [syncRun, setSyncRun] = useState(0)

  const [achievements, setAchievements] = useState<AchievementRow[] | null>(null)
  const [achievementsState, setAchievementsState] = useState<AchievementsState>('idle')
  // 0 = not requested yet; each increment (re)runs the fetch effect.
  const [achievementsRun, setAchievementsRun] = useState(0)

  // cosmetics + identity, in parallel, cancel-safe
  useEffect(() => {
    let cancelled = false
    setSyncState('loading')
    const load = async () => {
      const [cosmeticsResult, identityData] = await Promise.all([
        fetchCosmetics(),
        fetchIdentity()
      ])
      if (cancelled) return
      setCosmetics(cosmeticsResult.data)
      setIdentity(identityData)
      setEquippedPlate(cosmeticsResult.data.equipped)
      setDefaultPlateId(defaultPlateSelection(cosmeticsResult.data))
      setSyncState(cosmeticsResult.ok ? 'ok' : 'error')
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [syncRun])

  // idle prefetch: header counts complete without opening the tab
  useEffect(() => {
    if (cosmetics === null || achievementsRun > 0) return
    return whenIdle(() => setAchievementsRun((run) => (run === 0 ? 1 : run)))
  }, [cosmetics, achievementsRun])

  // the achievements fetch itself
  useEffect(() => {
    if (achievementsRun === 0) return
    let cancelled = false
    setAchievementsState('loading')
    const load = async () => {
      try {
        const res = await fetch('/api/user/achievements', { credentials: 'include' })
        const data = res.ok ? await res.json() : null
        if (cancelled) return
        if (data?.success && Array.isArray(data.achievements)) {
          setAchievements(data.achievements as AchievementRow[])
          setAchievementsState('ok')
        } else {
          setAchievements(NEUTRAL_BADGES)
          setAchievementsState('error')
        }
      } catch {
        if (cancelled) return
        setAchievements(NEUTRAL_BADGES)
        setAchievementsState('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [achievementsRun])

  const loadAchievements = useCallback(() => {
    setAchievementsRun((run) => (run === 0 ? 1 : run))
  }, [])

  const retry = useCallback(() => {
    setSyncRun((run) => run + 1)
    if (achievementsState === 'error') setAchievementsRun((run) => run + 1)
  }, [achievementsState])

  const usableIds = useMemo(
    () => (cosmetics ? usableIdsFor(cosmetics) : new Set<string>()),
    [cosmetics]
  )

  const equip = useCallback(
    async (nextPlateId: string | null) => {
      // Never write against a sheet we could not read: the optimistic
      // state would be a guess on top of a guess.
      if (syncState !== 'ok') return
      // One write at a time. A second call while the first PATCH is out
      // would flip the optimistic state again and let the two responses
      // race — the rollback could then restore the wrong plate.
      if (equipInFlight.current) return
      equipInFlight.current = true
      const prev = equippedPlate
      setEquipping(true)
      setEquippedPlate(nextPlateId)
      try {
        const res = await fetch('/api/user/profile', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ equipped_plate: nextPlateId })
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) throw new Error('equip rejected')
        if (nextPlateId) {
          toast({
            kind: 'success',
            title: 'PLATE EQUIPPED',
            body: `${getPlate(nextPlateId)?.name ?? 'Plate'} is live on the board.`
          })
        } else {
          toast({
            kind: 'info',
            title: 'PLATE UNEQUIPPED',
            body: 'Back to the stock row.'
          })
        }
      } catch {
        setEquippedPlate(prev)
        toast({
          kind: 'error',
          title: 'EQUIP FAILED',
          body: 'The board did not take it. Try again.'
        })
      } finally {
        equipInFlight.current = false
        setEquipping(false)
      }
    },
    [syncState, equippedPlate]
  )

  return {
    cosmetics,
    identity,
    equippedPlate,
    equipping,
    syncState,
    usableIds,
    defaultPlateId,
    achievements,
    achievementsState,
    loadAchievements,
    equip,
    retry
  }
}
