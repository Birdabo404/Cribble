// SYSTEM LOG — the RECORD pane's "what happened lately" strip: the
// entries buildSystemLog (systemLogEntries.ts) assembles from the payload,
// newest first, as mono rows `YYYY-MM-DD · EVENT · detail`. The event
// word is already the head of each entry's text (DECORATION, PUSH,
// IN FLIGHT, ENLISTED, LAST SEEN); the marker fills for something the
// pilot did and stays hollow for the passive stamps. Every row is a
// .pf-row so the boot / pane-swap stagger applies with no motion code
// here.

import { Marker } from './parts'
import type { LogEntry, LogKind } from './systemLogEntries'

/** Filled marker for an action the pilot took, hollow for a timestamp
 *  the system recorded about them. */
function activeKind(kind: LogKind): boolean {
  switch (kind) {
    case 'badge':
    case 'push':
    case 'inflight':
      return true
    case 'joined':
    case 'seen':
      return false
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

export function SystemLog({ entries, className = '' }: { entries: LogEntry[]; className?: string }) {
  return (
    <section aria-label="System log" className={className}>
      <header className="flex items-baseline justify-between gap-3">
        <span className="pf-label">SYSTEM LOG</span>
        <span className="pf-micro">LAST {entries.length}</span>
      </header>
      {entries.length === 0 ? (
        <p className="pf-micro mt-3">NO EVENTS ON FILE</p>
      ) : (
        <ol className="mt-3 border-t border-[color:var(--pf-line-soft)]">
          {entries.map((entry) => (
            <li
              key={`${entry.at}:${entry.kind}:${entry.text}`}
              className="pf-row flex items-center gap-3 border-b border-[color:var(--pf-line-soft)] py-2 font-data text-[11px] uppercase tracking-[0.12em]"
            >
              <Marker hollow={!activeKind(entry.kind)} style={{ color: 'var(--pf-ink-2)' }} />
              <time dateTime={entry.at} className="shrink-0 tabular-nums" style={{ color: 'var(--pf-ink-3)' }}>
                {entry.at.slice(0, 10)}
              </time>
              <span aria-hidden className="shrink-0" style={{ color: 'var(--pf-ink-3)' }}>
                ·
              </span>
              <span className="min-w-0 truncate" style={{ color: 'var(--pf-ink-2)' }}>
                {entry.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
