'use client'

// The operator's voice on /status. BULLETIN is one open incident as a
// stamped slip clipped to the console: square corners against the
// rounded glass watchlist (so it reads as an alert, not a card), a
// thick left rule and hairline frame in the declared severity's ink,
// and inside it the log — newest line first — set as a 1px-gapped
// grid on a contrasting field so the rows compartmentalise without a
// border declaration in sight. Type runs bimodal on purpose: a heavy
// uppercase display headline over 9px tracked telemetry. Every ink
// resolves through the --sev-* tokens, so light mode re-pins itself.
// RecentNotices is the resolved tail under the watchlist: date, ink
// stamp, title, elapsed — one line each, expandable to the thread.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { IncidentThread, NoticeEntry } from '@/lib/status/types'
import { StatusGlyph } from '@/components/status/StatusGlyph'
import {
  formatSpan,
  formatUtcDay,
  formatUtcTime,
  phaseLabel,
  severityColor,
  severityLabel
} from '@/components/status/severity'

function kindWord(thread: IncidentThread): string {
  return thread.phase === 'maintenance' ? 'MAINTENANCE' : 'INCIDENT'
}

/** Short reference for the footer stamp — the first uuid block. */
function refOf(incidentId: string): string {
  return incidentId.slice(0, 8).toUpperCase()
}

function LogLine({ entry, latest }: { entry: NoticeEntry; latest: boolean }) {
  return (
    <li
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[3.5rem_7.5rem_1fr] sm:px-5"
      style={{ background: 'var(--bulletin-row)' }}
    >
      <time
        dateTime={entry.at}
        className="font-data text-[10px] tabular-nums tracking-[0.2em] text-zinc-500"
      >
        {formatUtcTime(entry.at).slice(0, 5)}
      </time>
      <span
        className="font-data text-[9px] uppercase tracking-[0.25em]"
        style={{ color: severityColor(entry.severity) }}
      >
        <span aria-hidden className="mr-1.5 text-zinc-600">
          ▸
        </span>
        {phaseLabel(entry.phase)}
      </span>
      <p
        className={`col-span-2 text-[13px] leading-relaxed sm:col-span-1 ${
          latest ? 'text-zinc-100' : 'text-zinc-400'
        }`}
      >
        {entry.body}
      </p>
    </li>
  )
}

export function Bulletin({ thread }: { thread: IncidentThread }) {
  const ink = severityColor(thread.severity)
  const frame: CSSProperties = {
    borderColor: severityColor(thread.severity, 0.4),
    borderLeftColor: ink,
    background: severityColor(thread.severity, 0.04)
  }
  const hazard = thread.severity === 'outage'

  return (
    <article
      aria-label={`${kindWord(thread)}: ${thread.title}`}
      className="status-bulletin relative border border-l-[3px]"
      style={frame}
    >
      {hazard && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{
            backgroundImage: `repeating-linear-gradient(135deg, ${severityColor('outage', 0.85)} 0 6px, transparent 6px 12px)`
          }}
        />
      )}

      {/* header strip — kind · severity · opened */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pb-3 pt-4 sm:px-5">
        <span className="font-data text-[9px] uppercase tracking-[0.35em] text-zinc-300">
          [ {kindWord(thread)} ]
        </span>
        <span
          className="inline-flex items-center gap-1.5 font-data text-[9px] uppercase tracking-[0.25em]"
          style={{ color: ink }}
        >
          <StatusGlyph severity={thread.severity} size={7} />
          {severityLabel(thread.severity)}
        </span>
        <span aria-hidden className="dash-leader-dots hidden sm:block" />
        <span className="ml-auto font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600 sm:ml-0">
          opened {formatUtcDay(thread.openedAt.slice(0, 10))} · {formatUtcTime(thread.openedAt).slice(0, 5)} utc
        </span>
      </header>

      {/* headline — the one loud thing on the page */}
      <h2
        className="px-4 pb-4 font-display font-semibold uppercase text-zinc-50 sm:px-5"
        style={{
          fontSize: 'clamp(1.375rem, 3.2vw, 1.875rem)',
          letterSpacing: '-0.02em',
          lineHeight: 0.95
        }}
      >
        {thread.title}
      </h2>

      {/* the log — newest first, 1px-gapped grid */}
      <ol
        className="grid gap-px border-t"
        style={{
          borderColor: severityColor(thread.severity, 0.25),
          background: severityColor(thread.severity, 0.18)
        }}
      >
        {thread.entries.map((entry, index) => (
          <LogLine key={entry.id} entry={entry} latest={index === 0} />
        ))}
      </ol>

      {/* footer strip */}
      <footer
        className="flex items-baseline justify-between gap-4 border-t px-4 py-2.5 sm:px-5"
        style={{ borderColor: severityColor(thread.severity, 0.25) }}
      >
        <span className="font-data text-[9px] uppercase tracking-[0.3em] text-zinc-500">
          <span className="text-zinc-700">{'>>> '}</span>
          {thread.open ? 'updates as we have them' : 'resolved'}
          {' · '}
          <span className="text-zinc-400">{phaseLabel(thread.phase)}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600">
            ref {refOf(thread.incidentId)}
          </span>
          <span aria-hidden className="dash-barcode hidden h-3 w-14 sm:block" />
        </span>
      </footer>
    </article>
  )
}

function RecentRow({ thread }: { thread: IncidentThread }) {
  const [open, setOpen] = useState(false)
  const resolvedAt = thread.resolvedAt ?? thread.updatedAt
  const panelId = `status-recent-${thread.incidentId.slice(0, 8)}`
  return (
    <li className="px-4 py-3 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
      >
        <span className="font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600">
          {formatUtcDay(resolvedAt.slice(0, 10))}
        </span>
        <span
          className="font-data text-[9px] uppercase tracking-[0.25em]"
          style={{ color: severityColor('operational') }}
        >
          resolved
        </span>
        <span className="font-display text-[13px] tracking-wide text-zinc-300">
          {thread.title}
        </span>
        <span aria-hidden className="dash-leader-dots hidden sm:block" />
        <span className="ml-auto font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600 sm:ml-0">
          {formatSpan(thread.openedAt, resolvedAt)}
        </span>
        <span
          aria-hidden
          className={`font-data text-[9px] text-zinc-600 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
      </button>
      {open && (
        <ol id={panelId} className="mt-3 grid gap-px bg-white/[0.04]">
          {thread.entries.map((entry, index) => (
            <LogLine key={entry.id} entry={entry} latest={index === 0} />
          ))}
        </ol>
      )}
    </li>
  )
}

export function RecentNotices({ threads }: { threads: IncidentThread[] }) {
  if (threads.length === 0) return null
  return (
    <div className="status-recent glass-lite relative overflow-hidden rounded-2xl">
      <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] px-4 pb-3 pt-4 sm:px-5">
        <span className="font-data text-[10px] uppercase tracking-[0.4em] text-zinc-300">
          <span className="text-accent/80">{'// '}</span>recent
        </span>
        <span className="font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600">
          last 14 days
        </span>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {threads.map((thread) => (
          <RecentRow key={thread.incidentId} thread={thread} />
        ))}
      </ul>
    </div>
  )
}
