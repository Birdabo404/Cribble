'use client'

// One service on the watchlist. Vendors: severity glyph + Space Grotesk
// name + severity readout, a dotted leader out to the "N% quiet" ratio
// and the official-source link, the 90-day bar (or the honest "no
// published history" strip when a vendor publishes none) beneath, then
// a components disclosure that expands to severity-dotted chips.
// Cribble is the cockpit row: no invented history, just live lamps.

import { useState } from 'react'
import type { ServiceStatus } from '@/lib/status/types'
import { CribbleLamps } from '@/components/status/CribbleLamps'
import { DayBar } from '@/components/status/DayBar'
import { StatusGlyph } from '@/components/status/StatusGlyph'
import {
  formatUtcTime,
  severityColor,
  severityLabel
} from '@/components/status/severity'

function ExternalArrow({ size = 9 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  )
}

export function ServiceRow({ service }: { service: ServiceStatus }) {
  const [open, setOpen] = useState(false)
  const isCribble = service.id === 'cribble'
  const days = service.days
  const quiet =
    typeof service.quietRatio === 'number'
      ? Math.round(service.quietRatio * 100)
      : null
  const panelId = `status-components-${service.id}`

  return (
    <div className="px-4 py-4 transition-colors hover:bg-white/[0.02] sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <StatusGlyph severity={service.severity} className="self-center" />
        <span className="font-display text-[15px] font-medium tracking-wide text-zinc-100">
          {service.name}
        </span>
        <span
          className="font-data text-[9px] uppercase tracking-[0.25em]"
          style={{ color: severityColor(service.severity) }}
        >
          {severityLabel(service.severity)}
        </span>
        <span aria-hidden className="dash-leader-dots hidden sm:block" />
        {quiet !== null && (
          <span className="ml-auto font-data text-[10px] tracking-[0.2em] sm:ml-0">
            <span className="text-zinc-200">{quiet}%</span>{' '}
            <span className="text-zinc-600">QUIET</span>
          </span>
        )}
        {isCribble ? (
          <span className="ml-auto font-data text-[9px] uppercase tracking-[0.3em] text-zinc-600 sm:ml-0">
            live probes
          </span>
        ) : (
          <a
            href={service.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`${service.name} official status page`}
            className={`${quiet === null ? 'ml-auto sm:ml-0 ' : ''}inline-flex items-center gap-1 rounded font-data text-[9px] uppercase tracking-[0.25em] text-zinc-600 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500`}
          >
            <span className="hidden sm:inline">source</span>
            <ExternalArrow />
          </a>
        )}
      </div>

      <div className="mt-3">
        {isCribble ? (
          <CribbleLamps components={service.components} />
        ) : days && days.length > 0 ? (
          <DayBar days={days} serviceName={service.name} />
        ) : (
          <div className="flex h-7 items-center justify-center rounded border border-dashed border-zinc-800">
            <span className="font-data text-[9px] uppercase tracking-[0.3em] text-zinc-600">
              no published history
            </span>
          </div>
        )}
      </div>

      {!isCribble && service.components.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="inline-flex items-center gap-1.5 rounded font-data text-[9px] uppercase tracking-[0.3em] text-zinc-600 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
          >
            <span
              aria-hidden
              className={`inline-block transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
            {service.components.length}{' '}
            {service.components.length === 1 ? 'component' : 'components'}
          </button>

          {open && (
            <div id={panelId} className="mt-2.5 space-y-2.5">
              {service.description !== '' && (
                <p className="font-data text-[10px] leading-relaxed text-zinc-600">
                  “{service.description}”
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {service.components.map((component, i) => (
                  <span
                    key={`${component.name}-${i}`}
                    className="inline-flex max-w-[240px] items-center gap-1.5 rounded border border-zinc-800 bg-white/[0.02] px-2 py-1"
                  >
                    <StatusGlyph severity={component.severity} size={6} />
                    <span className="truncate font-data text-[9px] uppercase tracking-[0.18em] text-zinc-400">
                      {component.name}
                    </span>
                  </span>
                ))}
              </div>
              <p className="font-data text-[9px] uppercase tracking-[0.25em] text-zinc-700">
                feed read {formatUtcTime(service.fetchedAt)} utc
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
