// Telemetry for the STATUS RIBBON at the top of the content column: the
// SYS.TIME clock cell and the rotating one-line readouts (rank and
// movement, score and today's gain, presence, fleet, decorations, and
// the visitor's CHASE line when there is one). Pure — StatusRibbon only
// cycles an index over the array and hands the current line to the
// decode — so the vocabulary, the ▲/▼ glyphs and the hazard flag for a
// rank loss are pinned by a test.

import type { HangarCard } from '@/lib/hangar/types'
import { ACHIEVEMENTS } from '@/lib/achievements'
import { HANGAR_MAX } from '@/lib/hangar/types'
import type { PublicProfileData } from '@/types/profile'

export interface RibbonLine {
  /** Stable per line kind; StatusRibbon keys the decoded span on it. */
  key: string
  text: string
  /** Printed in --pf-alert (the only chromatic ink): a rank loss. */
  alert: boolean
}

/** The slice of the payload the lines read. */
export type RibbonInput = Pick<
  PublicProfileData,
  | 'rank'
  | 'rankDelta'
  | 'score'
  | 'todayScore'
  | 'isActive'
  | 'lastSeen'
  | 'hangar'
  | 'badges'
  | 'restricted'
>

const SEP = ' · '

const num = (n: number) => Math.round(n).toLocaleString('en-US')

/** formatRelative's ladder with an injected `now`, upper-cased for the
 *  ribbon: JUST NOW · 5M AGO · 2H AGO · 3D AGO. */
export function agoUpper(iso: string | null | undefined, now: Date): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const diff = Math.max(0, now.getTime() - then)
  if (diff < 60_000) return 'JUST NOW'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}M AGO`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}H AGO`
  return `${Math.floor(diff / 86_400_000)}D AGO`
}

/** What a bay is called in a one-line readout. */
function cardName(card: HangarCard): string {
  switch (card.kind) {
    case 'github':
      return `${card.owner}/${card.repo}`
    case 'site':
      return card.title || card.host
    case 'pending':
      return card.host
    default: {
      const exhaustive: never = card
      return exhaustive
    }
  }
}

/** `YOU 98,240 · GAP 44,290 PTS BEHIND` — the signed-in visitor's own
 *  score against the profile's. LEVEL when the two are equal. */
export function chaseText(you: number, theirs: number): string {
  const gap = Math.abs(Math.round(theirs) - Math.round(you))
  if (gap === 0) return `YOU ${num(you)}${SEP}LEVEL`
  return `YOU ${num(you)}${SEP}GAP ${num(gap)} PTS ${theirs > you ? 'BEHIND' : 'AHEAD'}`
}

export function ribbonLines(profile: RibbonInput, chase: string | null, now: Date): RibbonLine[] {
  const lines: RibbonLine[] = []

  if (profile.rank !== null) {
    const delta = profile.rankDelta
    let text = `RANK #${num(profile.rank)}`
    if (delta !== 0) {
      const n = Math.abs(delta)
      text += `${SEP}${delta > 0 ? '▲' : '▼'} ${num(n)} ${n === 1 ? 'PLACE' : 'PLACES'}`
    }
    lines.push({ key: 'rank', text, alert: delta < 0 })
  } else {
    lines.push({ key: 'rank', text: 'UNRANKED', alert: false })
  }

  lines.push({
    key: 'score',
    text: `SCORE ${num(profile.score)}${SEP}+${num(profile.todayScore)} TODAY`,
    alert: false
  })

  lines.push(
    profile.isActive
      ? { key: 'presence', text: 'ONLINE', alert: false }
      : { key: 'presence', text: `LAST SEEN ${agoUpper(profile.lastSeen, now)}`, alert: false }
  )

  const hangar = profile.hangar ?? []
  const inFlight = hangar.find((card) => card.inFlight) ?? null
  lines.push({
    key: 'fleet',
    text:
      `FLEET ${hangar.length} / ${HANGAR_MAX}` +
      (inFlight ? `${SEP}IN FLIGHT ${cardName(inFlight)}` : ''),
    alert: false
  })

  lines.push({
    key: 'decorations',
    text: profile.restricted
      ? `DECORATIONS${SEP}PRIVATE`
      : `DECORATIONS ${profile.badges.length} / ${ACHIEVEMENTS.length}`,
    alert: false
  })

  if (chase) lines.push({ key: 'chase', text: chase, alert: false })

  return lines
}

/** `SYS.TIME 18:34:02 UTC+8` for the clock cell, in the viewer's zone. */
export function sysTime(now: Date): string {
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const offsetMin = -now.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  const zone = minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`
  return `SYS.TIME ${hh}:${mm}:${ss} ${zone}`
}

/** `REV 2609` — the record's revision stamp for the footer, YYMM of the
 *  enlist date (UTC). '—' when the date is unreadable. */
export function revStamp(memberSince: string | null | undefined): string {
  if (!memberSince) return 'REV —'
  const t = new Date(memberSince)
  if (!Number.isFinite(t.getTime())) return 'REV —'
  const yy = String(t.getUTCFullYear() % 100).padStart(2, '0')
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
  return `REV ${yy}${mm}`
}
