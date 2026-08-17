// The Cribble cockpit row: three live probe lamps — Web / API /
// Database — read from the payload's components, never an invented
// history bar. Operational lamps breathe in the accent; down lamps burn
// steady ember; a probe we could not read stays a hollow zinc ring.
// Dotted leaders run label → lamp, the dossier instrument idiom.

import type { ServiceComponent, Severity } from '@/lib/status/types'
import { StatusGlyph } from '@/components/status/StatusGlyph'
import { lampWord, severityColor } from '@/components/status/severity'

const LAMPS = ['web', 'api', 'database'] as const

function lampSeverity(
  components: ServiceComponent[],
  lamp: (typeof LAMPS)[number]
): Severity {
  const hit = components.find((c) => c.name.trim().toLowerCase() === lamp)
  return hit ? hit.severity : 'unknown'
}

export function CribbleLamps({
  components
}: {
  components: ServiceComponent[]
}) {
  return (
    <div className="glass-inset-lite grid gap-2.5 rounded-lg px-3.5 py-3 sm:grid-cols-3 sm:gap-4">
      {LAMPS.map((lamp) => {
        const severity = lampSeverity(components, lamp)
        return (
          <div key={lamp} className="flex items-baseline gap-2">
            <span className="font-data text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              {lamp}
            </span>
            <span aria-hidden className="dash-leader-dots" />
            <StatusGlyph
              severity={severity}
              size={8}
              pulse
              className="self-center"
            />
            <span
              className="font-data text-[9px] tracking-[0.25em]"
              style={{ color: severityColor(severity) }}
            >
              {lampWord(severity)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
