import { describe, expect, it } from 'vitest'
import type { NoticeEntry, NoticePhase, NoticeSeverity, StatusPayload } from './types'
import {
  applyNotices,
  carryForward,
  cleanNoticeText,
  deriveNotices,
  isNoticePhase,
  isNoticeSeverity,
  threadOf,
  toNoticeEntry
} from './notices'

// The log is pure once the rows are read: these pin the fold (latest
// line wins, chronology by timestamp then id), the open/recent split
// with its window and cap, the overall lift, and the carry-forward
// rules a follow-up post relies on.

const NOW = new Date('2026-09-03T15:30:00.000Z')

let nextId = 1

function line(
  incidentId: string,
  minutesAgo: number,
  phase: NoticePhase,
  severity: NoticeSeverity = 'degraded',
  overrides: Partial<NoticeEntry> = {}
): NoticeEntry {
  return {
    id: nextId++,
    incidentId,
    at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    severity,
    phase,
    title: `Incident ${incidentId}`,
    body: `${phase} line`,
    ...overrides
  }
}

const basePayload: StatusPayload = {
  services: [],
  overall: 'operational',
  incomplete: false,
  checkedAt: NOW.toISOString()
}

describe('threadOf', () => {
  it('returns null for no lines', () => {
    expect(threadOf([])).toBeNull()
  })

  it('reads state off the newest line and lists entries newest first', () => {
    const opened = line('a', 60, 'investigating', 'degraded')
    const identified = line('a', 30, 'identified', 'outage')
    const thread = threadOf([identified, opened])

    expect(thread).not.toBeNull()
    expect(thread?.phase).toBe('identified')
    expect(thread?.severity).toBe('outage')
    expect(thread?.open).toBe(true)
    expect(thread?.openedAt).toBe(opened.at)
    expect(thread?.updatedAt).toBe(identified.at)
    expect(thread?.resolvedAt).toBeNull()
    expect(thread?.entries.map((entry) => entry.id)).toEqual([identified.id, opened.id])
  })

  it('closes on a resolved line and stamps resolvedAt from it', () => {
    const opened = line('a', 60, 'investigating')
    const resolved = line('a', 5, 'resolved', 'operational')
    const thread = threadOf([opened, resolved])

    expect(thread?.open).toBe(false)
    expect(thread?.resolvedAt).toBe(resolved.at)
    expect(thread?.severity).toBe('operational')
  })

  it('reopens when a non-terminal line lands after a resolution', () => {
    const opened = line('a', 60, 'investigating')
    const resolved = line('a', 30, 'resolved', 'operational')
    const reopened = line('a', 10, 'monitoring', 'degraded')
    const thread = threadOf([resolved, reopened, opened])

    expect(thread?.open).toBe(true)
    expect(thread?.phase).toBe('monitoring')
    expect(thread?.resolvedAt).toBeNull()
  })

  it('breaks same-millisecond ties by id', () => {
    const at = NOW.toISOString()
    const first = line('a', 0, 'investigating', 'degraded', { at })
    const second = line('a', 0, 'resolved', 'operational', { at })
    // Reversed input order must not change the verdict.
    expect(threadOf([second, first])?.phase).toBe('resolved')
    expect(threadOf([first, second])?.phase).toBe('resolved')
  })

  it('carries the newest line’s title', () => {
    const opened = line('a', 60, 'investigating', 'degraded', { title: 'Old title' })
    const renamed = line('a', 30, 'identified', 'degraded', { title: 'Sharper title' })
    expect(threadOf([opened, renamed])?.title).toBe('Sharper title')
  })
})

describe('deriveNotices', () => {
  it('splits open from resolved and orders open threads by last update', () => {
    const quiet = line('older', 240, 'investigating')
    const loud = line('newer', 200, 'investigating')
    const loudUpdate = line('newer', 20, 'identified')
    const olderUpdate = line('older', 10, 'monitoring')
    const done = line('done', 300, 'investigating')
    const doneResolved = line('done', 100, 'resolved', 'operational')

    const notices = deriveNotices([quiet, loud, loudUpdate, olderUpdate, done, doneResolved], NOW)

    expect(notices.open.map((thread) => thread.incidentId)).toEqual(['older', 'newer'])
    expect(notices.recent.map((thread) => thread.incidentId)).toEqual(['done'])
    expect(notices.recent[0].resolvedAt).toBe(doneResolved.at)
  })

  it('drops resolutions older than the window and caps the list', () => {
    const entries: NoticeEntry[] = []
    // Six resolved incidents, one per day going back, newest first.
    for (let day = 0; day < 6; day++) {
      const id = `r${day}`
      entries.push(line(id, day * 1440 + 120, 'investigating'))
      entries.push(line(id, day * 1440 + 60, 'resolved', 'operational'))
    }
    // One resolved 20 days ago — outside the 14-day window.
    entries.push(line('stale', 20 * 1440 + 60, 'investigating'))
    entries.push(line('stale', 20 * 1440, 'resolved', 'operational'))

    const notices = deriveNotices(entries, NOW)

    expect(notices.open).toEqual([])
    expect(notices.recent).toHaveLength(5)
    expect(notices.recent.map((thread) => thread.incidentId)).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      'r4'
    ])
    expect(notices.recent.some((thread) => thread.incidentId === 'stale')).toBe(false)
  })

  it('honours window and limit overrides', () => {
    const entries = [
      line('a', 3 * 1440, 'investigating'),
      line('a', 3 * 1440 - 30, 'resolved', 'operational'),
      line('b', 60, 'investigating'),
      line('b', 30, 'resolved', 'operational')
    ]
    const notices = deriveNotices(entries, NOW, { recentWindowDays: 1, recentLimit: 1 })
    expect(notices.recent.map((thread) => thread.incidentId)).toEqual(['b'])
  })

  it('returns empty lists for an empty log', () => {
    expect(deriveNotices([], NOW)).toEqual({ open: [], recent: [] })
  })
})

describe('applyNotices', () => {
  it('lifts overall to the worst open notice', () => {
    const notices = deriveNotices(
      [line('a', 10, 'investigating', 'degraded'), line('b', 5, 'identified', 'outage')],
      NOW
    )
    const applied = applyNotices(basePayload, notices)
    expect(applied.overall).toBe('outage')
    expect(applied.notices).toBe(notices)
  })

  it('never lowers what the probes already say', () => {
    const notices = deriveNotices([line('a', 10, 'maintenance', 'operational')], NOW)
    const applied = applyNotices({ ...basePayload, overall: 'degraded' }, notices)
    expect(applied.overall).toBe('degraded')
  })

  it('ignores resolved threads', () => {
    const notices = deriveNotices(
      [line('a', 60, 'investigating', 'outage'), line('a', 5, 'resolved', 'operational')],
      NOW
    )
    expect(applyNotices(basePayload, notices).overall).toBe('operational')
  })

  it('leaves the rest of the payload untouched', () => {
    const applied = applyNotices(basePayload, { open: [], recent: [] })
    expect(applied.services).toBe(basePayload.services)
    expect(applied.checkedAt).toBe(basePayload.checkedAt)
    expect(applied.incomplete).toBe(false)
  })
})

describe('carryForward', () => {
  const thread = threadOf([line('a', 30, 'identified', 'outage', { title: 'API errors' })])!

  it('keeps the thread title and severity for an ordinary follow-up', () => {
    expect(carryForward(thread, 'monitoring', undefined)).toEqual({
      title: 'API errors',
      severity: 'outage'
    })
  })

  it('defaults a resolution to operational', () => {
    expect(carryForward(thread, 'resolved', undefined).severity).toBe('operational')
  })

  it('lets an explicit severity win on any phase', () => {
    expect(carryForward(thread, 'resolved', 'degraded').severity).toBe('degraded')
    expect(carryForward(thread, 'monitoring', 'degraded').severity).toBe('degraded')
  })
})

describe('validators and mapping', () => {
  it('recognises the phase and severity vocabularies', () => {
    expect(isNoticePhase('monitoring')).toBe(true)
    expect(isNoticePhase('fixed')).toBe(false)
    expect(isNoticePhase(3)).toBe(false)
    expect(isNoticeSeverity('outage')).toBe(true)
    // A human never posts 'unknown' — that word belongs to the probes.
    expect(isNoticeSeverity('unknown')).toBe(false)
  })

  it('strips control characters and collapses whitespace', () => {
    expect(cleanNoticeText('  we\u0000 are\n\n  on it \t')).toBe('we are on it')
    expect(cleanNoticeText(42)).toBe('')
  })

  it('maps a row onto the contract, defaulting unrecognised words safely', () => {
    const entry = toNoticeEntry({
      id: '9',
      incident_id: 'abc',
      severity: 'weird',
      phase: 'odd',
      title: 'T',
      body: 'B',
      created_at: '2026-09-03 15:00:00+00'
    })
    expect(entry).toEqual({
      id: 9,
      incidentId: 'abc',
      at: '2026-09-03T15:00:00.000Z',
      severity: 'degraded',
      phase: 'investigating',
      title: 'T',
      body: 'B'
    })
  })
})
