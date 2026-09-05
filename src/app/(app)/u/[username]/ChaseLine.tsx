'use client'

// CHASE — the signed-in visitor's own score set against the profile's:
// `YOU 98,240 · GAP 44,290 PTS BEHIND`. Reads the viewer through the
// shared /me client cache (fetchMe), so on a hard load it usually reuses
// the nav shell's response and costs no extra request. Only for a
// signed-in viewer who is not the owner; nothing renders while the
// number is loading or if the fetch fails. useChase is exported on its
// own so ProfileClient can compute the line once and feed both this
// component (in the dossier block) and the STATUS RIBBON's rotation.

import { useEffect, useState } from 'react'
import { fetchMe } from '@/lib/client/fetchMe'
import type { PublicProfileData } from '@/types/profile'
import { chaseText } from './ribbonLines'

export type ChaseInput = Pick<PublicProfileData, 'viewer' | 'score'>

/** The CHASE line, or null (signed out, own profile, not loaded, failed). */
export function useChase(profile: ChaseInput | null): string | null {
  const eligible = profile !== null && profile.viewer !== null && !profile.viewer.isYou
  const [you, setYou] = useState<number | null>(null)

  useEffect(() => {
    if (!eligible) return
    let cancelled = false
    fetchMe()
      .then((result) => {
        if (cancelled || !result.ok) return
        const score = result.data.scores?.total_score
        if (typeof score === 'number' && Number.isFinite(score)) setYou(score)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [eligible])

  if (!eligible || you === null) return null
  return chaseText(you, profile.score)
}

/** `pf-micro` line in the heat ink (--pf-ember-ink, 5.04:1 on paper —
 *  the score chase is the one line here that is about heat); null when
 *  there is nothing to say. */
export function ChaseLine({ text, className = '' }: { text: string | null; className?: string }) {
  if (!text) return null
  return (
    <p className={`pf-micro ${className}`} style={{ color: 'var(--pf-ember-ink)' }}>
      {text}
    </p>
  )
}
