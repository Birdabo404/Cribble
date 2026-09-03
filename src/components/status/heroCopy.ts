// The /status verdict — one sentence, serif, with one emphasised word —
// and the mono sub-line under it. Pure: no React, no DOM. StatusConsole
// renders it in the page hero and status/opengraph-image.tsx paints the
// same words onto the unfurl card, so the link preview and the page it
// opens can never say two different things about the stack.

import { formatUtcTime, phaseLabel } from '@/components/status/severity'
import type { IncidentThread, ServiceStatus, StatusPayload } from '@/lib/status/types'

export type HeroCopy = {
  pre: string
  em: string
  post: string
  sub: string
  footnote: string | null
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function troubleSub(services: ServiceStatus[]): string {
  const down = services.filter((s) => s.severity === 'outage').map((s) => s.name)
  const degraded = services
    .filter((s) => s.severity === 'degraded')
    .map((s) => s.name)
  const clear = services.filter((s) => s.severity === 'operational').length
  const parts: string[] = []
  if (down.length > 0) {
    parts.push(`${listNames(down)} ${down.length === 1 ? 'is' : 'are'} down`)
  }
  if (degraded.length > 0) {
    parts.push(
      `${listNames(degraded)} ${degraded.length === 1 ? 'is' : 'are'} running degraded`
    )
  }
  const lead = parts.join('; ')
  if (clear === 0) return `${lead}.`
  return `${lead} — ${clear} ${clear === 1 ? 'service reports' : 'services report'} clear.`
}

function incompleteSub(services: ServiceStatus[]): string {
  const unknown = services
    .filter((s) => s.severity === 'unknown')
    .map((s) => s.name)
  if (unknown.length === 0) {
    return 'one or more feeds could not be read this pass — everything that answered reports clear.'
  }
  if (unknown.length === services.length) return 'no feeds answered this pass.'
  return `no signal from ${listNames(unknown)} this pass — the rest reports clear.`
}

/** When the operator has spoken, the verdict is theirs: the hero leads
 *  with the open thread instead of the probe arithmetic. Vendor trouble
 *  still shows on the watchlist below. */
function noticeHero(thread: IncidentThread, footnote: string | null): HeroCopy {
  const since = `since ${formatUtcTime(thread.openedAt).slice(0, 5)} utc`
  const phase = phaseLabel(thread.phase).toLowerCase()
  if (thread.phase === 'maintenance') {
    return {
      pre: 'scheduled ',
      em: 'maintenance',
      post: '.',
      sub: `${thread.title} — in progress ${since}.`,
      footnote
    }
  }
  return {
    pre: 'we’re ',
    em: 'on it',
    post: '.',
    sub: `${thread.title} — ${phase} ${since}.`,
    footnote
  }
}

/** `failed` = the latest refresh did not land; `payload` is then the
 *  last good pass (or null when there never was one). */
export function heroFor(payload: StatusPayload | null, failed: boolean): HeroCopy {
  if (payload === null) {
    if (failed) {
      return {
        pre: 'the watch is ',
        em: 'incomplete',
        post: '.',
        sub: 'the status feed itself did not answer — retry, or read the official sources below.',
        footnote: null
      }
    }
    return {
      pre: 'taking the ',
      em: 'pulse',
      post: '.',
      sub: 'first check in flight.',
      footnote: null
    }
  }

  if (failed) {
    return {
      pre: 'the watch is ',
      em: 'incomplete',
      post: '.',
      sub: `the last check did not land — showing the pass from ${formatUtcTime(payload.checkedAt)} utc.`,
      footnote: null
    }
  }

  const unknownNames = payload.services
    .filter((s) => s.severity === 'unknown')
    .map((s) => s.name)
  const footnote = payload.incomplete
    ? unknownNames.length > 0
      ? `no signal: ${unknownNames.join(' · ')}`
      : 'one or more feeds unreachable this pass'
    : null

  const openThread = payload.notices?.open[0]
  if (openThread !== undefined) return noticeHero(openThread, footnote)

  switch (payload.overall) {
    case 'outage':
      return {
        pre: 'the stack is ',
        em: 'loud',
        post: '.',
        sub: troubleSub(payload.services),
        footnote
      }
    case 'degraded':
      return {
        pre: 'something’s ',
        em: 'humming',
        post: '.',
        sub: troubleSub(payload.services),
        footnote
      }
    case 'operational': {
      if (payload.incomplete) {
        return {
          pre: 'the watch is ',
          em: 'incomplete',
          post: '.',
          sub: incompleteSub(payload.services),
          footnote: null
        }
      }
      const count = payload.services.length
      return {
        pre: 'the stack is ',
        em: 'quiet',
        post: '.',
        sub: `all ${count === 6 ? 'six' : count} services reporting clear.`,
        footnote: null
      }
    }
    default: {
      const exhaustive: never = payload.overall
      return exhaustive
    }
  }
}
