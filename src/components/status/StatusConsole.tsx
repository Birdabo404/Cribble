'use client'

// The /status client island — everything visible: header chrome (liquid
// mark, wordmark, live UTC clock, theme toggle), the serif hero rollup,
// the six-row watchlist card, and the sources footer. Fetches GET
// /api/status on mount and every 60s (ticks skipped while the tab is
// hidden), and holds the last good pass through a failed refresh so the
// page degrades to stale-but-honest instead of blank.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ServiceRow } from '@/components/status/ServiceRow'
import { StatusGlyph } from '@/components/status/StatusGlyph'
import { formatUtcTime } from '@/components/status/severity'
import { ACCENT } from '@/lib/theme'
import type { ServiceStatus, StatusPayload } from '@/lib/status/types'

const POLL_MS = 60_000

/** Official pages for the pre-data footer; the payload's own sourceUrl
 *  takes over as soon as a pass lands. */
const FALLBACK_SOURCES = [
  { host: 'githubstatus.com', url: 'https://www.githubstatus.com' },
  { host: 'status.openai.com', url: 'https://status.openai.com' },
  { host: 'status.claude.com', url: 'https://status.claude.com' },
  { host: 'status.cursor.com', url: 'https://status.cursor.com' },
  { host: 'status.x.ai', url: 'https://status.x.ai' }
]

/* ---------- hero copy ---------- */

type HeroCopy = {
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

function heroFor(payload: StatusPayload | null, failed: boolean): HeroCopy {
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

function sourcesFor(
  payload: StatusPayload | null
): { host: string; url: string }[] {
  if (payload === null) return FALLBACK_SOURCES
  const list: { host: string; url: string }[] = []
  for (const service of payload.services) {
    if (service.id === 'cribble') continue
    try {
      list.push({
        host: new URL(service.sourceUrl).hostname.replace(/^www\./, ''),
        url: service.sourceUrl
      })
    } catch {
      // malformed sourceUrl — skip the link rather than render a dud
    }
  }
  return list.length > 0 ? list : FALLBACK_SOURCES
}

/* ---------- chrome bits ---------- */

function UtcClock() {
  const [clock, setClock] = useState('')
  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-data text-[10px] tracking-[0.3em] text-zinc-300">
      {clock === '' ? '··:··:··' : clock} UTC
    </span>
  )
}

function RetryChip({
  busy,
  onRetry,
  className = ''
}: {
  busy: boolean
  onRetry: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 font-mono text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 disabled:cursor-default disabled:opacity-60 ${className}`}
    >
      {busy ? 'CHECKING…' : 'RETRY'}
    </button>
  )
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse px-4 py-4 motion-reduce:animate-none sm:px-5"
        >
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
            <span className="h-3.5 w-24 rounded bg-white/[0.08]" />
            <span className="ml-auto h-3 w-16 rounded bg-white/[0.05]" />
          </div>
          <div className="mt-3 h-7 rounded bg-white/[0.04]" />
        </div>
      ))}
    </>
  )
}

/* ---------- the console ---------- */

export function StatusConsole() {
  const [payload, setPayload] = useState<StatusPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as StatusPayload
      if (!Array.isArray(data.services)) throw new Error('malformed payload')
      setPayload(data)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (!document.hidden) void load()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const hero = heroFor(payload, failed)
  const sources = sourcesFor(payload)
  const lastChecked = payload !== null ? formatUtcTime(payload.checkedAt) : null
  const retry = () => void load()

  return (
    <div className="status-scope flex-1">
      {/* header chrome — wordmark, instrument cluster, theme, home */}
      <header
        className="status-reveal flex items-center justify-between gap-3 pt-8"
        style={{ ['--sr' as string]: '0ms' }}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 font-mono text-sm font-semibold tracking-[0.3em] text-zinc-100 transition-colors hover:text-zinc-300 sm:tracking-[0.4em]"
        >
          <LiquidMark size={20} />
          <span>
            CRIBBLE<span style={{ color: ACCENT }}>.</span>
          </span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-right">
            <UtcClock />
            <div className="font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600">
              checks every 60s
              {lastChecked !== null ? ` · last ${lastChecked.slice(0, 5)}` : ''}
            </div>
          </div>
          <ThemeToggle />
          <Link
            href="/"
            className="hidden rounded border border-zinc-800 px-3 py-1.5 font-mono text-[10px] tracking-[0.3em] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200 sm:inline-flex"
          >
            ← HOME
          </Link>
        </div>
      </header>

      {/* hero rollup — the serif verdict */}
      <section
        className="status-reveal mt-12 sm:mt-16"
        style={{ ['--sr' as string]: '90ms' }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-zinc-500">
          <span className="text-accent">Telemetry</span>
          <span className="mx-2 text-zinc-700">/</span>
          Status
        </p>
        <h1 className="mt-4 font-serif text-4xl leading-[1.08] text-zinc-300 md:text-5xl">
          {hero.pre}
          <em className="text-zinc-50">{hero.em}</em>
          {hero.post}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-500">
          {hero.sub}
        </p>
        {hero.footnote !== null && (
          <p className="mt-3 flex items-center gap-2 font-data text-[10px] uppercase tracking-[0.25em] text-zinc-600">
            <StatusGlyph severity="unknown" size={7} />
            {hero.footnote}
          </p>
        )}
        {failed && <RetryChip busy={busy} onRetry={retry} className="mt-5" />}
      </section>

      {/* system card — the watchlist */}
      <section
        className="status-reveal mt-10"
        style={{ ['--sr' as string]: '180ms' }}
      >
        <div className="glass-lite dash-frame relative overflow-hidden rounded-2xl">
          <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] px-4 pb-3 pt-4 sm:px-5">
            <span className="font-data text-[10px] uppercase tracking-[0.4em] text-zinc-300">
              <span className="text-accent/80">{'// '}</span>watchlist
            </span>
            <span className="font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600">
              {payload !== null
                ? `last check ${lastChecked} utc`
                : failed
                  ? 'feed unreachable'
                  : 'first check in flight'}
            </span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {payload !== null ? (
              payload.services.map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))
            ) : failed ? (
              <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                <StatusGlyph severity="unknown" size={12} />
                <p className="font-data text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  the feeds did not answer
                </p>
                <RetryChip busy={busy} onRetry={retry} />
              </div>
            ) : (
              <SkeletonRows />
            )}
          </div>
        </div>
      </section>

      {/* sources footer — provenance + the last-checked stamp */}
      <footer
        className="status-reveal mt-10 pb-10"
        style={{ ['--sr' as string]: '270ms' }}
      >
        <p className="font-data text-[9px] uppercase leading-relaxed tracking-[0.3em] text-zinc-600">
          sourced from official public status pages —{' '}
          {sources.map((source, i) => (
            <span key={source.host}>
              {i > 0 ? <span className="text-zinc-800"> · </span> : null}
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-200 hover:underline"
              >
                {source.host}
              </a>
            </span>
          ))}
        </p>
        <div className="mt-4 flex items-baseline justify-between gap-4">
          <span className="font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600">
            {lastChecked !== null
              ? `last checked ${lastChecked} utc`
              : 'no pass completed yet'}
          </span>
          <span aria-hidden className="dash-barcode h-3.5 w-20 shrink-0" />
        </div>
      </footer>

      <style jsx global>{`
        /* /status — scoped instrument kit. Severity inks resolve through
           the --sev-* vars: dark reads the repo tokens verbatim (accent /
           ice / ember on the lx-hero field); light re-pins outage to
           stamp-red ink, because the dossier paper theme pins ember to
           the same orange as the accent and a status page must never let
           "quiet" and "down" share a hue. --status-glow dims the neon on
           paper the same way --lb-glow does. */
        .status-scope {
          --sev-ok: var(--accent-rgb);
          --sev-warn: var(--ice-rgb);
          --sev-down: var(--ember-rgb);
          --status-glow: 1;
        }
        html.light .status-scope {
          --sev-down: 185 28 28;
          --status-glow: 0.4;
        }

        /* entrance cascade — header → hero → card → sources */
        .status-reveal {
          animation: status-reveal-in 700ms cubic-bezier(0.22, 1, 0.36, 1)
            backwards;
          animation-delay: var(--sr, 0ms);
        }
        @keyframes status-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }

        /* 90-day cells paint oldest → newest on first data arrival
           (--ci is the cell index, set inline by DayBar) */
        .status-cell {
          transform-origin: bottom;
          transition: filter 140ms ease;
        }
        .status-cell:hover {
          filter: brightness(1.35);
        }
        /* on paper, brightening washes toward white — darken instead */
        html.light .status-cell:hover {
          filter: brightness(0.82);
        }
        /* incident cells sit in the tab order; give focus a designed ring
           instead of the UA default blue */
        .status-cell:focus-visible {
          outline: 1px solid rgb(var(--z400) / 0.9);
          outline-offset: 1px;
        }
        .status-cell-in {
          animation: status-cell-in 240ms cubic-bezier(0.22, 1, 0.36, 1)
            backwards;
          animation-delay: calc(var(--ci) * 6ms);
        }
        @keyframes status-cell-in {
          from {
            opacity: 0;
            transform: scaleY(0.35);
          }
        }

        /* operational cockpit lamps breathe; down lamps burn steady */
        .status-lamp-live {
          animation: status-lamp-breathe 2600ms ease-in-out infinite;
        }
        @keyframes status-lamp-breathe {
          0%,
          100% {
            box-shadow:
              0 0 5px rgb(var(--sev-ok) / calc(0.45 * var(--status-glow))),
              0 0 12px rgb(var(--sev-ok) / calc(0.18 * var(--status-glow)));
          }
          50% {
            box-shadow:
              0 0 9px rgb(var(--sev-ok) / calc(0.85 * var(--status-glow))),
              0 0 20px rgb(var(--sev-ok) / calc(0.35 * var(--status-glow)));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .status-reveal,
          .status-cell-in,
          .status-lamp-live {
            animation: none;
          }
          .status-cell {
            transition: none;
          }
        }
      `}</style>
    </div>
  )
}
