import { formatCompact, formatDuration } from '@/components/dashboard-v2/format'
import { animDelay } from './anim'
import { Panel, PanelHeader } from './Panel'
import type { ToolRow } from '@/types/dashboard'

export function ToolsCard({ tools }: { tools: ToolRow[] }) {
  return (
    <Panel className="col-span-12 lg:col-span-4 p-6">
      <PanelHeader title="TOP TOOLS" subtitle="By contribution to score" />

      {tools.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-800 p-4 text-xs leading-relaxed text-zinc-500">
          No AI tool usage detected yet. Open ChatGPT, Claude, or Cursor with the extension
          installed to start earning points.
        </div>
      ) : (
        <ul className="mt-5 space-y-4">
          {tools.map((t, i) => (
            <li key={t.name} className="anim-rise" style={animDelay(140 + i * 110)}>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-accent/70 w-4 text-right tabular-nums shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-zinc-100 truncate">{t.name}</span>
                </div>
                <span className="text-zinc-300 font-semibold tabular-nums shrink-0">
                  {t.percent}%
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="anim-grow-x h-full bg-gradient-to-r from-accent/65 to-accent"
                  style={{ width: `${Math.max(2, t.percent)}%`, ...animDelay(320 + i * 110) }}
                />
              </div>
              <div className="mt-1 flex items-center gap-3 pl-6 text-[10px] text-zinc-500 tabular-nums">
                <span>{formatCompact(t.visits)} visits</span>
                <span className="text-zinc-800">·</span>
                <span>{formatDuration(t.active_ms)} active</span>
                <span className="text-zinc-800">·</span>
                <span>{formatCompact(Math.round(t.score))} pts</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
